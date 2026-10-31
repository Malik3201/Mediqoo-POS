import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import { adminHandler, serializeKey } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { encryptApiKey, fingerprintApiKey, maskApiKey, validateGroqKeyFormat } from "@/lib/ai/crypto";
import { ensurePool } from "@/lib/ai/router";

export const dynamic = "force-dynamic";

export const PATCH = adminHandler<{ id: string }>(async (req, actor, { id }) => {
  const body = await req.json().catch(() => ({}));
  const doc: any = await AiCredential.findOne({ id });
  if (!doc) return NextResponse.json({ error: "Key not found." }, { status: 404 });

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
    const fmt = validateGroqKeyFormat(apiKey);
    if (!fmt.valid) return NextResponse.json({ error: fmt.reason }, { status: 400 });
    const fp = fingerprintApiKey(apiKey);
    const dup = await AiCredential.findOne({ key_fingerprint: fp, id: { $ne: id } }).lean();
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
  await aiAudit(actor, action, "ai_credential", doc.id, { name: doc.name, ...changes });
  return NextResponse.json({ key: serializeKey(doc.toObject()) });
});

export const DELETE = adminHandler<{ id: string }>(async (_req, actor, { id }) => {
  const doc: any = await AiCredential.findOne({ id }).lean();
  if (!doc) return NextResponse.json({ error: "Key not found." }, { status: 404 });
  await AiCredential.deleteOne({ id });
  await aiAudit(actor, "credential_deleted", "ai_credential", id, { name: doc.name, organization_id: doc.organization_id, masked_key: doc.masked_key });
  return NextResponse.json({ ok: true });
});

