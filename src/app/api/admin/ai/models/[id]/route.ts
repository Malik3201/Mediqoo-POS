import { NextResponse } from "next/server";
import AiModelRegistry from "@/models/AiModelRegistry";
import { adminHandler, serializeModel } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { enforceSingleDefaults, pickModelFields } from "@/lib/ai/model-admin";

export const dynamic = "force-dynamic";

export const PATCH = adminHandler<{ id: string }>(async (req, actor, { id }) => {
  const body = await req.json().catch(() => ({}));
  const fields = pickModelFields(body);
  if (Object.keys(fields).length === 0) return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  const doc: any = await AiModelRegistry.findOneAndUpdate({ id }, { $set: fields }, { new: true });
  if (!doc) return NextResponse.json({ error: "Model not found." }, { status: 404 });
  await enforceSingleDefaults(id, fields);
  await aiAudit(actor, "model_updated", "ai_model", id, { provider_model_id: doc.provider_model_id, ...fields });
  return NextResponse.json({ model: serializeModel(doc.toObject()) });
});

export const DELETE = adminHandler<{ id: string }>(async (_req, actor, { id }) => {
  const doc: any = await AiModelRegistry.findOneAndDelete({ id }).lean();
  if (!doc) return NextResponse.json({ error: "Model not found." }, { status: 404 });
  await aiAudit(actor, "model_deleted", "ai_model", id, { provider_model_id: doc.provider_model_id });
  return NextResponse.json({ ok: true });
});

