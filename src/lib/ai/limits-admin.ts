import { ENTITLEMENT_EDITABLE } from "./admin-http";
import type { AiSettings } from "./settings";

const MODEL_POLICIES = ["auto", "fast_only", "full_featured"];
const ROLES = ["admin", "manager", "senior-cashier", "cashier"];

function int(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Validates + normalises an entitlement edit payload (whitelisted fields only). */
export function cleanEntitlementPatch(body: any): { patch: Record<string, any>; error?: string } {
  const patch: Record<string, any> = {};
  if (typeof body.ai_enabled === "boolean") patch.ai_enabled = body.ai_enabled;
  if (typeof body.advanced_copilot_enabled === "boolean") patch.advanced_copilot_enabled = body.advanced_copilot_enabled;
  if (typeof body.purchase_preparation_enabled === "boolean") patch.purchase_preparation_enabled = body.purchase_preparation_enabled;
  if (Array.isArray(body.allowed_models)) patch.allowed_models = body.allowed_models.filter((m: any) => typeof m === "string").slice(0, 20);
  if (body.model_policy !== undefined) {
    if (!MODEL_POLICIES.includes(body.model_policy)) return { patch, error: "Invalid model policy." };
    patch.model_policy = body.model_policy;
  }
  if (Array.isArray(body.allowed_roles)) {
    const roles = body.allowed_roles.filter((r: any) => ROLES.includes(r));
    if (roles.length === 0) return { patch, error: "At least one role must be allowed." };
    patch.allowed_roles = roles;
  }
  const numeric: [string, number, number][] = [
    ["daily_request_limit", 0, 1_000_000],
    ["monthly_request_limit", 0, 10_000_000],
    ["daily_token_limit", 0, 1_000_000_000],
    ["monthly_token_limit", 0, 10_000_000_000],
    ["max_output_tokens", 64, 4096],
    ["concurrent_request_limit", 1, 20],
    ["promo_extra_requests", 0, 1_000_000],
    ["promo_extra_tokens", 0, 1_000_000_000],
  ];
  for (const [k, min, max] of numeric) {
    if (body[k] !== undefined) {
      const v = int(body[k], min, max);
      if (v === undefined) return { patch, error: `${k} must be a number.` };
      patch[k] = v;
    }
  }
  if (body.promo_expires_at !== undefined) {
    if (body.promo_expires_at === null || body.promo_expires_at === "") patch.promo_expires_at = null;
    else {
      const d = new Date(body.promo_expires_at);
      if (isNaN(d.getTime())) return { patch, error: "Invalid promo expiry date." };
      patch.promo_expires_at = d;
    }
  }
  if (typeof body.timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: body.timezone });
      patch.timezone = body.timezone;
    } catch {
      return { patch, error: "Invalid timezone." };
    }
  }
  // Never allow counters/reservations to be set through this path.
  for (const k of Object.keys(patch)) {
    if (!(ENTITLEMENT_EDITABLE as readonly string[]).includes(k)) delete patch[k];
  }
  return { patch };
}

export function defaultEntitlementView(settings: AiSettings) {
  return {
    ai_enabled: true,
    allowed_models: [] as string[],
    model_policy: "auto",
    daily_request_limit: settings.default_daily_requests,
    monthly_request_limit: settings.default_monthly_requests,
    daily_token_limit: settings.default_daily_tokens,
    monthly_token_limit: settings.default_monthly_tokens,
    max_output_tokens: settings.default_max_output_tokens,
    concurrent_request_limit: 2,
    advanced_copilot_enabled: true,
    purchase_preparation_enabled: true,
    allowed_roles: ["admin", "manager", "senior-cashier", "cashier"],
    promo_extra_requests: 0,
    promo_extra_tokens: 0,
    promo_expires_at: null,
    timezone: "Asia/Karachi",
    daily_requests_used: 0,
    monthly_requests_used: 0,
    daily_tokens_used: 0,
    monthly_tokens_used: 0,
    day_key: new Date().toISOString().slice(0, 10),
    month_key: new Date().toISOString().slice(0, 7),
  };
}

