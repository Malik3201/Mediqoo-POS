import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Release from "@/models/Release";
import License from "@/models/License";
import { getLatestPublishedHotRelease, cmpVer, serializeHotUpdateResponse } from "@/lib/release";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const version = url.searchParams.get("version");
    const licenseKey = url.searchParams.get("license_key");

    if (!version) {
      return NextResponse.json({ error: "Missing version parameter" }, { status: 400 });
    }

    await connectToDatabase();

    let license = null;
    // Verify license if provided (optional for public updates, but good for tracking)
    if (licenseKey) {
      license = await License.findOne({ 
        license_key: licenseKey, 
        status: { $in: ["active", "issued"] } 
      });
      if (!license) {
        return NextResponse.json({ updateAvailable: false, reason: "invalid_license" }, { status: 403 });
      }
    }

    const latestRelease = await getLatestPublishedHotRelease(version, license?.client_id);

    console.log("Update Check", JSON.stringify({
      installed_version: version,
      selected_hot_version: latestRelease ? latestRelease.version : null,
      update_available: !!latestRelease
    }));

    if (latestRelease) {
      return NextResponse.json(serializeHotUpdateResponse(latestRelease, version));
    }

    return NextResponse.json({
      updateAvailable: false
    });

  } catch (error: any) {
    console.error("Update check error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
