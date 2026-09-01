import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";

/**
 * GET /api/portal/installations
 *
 * Returns all licenses (installations) for the authenticated portal user's client.
 * Used to populate the filter dropdown in the dashboard.
 *
 * Only exposes licenses belonging to this client (session-scoped).
 * cloud_dashboard feature flag is respected: only shows enabled licenses.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);
    await connectToDatabase();

    const clientId = user.client_id;

    const licenses = await License.find({
      client_id: clientId,
      "features.cloud_dashboard": true,
    })
      .select("id license_key status seats issued_at notes")
      .sort({ issued_at: -1 })
      .lean();

    // Return safe fields only — no license_key in response (not needed for dashboard)
    const installations = licenses.map((l: any) => ({
      id: l.id,
      label: l.notes ?? `License ${l.id.slice(0, 8)}`,
      status: l.status,
      seats: l.seats,
      issued_at: l.issued_at,
    }));

    return NextResponse.json({ ok: true, installations });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Installations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
