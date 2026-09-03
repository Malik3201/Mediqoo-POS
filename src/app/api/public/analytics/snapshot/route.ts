import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import InventorySnapshot from "@/models/InventorySnapshot";
import { isCloudDashboardEnabled } from "@/lib/status";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/public/analytics/snapshot
 *
 * Receives an inventory snapshot from POS and upserts the canonical state
 * for the license.
 *
 * Anti-double-count semantics (per correction #2):
 *   - One record per { client_id, license_id } (DB unique index enforced).
 *   - All terminals on the same License share the same LAN-synchronized inventory.
 *   - The server always REPLACES the existing snapshot with the incoming one.
 *   - reported_by_terminal is stored as metadata only.
 *   - Dashboard aggregates ONE snapshot per license — never sums terminals.
 *
 * Authentication: same as events (license_key + machine_id → verified seat).
 *
 * Body:
 * {
 *   license_key: string,
 *   machine_id: string,
 *   snapshot: {
 *     captured_at: string,       // ISO 8601
 *     stock_value: number,
 *     low_stock_count: number,
 *     out_of_stock_count: number,
 *     expiring_soon_count: number
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const { license_key, machine_id, snapshot } = body ?? {};

    if (!license_key || !machine_id || !snapshot) {
      return NextResponse.json(
        { error: "missing_fields", message: "license_key, machine_id, and snapshot are required." },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // Resolve license
    const license = await License.findOne({ license_key }).lean<{
      id: string; client_id: string; status: string; features: any;
    }>();

    if (!license) {
      return NextResponse.json({ error: "invalid_license" }, { status: 401, headers: CORS });
    }

    if (license.status !== "active") {
      return NextResponse.json({ error: "license_not_active" }, { status: 403, headers: CORS });
    }

    if (!isCloudDashboardEnabled(license)) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403, headers: CORS });
    }

    // Verify registered seat
    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: String(machine_id),
    }).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json({ error: "machine_not_registered" }, { status: 401, headers: CORS });
    }

    // Validate snapshot fields
    const capturedAt = new Date(snapshot.captured_at);
    if (isNaN(capturedAt.getTime())) {
      return NextResponse.json(
        { error: "invalid_captured_at" },
        { status: 400, headers: CORS }
      );
    }

    const stockValue = Number(snapshot.stock_value ?? 0);
    const lowStockCount = Number(snapshot.low_stock_count ?? 0);
    const outOfStockCount = Number(snapshot.out_of_stock_count ?? 0);
    const expiringSoonCount = Number(snapshot.expiring_soon_count ?? 0);

    // Upsert canonical snapshot per license (NOT per terminal — prevents double counting)
    await InventorySnapshot.findOneAndUpdate(
      { client_id: license.client_id, license_id: license.id },
      {
        $set: {
          reported_by_terminal: seat.terminal_number,
          reported_by_seat_id: seat.id,
          captured_at: capturedAt,
          stock_value: stockValue,
          low_stock_count: lowStockCount,
          out_of_stock_count: outOfStockCount,
          expiring_soon_count: expiringSoonCount,
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e: any) {
    console.error("Snapshot error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
