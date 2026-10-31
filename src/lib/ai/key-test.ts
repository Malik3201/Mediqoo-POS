import AiCredential from "@/models/AiCredential";
import AiOrgPool from "@/models/AiOrgPool";
import { decryptApiKey } from "./crypto";
import { groqListModels } from "./groq";
import { syncModelsWithProviderList } from "./models";
import { cooldownAfter429 } from "./routing-core";
import { raiseAlert, autoResolveAlerts } from "./alerts";

/**
 * Validates a stored key with a cheap, token-free provider call (GET /models) and records the
 * outcome in the key's health history. Rate limited (429) is treated as TEMPORARY, never "dead".
 */
export async function testCredential(credId: string) {
  const doc: any = await AiCredential.findOne({ id: credId }).select("+encrypted_key");
  if (!doc) throw new Error("Key not found");
  let apiKey = "";
  try {
    apiKey = decryptApiKey(doc.encrypted_key);
  } catch {
    await AiCredential.updateOne(
      { id: credId },
      { $set: { status: "Needs Attention", last_failure_at: new Date(), last_failure_reason: "Stored key could not be decrypted with the server encryption key." } }
    );
    return { ok: false, http_status: null as number | null, latency_ms: null as number | null, message: "The stored key could not be decrypted. Re-enter the key.", models: [] as string[] };
  }

  const r = await groqListModels(apiKey);
  apiKey = "";
  const now = new Date();
  let status = doc.status as string;
  let message = "";
  let reason: string | null = null;

  switch (r.outcome) {
    case "ok":
      status = "Healthy";
      message = `Key is valid. ${r.models.length} models visible to this account.`;
      await AiCredential.updateOne(
        { id: credId },
        { $set: { status, cooldown_until: null, last_success_at: now, consecutive_failures: 0, last_http_status: r.httpStatus } }
      );
      if (r.models.length > 0) {
        await syncModelsWithProviderList(r.models).catch(() => {});
      }
      void autoResolveAlerts("api_key_invalid", "credential", credId);
      break;
    case "invalid_credentials":
      status = "Invalid Credentials";
      message = "Groq rejected this key (401). It is revoked, expired or mistyped.";
      reason = "Provider rejected the key (401)";
      await raiseAlert({
        type: "api_key_invalid",
        severity: "critical",
        title: `${doc.name} requires attention`,
        reason: message,
        recommendedAction: "Rotate or replace this key in AI Management → API Keys.",
        entityType: "credential",
        entityId: credId,
        entityName: doc.name,
      });
      break;
    case "access_denied":
      status = "Needs Attention";
      message = "Access denied (403). Check the key's project permissions.";
      reason = "Access denied (403)";
      break;
    case "rate_limited": {
      status = "Rate Limited";
      const until = new Date(now.getTime() + cooldownAfter429({}));
      message = "Groq is rate limiting this organization right now (temporary). The key itself is not marked invalid.";
      reason = "Rate limited (429) — temporary";
      await AiCredential.updateOne({ id: credId }, { $set: { cooldown_until: until } });
      await AiOrgPool.updateOne({ organization_id: doc.organization_id }, { $set: { status: "Rate Limited", rate_limited_until: until } });
      break;
    }
    default:
      status = "Temporarily Unavailable";
      message = r.outcome === "timeout" ? "Groq did not respond in time. Try again shortly." : "Could not reach Groq right now. Try again shortly.";
      reason = r.outcome;
  }

  if (r.outcome !== "ok") {
    await AiCredential.updateOne(
      { id: credId },
      {
        $set: { status, last_failure_at: now, last_failure_reason: reason, last_http_status: r.httpStatus },
        $inc: { total_failures: 1 },
      }
    );
  }
  await AiCredential.updateOne(
    { id: credId },
    {
      $push: {
        health_history: {
          $each: [{ timestamp: now, status, http_status: r.httpStatus, latency_ms: r.latencyMs, reason: reason || "Manual test OK" }],
          $slice: -60,
        },
      },
    }
  );
  return { ok: r.outcome === "ok", http_status: r.httpStatus, latency_ms: r.latencyMs, message, models: r.models };
}

