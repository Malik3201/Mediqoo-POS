import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import AiPharmacyEntitlement from "@/models/AiPharmacyEntitlement";
import AiUsageLog from "@/models/AiUsageLog";
import AiModelRegistry from "@/models/AiModelRegistry";
import AiCredential from "@/models/AiCredential";
import { getAiSettings } from "./settings";
import { verifyDeviceIdentity } from "./license";
import { effectiveLimits, getOrCreateEntitlement, periodKeys, releaseQuota, reserveQuota, rolloverEntitlement, settleQuota } from "./quota";
import { loadModelSnaps, selectModelChain, syncModelsWithProviderList } from "./models";
import { decryptApiKey } from "./crypto";
import { groqListModels } from "./groq";
import { allowedToolNames, providerToolSpecs, validateToolArguments, type OperatorRole } from "./tools";
import { SYSTEM_PROMPT, buildSystemPrompt } from "./prompt";
import { estimateTokens, sanitizeMessages } from "./sanitize";
import { executeChat, type ExecuteDeps, type ExecuteResult } from "./router";
import { raiseAlert } from "./alerts";
import { checkGatewayHealth } from "./health";

export type GatewayErrorCode =
  | "ai_disabled"
  | "license_blocked"
  | "role_not_allowed"
  | "daily_limit_reached"
  | "monthly_limit_reached"
  | "token_limit_reached"
  | "too_many_concurrent"
  | "payload_too_large"
  | "capacity_exhausted"
  | "provider_unavailable"
  | "invalid_request"
  | "unauthorized";

const FRIENDLY: Record<GatewayErrorCode, string> = {
  ai_disabled: "AI assistant is not enabled for this pharmacy.",
  license_blocked: "Your license is not active, so the AI assistant is unavailable.",
  role_not_allowed: "AI assistant is not available for this user role.",
  daily_limit_reached: "Today's AI limit has been reached. It will reset tomorrow. Billing and all other POS features keep working.",
  monthly_limit_reached: "This month's AI limit has been reached. Please contact support to increase it.",
  token_limit_reached: "The AI usage budget has been reached for now. Please try again later.",
  too_many_concurrent: "AI is busy with another question. Please wait a moment and try again.",
  payload_too_large: "That request was too large. Please ask a shorter question.",
  capacity_exhausted: "AI is temporarily busy. Please try again in a minute. Your POS keeps working normally.",
  provider_unavailable: "AI is temporarily unavailable. Please try again shortly. Your POS keeps working normally.",
  invalid_request: "That request could not be understood.",
  unauthorized: "This terminal is not authorised for the AI assistant.",
};

const HTTP: Record<GatewayErrorCode, number> = {
  ai_disabled: 403,
  license_blocked: 403,
  role_not_allowed: 403,
  daily_limit_reached: 429,
  monthly_limit_reached: 429,
  token_limit_reached: 429,
  too_many_concurrent: 429,
  payload_too_large: 413,
  capacity_exhausted: 503,
  provider_unavailable: 503,
  invalid_request: 400,
  unauthorized: 401,
};

export interface GatewayResponse {
  status: number;
  body: any;
}

function fail(code: GatewayErrorCode, extra: Record<string, any> = {}): GatewayResponse {
  return { status: HTTP[code], body: { ok: false, error: code, message: FRIENDLY[code], ...extra } };
}

const VALID_ROLES: OperatorRole[] = ["admin", "manager", "senior-cashier", "cashier", "none"];
const VALID_LANG = ["en", "ur", "roman_ur"];

function limitState(e: any, now: Date) {
  const lim = effectiveLimits(e, now);
  const remainingDaily = Math.max(0, lim.dailyRequests - (e.daily_requests_used || 0));
  const tokensLeft = Math.max(0, lim.dailyTokens - (e.daily_tokens_used || 0));
  return { lim, remainingDaily, tokensLeft };
}

/** POST /api/public/ai/status */
export async function handleStatus(body: any): Promise<GatewayResponse> {
  const settings = await getAiSettings();
  const id = await verifyDeviceIdentity(body?.license_key, body?.machine_id);
  if (!id.ok) return { ...fail(id.error), status: id.status };
  if (!settings.ai_global_enabled) {
    return { status: 200, body: { ok: true, state: "disabled", enabled: false, advanced_copilot: false, purchase_preparation: false, allowed_roles: [], daily_limit: 0, daily_used: 0, remaining_daily_requests: 0, max_tool_steps: settings.max_tool_steps, chat_retention_days: settings.chat_retention_days, message: "AI is currently turned off by the administrator." } };
  }
  const { license } = id.identity;
  const ent: any = await getOrCreateEntitlement(license.id, license.client_id);
  await rolloverEntitlement(license.id, ent.timezone);
  const fresh: any = await AiPharmacyEntitlement.findOne({ license_id: license.id }).lean();
  const now = new Date();
  const { lim, remainingDaily, tokensLeft } = limitState(fresh, now);

  const healthy = await AiCredential.countDocuments({ enabled: true, status: { $in: ["Healthy", "Rate Limited", "Temporarily Unavailable"] } });
  let state: "ready" | "disabled" | "limit_reached" | "unavailable" = "ready";
  let message: string | undefined;
  if (!fresh.ai_enabled) {
    state = "disabled";
    message = FRIENDLY.ai_disabled;
  } else if (remainingDaily <= 0 || tokensLeft <= 0) {
    state = "limit_reached";
    message = FRIENDLY.daily_limit_reached;
  } else if (healthy === 0) {
    state = "unavailable";
    message = FRIENDLY.provider_unavailable;
  }
  return {
    status: 200,
    body: {
      ok: true,
      state,
      enabled: !!fresh.ai_enabled,
      advanced_copilot: !!fresh.advanced_copilot_enabled,
      purchase_preparation: !!fresh.purchase_preparation_enabled,
      allowed_roles: fresh.allowed_roles || [],
      daily_limit: lim.dailyRequests,
      daily_used: fresh.daily_requests_used || 0,
      remaining_daily_requests: remainingDaily,
      max_tool_steps: settings.max_tool_steps,
      chat_retention_days: settings.chat_retention_days,
      message,
    },
  };
}

async function logUsage(row: Record<string, any>) {
  try {
    await AiUsageLog.create(row);
  } catch (e) {
    console.warn("[ai-gateway] usage log failed:", (e as Error)?.message);
  }
}

async function recordModelStats(modelId: string, ok: boolean, latencyMs: number) {
  try {
    const m: any = await AiModelRegistry.findOne({ provider_model_id: modelId }).lean();
    if (!m) return;
    const n = (m.successful_requests || 0) + (m.failed_requests || 0);
    const avg = ok ? Math.round(((m.avg_latency_ms || 0) * n + latencyMs) / (n + 1)) : m.avg_latency_ms || 0;
    await AiModelRegistry.updateOne(
      { provider_model_id: modelId },
      {
        $set: {
          avg_latency_ms: avg,
          availability: ok ? "available" : m.availability,
          ...(ok ? { last_error: null } : {}),
        },
        $inc: { total_requests: 1, successful_requests: ok ? 1 : 0, failed_requests: ok ? 0 : 1 },
      }
    );
  } catch {
    /* stats are best effort */
  }
}

/** POST /api/public/ai/chat */
export async function handleChat(body: any, deps: ExecuteDeps = {}): Promise<GatewayResponse> {
  const started = Date.now();
  const settings = await getAiSettings();
  await connectToDatabase();

  // 1. Payload sanity / size
  if (!body || typeof body !== "object") return fail("invalid_request");
  let approxBytes = 0;
  try {
    approxBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return fail("invalid_request");
  }
  if (approxBytes > settings.max_payload_kb * 1024) return fail("payload_too_large");

  // 2. Global kill switch
  if (!settings.ai_global_enabled) return fail("ai_disabled");

  // 3. Verified device identity -> tenant. Tenant/role claims in the body are never trusted for tenancy.
  const idRes = await verifyDeviceIdentity(body.license_key, body.machine_id);
  if (!idRes.ok) return { ...fail(idRes.error), status: idRes.status };
  const { license, seat, client } = idRes.identity;

  // 4. Shape validation
  const role: OperatorRole = VALID_ROLES.includes(body?.operator?.role) ? body.operator.role : "cashier"; // unknown role -> least privilege
  const language = VALID_LANG.includes(body.language) ? body.language : "en";
  const complexity: "simple" | "complex" = body.complexity === "complex" ? "complex" : "simple";
  const step = Number.isInteger(body.step) ? body.step : -1;
  const requestType = typeof body.request_type === "string" ? body.request_type.slice(0, 48) : "general_copilot";
  const turnId = typeof body.turn_id === "string" ? body.turn_id.slice(0, 64) : "";
  if (step < 0 || step > settings.max_tool_steps || !turnId) return fail("invalid_request");
  if (!Array.isArray(body.tools)) return fail("invalid_request");

  const san = sanitizeMessages(body.messages);
  if (!san.ok) return fail("invalid_request");

  // 5. Entitlement, role and feature gates
  const ent: any = await getOrCreateEntitlement(license.id, license.client_id);
  if (!ent.ai_enabled) return fail("ai_disabled");
  if (!(ent.allowed_roles || []).includes(role) && !(role === "none" && (ent.allowed_roles || []).length > 0)) {
    return fail("role_not_allowed");
  }

  const toolNames = allowedToolNames(
    body.tools.filter((t: any) => typeof t === "string"),
    { role, advancedCopilot: !!ent.advanced_copilot_enabled, purchasePreparation: !!ent.purchase_preparation_enabled }
  );
  const toolSpecs = providerToolSpecs(toolNames);

  // 6. Model chain (capability-aware; never a model without tools for tool workflows)
  let models = await loadModelSnaps();
  let chain = selectModelChain(models, {
    complexity,
    needsTools: true,
    allowedModels: ent.allowed_models || [],
    modelPolicy: ent.model_policy || "auto",
    advancedCopilot: !!ent.advanced_copilot_enabled,
  });
  if (chain.length === 0) {
    // Auto-recover if all seeded models were marked unavailable before syncing with the active Groq account
    try {
      const cred: any = await AiCredential.findOne({ enabled: true, status: { $in: ["Healthy", "Rate Limited", "Temporarily Unavailable"] } }).select("+encrypted_key");
      if (cred?.encrypted_key) {
        const listed = await groqListModels(decryptApiKey(cred.encrypted_key));
        if (listed.outcome === "ok" && listed.models.length > 0) {
          await syncModelsWithProviderList(listed.models);
          models = await loadModelSnaps();
          chain = selectModelChain(models, {
            complexity,
            needsTools: true,
            allowedModels: ent.allowed_models || [],
            modelPolicy: ent.model_policy || "auto",
            advancedCopilot: !!ent.advanced_copilot_enabled,
          });
        }
      }
    } catch {
      /* best effort auto-discovery */
    }
  }
  if (chain.length === 0) return fail("provider_unavailable");

  const baseMaxOut = Math.max(64, Math.min(chain[0].max_output_tokens, ent.max_output_tokens || settings.default_max_output_tokens));
  const maxOut = /gpt-oss|qwen|deepseek/i.test(chain[0].provider_model_id) ? Math.min(chain[0].max_output_tokens, Math.max(1536, baseMaxOut)) : baseMaxOut;
  const estTokens = estimateTokens(san.messages, JSON.stringify(toolSpecs).length, SYSTEM_PROMPT.length, baseMaxOut);

  // 7. Atomic reservation (request counted on first step of a turn only)
  const reservation = await reserveQuota(license.id, estTokens, step === 0);
  const baseLog = {
    request_id: crypto.randomUUID(),
    license_id: license.id,
    client_id: license.client_id,
    pharmacy_name: client?.name || "Pharmacy",
    seat_id: seat?.id || null,
    terminal_number: seat?.terminal_number ?? null,
    operator_id: typeof body?.operator?.id === "string" ? body.operator.id.slice(0, 64) : null,
    operator_role: role,
    request_type: requestType,
    language,
  };
  if (!reservation.ok) {
    const code = reservation.error as GatewayErrorCode;
    await logUsage({ ...baseLog, model_used: "none", status: code === "ai_disabled" ? "blocked" : "quota_exceeded", http_status: HTTP[code], error_code: code, latency_ms: Date.now() - started });
    if (code === "daily_limit_reached" || code === "monthly_limit_reached" || code === "token_limit_reached") {
      await raiseAlert({
        type: "pharmacy_quota_exceeded",
        severity: "info",
        title: `${client?.name || "A pharmacy"} reached its AI limit`,
        reason: `The ${code.replace(/_/g, " ")} for this pharmacy was reached.`,
        recommendedAction: "Review the pharmacy's limits in AI Management → Pharmacy Limits, or add a temporary promo quota.",
        entityType: "pharmacy",
        entityId: license.id,
        entityName: client?.name || license.id,
      });
    }
    const retry = code === "daily_limit_reached" ? secondsUntilTomorrow(ent.timezone) : undefined;
    return fail(code, retry ? { retry_after_seconds: retry } : {});
  }

  // 8. Provider call through the shared-quota-aware router
  const providerMessages: any[] = [{ role: "system", content: buildSystemPrompt(language) }, ...san.messages];
  let exec: ExecuteResult | null = null;
  let usedModel = chain[0].provider_model_id;
  try {
    for (const m of chain) {
      usedModel = m.provider_model_id;
      exec = await executeChat(
        {
          model: m.provider_model_id,
          messages: providerMessages,
          tools: toolSpecs.length ? toolSpecs : undefined,
          maxTokens: Math.min(m.max_output_tokens, maxOut),
          estTokens,
          allowFallbackOnly: m !== chain[0],
        },
        deps
      );
      if (exec.ok) break;
      if (exec.error === "model_unsupported" || exec.error === "capacity_exhausted" || exec.error === "provider_unavailable") continue;
      break;
    }
  } catch (e) {
    console.error("[ai-gateway] executeChat crashed:", (e as Error)?.message);
    exec = { ok: false, error: "provider_unavailable", attempts: 0 };
  }

  if (!exec || !exec.ok) {
    try {
      await releaseQuota(reservation, true);
    } catch (e) {
      console.error("[ai-gateway] releaseQuota failed:", (e as Error)?.message);
    }
    const err = exec && !exec.ok ? exec : { error: "provider_unavailable" as const, attempts: 0 };
    const code: GatewayErrorCode = err.error === "capacity_exhausted" ? "capacity_exhausted" : "provider_unavailable";
    await recordModelStats(usedModel, false, Date.now() - started);
    void checkGatewayHealth().catch(() => {});
    await logUsage({
      ...baseLog,
      model_used: usedModel,
      credential_id: (err as any).lastCredentialId || null,
      credential_name: (err as any).lastCredentialName || null,
      organization_id: (err as any).organizationId || null,
      status: code === "capacity_exhausted" ? "rate_limited" : "provider_error",
      http_status: HTTP[code],
      error_code: code,
      latency_ms: Date.now() - started,
    });
    return fail(code, { retry_after_seconds: (err as any).retryAfterSeconds });
  }

  // 9. Validate model output (tool calls) — arguments checked against allow-listed schemas
  const rawMsg = exec.result.message || {};
  const usage = exec.result.usage || { input: 0, output: 0, cached: 0, total: 0 };
  let toolCalls: { id: string; name: string; arguments: any }[] | undefined;
  if (Array.isArray(rawMsg.tool_calls) && rawMsg.tool_calls.length > 0 && step < settings.max_tool_steps) {
    const validCalls: { id: string; name: string; arguments: any }[] = [];
    for (const tc of rawMsg.tool_calls.slice(0, 3)) {
      const name = String(tc?.function?.name || "");
      let args: any = {};
      try {
        args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = null;
      }
      const valid = args !== null && toolNames.includes(name) && validateToolArguments(name, args) === null;
      if (valid) validCalls.push({ id: String(tc.id || crypto.randomUUID()).slice(0, 64), name, arguments: args });
    }
    if (validCalls.length > 0) toolCalls = validCalls;
  }
  let content: string | null = typeof rawMsg.content === "string" ? rawMsg.content.slice(0, 4000) : null;
  if (!toolCalls && !content) {
    content =
      language === "roman_ur"
        ? "Maaf kijiye, main yeh sawal poori tarah samajh nahi saka. Barah-e-meherbani dobara likhein."
        : language === "ur"
        ? "معذرت، میں یہ سوال پوری طرح سمجھ نہیں سکا۔ براہِ کرم دوبارہ لکھیں۔"
        : "Sorry, I couldn't complete that. Please try rephrasing your question.";
  }

  // 10. Settle actual usage, record analytics (operational metadata only — never prompts/answers)
  try {
    await settleQuota(reservation, usage.total);
  } catch (e) {
    console.error("[ai-gateway] settleQuota failed:", (e as Error)?.message);
  }
  const modelDoc: any = await AiModelRegistry.findOne({ provider_model_id: usedModel }).lean();
  const cost = modelDoc ? (usage.input / 1e6) * (modelDoc.cost_per_million_input_usd || 0) + (usage.output / 1e6) * (modelDoc.cost_per_million_output_usd || 0) : 0;
  await recordModelStats(usedModel, true, exec.result.latencyMs);
  await logUsage({
    ...baseLog,
    model_used: usedModel,
    credential_id: exec.credentialId,
    credential_name: exec.credentialName,
    organization_id: exec.organizationId,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cached_tokens: usage.cached,
    total_tokens: usage.total,
    estimated_cost_usd: cost,
    latency_ms: Date.now() - started,
    status: "success",
    http_status: 200,
    tool_calls_count: toolCalls ? toolCalls.length : 0,
  });
  void checkUnusualTokens(license.id, client?.name || license.id, usage.total, settings.unusual_token_multiplier);

  const after: any = await AiPharmacyEntitlement.findOne({ license_id: license.id }).lean();
  const { remainingDaily } = limitState(after, new Date());
  return {
    status: 200,
    body: {
      ok: true,
      message: { role: "assistant", content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      usage: { input: usage.input, output: usage.output, cached: usage.cached, total: usage.total },
      model: usedModel,
      remaining_daily_requests: remainingDaily,
    },
  };
}

function secondsUntilTomorrow(tz: string): number {
  const now = new Date();
  const { day } = periodKeys(tz, now);
  for (let h = 1; h <= 26; h++) {
    const probe = new Date(now.getTime() + h * 3_600_000);
    if (periodKeys(tz, probe).day !== day) return Math.max(60, h * 3600 - (now.getMinutes() * 60 + now.getSeconds()));
  }
  return 3600;
}

async function checkUnusualTokens(licenseId: string, name: string, tokens: number, multiplier: number) {
  try {
    if (tokens < 8000) return;
    const recent: any[] = await AiUsageLog.find({ license_id: licenseId, status: "success" }).sort({ created_at: -1 }).limit(30).select("total_tokens").lean();
    if (recent.length < 5) return;
    const avg = recent.reduce((s, r) => s + (r.total_tokens || 0), 0) / recent.length;
    if (tokens > Math.max(1500, avg) * multiplier) {
      await raiseAlert({
        type: "unusual_token_consumption",
        severity: "warning",
        title: `Unusual AI token usage at ${name}`,
        reason: `One request used ${tokens} tokens, over ${multiplier}× this pharmacy's recent average (${Math.round(avg)}).`,
        recommendedAction: "Review recent requests in Usage & Analytics and lower the pharmacy's output-token limit if needed.",
        entityType: "pharmacy",
        entityId: licenseId,
        entityName: name,
      });
    }
  } catch {
    /* best effort */
  }
}
