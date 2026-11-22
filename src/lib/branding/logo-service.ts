import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Project from "@/models/Project";
import OwnerPortalState from "@/models/OwnerPortalState";
import AuditLog from "@/models/AuditLog";
import { uploadBufferToR2, deleteR2Object } from "@/lib/r2";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB canonical upper bound
export const MAX_LOGO_DIMENSION = 2048;

export type ValidatedLogoImage = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  ext: "png" | "jpg" | "webp";
  buffer: Buffer;
  width: number;
  height: number;
};

/**
 * Inspects actual magic bytes and image header dimensions in pure Node.
 * Never trusts client-provided MIME type or filename.
 */
export function validateLogoBuffer(buffer: Buffer): { ok: true; image: ValidatedLogoImage } | { ok: false; error: string } {
  if (!buffer || buffer.length < 16) {
    return { ok: false, error: "Image file is empty or unreadable." };
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo image exceeds the 2 MB size limit." };
  }

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offset 16..24
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0 || width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
      return { ok: false, error: `PNG dimensions must be between 1×1 and ${MAX_LOGO_DIMENSION}×${MAX_LOGO_DIMENSION}.` };
    }
    return { ok: true, image: { mimeType: "image/png", ext: "png", buffer, width, height } };
  }

  // 2. JPEG: FF D8 FF, scan SOF0/SOF1/SOF2 markers for dimensions
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    let width = 0;
    let height = 0;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) break;
      const segLen = buffer.readUInt16BE(offset);
      if (segLen < 2 || offset + segLen > buffer.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += segLen;
    }
    if (width <= 0 || height <= 0 || width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
      return { ok: false, error: `JPEG dimensions must be between 1×1 and ${MAX_LOGO_DIMENSION}×${MAX_LOGO_DIMENSION}.` };
    }
    return { ok: true, image: { mimeType: "image/jpeg", ext: "jpg", buffer, width, height } };
  }

  // 3. WebP: RIFF....WEBP (VP8, VP8L, or VP8X)
  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buffer.toString("ascii", 12, 16);
    let width = 0;
    let height = 0;
    if (chunk === "VP8X" && buffer.length >= 30) {
      width = 1 + buffer.readUIntLE(24, 3);
      height = 1 + buffer.readUIntLE(27, 3);
    } else if (chunk === "VP8 " && buffer.length >= 30) {
      width = buffer.readUInt16LE(26) & 0x3fff;
      height = buffer.readUInt16LE(28) & 0x3fff;
    } else if (chunk === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (width <= 0 || height <= 0 || width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
      return { ok: false, error: `WebP dimensions must be between 1×1 and ${MAX_LOGO_DIMENSION}×${MAX_LOGO_DIMENSION}.` };
    }
    return { ok: true, image: { mimeType: "image/webp", ext: "webp", buffer, width, height } };
  }

  return { ok: false, error: "Unsupported image format. Please upload PNG, JPG, or WebP." };
}

export function decodeBase64ImageInput(raw: string): Buffer | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const b64 = trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  const clean = b64.replace(/\s+/g, "");
  if (!clean) return null;
  try {
    const buf = Buffer.from(clean, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export function appendCacheBustVersion(url: string | null | undefined, version: number): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const clean = url.trim();
  if (clean.startsWith("data:")) return clean;
  if (!version || version <= 0) return clean;
  try {
    const u = new URL(clean);
    u.searchParams.set("v", String(version));
    return u.toString();
  } catch {
    const sep = clean.includes("?") ? "&" : "?";
    return clean.includes("v=") ? clean : `${clean}${sep}v=${version}`;
  }
}

/**
 * Canonical server-side resolver for a pharmacy's effective logo.
 * Strictly license-scoped first; respects explicit removal (`logo_removed: true`).
 */
export function resolveEffectivePharmacyLogo(params: {
  license?: any;
  project?: any;
  portalState?: any;
}): {
  logoUrl: string | null;
  logoThumbUrl: string | null;
  brandingVersion: number;
  updatedAt: string | null;
  isCustom: boolean;
} {
  const b = params.license?.branding;
  const version = Number(b?.branding_version || 0);
  const updatedAt = b?.updated_at ? new Date(b.updated_at).toISOString() : null;

  if (b?.logo_removed === true) {
    return { logoUrl: null, logoThumbUrl: null, brandingVersion: version, updatedAt, isCustom: false };
  }

  if (typeof b?.logo_url === "string" && b.logo_url.trim()) {
    return {
      logoUrl: appendCacheBustVersion(b.logo_url, version),
      logoThumbUrl: appendCacheBustVersion(b.logo_thumb_url || b.logo_url, version),
      brandingVersion: version,
      updatedAt,
      isCustom: true,
    };
  }

  // Backward-compatible fallback for licenses configured before license.branding
  const fallback =
    (typeof params.portalState?.pharmacy_logo === "string" && params.portalState.pharmacy_logo.trim()) ||
    (typeof params.project?.branding?.logo_url === "string" && params.project.branding.logo_url.trim()) ||
    null;

  return {
    logoUrl: fallback ? appendCacheBustVersion(fallback, version) : null,
    logoThumbUrl: fallback ? appendCacheBustVersion(fallback, version) : null,
    brandingVersion: version,
    updatedAt,
    isCustom: Boolean(fallback),
  };
}

function buildPublicAssetUrl(objectKey: string, version: number): string {
  const base = (process.env.R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("R2_PUBLIC_URL is not configured on the server.");
  }
  return `${base}/${objectKey}?v=${version}`;
}

export async function uploadLicensePharmacyLogo(params: {
  licenseId: string;
  imageBase64: string;
  thumbBase64?: string | null;
  actorLabel: string;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<
  | {
      ok: true;
      logoUrl: string;
      logoThumbUrl: string;
      brandingVersion: number;
      updatedAt: string;
      width: number;
      height: number;
      sizeBytes: number;
    }
  | { ok: false; status: number; error: string }
> {
  const rawBuf = decodeBase64ImageInput(params.imageBase64);
  if (!rawBuf) {
    return { ok: false, status: 400, error: "Invalid or missing logo image payload." };
  }
  const validated = validateLogoBuffer(rawBuf);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  await connectToDatabase();
  const license = await License.findOne({ id: params.licenseId });
  if (!license) {
    return { ok: false, status: 404, error: "License not found." };
  }

  const prevKey = license.branding?.logo_object_key || null;
  const prevThumbKey = license.branding?.logo_thumb_object_key || null;
  const nextVersion = Number(license.branding?.branding_version || 0) + 1;
  const safeLicId = license.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const stamp = Date.now();
  const objectKey = `branding/licenses/${safeLicId}/logo-v${nextVersion}-${stamp}.${validated.image.ext}`;

  await uploadBufferToR2(objectKey, validated.image.buffer, validated.image.mimeType, {
    license_id: license.id,
    branding_version: String(nextVersion),
    purpose: "pharmacy-logo",
  });

  let thumbObjectKey: string | null = null;
  let thumbUrl: string | null = null;
  if (params.thumbBase64) {
    const thumbBuf = decodeBase64ImageInput(params.thumbBase64);
    if (thumbBuf) {
      const valThumb = validateLogoBuffer(thumbBuf);
      if (valThumb.ok) {
        thumbObjectKey = `branding/licenses/${safeLicId}/logo-thumb-v${nextVersion}-${stamp}.${valThumb.image.ext}`;
        await uploadBufferToR2(thumbObjectKey, valThumb.image.buffer, valThumb.image.mimeType, {
          license_id: license.id,
          branding_version: String(nextVersion),
          purpose: "pharmacy-logo-thumb",
        });
        thumbUrl = buildPublicAssetUrl(thumbObjectKey, nextVersion);
      }
    }
  }

  const logoUrl = buildPublicAssetUrl(objectKey, nextVersion);
  const now = new Date();

  license.branding = {
    logo_url: logoUrl,
    logo_object_key: objectKey,
    logo_thumb_url: thumbUrl || logoUrl,
    logo_thumb_object_key: thumbObjectKey,
    logo_removed: false,
    branding_version: nextVersion,
    updated_at: now,
    updated_by: params.actorLabel,
  };
  license.license_version = Number(license.license_version || 1) + 1;
  await license.save();

  // Keep linked project (exact project_id for this license) and OwnerPortalState (exact license_id) in sync
  await Promise.all([
    license.project_id
      ? Project.updateOne({ id: license.project_id }, { $set: { "branding.logo_url": logoUrl } }).catch(() => {})
      : Promise.resolve(),
    OwnerPortalState.updateMany({ license_id: license.id }, { $set: { pharmacy_logo: logoUrl } }).catch(() => {}),
  ]);

  // Best-effort cleanup of previous R2 objects
  if (prevKey && prevKey !== objectKey) {
    void deleteR2Object(prevKey).catch(() => {});
  }
  if (prevThumbKey && prevThumbKey !== thumbObjectKey) {
    void deleteR2Object(prevThumbKey).catch(() => {});
  }

  try {
    await AuditLog.create({
      action: "pharmacy_logo_updated",
      actor_id: params.actorId || undefined,
      actor_email: params.actorEmail || undefined,
      entity_type: "license",
      entity_id: license.id,
      metadata: {
        branding_version: nextVersion,
        mime_type: validated.image.mimeType,
        width: validated.image.width,
        height: validated.image.height,
        size_bytes: validated.image.buffer.length,
        actor: params.actorLabel,
      },
    });
  } catch {
    /* non-fatal audit log */
  }

  return {
    ok: true,
    logoUrl,
    logoThumbUrl: thumbUrl || logoUrl,
    brandingVersion: nextVersion,
    updatedAt: now.toISOString(),
    width: validated.image.width,
    height: validated.image.height,
    sizeBytes: validated.image.buffer.length,
  };
}

export async function removeLicensePharmacyLogo(params: {
  licenseId: string;
  actorLabel: string;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<{ ok: true; brandingVersion: number; updatedAt: string } | { ok: false; status: number; error: string }> {
  await connectToDatabase();
  const license = await License.findOne({ id: params.licenseId });
  if (!license) {
    return { ok: false, status: 404, error: "License not found." };
  }

  const prevKey = license.branding?.logo_object_key || null;
  const prevThumbKey = license.branding?.logo_thumb_object_key || null;
  const nextVersion = Number(license.branding?.branding_version || 0) + 1;
  const now = new Date();

  license.branding = {
    logo_url: null,
    logo_object_key: null,
    logo_thumb_url: null,
    logo_thumb_object_key: null,
    logo_removed: true,
    branding_version: nextVersion,
    updated_at: now,
    updated_by: params.actorLabel,
  };
  license.license_version = Number(license.license_version || 1) + 1;
  await license.save();

  await Promise.all([
    license.project_id
      ? Project.updateOne({ id: license.project_id }, { $set: { "branding.logo_url": null } }).catch(() => {})
      : Promise.resolve(),
    OwnerPortalState.updateMany({ license_id: license.id }, { $set: { pharmacy_logo: null } }).catch(() => {}),
  ]);

  if (prevKey) void deleteR2Object(prevKey).catch(() => {});
  if (prevThumbKey) void deleteR2Object(prevThumbKey).catch(() => {});

  try {
    await AuditLog.create({
      action: "pharmacy_logo_removed",
      actor_id: params.actorId || undefined,
      actor_email: params.actorEmail || undefined,
      entity_type: "license",
      entity_id: license.id,
      metadata: { branding_version: nextVersion, actor: params.actorLabel },
    });
  } catch {
    /* non-fatal */
  }

  return { ok: true, brandingVersion: nextVersion, updatedAt: now.toISOString() };
}
