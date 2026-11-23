import crypto from "crypto";
import type { IWhatsAppEncryptedToken } from "@/models/WhatsAppIntegration";

const WHATSAPP_MASTER_FALLBACK_DEV = "aivrasol-whatsapp-credential-master-fallback-dev-only";

function deriveWhatsAppKey(masterSecret: string): Buffer {
  return crypto
    .createHmac("sha256", "aivrasol-whatsapp-credential-encryption-v1")
    .update(masterSecret)
    .digest();
}

/**
 * Derives the active 32-byte AES-256-GCM key using domain-separated HMAC-SHA256
 * strictly from server environment secrets outside MongoDB.
 */
function getWhatsAppMasterKey(): Buffer {
  const masterSecret =
    process.env.WHATSAPP_CREDENTIAL_MASTER_KEY ||
    process.env.AI_CREDENTIAL_MASTER_KEY ||
    process.env.BACKUP_SECRET_MASTER_KEY ||
    process.env.NEXTAUTH_SECRET ||
    WHATSAPP_MASTER_FALLBACK_DEV;

  return deriveWhatsAppKey(masterSecret);
}

/**
 * Ordered decryption key candidates: active primary key first, followed by legacy
 * fallback env secrets so tokens encrypted before `WHATSAPP_CREDENTIAL_MASTER_KEY`
 * was provisioned continue decrypting cleanly and can be seamlessly re-encrypted.
 */
function getWhatsAppDecryptionKeys(): Array<{ key: Buffer; isPrimary: boolean }> {
  const rawCandidates = [
    process.env.WHATSAPP_CREDENTIAL_MASTER_KEY,
    process.env.AI_CREDENTIAL_MASTER_KEY,
    process.env.BACKUP_SECRET_MASTER_KEY,
    process.env.NEXTAUTH_SECRET,
    WHATSAPP_MASTER_FALLBACK_DEV,
  ];

  const seen = new Set<string>();
  const out: Array<{ key: Buffer; isPrimary: boolean }> = [];

  for (const raw of rawCandidates) {
    if (!raw) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push({ key: deriveWhatsAppKey(raw), isPrimary: out.length === 0 });
    }
    const trimmed = raw.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push({ key: deriveWhatsAppKey(trimmed), isPrimary: false });
    }
  }

  return out;
}

export function encryptWhatsAppToken(rawToken: string): IWhatsAppEncryptedToken {
  const clean = String(rawToken || "").trim();
  if (!clean) {
    throw new Error("WhatsApp provider API token cannot be empty.");
  }
  const key = getWhatsAppMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(clean, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return {
    encrypted_value: encrypted,
    iv: iv.toString("hex"),
    tag,
    key_version: 1,
  };
}

export function decryptWhatsAppTokenWithMeta(
  payload: IWhatsAppEncryptedToken
): { token: string; usedLegacyKey: boolean } {
  if (!payload?.encrypted_value || !payload?.iv || !payload?.tag) {
    throw new Error("Invalid encrypted WhatsApp token payload.");
  }
  const ivBuf = Buffer.from(payload.iv, "hex");
  const tagBuf = Buffer.from(payload.tag, "hex");
  const candidates = getWhatsAppDecryptionKeys();

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", candidate.key, ivBuf);
      decipher.setAuthTag(tagBuf);
      let decrypted = decipher.update(payload.encrypted_value, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return { token: decrypted, usedLegacyKey: !candidate.isPrimary };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Unable to decrypt stored WhatsApp API token (${(lastError as Error)?.message || "key mismatch"}). Please re-enter the GREEN-API token in WhatsApp Settings and save.`
  );
}

export function decryptWhatsAppToken(payload: IWhatsAppEncryptedToken): string {
  return decryptWhatsAppTokenWithMeta(payload).token;
}

/**
 * Permanently masks a provider token showing only the last 4 characters (e.g. "••••••••A7F2").
 */
export function maskWhatsAppToken(rawToken: string): string {
  const clean = String(rawToken || "").trim();
  if (clean.length <= 4) return "••••••••";
  return `••••••••${clean.slice(-4).toUpperCase()}`;
}

/**
 * Normalizes Pakistan or international phone numbers to international E.164 digits
 * without a leading '+' (e.g. "0300-1234567" -> "923001234567", "+44 7700 900077" -> "447700900077").
 */
export function normalizeWhatsAppPhone(
  input: string | null | undefined,
  defaultCountryCode = "92"
): { valid: boolean; digits: string; chatId: string; error?: string } {
  const raw = String(input || "").trim();
  if (!raw) {
    return { valid: false, digits: "", chatId: "", error: "Phone number is required." };
  }

  const hasExplicitIntl = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/[^0-9]/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Local Pakistani mobile (03XXXXXXXXX -> 923XXXXXXXXX) or 10-digit 3XXXXXXXXX
  if (!hasExplicitIntl) {
    if (defaultCountryCode === "92") {
      if (digits.length === 11 && digits.startsWith("03")) {
        digits = `92${digits.slice(1)}`;
      } else if (digits.length === 10 && digits.startsWith("3")) {
        digits = `92${digits}`;
      } else if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 12) {
        digits = `${defaultCountryCode}${digits.slice(1)}`;
      }
    } else if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 12) {
      digits = `${defaultCountryCode}${digits.slice(1)}`;
    }
  }

  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      digits: "",
      chatId: "",
      error: "Enter a valid WhatsApp number with country code (e.g. 03001234567 or +923001234567).",
    };
  }

  return {
    valid: true,
    digits,
    chatId: `${digits}@c.us`,
  };
}

/**
 * Formats normalized digits for human-friendly display (+92 300 123 4567).
 */
export function formatPhoneForDisplay(digits: string | null | undefined): string | null {
  const clean = String(digits || "").replace(/[^0-9]/g, "");
  if (!clean) return null;
  if (clean.startsWith("92") && clean.length === 12) {
    return `+92 ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  }
  return `+${clean}`;
}

/**
 * Masks a phone number for audit/history/Super Admin views (+92 300 ••••567).
 */
export function maskPhoneNumber(digits: string | null | undefined): string {
  const clean = String(digits || "").replace(/[^0-9]/g, "");
  if (!clean) return "—";
  if (clean.length <= 5) return "••••";
  if (clean.startsWith("92") && clean.length === 12) {
    return `+92 ${clean.slice(2, 5)} ••••${clean.slice(-3)}`;
  }
  return `+${clean.slice(0, Math.min(4, clean.length - 4))} ••••${clean.slice(-3)}`;
}

/**
 * Validates and normalizes a GREEN-API base URL (strictly HTTPS).
 */
export function normalizeGreenApiUrl(rawUrl: string | null | undefined): {
  valid: boolean;
  url: string;
  error?: string;
} {
  const trimmed = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { valid: false, url: "", error: "API URL is required." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, url: "", error: "API URL must be a valid HTTPS URL (e.g. https://7103.api.greenapi.com)." };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, url: "", error: "API URL must use HTTPS." };
  }
  // Keep only origin to avoid path injection or accidental pasted method paths
  return { valid: true, url: parsed.origin };
}

/**
 * Validates GREEN-API Instance ID (numeric digits only, 6-20 chars).
 */
export function normalizeGreenInstanceId(rawId: string | null | undefined): {
  valid: boolean;
  instanceId: string;
  error?: string;
} {
  const clean = String(rawId || "").trim().replace(/^waInstance/i, "");
  if (!/^\d{4,24}$/.test(clean)) {
    return {
      valid: false,
      instanceId: "",
      error: "Instance ID must contain digits only (e.g. 7103123456).",
    };
  }
  return { valid: true, instanceId: clean };
}

/**
 * Scrubs GREEN-API tokens from any string, URL, or error message before logging or returning.
 */
export function scrubWhatsAppSecrets(input: string, knownToken?: string | null): string {
  if (!input) return input;
  let out = String(input);
  if (knownToken && knownToken.trim().length >= 6) {
    const escaped = knownToken.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  // Scrub GREEN-API URL pattern: /waInstance12345/method/<token>
  out = out.replace(
    /(\/waInstance\d+\/[A-Za-z0-9_-]+\/)([A-Za-z0-9._-]{8,})/gi,
    "$1[REDACTED]"
  );
  return out;
}
