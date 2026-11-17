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

    const now = new Date();
    const updated = await License.findOneAndUpdate(
      { id: license.id },
      {
        $set: {
          "fresh_start.status": "completed",
          "fresh_start.completed_at": now,
          "fresh_start.completed_by": body.completed_by || "POS Operator",
          "fresh_start.notes": body.notes || "Fresh Start Reset executed successfully in POS",
          "go_live.status": "completed",
          "go_live.completed_at": now,
          "go_live.completed_by": body.completed_by || "POS Operator",
          "go_live.notes": body.notes || "Fresh Start Reset executed successfully in POS",
        },
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    return NextResponse.json(
      {
        ok: true,
        status: "completed",
        completed_at: updated?.fresh_start?.completed_at,
        authorization_version: updated?.fresh_start?.authorization_version || 1,
        cycle_id: updated?.fresh_start?.cycle_id || null,
        license_version: updated?.license_version,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Complete Fresh Start Error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
