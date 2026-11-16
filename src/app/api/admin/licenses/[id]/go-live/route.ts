import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const nextStatus = body.status;
    if (!["enabled", "not_enabled", "revoked", "completed"].includes(nextStatus)) {
      return NextResponse.json(
        { error: "Invalid status. Must be 'enabled', 'not_enabled', 'revoked', or 'completed'." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const existing = await License.findOne({ id }).lean();
    if (!existing) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    const now = new Date();
    const operatorName = (token.name || token.email || "Super Administrator") as string;

    const currentGoLive = existing.go_live || { status: "not_enabled" };

    const updatedGoLive = {
      ...currentGoLive,
      status: nextStatus,
      notes: typeof body.notes === "string" ? body.notes : currentGoLive.notes || null,
      ...(nextStatus === "enabled"
        ? {
            enabled_at: now,
            enabled_by: operatorName,
            revoked_at: null,
            revoked_by: null,
          }
        : {}),
      ...(nextStatus === "revoked" || nextStatus === "not_enabled"
        ? {
            revoked_at: now,
            revoked_by: operatorName,
          }
        : {}),
      ...(nextStatus === "completed"
        ? {
            completed_at: now,
            completed_by: operatorName,
          }
        : {}),
    };

    const updated = await License.findOneAndUpdate(
      { id },
      {
        $set: { go_live: updatedGoLive },
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    return NextResponse.json({
      ok: true,
      go_live: updated?.go_live,
      license_version: updated?.license_version,
    });
  } catch (error: any) {
    console.error("License Go-Live Update Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
