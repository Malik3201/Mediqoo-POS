import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";
import { transcribeWithGroqWhisper, verifyVoiceAccess } from "@/lib/ai/voice";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // 4 MB max (~10 min opus)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`ai-stt:${clientIp(req)}`, 35, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "too_many_requests",
        message: "Too many voice requests. Please pause a moment and try again.",
        retry_after_seconds: rl.retryAfterSeconds,
      },
      { status: 429, headers: { ...CORS, "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_request", message: "Expected multipart/form-data with audio file." },
      { status: 400, headers: CORS }
    );
  }

  const licenseKey = String(form.get("license_key") || "").trim();
  const machineId = String(form.get("machine_id") || "").trim();
  const language = String(form.get("language") || "roman_ur").trim();
  const vocabHint = String(form.get("vocab_hint") || "").trim();
  const audioField = form.get("audio");

  const auth = await verifyVoiceAccess(licenseKey, machineId);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: CORS }
    );
  }

  if (!audioField || typeof audioField === "string") {
    return NextResponse.json(
      { ok: false, error: "missing_audio", message: "No audio recording was provided." },
      { status: 400, headers: CORS }
    );
  }

  const size = audioField.size || 0;
  if (size < 200) {
    return NextResponse.json(
      { ok: false, error: "audio_too_short", message: "Voice clip is too short. Please speak clearly." },
      { status: 400, headers: CORS }
    );
  }
  if (size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { ok: false, error: "audio_too_large", message: "Voice clip exceeds 4 MB limit. Please ask a shorter question." },
      { status: 413, headers: CORS }
    );
  }

  const arrayBuf = await audioField.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuf);

  const res = await transcribeWithGroqWhisper({
    audioBuffer,
    filename: (audioField as File).name || "aiva-voice.webm",
    mimeType: audioField.type || "audio/webm",
    language,
    vocabHint,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, message: res.message },
      { status: res.status, headers: CORS }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      text: res.text,
      detected_language: res.detectedLanguage,
      provider: "groq",
      model: res.model,
      latency_ms: res.latencyMs,
    },
    { status: 200, headers: CORS }
  );
}
