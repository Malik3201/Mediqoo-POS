import crypto from "crypto";

/**
 * Derives a 32-byte AES-256-GCM key using domain-separated SHA-256 / HKDF
 * from server environment secrets. The master key is strictly outside MongoDB.
 */
function getAiCredentialMasterKey(): Buffer {
  const masterSecret =
    process.env.AI_CREDENTIAL_MASTER_KEY ||
    process.env.BACKUP_SECRET_MASTER_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "mediqoo-ai-credential-master-fallback-dev-only";

  return crypto
    .createHmac("sha256", "mediqoo-ai-credential-encryption-v1")
    .update(masterSecret)
    .digest();
}

export interface EncryptedCredentialPayload {
  encrypted_value: string;
  iv: string;
  tag: string;
  key_version: number;
}

/**
 * Encrypts a Groq API key with AES-256-GCM authenticated encryption.
 */
export function encryptApiKey(rawKey: string): EncryptedCredentialPayload {
  const clean = rawKey.trim();
  if (!clean) {
    throw new Error("API key cannot be empty");
  }
  const key = getAiCredentialMasterKey();
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

/**
 * Decrypts a stored Groq API key on the server side only for outbound Groq calls.
 * Never expose the returned string to any client or log.
 */
export function decryptApiKey(payload: EncryptedCredentialPayload): string {
  if (!payload?.encrypted_value || !payload?.iv || !payload?.tag) {
    throw new Error("Invalid encrypted credential payload");
  }
  const key = getAiCredentialMasterKey();
  const ivBuf = Buffer.from(payload.iv, "hex");
  const tagBuf = Buffer.from(payload.tag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tagBuf);

  let decrypted = decipher.update(payload.encrypted_value, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Produces a safe masked display identifier for an API key (e.g. "gsk_••••••••9x2a").
 * Never reveals the middle or full key.
 */
export function maskApiKey(rawKey: string): string {
  const clean = (rawKey || "").trim();
  if (clean.length <= 8) {
    return "gsk_••••••••";
  }
  const prefix = clean.startsWith("gsk_") ? "gsk_" : clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Deterministic SHA-256 fingerprint of an API key to detect duplicate entries
 * without storing or comparing plaintext keys.
 */
export function fingerprintApiKey(rawKey: string): string {
  const clean = (rawKey || "").trim();
  return crypto
    .createHmac("sha256", "mediqoo-ai-key-fingerprint-v1")
    .update(clean)
    .digest("hex");
}

/**
 * Validates basic Groq API key format before storing.
 */
export function validateGroqKeyFormat(rawKey: string): { valid: boolean; reason?: string } {
  if (!rawKey || typeof rawKey !== "string") {
    return { valid: false, reason: "API key is required." };
  }
  const clean = rawKey.trim();
  if (clean.length < 20) {
    return { valid: false, reason: "API key is too short (minimum 20 characters)." };
  }
  if (clean.length > 256) {
    return { valid: false, reason: "API key exceeds maximum allowed length." };
  }
  if (/\s/.test(clean)) {
    return { valid: false, reason: "API key must not contain spaces or line breaks." };
  }
  if (!clean.startsWith("gsk_")) {
    return { valid: false, reason: "Groq API keys must start with 'gsk_'." };
  }
  return { valid: true };
}

/**
 * Scrubs any accidental gsk_ token or secret field from strings/metadata before logging.
 */
export function scrubSecretsFromText(input: string): string {
  if (!input) return input;
  return input.replace(/gsk_[A-Za-z0-9_-]{8,}/g, "gsk_[REDACTED]");
}

