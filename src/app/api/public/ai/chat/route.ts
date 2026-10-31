import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "@/lib/ai/gateway";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";

export const maxDuration = 60;
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
  const rl = rateLimit(`ai-chat:${clientIp(req)}`, 90, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "too_many_concurrent", message: "Too many requests. Please slow down.", retry_after_seconds: rl.retryAfterSeconds },
      { status: 429, headers: { ...CORS, "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request", message: "Invalid request." }, { status: 400, headers: CORS });
  }
  try {
    const res = await handleChat(body);
    return NextResponse.json(res.body, { status: res.status, headers: CORS });
  } catch (e) {
    console.error("[ai/chat] unexpected error:", (e as Error)?.message);
    return NextResponse.json(
      { ok: false, error: "provider_unavailable", message: "AI is temporarily unavailable. Please try again shortly. Your POS keeps working normally." },
      { status: 503, headers: CORS }
    );
  }
}

