import crypto from "crypto";
import sharp from "sharp";

export const MAX_PAGES_PER_INVOICE = 8;
export const MAX_PAGE_BYTES = 10 * 1024 * 1024; // 10 MB per page
export const MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB total
export const MIN_IMAGE_DIMENSION = 32;
export const MAX_IMAGE_DIMENSION = 8192;
export const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateOpaqueToken(prefix = "sp"): string {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return crypto
    .createHmac("sha256", "aivrasol-smart-purchase-token-v1")
    .update(String(token || ""))
    .digest("hex");
}

function getTempEncryptionKey(): Buffer {
  const secret =
    process.env.AI_CREDENTIAL_MASTER_KEY ||
    process.env.BACKUP_SECRET_MASTER_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "aivrasol-smart-purchase-temp-encryption-key";
  return crypto
    .createHmac("sha256", "aivrasol-smart-purchase-page-aes-v1")
    .update(secret)
    .digest();
}

export function encryptBufferForTempStorage(buf: Buffer): {
  encryptedBase64: string;
  ivHex: string;
  authTagHex: string;
} {
  const key = getTempEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedBase64: ct.toString("base64"),
    ivHex: iv.toString("hex"),
    authTagHex: tag.toString("hex"),
  };
}

export function decryptBufferFromTempStorage(payload: {
  encryptedBase64: string;
  ivHex: string;
  authTagHex: string;
}): Buffer {
  const key = getTempEncryptionKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.authTagHex, "hex"));
  const ct = Buffer.from(payload.encryptedBase64, "base64");
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function detectMagicMimeType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  // PDF: %PDF-
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export interface SanitizedInvoicePage {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

/**
 * Validates actual file magic bytes, dimensions, and size; auto-rotates via EXIF
 * and strips all EXIF/GPS/camera metadata to protect user privacy and normalize orientation.
 */
export async function validateAndSanitizeImageBuffer(
  rawBuffer: Buffer
): Promise<{ ok: true; page: SanitizedInvoicePage } | { ok: false; error: string; message: string }> {
  if (!rawBuffer || rawBuffer.length === 0) {
    return { ok: false, error: "empty_file", message: "Uploaded file is empty." };
  }
  if (rawBuffer.length > MAX_PAGE_BYTES) {
    return {
      ok: false,
      error: "file_too_large",
      message: `Each invoice page must be under ${Math.round(MAX_PAGE_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const detectedMime = detectMagicMimeType(rawBuffer);
  if (!detectedMime || detectedMime === "application/pdf") {
    return {
      ok: false,
      error: "unsupported_mime_type",
      message: "Only valid JPEG, PNG, or WebP invoice images are accepted here.",
    };
  }

  try {
    const metadata = await sharp(rawBuffer, { failOn: "error" }).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
      return {
        ok: false,
        error: "image_too_small",
        message: `Image dimensions (${width}x${height}) are too small. Minimum is ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px.`,
      };
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return {
        ok: false,
        error: "image_too_large",
        message: `Image dimensions (${width}x${height}) exceed maximum allowed ${MAX_IMAGE_DIMENSION}px.`,
      };
    }

    // Auto-orient based on EXIF orientation tag and strip all metadata.
    // Downscale only if larger than 2200px on longest side so OCR/Vision stays crisp and fast.
    let pipeline = sharp(rawBuffer).rotate();
    const longest = Math.max(width, height);
    if (longest > 2200) {
      pipeline = pipeline.resize({
        width: width >= height ? 2200 : undefined,
        height: height > width ? 2200 : undefined,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const sanitizedBuffer = await pipeline
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    const finalMeta = await sharp(sanitizedBuffer).metadata();
    const sha256 = crypto.createHash("sha256").update(sanitizedBuffer).digest("hex");

    return {
      ok: true,
      page: {
        buffer: sanitizedBuffer,
        mimeType: "image/jpeg",
        width: finalMeta.width || width,
        height: finalMeta.height || height,
        sizeBytes: sanitizedBuffer.length,
        sha256,
      },
    };
  } catch {
    return {
      ok: false,
      error: "corrupt_image",
      message: "The uploaded file is not a valid or readable image.",
    };
  }
}

// Simple in-memory sliding window rate limiter for mobile & session endpoints
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (v.resetAt <= now) rateLimitBuckets.delete(k);
    }
  }
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count += 1;
  return true;
}
