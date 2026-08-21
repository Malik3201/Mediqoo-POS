import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Release from "@/models/Release";
import License from "@/models/License";

function parseVersion(v: string) {
  const parts = v.replace(/^v/, "").split(".");
  return parts.map(n => parseInt(n) || 0);
}

function isNewer(latest: string, current: string) {
  const v1 = parseVersion(latest);
  const v2 = parseVersion(current);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const p1 = v1[i] || 0;
    const p2 = v2[i] || 0;
    if (p1 > p2) return true;
    if (p1 < p2) return false;
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const version = url.searchParams.get("version");
    const licenseKey = url.searchParams.get("license_key");

    if (!version) {
      return NextResponse.json({ error: "Missing version parameter" }, { status: 400 });
    }

    await connectToDatabase();

    // Verify license if provided (optional for public updates, but good for tracking)
    if (licenseKey) {
      const license = await License.findOne({ 
        license_key: licenseKey, 
        status: { $in: ["active", "issued"] } 
      });
      if (!license) {
        return NextResponse.json({ updateAvailable: false, reason: "invalid_license" }, { status: 403 });
      }
    }

    // Find the latest published release
    const releases = await Release.find({ status: "published" }).sort({ published_at: -1 }).lean();
    if (!releases.length) {
      return NextResponse.json({ updateAvailable: false, currentVersion: version, latestVersion: version });
    }

    // Assuming semantic sorting or just the latest published
    let latestRelease = releases[0];
    
    // Better: Sort by semantic version
    releases.sort((a, b) => isNewer(a.version, b.version) ? -1 : 1);
    latestRelease = releases[0];

    if (isNewer(latestRelease.version, version)) {
      return NextResponse.json({
        updateAvailable: true,
        latestVersion: latestRelease.version,
        downloadUrl: latestRelease.release_type === "hot" ? latestRelease.asar_url : latestRelease.full_package_url,
        sha256: latestRelease.sha256 || "",
        releaseType: latestRelease.release_type || "hot"
      });
    }

    return NextResponse.json({
      updateAvailable: false
    });

  } catch (error: any) {
    console.error("Update check error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
