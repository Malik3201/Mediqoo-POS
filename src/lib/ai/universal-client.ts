import { scrubSecretsFromText } from "./crypto";

export const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

const BLOCKED_HOSTNAMES = new Set([
  "0.0.0.0",
  "::",
  "[::]",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

function isLocalhostHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

function isBlockedIpLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "0.0.0.0" || h === "::") return true;

  // IPv4 checks
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b, c, d] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    // Allow explicit 127.0.0.1 for local gateways (Ollama / LiteLLM), block other 127.x, 0.x, link-local metadata, private LAN ranges
    if (a === 127 && b === 0 && c === 0 && d === 1) return false;
    if (a === 0 || a === 127) return true;
    if (a === 169 && b === 254) return true; // cloud metadata / link-local
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 private / link-local / mapped-IPv4 checks (allow ::1)
  if (h.includes(":")) {
    if (h === "::1") return false;
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("::ffff:")) {
      return true;
    }
  }

  return false;
}

export interface BaseUrlValidation {
  valid: boolean;
  normalized?: string;
  host?: string;
  reason?: string;
}

/**
 * Validates and normalizes a custom OpenAI-compatible base URL with SSRF protection.
 * - Requires HTTPS for all remote endpoints
 * - Permits HTTP strictly for localhost / 127.0.0.1 / [::1] (local Ollama / LiteLLM gateways)
 * - Blocks cloud metadata IPs (169.254.169.254), 0.0.0.0, private RFC1918 ranges, and non-HTTP schemes
 */
export function validateAndNormalizeBaseUrl(rawUrl: string): BaseUrlValidation {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "Base URL is required." };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: "Base URL is required." };
  }
  if (trimmed.length > 500) {
    return { valid: false, reason: "Base URL is too long (maximum 500 characters)." };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: "Base URL must not contain spaces or line breaks." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "Enter a valid URL starting with https:// (for example https://openrouter.ai/api/v1)." };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: "Base URL must not embed credentials." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { valid: false, reason: "Base URL must include a valid hostname." };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || isBlockedIpLiteral(hostname)) {
    return { valid: false, reason: "This host/IP address is blocked for security reasons. Use a public HTTPS endpoint or localhost." };
  }

  const isLocal = isLocalhostHost(hostname);
  if (parsed.protocol === "http:") {
    if (!isLocal) {
      return { valid: false, reason: "Remote API endpoints must use https:// (http:// is only allowed for localhost / 127.0.0.1)." };
    }
  } else if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Base URL must use https://." };
  }

  // Strip trailing slashes from pathname while preserving any query params (e.g. Azure api-version)
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${parsed.protocol}//${parsed.host}${cleanPath}${parsed.search}`;

  return { valid: true, normalized, host: parsed.host };
}

/**
 * Resolves the exact OpenAI-compatible `/chat/completions` URL from a base URL or full endpoint URL.
 * - Empty/null -> Groq default `https://api.groq.com/openai/v1/chat/completions`
 * - Strips trailing slashes
 * - If path already ends with `/chat/completions`, uses it as-is
 * - Otherwise appends `/chat/completions`
 */
export function resolveChatCompletionsUrl(baseUrl?: string | null): string {
  const raw = (baseUrl || "").trim();
  if (!raw) {
    return `${GROQ_DEFAULT_BASE_URL}/chat/completions`;
  }
  try {
    const u = new URL(raw);
    const cleanPath = u.pathname.replace(/\/+$/, "");
    const finalPath = /\/chat\/completions$/i.test(cleanPath)
      ? cleanPath
      : `${cleanPath}/chat/completions`;
    return `${u.protocol}//${u.host}${finalPath}${u.search}`;
  } catch {
    const clean = raw.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(clean)) return clean;
    return `${clean}/chat/completions`;
  }
}

/**
 * Builds standard OpenAI-compatible HTTP headers, adding OpenRouter attribution headers when appropriate.
 */
export function buildOpenAiHeaders(apiKey: string, endpointUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  try {
    const host = new URL(endpointUrl).hostname.toLowerCase();
    if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) {
      headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL || "https://aivrasol.com";
      headers["X-Title"] = "AivraSol POS";
    }
  } catch {
    /* ignore */
  }
  return headers;
}

/**
 * Infers a friendly provider badge label from a custom API base URL.
 */
export function inferProviderLabel(baseUrl?: string | null): string {
  if (!baseUrl) return "Custom API";
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    if (host.includes("openrouter.ai")) return "OpenRouter";
    if (host.includes("deepseek.com")) return "DeepSeek";
    if (host === "api.openai.com" || host.endsWith(".openai.azure.com")) return "OpenAI";
    if (host.includes("together.xyz")) return "Together";
    if (host.includes("mistral.ai")) return "Mistral";
    if (host.includes("fireworks.ai")) return "Fireworks";
    if (host === "api.x.ai" || host.endsWith(".x.ai")) return "xAI Grok";
    if (host.includes("siliconflow.")) return "SiliconFlow";
    if (host.includes("generativelanguage.googleapis.com")) return "Google Gemini";
    if (host.includes("groq.com")) return "Groq";
    if (isLocalhostHost(host)) return "Local Gateway";
    return host;
  } catch {
    return "Custom API";
  }
}

export function extractHostFromUrl(baseUrl?: string | null): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return null;
  }
}

/**
 * Extracts a concise human-readable error message from a raw provider error response body,
 * scrubbing any secrets.
 */
export function formatProviderErrorSnippet(rawText?: string | null, apiKey?: string): string {
  if (!rawText) return "";
  const scrubbed = scrubSecretsFromText(rawText, apiKey).trim();
  if (!scrubbed) return "";
  if (scrubbed.startsWith("{")) {
    try {
      const parsed = JSON.parse(scrubbed);
      const msg =
        (typeof parsed?.error?.message === "string" && parsed.error.message) ||
        (typeof parsed?.message === "string" && parsed.message) ||
        (typeof parsed?.detail === "string" && parsed.detail) ||
        (typeof parsed?.error === "string" && parsed.error);
      if (msg) return scrubSecretsFromText(msg, apiKey).slice(0, 220);
    } catch {
      /* fall through to plain text */
    }
  }
  return scrubbed.replace(/\s+/g, " ").slice(0, 220);
}

export function validateCustomModelId(rawModel: string): { valid: boolean; value?: string; reason?: string } {
  if (!rawModel || typeof rawModel !== "string") {
    return { valid: false, reason: "Model name is required." };
  }
  const clean = rawModel.trim();
  if (!clean) {
    return { valid: false, reason: "Model name is required." };
  }
  if (clean.length > 160) {
    return { valid: false, reason: "Model name is too long (maximum 160 characters)." };
  }
  if (!/^[A-Za-z0-9._\-/:@+]{1,160}$/.test(clean)) {
    return { valid: false, reason: "Model name contains invalid characters (no spaces allowed)." };
  }
  return { valid: true, value: clean };
}
