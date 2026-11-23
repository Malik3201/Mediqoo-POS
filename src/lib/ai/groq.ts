import { scrubSecretsFromText } from "./crypto";
import {
  GROQ_DEFAULT_BASE_URL,
  buildOpenAiHeaders,
  resolveChatCompletionsUrl,
  validateAndNormalizeBaseUrl,
} from "./universal-client";

const GROQ_BASE = GROQ_DEFAULT_BASE_URL;

export type ProviderOutcome =
  | "ok"
  | "invalid_credentials" // 401
  | "access_denied" // 403
  | "rate_limited" // 429
  | "model_unsupported" // 400/404 model errors
  | "provider_error" // 5xx
  | "timeout"
  | "network_error"
  | "invalid_response";

export interface ProviderRateHeaders {
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
  resetTokensMs?: number;
  retryAfterMs?: number;
}

export interface ProviderUsage {
  input: number;
  output: number;
  cached: number;
  total: number;
}

export interface ProviderResult {
  outcome: ProviderOutcome;
  httpStatus: number | null;
  latencyMs: number;
  headers: ProviderRateHeaders;
  message?: any;
  usage?: ProviderUsage;
  errorText?: string;
}

/** Parses Groq duration strings such as "2m59.56s", "7.66s", "120ms". */
export function parseDurationMs(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000); // plain seconds (retry-after)
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const n = parseFloat(m[1]);
    if (m[2] === "ms") total += n;
    else if (m[2] === "s") total += n * 1000;
    else if (m[2] === "m") total += n * 60_000;
    else if (m[2] === "h") total += n * 3_600_000;
  }
  return matched ? Math.round(total) : undefined;
}

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function readRateHeaders(h: Headers): ProviderRateHeaders {
  return {
    limitRequests: num(h.get("x-ratelimit-limit-requests")),
    remainingRequests: num(h.get("x-ratelimit-remaining-requests")),
    limitTokens: num(h.get("x-ratelimit-limit-tokens")),
    remainingTokens: num(h.get("x-ratelimit-remaining-tokens")),
    resetRequestsMs: parseDurationMs(h.get("x-ratelimit-reset-requests")),
    resetTokensMs: parseDurationMs(h.get("x-ratelimit-reset-tokens")),
    retryAfterMs: parseDurationMs(h.get("retry-after")),
  };
}

export function classifyStatus(status: number, bodyText: string): ProviderOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "invalid_credentials";
  if (status === 402 || status === 403) return "access_denied";
  if (status === 429) return "rate_limited";
  if (
    status === 404 ||
    (status === 400 &&
      /model_not_found|model_decommissioned|does not exist|model.*not.*exist|model.*not.*supported|decommissioned|not a valid model|unknown model|invalid model|no endpoints found/i.test(bodyText))
  ) {
    return "model_unsupported";
  }
  if (status >= 500) return "provider_error";
  return "invalid_response";
}

/**
 * Converts assistant tool_calls and tool role messages into plain-text messages
 * when sending a follow-up completion without active tools, preventing Groq Harmony
 * models (gpt-oss-20b / gpt-oss-120b) from throwing `tool_use_failed` ("Tool choice is none, but model called a tool").
 */
export function flattenMessagesForPlainText(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: `[Tool Result${m.name ? ` (${m.name})` : ""}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
      });
    } else if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const summary = m.tool_calls
        .map((tc: any) => `${tc?.function?.name || "tool"}(${tc?.function?.arguments || "{}"})`)
        .join(", ");
      out.push({
        role: "assistant",
        content: m.content ? `${m.content}\n[Called: ${summary}]` : `[Called: ${summary}]`,
      });
    } else {
      out.push({ role: m.role, content: typeof m.content === "string" ? m.content : "" });
    }
  }
  return out;
}

export interface ChatCompletionInput {
  apiKey: string;
  model: string;
  messages: any[];
  tools?: any[];
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  baseUrl?: string | null;
  provider?: "groq" | "custom";
}

function normalizeMessageContent(rawContent: unknown): string | null {
  if (typeof rawContent === "string") return rawContent;
  if (Array.isArray(rawContent)) {
    const joined = rawContent
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
    return joined || null;
  }
  return null;
}

/**
 * Single OpenAI-compatible provider call supporting both Groq and Universal / Custom API endpoints
 * (no retries here beyond single-turn tool/parameter compatibility fallback — retry policy lives
 * in the router so shared organization quotas are accounted for correctly).
 */
export async function groqChat(input: ChatCompletionInput): Promise<ProviderResult> {
  const started = Date.now();
  const isCustom = input.provider === "custom" || Boolean(input.baseUrl && input.baseUrl.trim());
  let endpointUrl = resolveChatCompletionsUrl(null);
  if (isCustom) {
    const check = validateAndNormalizeBaseUrl(input.baseUrl || "");
    if (!check.valid || !check.normalized) {
      return {
        outcome: "network_error",
        httpStatus: null,
        latencyMs: Date.now() - started,
        headers: {},
        errorText: check.reason || "Invalid custom API base URL.",
      };
    }
    endpointUrl = resolveChatCompletionsUrl(check.normalized);
  }

  const reqHeaders = buildOpenAiHeaders(input.apiKey, endpointUrl);
  const hasTools = Boolean(input.tools && input.tools.length > 0);
  const body: any = {
    model: input.model,
    messages: hasTools ? input.messages : flattenMessagesForPlainText(input.messages),
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0.2,
    stream: false,
  };
  if (hasTools) {
    body.tools = input.tools;
    body.tool_choice = "auto";
    if (!isCustom) {
      body.parallel_tool_calls = false;
    }
  }

  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 25_000),
      cache: "no-store",
    });
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      outcome: isTimeout ? "timeout" : "network_error",
      httpStatus: null,
      latencyMs: Date.now() - started,
      headers: {},
      errorText: scrubSecretsFromText(String(e?.message || e), input.apiKey).slice(0, 200),
    };
  }

  let headers = readRateHeaders(res.headers);
  let text = await res.text().catch(() => "");

  // If a provider rejects tool definitions/tool_choice (or Groq Harmony rejects a tool call),
  // retry once cleanly as plain-text completion with flattened history.
  const toolRejected =
    (res.status === 400 || res.status === 422) &&
    /tool_use_failed|Tool choice is none|Failed to call a function|does not support tools|tools.*not.*support|function calling.*not.*support|tool_choice.*not.*support|unrecognized.*tools|unknown.*field.*tools|invalid.*tool_choice/i.test(
      text
    );

  if (toolRejected) {
    try {
      const fallbackMessages = [
        ...flattenMessagesForPlainText(input.messages),
        {
          role: "system",
          content: "Do NOT call any tools or functions now. Respond directly to the user in plain text using the information already gathered.",
        },
      ];
      const retryRes = await fetch(endpointUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          model: input.model,
          messages: fallbackMessages,
          max_tokens: input.maxTokens,
          temperature: input.temperature ?? 0.2,
          stream: false,
        }),
        signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
        cache: "no-store",
      });
      headers = readRateHeaders(retryRes.headers);
      text = await retryRes.text().catch(() => "");
      res = retryRes;
    } catch {
      // Keep original response if fallback network call fails
    }
  } else if (isCustom && res.status === 400 && /max_completion_tokens/i.test(text)) {
    // OpenAI newer reasoning/GPT-5 models require `max_completion_tokens` instead of `max_tokens`.
    try {
      const retryBody: any = { ...body };
      delete retryBody.max_tokens;
      retryBody.max_completion_tokens = input.maxTokens;
      if (/temperature/i.test(text)) delete retryBody.temperature;
      const retryRes = await fetch(endpointUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
        cache: "no-store",
      });
      headers = readRateHeaders(retryRes.headers);
      text = await retryRes.text().catch(() => "");
      res = retryRes;
    } catch {
      // Keep original response
    }
  }

  const outcome = classifyStatus(res.status, text);
  if (outcome !== "ok") {
    return {
      outcome,
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      headers,
      errorText: scrubSecretsFromText(text, input.apiKey).slice(0, 300),
    };
  }

  try {
    const json = JSON.parse(text);
    const rawMsg = json?.choices?.[0]?.message;
    if (!rawMsg || typeof rawMsg !== "object") throw new Error("no message");
    const msg = {
      ...rawMsg,
      content: normalizeMessageContent(rawMsg.content),
    };
    const u = json.usage && typeof json.usage === "object" ? json.usage : {};
    const cached = Math.max(0, Math.round(Number(u?.prompt_tokens_details?.cached_tokens) || 0));
    const inputTok = Math.max(0, Math.round(Number(u.prompt_tokens) || 0));
    const outputTok = Math.max(0, Math.round(Number(u.completion_tokens) || 0));
    const totalTok = Math.max(0, Math.round(Number(u.total_tokens) || inputTok + outputTok));
    const usage: ProviderUsage = {
      input: inputTok,
      output: outputTok,
      cached,
      total: totalTok,
    };
    return {
      outcome: "ok",
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      headers,
      message: msg,
      usage,
    };
  } catch {
    return {
      outcome: "invalid_response",
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      headers,
      errorText: "Provider returned an unreadable response.",
    };
  }
}

export const universalChat = groqChat;

/** Lists model IDs available to this credential (used to verify the Groq registry). */
export async function groqListModels(
  apiKey: string
): Promise<{ outcome: ProviderOutcome; httpStatus: number | null; latencyMs: number; models: string[]; errorText?: string }> {
  const started = Date.now();
  try {
    const res = await fetch(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const text = await res.text();
    const outcome = classifyStatus(res.status, text);
    if (outcome !== "ok") {
      return {
        outcome,
        httpStatus: res.status,
        latencyMs: Date.now() - started,
        models: [],
        errorText: scrubSecretsFromText(text, apiKey).slice(0, 200),
      };
    }
    const json = JSON.parse(text);
    const models = Array.isArray(json?.data) ? json.data.map((m: any) => String(m.id)) : [];
    return { outcome: "ok", httpStatus: res.status, latencyMs: Date.now() - started, models };
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      outcome: isTimeout ? "timeout" : "network_error",
      httpStatus: null,
      latencyMs: Date.now() - started,
      models: [],
      errorText: scrubSecretsFromText(String(e?.message || e), apiKey).slice(0, 200),
    };
  }
}

