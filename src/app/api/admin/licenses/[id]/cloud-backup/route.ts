import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Invalid request body: 'enabled' boolean is required" }, { status: 400 });
    }

    const enabled = body.enabled;
    await connectToDatabase();

    // 1. Attempt the atomic increment and feature set
    const updated = await License.findOneAndUpdate(
      { id, "features.cloud_backup": { $ne: enabled } },
      {
        $set: { "features.cloud_backup": enabled },
        $inc: { license_version: 1 }
      },
      { new: true }
    ).lean();

    if (updated) {
      return NextResponse.json({
        ok: true,
        changed: true,
        cloud_backup_enabled: enabled,
        license_version: updated.license_version
      });
    }

    // 2. No-op or missing license fallback
    const existing = await License.findOne({ id }).lean();
    if (!existing) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      changed: false,
      cloud_backup_enabled: existing.features?.cloud_backup === true,
      license_version: existing.license_version || 1
    });
  } catch (error: any) {
    console.error("Cloud Backup Mutation Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
