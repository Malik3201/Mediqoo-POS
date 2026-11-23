import crypto from "crypto";
import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import AiOrgPool from "@/models/AiOrgPool";
import { adminHandler, serializeKey, serializeModel } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import {
  encryptApiKey,
  fingerprintApiKey,
  maskApiKey,
  validateCustomApiKeyFormat,
  validateGroqKeyFormat,
} from "@/lib/ai/crypto";
import { ensurePool } from "@/lib/ai/router";
import { raiseAlert } from "@/lib/ai/alerts";
import { upsertCustomModelForCredential } from "@/lib/ai/model-admin";
import {
  inferProviderLabel,
  validateAndNormalizeBaseUrl,
  validateCustomModelId,
} from "@/lib/ai/universal-client";

export const dynamic = "force-dynamic";

function slugifyPool(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "api").slice(0, 32);
}

function parseAllowedModels(raw: unknown): string[] {
  if (!raw) return [];
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

export const GET = adminHandler(async () => {
  const [keys, pools] = await Promise.all([AiCredential.find({}).sort({ created_at: 1 }).lean(), AiOrgPool.find({}).lean()]);
  const now = Date.now();
  const poolOut = pools.map((p: any) => {
    const orgKeys = keys.filter((k: any) => k.organization_id === p.organization_id);
    const healthy = orgKeys.filter((k: any) => k.enabled && k.status === "Healthy").length;
    const limited = p.rate_limited_until && new Date(p.rate_limited_until).getTime() > now;
    const circuit = p.circuit_open_until && new Date(p.circuit_open_until).getTime() > now;
    const isCustomPool = orgKeys.length > 0 && orgKeys.every((k: any) => k.provider === "custom");
    return {
      organization_id: p.organization_id,
      organization_name: p.organization_name,
      provider: isCustomPool ? "custom" : "groq",
      provider_label: isCustomPool ? orgKeys[0]?.provider_label || "Universal API" : "Groq",
      status: limited ? "Rate Limited" : circuit ? "Temporarily Unavailable" : p.status,
      rate_limited_until: limited ? p.rate_limited_until : null,
      circuit_open_until: circuit ? p.circuit_open_until : null,
      in_flight_requests: p.in_flight_requests || 0,
      daily_requests_used: p.daily_requests_used || 0,
      daily_request_limit: p.daily_request_limit,
      daily_tokens_used: p.daily_tokens_used || 0,
      daily_token_limit: p.daily_token_limit,
      minute_requests_used: p.minute_requests_used || 0,
      minute_request_limit: p.minute_request_limit,
      key_count: orgKeys.length,
      healthy_key_count: healthy,
    };
  });
  return NextResponse.json({ keys: keys.map(serializeKey), pools: poolOut });
});

export const POST = adminHandler(async (req, actor) => {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider === "custom" ? "custom" : "groq";
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const weight = Math.min(1000, Math.max(1, Math.round(Number(body.weight) || 100)));

  if (provider === "custom") {
    const baseCheck = validateAndNormalizeBaseUrl(body.base_url);
    if (!baseCheck.valid || !baseCheck.normalized) {
      return NextResponse.json({ error: baseCheck.reason || "Valid Base URL is required." }, { status: 400 });
    }
    const modelCheck = validateCustomModelId(body.default_model);
    if (!modelCheck.valid || !modelCheck.value) {
      return NextResponse.json({ error: modelCheck.reason || "Model name is required." }, { status: 400 });
    }
    const keyFmt = validateCustomApiKeyFormat(apiKey);
    if (!keyFmt.valid) {
      return NextResponse.json({ error: keyFmt.reason }, { status: 400 });
    }

    const defaultModel = modelCheck.value;
    const providerLabel =
      String(body.provider_label || "").trim().slice(0, 60) || inferProviderLabel(baseCheck.normalized);
    const name =
      String(body.name || "").trim().slice(0, 80) || `${providerLabel} (${defaultModel})`.slice(0, 80);

    const extraModels = parseAllowedModels(body.allowed_models);
    const allowedModels = Array.from(new Set([defaultModel, ...extraModels]));

    const organizationId =
      String(body.organization_id || "").trim().slice(0, 120) ||
      `custom:${slugifyPool(providerLabel)}:${crypto.randomUUID().slice(0, 8)}`;
    const organizationName =
      String(body.organization_name || "").trim().slice(0, 120) ||
      `${providerLabel}${baseCheck.host ? ` · ${baseCheck.host}` : ""}`.slice(0, 120);

    const fingerprint = fingerprintApiKey(apiKey);
    const dup = await AiCredential.findOne({
      key_fingerprint: fingerprint,
      provider: "custom",
      base_url: baseCheck.normalized,
      default_model: defaultModel,
    }).lean();
    if (dup) {
      return NextResponse.json(
        { error: "This API key is already registered for the same Base URL and Model." },
        { status: 400 }
      );
    }

    const enc = encryptApiKey(apiKey);
    const doc: any = await AiCredential.create({
      name,
      provider: "custom",
      base_url: baseCheck.normalized,
      default_model: defaultModel,
      provider_label: providerLabel,
      allowed_models: allowedModels,
      organization_id: organizationId,
      organization_name: organizationName,
      masked_key: maskApiKey(apiKey),
      key_fingerprint: fingerprint,
      encrypted_key: enc,
      weight,
      status: "Healthy",
      created_by: actor.email,
      updated_by: actor.email,
      health_history: [{ timestamp: new Date(), status: "Healthy", reason: "Universal API key added (not yet tested)" }],
    });

    await ensurePool(organizationId, organizationName);

    const setAsPrimary = body.set_as_primary === true;
    const primaryModel = await upsertCustomModelForCredential({
      modelId: defaultModel,
      providerLabel,
      setAsPrimary,
    });
    for (const extra of allowedModels) {
      if (extra !== defaultModel) {
        await upsertCustomModelForCredential({ modelId: extra, providerLabel, setAsPrimary: false });
      }
    }

    await aiAudit(actor, "credential_created", "ai_credential", doc.id, {
      name,
      provider: "custom",
      provider_label: providerLabel,
      base_url: baseCheck.normalized,
      default_model: defaultModel,
      set_as_primary: setAsPrimary,
      organization_id: organizationId,
      masked_key: doc.masked_key,
    });

    const recent = await AiCredential.countDocuments({ created_at: { $gte: new Date(Date.now() - 10 * 60_000) } });
    if (recent >= 5) {
      await raiseAlert({
        type: "suspicious_credential_activity",
        severity: "warning",
        title: "Several API keys were added in a short time",
        reason: `${recent} credentials were created in the last 10 minutes.`,
        recommendedAction: "Review the Audit log to confirm these additions were intended.",
        entityType: "gateway",
        entityId: "credential-management",
        entityName: "Credential management",
      });
    }

    return NextResponse.json({
      key: serializeKey(doc.toObject()),
      model: serializeModel(primaryModel.toObject()),
    });
  }

  // Standard Groq credential creation (100% backward compatible)
  const name = String(body.name || "").trim().slice(0, 80);
  const organizationId = String(body.organization_id || "").trim().slice(0, 120);
  const organizationName = String(body.organization_name || "").trim().slice(0, 120) || organizationId;

  if (!name) return NextResponse.json({ error: "Key name is required." }, { status: 400 });
  if (!organizationId) return NextResponse.json({ error: "Groq organization / project is required (keys of one organization share one quota pool)." }, { status: 400 });
  const fmt = validateGroqKeyFormat(apiKey);
  if (!fmt.valid) return NextResponse.json({ error: fmt.reason }, { status: 400 });

  const fingerprint = fingerprintApiKey(apiKey);
  const dup = await AiCredential.findOne({ key_fingerprint: fingerprint, provider: { $ne: "custom" } }).lean();
  if (dup) return NextResponse.json({ error: "This API key is already registered." }, { status: 400 });

  const enc = encryptApiKey(apiKey);
  const doc: any = await AiCredential.create({
    name,
    provider: "groq",
    organization_id: organizationId,
    organization_name: organizationName,
    masked_key: maskApiKey(apiKey),
    key_fingerprint: fingerprint,
    encrypted_key: enc,
    weight,
    status: "Healthy",
    created_by: actor.email,
    updated_by: actor.email,
    health_history: [{ timestamp: new Date(), status: "Healthy", reason: "Key added (not yet tested)" }],
  });
  await ensurePool(organizationId, organizationName);
  await aiAudit(actor, "credential_created", "ai_credential", doc.id, { name, provider: "groq", organization_id: organizationId, masked_key: doc.masked_key });

  // Suspicious activity: many credential creations in a short window.
  const recent = await AiCredential.countDocuments({ created_at: { $gte: new Date(Date.now() - 10 * 60_000) } });
  if (recent >= 5) {
    await raiseAlert({
      type: "suspicious_credential_activity",
      severity: "warning",
      title: "Several API keys were added in a short time",
      reason: `${recent} credentials were created in the last 10 minutes.`,
      recommendedAction: "Review the Audit log to confirm these additions were intended.",
      entityType: "gateway",
      entityId: "credential-management",
      entityName: "Credential management",
    });
  }
  return NextResponse.json({ key: serializeKey(doc.toObject()) });
});
