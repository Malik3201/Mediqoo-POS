import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import ReleaseInstall from "@/models/ReleaseInstall";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.license_key || !body.release_id || !body.version) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();

    const lic = await License.findOne({ license_key: body.license_key }).lean();
    if (!lic) {
      return NextResponse.json({ error: "invalid_license" }, { status: 401, headers: CORS });
    }

    await ReleaseInstall.create({
      release_id: body.release_id,
      license_id: lic.id,
      license_key: lic.license_key,
      version: body.version,
      machine_id: body.machine_id ?? null,
      status: body.status ?? "installed",
      error: body.error ?? null,
    });

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e: any) {
    console.error("Report install API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS },
    );
  }
}
