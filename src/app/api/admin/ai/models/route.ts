import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import AiModelRegistry from "@/models/AiModelRegistry";
import { adminHandler, serializeModel } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { seedModelsIfEmpty } from "@/lib/ai/models";
import { enforceSingleDefaults, pickModelFields } from "@/lib/ai/model-admin";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => {
  await seedModelsIfEmpty();
  const models = await AiModelRegistry.find({}).sort({ created_at: 1 }).lean();
  return NextResponse.json({ models: models.map(serializeModel) });
});

export const POST = adminHandler(async (req, actor) => {
  const body = await req.json().catch(() => ({}));
  const providerId = String(body.provider_model_id || "").trim();
  const name = String(body.model_name || "").trim();
  const provider = body.provider === "custom" ? "custom" : "groq";
  if (!providerId || !/^[A-Za-z0-9._\-/:@+]{2,160}$/.test(providerId)) return NextResponse.json({ error: "A valid provider model ID is required." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Model name is required." }, { status: 400 });
  if (await AiModelRegistry.exists({ provider_model_id: providerId })) return NextResponse.json({ error: "This model is already in the registry." }, { status: 400 });

  const fields = pickModelFields(body);
  const doc: any = await AiModelRegistry.create({
    ...fields,
    provider,
    model_name: name,
    provider_model_id: providerId,
    ...(provider === "custom" ? { availability: "available" } : {}),
  });
  await enforceSingleDefaults(doc.id, fields);

  // If linking directly to a configured Universal / Custom API credential, append to its allowed_models
  if (provider === "custom" && typeof body.credential_id === "string" && body.credential_id.trim()) {
    await AiCredential.updateOne(
      { id: body.credential_id.trim(), provider: "custom" },
      { $addToSet: { allowed_models: providerId } }
    );
  }

  await aiAudit(actor, "model_created", "ai_model", doc.id, { provider_model_id: providerId, provider });
  return NextResponse.json({ model: serializeModel(doc.toObject()) });
});
