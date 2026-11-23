import AiCredential from "@/models/AiCredential";
import AiModelRegistry from "@/models/AiModelRegistry";
import AiOrgPool from "@/models/AiOrgPool";
import { decryptApiKey } from "./crypto";
import { groqChat, groqListModels } from "./groq";
import { syncModelsWithProviderList } from "./models";
import { cooldownAfter429 } from "./routing-core";
import { raiseAlert, autoResolveAlerts } from "./alerts";
import { extractHostFromUrl, formatProviderErrorSnippet } from "./universal-client";

/**
 * Validates a stored key and records the outcome in the key's health history.
 * - For Groq keys: calls GET /models (token-free) and syncs the Groq model registry.
 * - For Universal / Custom OpenAI-compatible keys: sends a minimal max_tokens: 16 chat completion
 *   to the credential's normalized base_url using its default_model (or allowed_models[0]).
 * Rate limited (429) is treated as TEMPORARY, never "dead".
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

  const now = new Date();
  const isCustom = doc.provider === "custom";

  if (isCustom) {
    const baseUrl = String(doc.base_url || "").trim();
    const testModel = String(doc.default_model || doc.allowed_models?.[0] || "").trim();
    const providerName = doc.provider_label || extractHostFromUrl(baseUrl) || "Custom API";

    if (!baseUrl || !testModel) {
      apiKey = "";
      const msg = "Custom API key is missing a Base URL or Model Name. Edit the key to configure both.";
      await AiCredential.updateOne(
        { id: credId },
        {
          $set: { status: "Needs Attention", last_failure_at: now, last_failure_reason: msg, last_http_status: null },
          $push: {
            health_history: {
              $each: [{ timestamp: now, status: "Needs Attention", http_status: null, latency_ms: 0, reason: msg }],
              $slice: -60,
            },
          },
        }
      );
      return { ok: false, http_status: null as number | null, latency_ms: 0, message: msg, models: [] as string[] };
    }

    const r = await groqChat({
      apiKey,
      model: testModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 20_000,
      baseUrl,
      provider: "custom",
    });
    const detail = formatProviderErrorSnippet(r.errorText, apiKey);
    apiKey = "";

    let status = doc.status as string;
    let message = "";
    let reason: string | null = null;

    switch (r.outcome) {
      case "ok":
        status = "Healthy";
        message = `Connected to ${providerName} (${testModel}) successfully.`;
        await AiCredential.updateOne(
          { id: credId },
          { $set: { status, cooldown_until: null, last_success_at: now, consecutive_failures: 0, last_http_status: r.httpStatus } }
        );
        await AiModelRegistry.updateOne(
          { provider_model_id: testModel },
          { $set: { availability: "available", last_verified_at: now, last_error: null } }
        ).catch(() => {});
        void autoResolveAlerts("api_key_invalid", "credential", credId);
        break;
      case "invalid_credentials":
        status = "Invalid Credentials";
        message = `${providerName} rejected this API key (401). Check that the key is valid and active.`;
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
        if (r.httpStatus === 402) {
          message = `${providerName} returned 402 (insufficient balance or billing required).${detail ? ` ${detail}` : ""}`;
          reason = "Insufficient credits / billing required (402)";
        } else {
          message = `${providerName} denied access (403). Check API key permissions or model access.${detail ? ` ${detail}` : ""}`;
          reason = "Access denied (403)";
        }
        break;
      case "model_unsupported":
        status = "Needs Attention";
        message = `${providerName} could not run model "${testModel}" (${r.httpStatus ?? "error"}). Verify the exact model ID.${detail ? ` ${detail}` : ""}`;
        reason = `Model unsupported: ${testModel}`;
        break;
      case "rate_limited": {
        status = "Rate Limited";
        const until = new Date(now.getTime() + cooldownAfter429(r.headers || {}));
        message = `${providerName} is rate limiting requests right now (429). The key itself is not marked invalid.`;
        reason = "Rate limited (429) — temporary";
        await AiCredential.updateOne({ id: credId }, { $set: { cooldown_until: until } });
        await AiOrgPool.updateOne({ organization_id: doc.organization_id }, { $set: { status: "Rate Limited", rate_limited_until: until } });
        break;
      }
      default:
        status = r.httpStatus && r.httpStatus >= 400 && r.httpStatus < 500 ? "Needs Attention" : "Temporarily Unavailable";
        message =
          r.outcome === "timeout"
            ? `${providerName} did not respond in time. Check the Base URL and try again.`
            : `${providerName} test failed (${r.httpStatus ?? r.outcome}).${detail ? ` ${detail}` : ""}`;
        reason = detail ? `${r.outcome}: ${detail}`.slice(0, 200) : r.outcome;
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
            $each: [{ timestamp: now, status, http_status: r.httpStatus, latency_ms: r.latencyMs, reason: reason || `Manual test OK (${testModel})` }],
            $slice: -60,
          },
        },
      }
    );
    return {
      ok: r.outcome === "ok",
      http_status: r.httpStatus,
      latency_ms: r.latencyMs,
      message,
      models: r.outcome === "ok" ? [testModel] : [],
    };
  }

  // Default Groq credential verification
  const r = await groqListModels(apiKey);
  apiKey = "";
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

