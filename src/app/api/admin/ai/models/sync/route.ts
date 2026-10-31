import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import { adminHandler } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { decryptApiKey } from "@/lib/ai/crypto";
import { groqListModels } from "@/lib/ai/groq";
import { seedModelsIfEmpty, syncModelsWithProviderList } from "@/lib/ai/models";

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

  const { verified, missing } = await syncModelsWithProviderList(available);
  await aiAudit(actor, "models_verified", "ai_model", "registry", { verified, missing });
  return NextResponse.json({
    ok: true,
    available,
    verified,
    message: missing.length
      ? `${verified} model(s) verified and enabled. Not available on this account: ${missing.join(", ")}.`
      : `All ${verified} registry model(s) verified.`,
  });
});
