import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Release from "@/models/Release";
import ReleaseInstall from "@/models/ReleaseInstall";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Compare semantic versions "1.2.3". Returns 1 if a>b, -1 if a<b, 0 equal. */
function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

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

    // Latest published release applicable to this client
    const releases = await Release.find({ status: "published" })
      .sort({ published_at: -1 })
      .limit(50)
      .lean();

    const applicable = releases.find((r: any) => {
      if (r.rollout_type === "specific") {
        const targets: string[] = r.target_client_ids ?? [];
        if (!lic.client_id || !targets.includes(lic.client_id)) return false;
      }
      return cmpVer(r.version, currentVersion) > 0;
    });

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

    return NextResponse.json({
      update: {
        id: applicable.id,
        version: applicable.version,
        changelog: applicable.changelog ?? "",
        mandatory: !!applicable.mandatory,
        size: applicable.installer_size ?? 0,
        sha256: applicable.sha256 ?? null,
        download_url: downloadUrl,
        published_at: applicable.published_at,
      },
    }, { headers: CORS });
  } catch (e: any) {
    console.error("Check update API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS },
    );
  }
}
