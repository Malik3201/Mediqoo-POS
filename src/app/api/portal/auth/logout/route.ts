import { NextRequest, NextResponse } from "next/server";
import { clearPortalCookie } from "@/lib/portal-auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  return clearPortalCookie(res);
}
