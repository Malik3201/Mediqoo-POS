import { scrubSecretsFromText } from "./crypto";

const GROQ_BASE = "https://api.groq.com/openai/v1";

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
  if (status === 403) return "access_denied";
  if (status === 429) return "rate_limited";
  if (
    status === 404 ||
    (status === 400 &&
      /model_not_found|model_decommissioned|does not exist|model.*not.*exist|model.*not.*supported|decommissioned/i.test(bodyText))
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
}

/**
 * Single provider call (no retries here — retry policy lives in the router so the
 * shared organization quota can be accounted for correctly).
 */
export async function groqChat(input: ChatCompletionInput): Promise<ProviderResult> {
  const started = Date.now();
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
    body.parallel_tool_calls = false;
  }

  let res: Response;
  try {
    res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
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
      errorText: scrubSecretsFromText(String(e?.message || e)).slice(0, 200),
    };
  }

  let headers = readRateHeaders(res.headers);
  let text = await res.text().catch(() => "");

  // If Groq's Harmony parser rejected a malformed tool call or a tool call when tools were disabled
  // ("Tool choice is none, but model called a tool" / "tool_use_failed"), automatically recover
  // by requesting a plain-text response with flattened tool history.
  if (res.status === 400 && /tool_use_failed|Tool choice is none|Failed to call a function/i.test(text)) {
    try {
      const fallbackMessages = [
        ...flattenMessagesForPlainText(input.messages),
        {
          role: "system",
          content: "Do NOT call any tools or functions now. Respond directly to the user in plain text using the information already gathered.",
        },
      ];
      const retryRes = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
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
  }

  const outcome = classifyStatus(res.status, text);
  if (outcome !== "ok") {
    return {
      outcome,
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      headers,
      errorText: scrubSecretsFromText(text).slice(0, 300),
    };
  }

  try {
    const json = JSON.parse(text);
    const msg = json?.choices?.[0]?.message;
    if (!msg || typeof msg !== "object") throw new Error("no message");
    const u = json.usage || {};
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage: ProviderUsage = {
      input: Number(u.prompt_tokens) || 0,
      output: Number(u.completion_tokens) || 0,
      cached: Number(cached) || 0,
      total: Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
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

/** Lists model IDs available to this credential (used to verify the registry). */
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
        errorText: scrubSecretsFromText(text).slice(0, 200),
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
      errorText: scrubSecretsFromText(String(e?.message || e)).slice(0, 200),
    };
  }
}

