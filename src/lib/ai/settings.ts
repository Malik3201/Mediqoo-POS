import connectToDatabase from "@/lib/db";
import SystemSetting from "@/models/SystemSetting";

export interface AiSettings {
  ai_global_enabled: boolean;
  default_daily_requests: number;
  default_monthly_requests: number;
  default_daily_tokens: number;
  default_monthly_tokens: number;
  default_max_output_tokens: number;
  max_payload_kb: number;
  max_tool_steps: number;
  chat_retention_days: number;
  alert_cooldown_minutes: number;
  unusual_token_multiplier: number;
  alert_email_enabled: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  ai_global_enabled: true,
  default_daily_requests: 150,
  default_monthly_requests: 3000,
  default_daily_tokens: 150_000,
  default_monthly_tokens: 3_000_000,
  default_max_output_tokens: 800,
  max_payload_kb: 96,
  max_tool_steps: 4,
  chat_retention_days: 30,
  alert_cooldown_minutes: 30,
  unusual_token_multiplier: 5,
  alert_email_enabled: false,
};

const SETTINGS_KEY = "ai_settings";
let cache: { at: number; value: AiSettings } | null = null;
const CACHE_MS = 15_000;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Validates and normalises a (possibly partial) settings object. */
export function normalizeAiSettings(input: Partial<AiSettings> | null | undefined): AiSettings {
  const d = DEFAULT_AI_SETTINGS;
  const s = input || {};
  return {
    ai_global_enabled: typeof s.ai_global_enabled === "boolean" ? s.ai_global_enabled : d.ai_global_enabled,
    default_daily_requests: clampInt(s.default_daily_requests, 0, 1_000_000, d.default_daily_requests),
    default_monthly_requests: clampInt(s.default_monthly_requests, 0, 10_000_000, d.default_monthly_requests),
    default_daily_tokens: clampInt(s.default_daily_tokens, 0, 1_000_000_000, d.default_daily_tokens),
    default_monthly_tokens: clampInt(s.default_monthly_tokens, 0, 10_000_000_000, d.default_monthly_tokens),
    default_max_output_tokens: clampInt(s.default_max_output_tokens, 64, 4096, d.default_max_output_tokens),
    max_payload_kb: clampInt(s.max_payload_kb, 8, 512, d.max_payload_kb),
    max_tool_steps: clampInt(s.max_tool_steps, 1, 6, d.max_tool_steps),
    chat_retention_days: clampInt(s.chat_retention_days, 0, 365, d.chat_retention_days),
    alert_cooldown_minutes: clampInt(s.alert_cooldown_minutes, 1, 1440, d.alert_cooldown_minutes),
    unusual_token_multiplier: clampInt(s.unusual_token_multiplier, 2, 100, d.unusual_token_multiplier),
    alert_email_enabled: typeof s.alert_email_enabled === "boolean" ? s.alert_email_enabled : d.alert_email_enabled,
  };
}

export async function getAiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  await connectToDatabase();
  const doc: any = await SystemSetting.findOne({ key: SETTINGS_KEY }).lean();
  let parsed: Partial<AiSettings> | null = null;
  if (doc?.value) {
    try {
      parsed = JSON.parse(doc.value);
    } catch {
      parsed = null;
    }
  }
  const value = normalizeAiSettings(parsed);
  cache = { at: Date.now(), value };
  return value;
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  await connectToDatabase();
  const current = await getAiSettings();
  const next = normalizeAiSettings({ ...current, ...patch });
  await SystemSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { value: JSON.stringify(next) } },
    { upsert: true, new: true }
  );
  cache = { at: Date.now(), value: next };
  return next;
}

export function invalidateAiSettingsCache() {
  cache = null;
}

