import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import Client from "@/models/Client";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";
import License from "@/models/License";
import { resolveEffectivePharmacyLogo } from "@/lib/branding/logo-service";

/**
 * GET /api/portal/auth/me
 *
 * Returns the current portal user session.
 * Performs full DB revalidation (status check, client_id match).
 * Returns 401 JSON (not redirect) if unauthenticated.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);
    const [client, portalState, project, clientLicenses] = await Promise.all([
      Client.findOne({ id: user.client_id }).lean<any>(),
      OwnerPortalState.findOne({ client_id: user.client_id })
        .sort({ captured_at: -1 })
        .select("pharmacy_name pharmacy_logo license_id")
        .lean<any>(),
      Project.findOne({ client_id: user.client_id })
        .sort({ updatedAt: -1 })
        .select("name branding")
        .lean<any>(),
      License.find({ client_id: user.client_id })
        .sort({ created_at: -1 })
        .select("id status features branding project_id")
        .lean<any[]>(),
    ]);

    const primaryLicense =
      clientLicenses.find((l) => l.id === portalState?.license_id) ||
      clientLicenses.find((l) => l.status === "active") ||
      clientLicenses[0] ||
      null;

    const resolvedPharmacyName =
      portalState?.pharmacy_name ||
      project?.branding?.business_name ||
      project?.name ||
      client?.name ||
      user.client_name ||
      "AivraSol Pharmacy";

    const resolvedBranding = resolveEffectivePharmacyLogo({
      license: primaryLicense,
      project,
      portalState,
    });
    const resolvedPharmacyLogo = resolvedBranding.logoUrl;

    // Check cloud backup feature entitlement for this client
    const hasCloudBackup = clientLicenses.some((l) => l.features?.cloud_backup === true);

    return NextResponse.json({
      ok: true,
      pharmacy_name: resolvedPharmacyName,
      pharmacy_logo: resolvedPharmacyLogo,
      branding_version: resolvedBranding.brandingVersion,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        client_id: user.client_id,
        last_login_at: user.last_login_at,
        pharmacy_name: resolvedPharmacyName,
        pharmacy_logo: resolvedPharmacyLogo,
        client: client ? {
          name: client.name,
          contact_name: client.contact_name,
          contact_email: client.contact_email,
          contact_phone: client.contact_phone,
          address: client.address,
          timezone: client.timezone,
          has_cloud_backup: !!hasCloudBackup,
        } : null,
      },
    });
  } catch (err) {
    if (err instanceof PortalAuthError) {
      return portalAuthErrorResponse(err);
    }
    console.error("Portal /me error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
