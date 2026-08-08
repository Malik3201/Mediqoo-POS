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
    if (!body.license_key || !body.machine_id || !body.role) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400, headers: CORS },
      );
    }
    if (body.role !== "main" && body.role !== "client") {
      return NextResponse.json(
        { error: "invalid_role" },
        { status: 400, headers: CORS },
      );
    }

    await connectToDatabase();

    const lic = await License.findOne({ license_key: body.license_key }).lean();
    if (!lic) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS },
      );
    }
    if (lic.status !== "active") {
      return NextResponse.json(
        { error: "license_not_active", status: lic.status },
        { status: 403, headers: CORS },
      );
    }

    // Existing seat for this machine? Just heartbeat it.
    const existing = await LicenseSeat.findOne({
      license_id: lic.id,
      machine_id: body.machine_id,
    });

    if (existing) {
      existing.role = body.role;
      if (body.hostname) existing.hostname = body.hostname;
      existing.last_seen_at = new Date().toISOString();
      await existing.save();

      return NextResponse.json(
        { ok: true, seat_id: existing.id, reused: true },
        { headers: CORS },
      );
    }

    // Enforce seat cap.
    const count = await LicenseSeat.countDocuments({ license_id: lic.id });

    if (count >= (lic.seats ?? 1)) {
      return NextResponse.json(
        {
          error: "seat_limit_reached",
          seats: lic.seats,
          seats_used: count,
        },
        { status: 403, headers: CORS },
      );
    }

    // Only one "main" per license.
    if (body.role === "main") {
      const mainCount = await LicenseSeat.countDocuments({
        license_id: lic.id,
        role: "main",
      });
      if (mainCount > 0) {
        return NextResponse.json(
          { error: "main_already_exists" },
          { status: 409, headers: CORS },
        );
      }
    }

    const inserted = await LicenseSeat.create({
      license_id: lic.id,
      machine_id: body.machine_id,
      role: body.role,
      hostname: body.hostname ?? null,
    });

    return NextResponse.json(
      { ok: true, seat_id: inserted.id, reused: false },
      { headers: CORS },
    );
  } catch (e: any) {
    console.error("Register seat API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS },
    );
  }
}
