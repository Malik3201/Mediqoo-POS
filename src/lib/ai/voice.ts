import crypto from "node:crypto";
import { EdgeTTS } from "@andresaya/edge-tts";
import connectToDatabase from "@/lib/db";
import AiCredential from "@/models/AiCredential";
import { decryptApiKey, scrubSecretsFromText } from "./crypto";
import { getAiSettings } from "./settings";
import { verifyDeviceIdentity } from "./license";
import { getOrCreateEntitlement } from "./quota";

export type SupportedAivaVoice = "ur-PK-UzmaNeural" | "ur-PK-AsadNeural";

export const SUPPORTED_AIVA_VOICES: ReadonlySet<SupportedAivaVoice> = new Set([
  "ur-PK-UzmaNeural",
  "ur-PK-AsadNeural",
]);

export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";
const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const BASE_PHARMACY_VOCAB_PROMPT =
  "AivraSol POS pharmacy assistant. Urdu and English medicine queries: " +
  "aaj ki sale, cash, khata, expiry, stock, batch, supplier, payable, purchase, return, shift, closing, expense, discount, profit, " +
  "Panadol, Augmentin, Brufen, Risek, Flagyl, Disprin, Arinac, Calpol, Amoxil, Ponstan, Surbex, Rigix, Azomax, Nexum, Glucophage, Concor.";

export async function verifyVoiceAccess(
  licenseKey: unknown,
  machineId: unknown
): Promise<
  | { ok: true; licenseId: string; clientId: string }
  | { ok: false; status: number; error: string; message: string }
> {
  const settings = await getAiSettings();
  if (!settings.ai_global_enabled) {
    return {
      ok: false,
      status: 403,
      error: "ai_disabled",
      message: "Aiva AI assistant is currently disabled by administrator.",
    };
  }

  const verified = await verifyDeviceIdentity(licenseKey, machineId);
  if (!verified.ok) {
    return {
      ok: false,
      status: verified.status,
      error: verified.error,
      message:
        verified.error === "license_blocked"
          ? "Your license is not active, so Aiva Voice is unavailable."
          : "This terminal is not authorized for Aiva Voice.",
    };
  }

  const { license } = verified.identity;
  const ent: any = await getOrCreateEntitlement(license.id, license.client_id);
  if (!ent?.ai_enabled) {
    return {
      ok: false,
      status: 403,
      error: "ai_disabled",
      message: "Aiva AI assistant is not enabled for this pharmacy license.",
    };
  }

  return { ok: true, licenseId: String(license.id), clientId: String(license.client_id) };
}

interface GroqKeyCandidate {
  id: string;
  name: string;
  apiKey: string;
}

/**
 * Resolves all active Groq API keys from Super Admin's encrypted `AiCredential` pool
 * (strictly Groq-only for STT, with optional `GROQ_API_KEY` env fallback).
 */
async function getActiveGroqKeys(): Promise<GroqKeyCandidate[]> {
  const out: GroqKeyCandidate[] = [];
  const seen = new Set<string>();

  try {
    await connectToDatabase();
    // Match router.ts convention: older Groq credentials saved before multi-provider support
    // have no `provider` field (undefined/null), so query `{ provider: { $ne: "custom" } }`
    // and also allow custom keys pointing to api.groq.com.
    const creds: any[] = await AiCredential.find({
      enabled: true,
      $or: [
        { provider: { $exists: false } },
        { provider: null },
        { provider: "groq" },
        { base_url: /groq\.com/i },
      ],
      status: { $in: ["Healthy", "Rate Limited", "Temporarily Unavailable"] },
    })
      .sort({ weight: -1, last_success_at: -1 })
      .lean();

    // Prioritize Healthy keys before cooling/transient keys
    creds.sort((a, b) => {
      const aHealthy = a.status === "Healthy" ? 1 : 0;
      const bHealthy = b.status === "Healthy" ? 1 : 0;
      if (aHealthy !== bHealthy) return bHealthy - aHealthy;
      return (b.weight || 0) - (a.weight || 0);
    });

    for (const c of creds) {
      try {
        const key = decryptApiKey(c.encrypted_key);
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push({ id: String(c.id), name: String(c.name || "Groq Key"), apiKey: key });
        }
      } catch {
        // Skip undecryptable key cleanly
      }
    }
  } catch {
    // Non-fatal if DB unreachable; fall through to env fallback
  }

  const envKey = (process.env.GROQ_API_KEY || "").trim();
  if (envKey && !seen.has(envKey)) {
    out.push({ id: "env_groq", name: "ENV GROQ_API_KEY", apiKey: envKey });
  }

  return out;
}

export async function transcribeWithGroqWhisper(params: {
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
  vocabHint?: string;
}): Promise<
  | { ok: true; text: string; detectedLanguage?: string; latencyMs: number; model: string }
  | { ok: false; status: number; error: string; message: string }
> {
  const keys = await getActiveGroqKeys();
  if (keys.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "no_groq_key",
      message: "No active Groq API key is configured in Super Admin -> AI Management.",
    };
  }

  const vocabClean = String(params.vocabHint || "")
    .replace(/[^\w\s,.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
  const prompt = vocabClean
    ? `${BASE_PHARMACY_VOCAB_PROMPT} Store medicines: ${vocabClean}`
    : BASE_PHARMACY_VOCAB_PROMPT;

  let lastStatus = 503;
  let lastMsg = "Voice recognition is temporarily unavailable. Please try again.";

  for (const cand of keys.slice(0, 4)) {
    const started = Date.now();
    try {
      const form = new FormData();
      const uint8 = new Uint8Array(params.audioBuffer);
      const fileBlob = new Blob([uint8], { type: params.mimeType || "audio/webm" });
      form.append("file", fileBlob, params.filename || "voice.webm");
      form.append("model", GROQ_WHISPER_MODEL);
      form.append("temperature", "0");
      form.append("response_format", "verbose_json");
      form.append("prompt", prompt);
      // Only pin language="en" when operator explicitly chose English.
      // For Roman Urdu / Urdu, auto-detection with bilingual prompt keeps English drug names crisp!
      if (params.language === "en") {
        form.append("language", "en");
      }

      const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cand.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(22_000),
      });

      const latencyMs = Date.now() - started;
      const bodyText = await res.text().catch(() => "");

      if (res.ok) {
        let parsed: any = {};
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          parsed = { text: bodyText };
        }
        const text = String(parsed?.text || "").trim();
        return {
          ok: true,
          text,
          detectedLanguage: typeof parsed?.language === "string" ? parsed.language : undefined,
          latencyMs,
          model: GROQ_WHISPER_MODEL,
        };
      }

      lastStatus = res.status;
      if (res.status === 429) {
        lastMsg = "Groq voice rate limit reached temporarily. Retrying next available key or try again shortly.";
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        lastMsg = "Groq API key authentication failed. Please check Super Admin -> AI Management.";
        continue;
      }
      if (res.status >= 500) {
        lastMsg = "Groq speech service is temporarily busy. Please try again.";
        continue;
      }

      lastMsg = scrubSecretsFromText(bodyText.slice(0, 200)) || "Could not process audio clip.";
      break;
    } catch (err: any) {
      lastStatus = 504;
      lastMsg = err?.name === "TimeoutError" ? "Voice transcription timed out." : "Network error reaching Groq STT.";
    }
  }

  return {
    ok: false,
    status: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 503,
    error: lastStatus === 429 ? "rate_limited" : "stt_failed",
    message: lastMsg,
  };
}

/* ============================================================================
   Neural Urdu TTS (Microsoft Edge TTS now + Azure Speech F0 plug-in ready!)
   ============================================================================ */

interface TtsCacheEntry {
  audio: Buffer;
  provider: "edge" | "azure";
  expiresAt: number;
}

const TTS_CACHE_MAX = 150;
const TTS_CACHE_TTL_MS = 30 * 60 * 1000;
const ttsCache = new Map<string, TtsCacheEntry>();

function getCachedTts(key: string): TtsCacheEntry | null {
  const hit = ttsCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    ttsCache.delete(key);
    return null;
  }
  return hit;
}

function putCachedTts(key: string, entry: Omit<TtsCacheEntry, "expiresAt">): void {
  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    if (oldest) ttsCache.delete(oldest);
  }
  ttsCache.set(key, { ...entry, expiresAt: Date.now() + TTS_CACHE_TTL_MS });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSpeechText(raw: string): string {
  return String(raw || "")
    .replace(/[*_`#>~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

/**
 * Future plug-in: if AZURE_SPEECH_KEY + AZURE_SPEECH_REGION are added to Vercel env later,
 * automatically switches to official Microsoft Azure Neural TTS (500k chars/mo free tier F0)
 * with ZERO code changes!
 */
async function synthesizeWithAzureIfConfigured(
  text: string,
  voice: SupportedAivaVoice,
  rate: string
): Promise<Buffer | null> {
  const key = (process.env.AZURE_SPEECH_KEY || "").trim();
  const region = (process.env.AZURE_SPEECH_REGION || "").trim();
  if (!key || !region) return null;

  const ssml = `<speak version='1.0' xml:lang='ur-PK'><voice name='${voice}'><prosody rate='${escapeXml(rate)}'>${escapeXml(text)}</prosody></voice></speak>`;
  const res = await fetch(
    `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "AivraSolPOS-Aiva/1.0",
      },
      body: ssml,
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) return null;
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return buf.length > 256 ? buf : null;
}

async function synthesizeWithEdgeTts(
  text: string,
  voice: SupportedAivaVoice,
  rate: string
): Promise<Buffer> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tts = new EdgeTTS();
      await tts.synthesize(text, voice, {
        rate,
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      });
      const buf = tts.toBuffer();
      if (buf && buf.length > 256) {
        return buf;
      }
      throw new Error("Empty audio returned by Edge TTS");
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Edge TTS synthesis failed");
}

export async function synthesizeAivaSpeech(params: {
  text: string;
  voice?: string;
  rate?: string;
}): Promise<
  | { ok: true; audio: Buffer; provider: "edge" | "azure"; cacheHit: boolean }
  | { ok: false; status: number; error: string; message: string }
> {
  const cleanText = sanitizeSpeechText(params.text);
  if (!cleanText) {
    return { ok: false, status: 400, error: "empty_text", message: "Speech text is empty." };
  }

  const voice: SupportedAivaVoice = SUPPORTED_AIVA_VOICES.has(params.voice as SupportedAivaVoice)
    ? (params.voice as SupportedAivaVoice)
    : "ur-PK-UzmaNeural";

  const rate =
    typeof params.rate === "string" && /^[+-]?\d{1,2}%$/.test(params.rate.trim())
      ? params.rate.trim()
      : "+4%";

  const cacheKey = crypto
    .createHash("sha256")
    .update(`${voice}|${rate}|${cleanText}`)
    .digest("hex");

  const cached = getCachedTts(cacheKey);
  if (cached) {
    return { ok: true, audio: cached.audio, provider: cached.provider, cacheHit: true };
  }

  // 1. Optional Azure F0 Speech if configured later (seamless zero-code upgrade path)
  try {
    const azureBuf = await synthesizeWithAzureIfConfigured(cleanText, voice, rate);
    if (azureBuf) {
      putCachedTts(cacheKey, { audio: azureBuf, provider: "azure" });
      return { ok: true, audio: azureBuf, provider: "azure", cacheHit: false };
    }
  } catch {
    // Gracefully fall back to Edge TTS
  }

  // 2. Primary Right Now: Free Microsoft Edge Neural TTS (ur-PK-UzmaNeural / ur-PK-AsadNeural)
  try {
    const edgeBuf = await synthesizeWithEdgeTts(cleanText, voice, rate);
    putCachedTts(cacheKey, { audio: edgeBuf, provider: "edge" });
    return { ok: true, audio: edgeBuf, provider: "edge", cacheHit: false };
  } catch (err: any) {
    return {
      ok: false,
      status: 503,
      error: "tts_unavailable",
      message: String(err?.message || "Urdu voice synthesis is temporarily unavailable."),
    };
  }
}
