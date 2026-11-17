import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.license_key || !body.machine_id) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    const license = await License.findOne({ license_key: body.license_key });
    if (!license) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS }
      );
    }

    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: body.machine_id,
    });

    if (!seat) {
      return NextResponse.json(
        { error: "unregistered_machine" },
        { status: 403, headers: CORS }
      );
    }

    // Strict Guard: Peer seats cannot request Fresh Start (Rule 3)
    if (seat.role === "client") {
      return NextResponse.json(
        { error: "peer_seats_not_allowed", message: "Fresh Start is managed from the Main POS." },
        { status: 403, headers: CORS }
      );
    }

    // If already enabled or completed, respect current status
    if (license.fresh_start?.status === "enabled") {
      return NextResponse.json(
        { ok: true, status: "enabled", message: "Fresh Start is already approved" },
        { headers: CORS }
      );
    }

    const now = new Date();
    const updated = await License.findOneAndUpdate(
      { id: license.id },
      {
        $set: {
          "fresh_start.status": "pending",
          "fresh_start.requested_at": now,
          "fresh_start.requested_by": body.requested_by || "Main POS Owner",
          "fresh_start.app_version": body.app_version || null,
          "fresh_start.notes": body.notes || "Requested from Main POS seat",
          "fresh_start.rejected_at": null,
          "fresh_start.rejected_by": null,
          "fresh_start.rejection_reason": null,
        },
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    return NextResponse.json(
      {
        ok: true,
        status: "pending",
        requested_at: updated?.fresh_start?.requested_at,
        authorization_version: updated?.fresh_start?.authorization_version || 1,
        cycle_id: updated?.fresh_start?.cycle_id || null,
        license_version: updated?.license_version,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Request Fresh Start Error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
