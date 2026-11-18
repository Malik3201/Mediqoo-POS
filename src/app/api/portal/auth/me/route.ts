import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import Client from "@/models/Client";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";

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
    const [client, portalState, project] = await Promise.all([
      Client.findOne({ id: user.client_id }).lean<any>(),
      OwnerPortalState.findOne({ client_id: user.client_id })
        .sort({ captured_at: -1 })
        .select("pharmacy_name pharmacy_logo")
        .lean<any>(),
      Project.findOne({ client_id: user.client_id })
        .sort({ updatedAt: -1 })
        .select("name branding")
        .lean<any>(),
    ]);

    // Prioritize actual pharmacy store name over proprietor's personal name
    const resolvedPharmacyName =
      (client?.name && !/^abdul\s*rehman$/i.test(client.name) ? client.name : null) ||
      (portalState?.pharmacy_name && !/^abdul\s*rehman$/i.test(portalState.pharmacy_name) ? portalState.pharmacy_name : null) ||
      project?.branding?.business_name ||
      (project?.name && !/^abdul\s*rehman$/i.test(project.name) ? project.name : null) ||
      client?.name ||
      portalState?.pharmacy_name ||
      user.client_name ||
      "AR Pharmacy";

    const resolvedPharmacyLogo =
      portalState?.pharmacy_logo ||
      project?.branding?.logo_url ||
      null;

    // Check cloud backup feature entitlement for this client
    const License = require("@/models/License").default;
    const hasCloudBackup = await License.exists({ 
      client_id: user.client_id, 
      "features.cloud_backup": true 
    });

    return NextResponse.json({
      ok: true,
      pharmacy_name: resolvedPharmacyName,
      pharmacy_logo: resolvedPharmacyLogo,
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
