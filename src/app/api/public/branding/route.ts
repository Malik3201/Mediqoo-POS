import { NextRequest } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Project from "@/models/Project";
import OwnerPortalState from "@/models/OwnerPortalState";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { resolveEffectivePharmacyLogo } from "@/lib/branding/logo-service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function GET(req: NextRequest) {
  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: false,
    rateBucket: "branding-get",
    rateMaxPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  try {
    await connectToDatabase();
    const license: any = await License.findOne({ id: auth.identity.license.id }).lean();
    if (!license) {
      return whatsappJson({ ok: false, error: "license_not_found" }, 404);
    }
    const [project, portalState] = await Promise.all([
      license.project_id ? Project.findOne({ id: license.project_id }).select("branding").lean() : null,
      OwnerPortalState.findOne({ license_id: license.id }).select("pharmacy_logo").lean(),
    ]);

    const resolved = resolveEffectivePharmacyLogo({ license, project, portalState });
    return whatsappJson({
      ok: true,
      canManage: auth.identity.seat?.role === "main",
      brandingVersion: resolved.brandingVersion,
      logoUrl: resolved.logoUrl,
      logoThumbUrl: resolved.logoThumbUrl,
      updatedAt: resolved.updatedAt,
      isCustom: resolved.isCustom,
    });
  } catch (err: any) {
    console.error("[public/branding GET]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Could not load pharmacy branding." }, 500);
  }
}
