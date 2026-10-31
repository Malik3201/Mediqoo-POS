import { wrapToolResult } from "./prompt";

const MAX_MESSAGES = 14;
const MAX_USER_CHARS = 1200;
const MAX_ASSISTANT_CHARS = 2000;
export const MAX_TOOL_CHARS = 6000;

/** Masks Pakistani/intl phone numbers and long digit runs that look like phones / CNIC. */
export function maskPII(text: string): string {
  if (!text) return text;
  return text
    // CNIC 12345-1234567-1
    .replace(/\b\d{5}-?\d{7}-?\d\b/g, "[ID masked]")
    // +92 3xx xxxxxxx / 03xx-xxxxxxx / 0092...
    .replace(/(?:\+|00)?92[-\s]?3\d{2}[-\s]?\d{7}\b/g, "03XX-XXXXXXX")
    .replace(/\b03\d{2}[-\s]?\d{7}\b/g, "03XX-XXXXXXX")
    // generic landline/phone style 0xx-xxxxxxx
    .replace(/\b0\d{2,3}[-\s]?\d{6,8}\b/g, "0XX-XXXXXXX");
}

function stripControl(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

export interface CleanMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

/**
 * Normalises client messages into a safe provider conversation:
 *  - client-supplied "system" messages are DROPPED (only the gateway's system prompt exists)
 *  - bounded message count and length, control characters stripped, PII masked
 *  - tool messages are wrapped as untrusted data and size capped
 *  - only the most recent MAX_MESSAGES are kept (limited conversational context)
 */
export function sanitizeMessages(input: any[]): { ok: true; messages: CleanMessage[] } | { ok: false } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false };
  const out: CleanMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return { ok: false };
    const role = m.role;
    if (role === "system") continue;
    if (role !== "user" && role !== "assistant" && role !== "tool") return { ok: false };

    if (role === "tool") {
      if (typeof m.tool_call_id !== "string" || typeof m.content !== "string") return { ok: false };
      const content = maskPII(stripControl(m.content)).slice(0, MAX_TOOL_CHARS);
      out.push({ role: "tool", tool_call_id: String(m.tool_call_id).slice(0, 64), name: typeof m.name === "string" ? m.name.slice(0, 64) : undefined, content: wrapToolResult(content) });
      continue;
    }
    if (role === "assistant") {
      const msg: CleanMessage = { role: "assistant", content: typeof m.content === "string" ? stripControl(m.content).slice(0, MAX_ASSISTANT_CHARS) : null };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.slice(0, 1).map((tc: any) => ({
          id: String(tc?.id || "").slice(0, 64),
          type: "function" as const,
          function: {
            name: String(tc?.name || tc?.function?.name || "").slice(0, 64),
            arguments: typeof tc?.arguments === "string" ? tc.arguments.slice(0, 2000) : JSON.stringify(tc?.arguments ?? tc?.function?.arguments ?? {}).slice(0, 2000),
          },
        }));
      }
      out.push(msg);
      continue;
    }
    if (typeof m.content !== "string") return { ok: false };
    out.push({ role: "user", content: maskPII(stripControl(m.content)).slice(0, MAX_USER_CHARS) });
  }
  if (out.length === 0) return { ok: false };
  let trimmed = out.slice(-MAX_MESSAGES);
  // Never start with an orphan tool message.
  while (trimmed.length && trimmed[0].role === "tool") trimmed = trimmed.slice(1);
  if (trimmed.length === 0) return { ok: false };
  return { ok: true, messages: trimmed };
}

/** Conservative token estimate (chars/3 covers Urdu/Roman Urdu well) plus the output budget. */
export function estimateTokens(messages: CleanMessage[], toolSpecsJsonLength: number, systemChars: number, maxOutput: number): number {
  let chars = systemChars + toolSpecsJsonLength;
  for (const m of messages) chars += (m.content?.length || 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  return Math.ceil(chars / 3) + maxOutput;
}

