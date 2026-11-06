import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";
import ReleaseInstall from "@/models/ReleaseInstall";
import { getLatestPublishedHotRelease, serializeHotUpdateResponse } from "@/lib/release";
import { extractRequestGeo } from "@/lib/geo-location";

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
    const licenseKey = (body.license_key ?? "").trim();
    const currentVersion = (body.current_version ?? "0.0.0").trim();

    if (!licenseKey) {
      return NextResponse.json({ error: "license_key required" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();

    // Validate license
    const lic = await License.findOne({ license_key: licenseKey }).lean();
    if (!lic || lic.status !== "active") {
      return NextResponse.json({ update: null, reason: "invalid_license" }, { headers: CORS });
    }
    if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ update: null, reason: "expired_license" }, { headers: CORS });
    }

    // Silently capture location on update check
    try {
      const client = lic.client_id
        ? await Client.findOne({ id: lic.client_id }).lean()
        : null;
      const geo = extractRequestGeo(req, body?.location, client?.address || client?.name);
      if (geo) {
        if (body.machine_id) {
          await LicenseSeat.updateOne(
            { license_id: lic.id, machine_id: body.machine_id },
            { $set: { last_seen_at: new Date(), location: geo } }
          );
        }
        if (client && client.location?.source !== "admin_manual") {
          await Client.updateOne({ id: client.id }, { $set: { location: geo } });
        }
      }
    } catch {
      // Non-critical
    }

    // Latest published hot release applicable to this client
    const applicable = await getLatestPublishedHotRelease(currentVersion, lic.client_id);

    console.log("Update Check", JSON.stringify({
      installed_version: currentVersion,
      selected_hot_version: applicable ? applicable.version : null,
      update_available: !!applicable
    }));

    if (!applicable) {
      return NextResponse.json({ update: null }, { headers: CORS });
    }

    // Next.js static asset URL instead of signed S3 URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001";
    
    // If storage_path is already a full absolute URL (e.g. from Cloudflare R2), use it directly
    const downloadUrl = applicable.storage_path.startsWith("http")
      ? applicable.storage_path
      : `${baseUrl}${applicable.storage_path}`;

    // Log check
    await ReleaseInstall.create({
      release_id: applicable.id,
      license_id: lic.id,
      license_key: lic.license_key,
      version: applicable.version,
      machine_id: body.machine_id ?? null,
      status: "checked",
    });

    return NextResponse.json(serializeHotUpdateResponse(applicable, currentVersion), { headers: CORS });
  } catch (e: any) {
    console.error("Check update API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS },
    );
  }
}
