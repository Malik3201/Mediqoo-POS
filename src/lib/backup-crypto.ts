import crypto from "crypto";

/**
 * Derives a 32-byte AES-256 key from server master secret.
 */
function getMasterKey(): Buffer {
  const masterSecret = 
    process.env.BACKUP_SECRET_MASTER_KEY || 
    process.env.NEXTAUTH_SECRET || 
    "aivrasol-cloud-backup-master-secret-seed-2026";
  
  return crypto.createHash("sha256").update(masterSecret).digest();
}

/**
 * Reversibly encrypts a pharmacy backup recovery secret using AES-256-GCM.
 */
export function encryptRecoverySecret(plainSecret: string): {
  encrypted_value: string;
  iv: string;
  tag: string;
} {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainSecret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return {
    encrypted_value: encrypted,
    iv: iv.toString("hex"),
    tag,
  };
}

/**
 * Decrypts a pharmacy backup recovery secret using AES-256-GCM.
 */
export function decryptRecoverySecret(
  encrypted_value: string,
  iv: string,
  tag: string
): string {
  const key = getMasterKey();
  const ivBuf = Buffer.from(iv, "hex");
  const tagBuf = Buffer.from(tag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tagBuf);

  let decrypted = decipher.update(encrypted_value, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
