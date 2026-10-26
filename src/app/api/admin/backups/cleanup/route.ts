import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { cleanupAllLicensesBackups } from "@/lib/cloud-backup-retention";

export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await cleanupAllLicensesBackups();
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("Manual retention cleanup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
