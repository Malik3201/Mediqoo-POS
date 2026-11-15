import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import ReleaseInstall from "@/models/ReleaseInstall";
import { ANDROID_POS_PLATFORM, ANDROID_POS_PRODUCT } from "@/lib/release-signing";

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
    const licenseKey = String(body.license_key || "").trim();
    const releaseId = String(body.release_id || "").trim();
    const version = String(body.version || "").trim();

    if (!licenseKey || !releaseId || !version) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();
    const lic = (await License.findOne({ license_key: licenseKey }).lean()) as any;
    if (!lic) {
      return NextResponse.json({ error: "invalid_license" }, { status: 401, headers: CORS });
    }

    await ReleaseInstall.create({
      release_id: releaseId,
      license_id: lic.id,
      license_key: lic.license_key,
      machine_id: body.machine_id ? String(body.machine_id) : undefined,
      version,
      app_type: ANDROID_POS_PRODUCT,
      platform: ANDROID_POS_PLATFORM,
      channel: body.channel ? String(body.channel) : undefined,
      release_type: body.release_type ? String(body.release_type) : undefined,
      native_version_code:
        typeof body.native_version_code === "number" ? body.native_version_code : undefined,
      web_version: body.web_version ? String(body.web_version) : undefined,
      status: String(body.status || "installed"),
      error: body.error ? String(body.error) : undefined,
    });

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err: any) {
    console.error("Android report-install API error:", err);
    return NextResponse.json(
      { error: err?.message || "unknown" },
      { status: 500, headers: CORS }
    );
  }
}

