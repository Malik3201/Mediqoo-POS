import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";
import { synthesizeAivaSpeech, verifyVoiceAccess } from "@/lib/ai/voice";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "X-TTS-Provider, X-TTS-Cache",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`ai-tts:${clientIp(req)}`, 50, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "too_many_requests",
        message: "Too many speech requests. Please slow down.",
        retry_after_seconds: rl.retryAfterSeconds,
      },
      { status: 429, headers: { ...CORS, "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_request", message: "Invalid JSON body." },
      { status: 400, headers: CORS }
    );
  }

  const auth = await verifyVoiceAccess(body?.license_key, body?.machine_id);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: CORS }
    );
  }

  const result = await synthesizeAivaSpeech({
    text: String(body?.text || ""),
    voice: typeof body?.voice === "string" ? body.voice : "ur-PK-UzmaNeural",
    rate: typeof body?.rate === "string" ? body.rate : "+4%",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: CORS }
    );
  }

  return new NextResponse(new Uint8Array(result.audio), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(result.audio.length),
      "Cache-Control": "private, max-age=600",
      "X-TTS-Provider": result.provider,
      "X-TTS-Cache": result.cacheHit ? "HIT" : "MISS",
    },
  });
}
