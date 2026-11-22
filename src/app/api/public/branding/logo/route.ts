import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import {
  removeLicensePharmacyLogo,
  uploadLicensePharmacyLogo,
} from "@/lib/branding/logo-service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return whatsappJson({ ok: false, error: "invalid_json", message: "Invalid JSON payload." }, 400);
  }

  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: true,
    rateBucket: "branding-logo-upload",
    rateMaxPerMin: 15,
    body,
  });
  if (!auth.ok) return auth.response;

  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  const thumbBase64 = typeof body?.thumbBase64 === "string" ? body.thumbBase64 : null;

  try {
    const res = await uploadLicensePharmacyLogo({
      licenseId: auth.identity.license.id,
      imageBase64,
      thumbBase64,
      actorLabel: `Main POS (${auth.operatorName})`,
    });
    if (!res.ok) {
      return whatsappJson({ ok: false, error: "upload_rejected", message: res.error }, res.status);
    }
    return whatsappJson(res);
  } catch (err: any) {
    console.error("[public/branding/logo POST]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Failed uploading pharmacy logo." }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: true,
    rateBucket: "branding-logo-delete",
    rateMaxPerMin: 15,
  });
  if (!auth.ok) return auth.response;

  try {
    const res = await removeLicensePharmacyLogo({
      licenseId: auth.identity.license.id,
      actorLabel: `Main POS (${auth.operatorName})`,
    });
    if (!res.ok) {
      return whatsappJson({ ok: false, error: "delete_failed", message: res.error }, res.status);
    }
    return whatsappJson(res);
  } catch (err: any) {
    console.error("[public/branding/logo DELETE]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Failed removing pharmacy logo." }, 500);
  }
}
