import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(_req: NextRequest) {
  const filePath = path.join(process.cwd(), "public", "downloads", "aivrasolpos_owner_portal.apk");
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "APK file not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="aivrasolpos_owner_portal.apk"',
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
