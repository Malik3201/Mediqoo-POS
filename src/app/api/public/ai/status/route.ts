import { NextRequest, NextResponse } from "next/server";
import { handleStatus } from "@/lib/ai/gateway";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`ai-status:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "too_many_concurrent", message: "Too many requests." }, { status: 429, headers: CORS });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request", message: "Invalid request." }, { status: 400, headers: CORS });
  }
  try {
    const res = await handleStatus(body);
    return NextResponse.json(res.body, { status: res.status, headers: CORS });
  } catch (e) {
    console.error("[ai/status] unexpected error:", (e as Error)?.message);
    return NextResponse.json({ ok: true, state: "unavailable", enabled: true, message: "AI is temporarily unavailable." }, { status: 200, headers: CORS });
  }
}

