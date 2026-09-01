import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import License from "@/models/License";

/**
 * GET /api/admin/analytics-bootstrap
 * 
 * Returns bootstrap status for a client.
 * Requires admin authentication.
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  await connectToDatabase();

  try {
    // Find all licenses for this client
    const licenses = await License.find({ client_id: clientId }).select("id license_key features status").lean();
    
    // Find bootstraps for this client
    const bootstraps = await AnalyticsBootstrap.find({ client_id: clientId }).lean();
    
    // Map them together
    const result = licenses.map(lic => {
      const b = bootstraps.find(b => b.license_id === lic.id);
      return {
        license_id: lic.id,
        license_key: lic.license_key,
        cloud_dashboard_enabled: !!lic.features?.cloud_dashboard,
        license_status: lic.status,
        bootstrap_status: b ? b.status : "not_started",
        bootstrap_version: b?.bootstrap_version,
        completed_at: b?.completed_at,
        daily_records_count: b?.daily_records_count,
        has_inventory_snapshot: b?.has_inventory_snapshot,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Admin bootstrap status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
