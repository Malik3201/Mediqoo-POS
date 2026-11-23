import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import AiModelRegistry from "@/models/AiModelRegistry";
import AiOrgPool from "@/models/AiOrgPool";
import { adminHandler, serializeKey } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import {
  encryptApiKey,
  fingerprintApiKey,
  maskApiKey,
  validateCustomApiKeyFormat,
  validateGroqKeyFormat,
} from "@/lib/ai/crypto";
import { ensurePool } from "@/lib/ai/router";
import { upsertCustomModelForCredential } from "@/lib/ai/model-admin";
import {
  inferProviderLabel,
  validateAndNormalizeBaseUrl,
  validateCustomModelId,
} from "@/lib/ai/universal-client";

export const dynamic = "force-dynamic";

function parseAllowedModels(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\n,]+/)
      : [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const chk = validateCustomModelId(item);
    if (chk.valid && chk.value && !out.includes(chk.value)) {
      out.push(chk.value);
    }
  }
  return out.slice(0, 25);
}

export const PATCH = adminHandler<{ id: string }>(async (req, actor, { id }) => {
  const body = await req.json().catch(() => ({}));
  const doc: any = await AiCredential.findOne({ id });
  if (!doc) return NextResponse.json({ error: "Key not found." }, { status: 404 });

  const isCustom = doc.provider === "custom";
  const previousDefaultModel = doc.default_model ? String(doc.default_model) : null;
  const changes: Record<string, any> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    doc.name = body.name.trim().slice(0, 80);
    changes.name = doc.name;
  }
  if (typeof body.organization_id === "string" && body.organization_id.trim()) {
    doc.organization_id = body.organization_id.trim().slice(0, 120);
    changes.organization_id = doc.organization_id;
  }
  if (typeof body.organization_name === "string" && body.organization_name.trim()) {
    doc.organization_name = body.organization_name.trim().slice(0, 120);
    changes.organization_name = doc.organization_name;
  }
  if (typeof body.weight === "number") {
    doc.weight = Math.min(1000, Math.max(1, Math.round(body.weight)));
    changes.weight = doc.weight;
  }
  if (["none", "fallback_only", "test_only"].includes(body.admin_restriction)) {
    doc.admin_restriction = body.admin_restriction;
    changes.admin_restriction = doc.admin_restriction;
  }

  if (isCustom) {
    if (body.base_url !== undefined) {
      const baseCheck = validateAndNormalizeBaseUrl(body.base_url);
      if (!baseCheck.valid || !baseCheck.normalized) {
        return NextResponse.json({ error: baseCheck.reason || "Valid Base URL is required." }, { status: 400 });
      }
      doc.base_url = baseCheck.normalized;
      changes.base_url = doc.base_url;
    }

    if (body.provider_label !== undefined) {
      const lbl = String(body.provider_label || "").trim().slice(0, 60);
      doc.provider_label = lbl || inferProviderLabel(doc.base_url);
      changes.provider_label = doc.provider_label;
    }

    if (body.default_model !== undefined) {
      const modelCheck = validateCustomModelId(body.default_model);
      if (!modelCheck.valid || !modelCheck.value) {
        return NextResponse.json({ error: modelCheck.reason || "Model name is required." }, { status: 400 });
      }
      doc.default_model = modelCheck.value;
      changes.default_model = doc.default_model;
    }

    if (body.allowed_models !== undefined) {
      const parsed = parseAllowedModels(body.allowed_models);
      doc.allowed_models = doc.default_model
        ? Array.from(new Set([doc.default_model, ...parsed]))
        : parsed;
      changes.allowed_models = doc.allowed_models;
    } else if (body.default_model !== undefined && doc.default_model) {
      const existingAllowed: string[] = Array.isArray(doc.allowed_models) ? doc.allowed_models : [];
      const kept = previousDefaultModel
        ? existingAllowed.filter((m) => m !== previousDefaultModel)
        : existingAllowed;
      doc.allowed_models = Array.from(new Set([doc.default_model, ...kept]));
      changes.allowed_models = doc.allowed_models;
    }
  } else if (Array.isArray(body.allowed_models)) {
    doc.allowed_models = parseAllowedModels(body.allowed_models);
    changes.allowed_models = doc.allowed_models;
  }

  let action = "credential_updated";
  if (typeof body.enabled === "boolean" && body.enabled !== doc.enabled) {
    doc.enabled = body.enabled;
    if (!body.enabled) {
      doc.status = "Disabled";
    } else if (doc.status === "Disabled") {
      doc.status = "Healthy";
      doc.cooldown_until = null;
    }
    action = body.enabled ? "credential_enabled" : "credential_disabled";
    changes.enabled = body.enabled;
  }

  if (typeof body.api_key === "string" && body.api_key.trim()) {
    const apiKey = body.api_key.trim();
    const fmt = isCustom ? validateCustomApiKeyFormat(apiKey) : validateGroqKeyFormat(apiKey);
    if (!fmt.valid) return NextResponse.json({ error: fmt.reason }, { status: 400 });
    const fp = fingerprintApiKey(apiKey);
    const dupQuery = isCustom
      ? { key_fingerprint: fp, provider: "custom", base_url: doc.base_url, default_model: doc.default_model, id: { $ne: id } }
      : { key_fingerprint: fp, provider: { $ne: "custom" }, id: { $ne: id } };
    const dup = await AiCredential.findOne(dupQuery).lean();
    if (dup) return NextResponse.json({ error: "This API key is already registered." }, { status: 400 });
    doc.encrypted_key = encryptApiKey(apiKey);
    doc.key_fingerprint = fp;
    doc.masked_key = maskApiKey(apiKey);
    doc.rotated_at = new Date();
    doc.status = doc.enabled ? "Healthy" : "Disabled";
    doc.cooldown_until = null;
    doc.consecutive_failures = 0;
    doc.last_failure_reason = null;
    doc.health_history.push({ timestamp: new Date(), status: doc.status, reason: "Key rotated/replaced (not yet tested)" });
    action = "credential_rotated";
    changes.masked_key = doc.masked_key;
  }

  doc.updated_by = actor.email;
  await doc.save();
  await ensurePool(doc.organization_id, doc.organization_name);

  if (isCustom && doc.default_model) {
    let promotePrimary = body.set_as_primary === true;
    // If admin edited the model name of a key whose previous model was the active default, seamlessly follow it.
    if (!promotePrimary && body.set_as_primary !== false && previousDefaultModel && previousDefaultModel !== doc.default_model) {
      const oldReg: any = await AiModelRegistry.findOne({ provider_model_id: previousDefaultModel }).lean();
      if (oldReg?.is_default || oldReg?.is_complex_default) {
        promotePrimary = true;
      }
    }
    await upsertCustomModelForCredential({
      modelId: doc.default_model,
      providerLabel: doc.provider_label,
      setAsPrimary: promotePrimary,
    });
    for (const extra of doc.allowed_models || []) {
      if (extra !== doc.default_model) {
        await upsertCustomModelForCredential({ modelId: extra, providerLabel: doc.provider_label, setAsPrimary: false });
      }
    }
  }

  await aiAudit(actor, action, "ai_credential", doc.id, { name: doc.name, ...changes });
  return NextResponse.json({ key: serializeKey(doc.toObject()) });
});

export const DELETE = adminHandler<{ id: string }>(async (_req, actor, { id }) => {
  const doc: any = await AiCredential.findOne({ id }).lean();
  if (!doc) return NextResponse.json({ error: "Key not found." }, { status: 404 });
  await AiCredential.deleteOne({ id });
  if (doc.provider === "custom" && doc.organization_id) {
    const remaining = await AiCredential.countDocuments({ organization_id: doc.organization_id });
    if (remaining === 0) {
      await AiOrgPool.deleteOne({ organization_id: doc.organization_id }).catch(() => {});
    }
  }
  await aiAudit(actor, "credential_deleted", "ai_credential", id, {
    name: doc.name,
    provider: doc.provider || "groq",
    organization_id: doc.organization_id,
    masked_key: doc.masked_key,
  });
  return NextResponse.json({ ok: true });
});

