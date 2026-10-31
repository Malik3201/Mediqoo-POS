import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import AiModelRegistry from "@/models/AiModelRegistry";
import { adminHandler } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { decryptApiKey } from "@/lib/ai/crypto";
import { groqListModels } from "@/lib/ai/groq";
import { seedModelsIfEmpty } from "@/lib/ai/models";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Verifies the registry against the models actually visible to a healthy configured credential. */
export const POST = adminHandler(async (_req, actor) => {
  await seedModelsIfEmpty();
  const candidates: any[] = await AiCredential.find({ enabled: true, status: { $in: ["Healthy", "Rate Limited", "Temporarily Unavailable"] } })
    .select("+encrypted_key")
    .limit(3);
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false, available: [], verified: 0, message: "No healthy API key is available to verify models. Add or fix a key first." });
  }

  let available: string[] | null = null;
  let lastMsg = "";
  for (const c of candidates) {
    try {
      const r = await groqListModels(decryptApiKey(c.encrypted_key));
      if (r.outcome === "ok") {
        available = r.models;
        break;
      }
      lastMsg = `Groq returned ${r.httpStatus ?? r.outcome}.`;
    } catch {
      lastMsg = "A stored key could not be decrypted.";
    }
  }
  if (!available) return NextResponse.json({ ok: false, available: [], verified: 0, message: `Could not list models. ${lastMsg}` });

  const set = new Set(available);
  const models: any[] = await AiModelRegistry.find({});
  let verified = 0;
  const missing: string[] = [];
  for (const m of models) {
    if (set.has(m.provider_model_id)) {
      m.availability = "available";
      m.last_verified_at = new Date();
      m.last_error = null;
      verified += 1;
    } else {
      m.availability = "unavailable";
      m.last_verified_at = new Date();
      m.last_error = "Not available on the configured Groq account.";
      missing.push(m.provider_model_id);
    }
    await m.save();
  }
  await aiAudit(actor, "models_verified", "ai_model", "registry", { verified, missing });
  return NextResponse.json({
    ok: true,
    available,
    verified,
    message: missing.length
      ? `${verified} model(s) verified. Not available on this account: ${missing.join(", ")}. They will not be routed to.`
      : `All ${verified} registry model(s) verified.`,
  });
});

