import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import InventorySnapshot from "@/models/InventorySnapshot";
import License from "@/models/License";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";

/**
 * GET /api/portal/dashboard/inventory
 *
 * Returns the current inventory summary for the authenticated portal user's client.
 *
 * Anti-double-count semantics (per correction #2):
 *   - Fetches ONE snapshot per license (unique index enforced at storage time).
 *   - For a client with multiple licenses: aggregates latest snapshot from each license.
 *   - Two terminals under the same license share inventory (LAN sync) — only ONE
 *     snapshot record exists per license, so summing across licenses is safe.
 *
 * Query params:
 *   license_id: optional — filter to a specific installation
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);

    await connectToDatabase();

    const clientId = user.client_id; // ALWAYS from session
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");

    let licenseIds: string[] = [];

    if (licenseIdParam) {
      // Validate license belongs to this client
      const licenseCheck = await License.findOne({
        id: licenseIdParam,
        client_id: clientId,
      }).lean();

      if (!licenseCheck) {
        return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      }
      licenseIds = [licenseIdParam];
    } else {
      // Get all licenses for this client
      const licenses = await License.find({ client_id: clientId })
        .select("id")
        .lean<{ id: string }[]>();
      licenseIds = licenses.map((l) => l.id);
    }

    // One snapshot per license (DB unique index guarantees this)
    const snapshots = await InventorySnapshot.find({
      client_id: clientId,
      license_id: { $in: licenseIds },
    }).lean();

    // Aggregate across licenses (safe because one record per license, never summing terminals)
    const totals = snapshots.reduce(
      (acc, s) => ({
        stock_value: acc.stock_value + (s.stock_value ?? 0),
        low_stock_count: acc.low_stock_count + (s.low_stock_count ?? 0),
        out_of_stock_count: acc.out_of_stock_count + (s.out_of_stock_count ?? 0),
        expiring_soon_count: acc.expiring_soon_count + (s.expiring_soon_count ?? 0),
      }),
      {
        stock_value: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        expiring_soon_count: 0,
      }
    );

    // Include per-license breakdown for optional UI drill-down
    const perLicense = snapshots.map((s) => ({
      license_id: s.license_id,
      captured_at: s.captured_at,
      reported_by_terminal: s.reported_by_terminal,
      stock_value: s.stock_value,
      low_stock_count: s.low_stock_count,
      out_of_stock_count: s.out_of_stock_count,
      expiring_soon_count: s.expiring_soon_count,
    }));

    return NextResponse.json({
      ok: true,
      totals,
      per_license: perLicense,
      license_count: snapshots.length,
      last_updated: snapshots.reduce<Date | null>((latest, s) => {
        const cap = s.captured_at as Date;
        return latest === null || cap > latest ? cap : latest;
      }, null),
    });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Dashboard inventory error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
