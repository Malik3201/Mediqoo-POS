import crypto from "node:crypto";
import dbConnect from "@/lib/db";
import Project from "@/models/Project";
import {
  callStorefrontManageApi,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

const SUPPORTED_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function parsePosLogoDataUrl(rawLogoUrl: string): {
  mimeType: string;
  base64Data: string;
  buffer: Buffer;
} | null {
  const trimmed = rawLogoUrl.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const rawMime = match[1].toLowerCase();
  const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  if (!SUPPORTED_MIMES.has(mimeType)) return null;
  const base64Data = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64Data, "base64");
  if (!buffer.length || buffer.length > 650 * 1024) return null;
  return { mimeType, base64Data, buffer };
}

export async function getPosProjectLogoForPharmacy(pharmacyId: string): Promise<{
  rawLogoUrl: string;
  mimeType: string;
  base64Data: string;
  buffer: Buffer;
} | null> {
  if (!pharmacyId) return null;
  try {
    await dbConnect();
    const project: any = await Project.findOne({ client_id: pharmacyId })
      .sort({ updatedAt: -1 })
      .lean();
    const rawLogoUrl =
      typeof project?.branding?.logo_url === "string" ? project.branding.logo_url.trim() : "";
    if (!rawLogoUrl) return null;

    const parsed = parsePosLogoDataUrl(rawLogoUrl);
    if (parsed) {
      return { rawLogoUrl, ...parsed };
    }

    if (/^https?:\/\//i.test(rawLogoUrl)) {
      const resp = await fetch(rawLogoUrl, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return null;
      const ct = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const mimeType = ct === "image/jpg" ? "image/jpeg" : ct;
      if (!SUPPORTED_MIMES.has(mimeType)) return null;
      const arr = await resp.arrayBuffer();
      const buffer = Buffer.from(arr);
      if (!buffer.length || buffer.length > 650 * 1024) return null;
      return {
        rawLogoUrl,
        mimeType,
        base64Data: buffer.toString("base64"),
        buffer,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function syncPosProjectLogoToStorefront(params: {
  storefrontId: string;
  pharmacyId: string;
  actor: StorefrontManagementActor;
}): Promise<{
  synced: boolean;
  logo_url?: string;
  byte_size?: number;
  reason?: string;
}> {
  const posLogo = await getPosProjectLogoForPharmacy(params.pharmacyId);
  if (!posLogo) {
    return { synced: false, reason: "no_pos_logo_found" };
  }

  const sha256Hex = crypto.createHash("sha256").update(posLogo.buffer).digest("hex");
  const ext =
    posLogo.mimeType === "image/png"
      ? "png"
      : posLogo.mimeType === "image/webp"
      ? "webp"
      : "jpg";

  const uploadRes = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/${encodeURIComponent(params.storefrontId)}/media`,
    {
      method: "POST",
      actor: params.actor,
      body: {
        purpose: "logo",
        asset_purpose: "logo",
        original_filename: `pos-pharmacy-logo.${ext}`,
        content_type: posLogo.mimeType,
        mime_type: posLogo.mimeType,
        byte_size: posLogo.buffer.length,
        sha256_hex: sha256Hex,
        base64_data: posLogo.base64Data,
        entity_type: "branding",
        entity_id: params.storefrontId,
      },
    }
  );

  if (!uploadRes.ok || !uploadRes.data?.media?.public_url) {
    return { synced: false, reason: "upload_failed" };
  }

  return {
    synced: true,
    logo_url: uploadRes.data.media.public_url,
    byte_size: posLogo.buffer.length,
  };
}

