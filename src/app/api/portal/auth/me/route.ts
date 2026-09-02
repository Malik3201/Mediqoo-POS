import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import Client from "@/models/Client";

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
    const client = await Client.findOne({ id: user.client_id }).lean();
    
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        client_id: user.client_id,
        last_login_at: user.last_login_at,
        client: client ? {
          name: client.name,
          contact_name: client.contact_name,
          contact_email: client.contact_email,
          contact_phone: client.contact_phone,
          address: client.address,
          timezone: client.timezone,
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
