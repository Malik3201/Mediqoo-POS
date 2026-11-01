/**
 * Pure routing decisions for the Mediqoo AI Gateway (no database, no network).
 * Everything here is deterministic given its inputs + an injected RNG, so it is unit-testable.
 *
 * CRITICAL PROVIDER RULE
 * ----------------------
 * Groq rate limits are enforced per ORGANIZATION. All credentials that belong to the same
 * organization therefore share ONE pool (rate-limit state, cooldown, circuit breaker, quota counters).
 *  - A 429 on any key puts the WHOLE organization pool on cooldown. We never "rotate" to
 *    another key of the same organization to dodge a limit.
 *  - Weighted fair distribution only happens between genuinely independent pools
 *    (different organizations that an administrator explicitly authorised).
 *  - A pool's routing weight is the MAX of its keys' weights (not the sum) so that adding
 *    keys to an organization never inflates its share or capacity.
 */

export type CredStatus =
  | "Healthy"
  | "Rate Limited"
  | "Temporarily Unavailable"
  | "Invalid Credentials"
  | "Disabled"
  | "Needs Attention";

export interface CredSnapshot {
  id: string;
  name: string;
  organization_id: string;
  enabled: boolean;
  weight: number;
  admin_restriction: "none" | "fallback_only" | "test_only";
  status: CredStatus;
  cooldown_until: Date | null;
  allowed_models: string[];
}

export interface PoolSnapshot {
  organization_id: string;
  rate_limited_until: Date | null;
  circuit_open_until: Date | null;
  in_flight_requests: number;
  minute_window_key: string;
  minute_requests_used: number;
  minute_tokens_used: number;
  minute_request_limit: number;
  minute_token_limit: number;
  day_key: string;
  daily_requests_used: number;
  daily_tokens_used: number;
  daily_request_limit: number;
  daily_token_limit: number;
  provider_remaining_requests: number | null;
  provider_remaining_tokens: number | null;
  provider_reset_requests_at: Date | null;
  provider_reset_tokens_at: Date | null;
}

export interface PoolGroup {
  organization_id: string;
  weight: number;
  in_flight: number;
  creds: CredSnapshot[];
}

export function minuteKey(d: Date): string {
  return d.toISOString().slice(0, 16);
}
export function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function credIsRoutable(
  c: CredSnapshot,
  model: string,
  now: Date,
  opts: { allowFallbackOnly: boolean }
): boolean {
  if (!c.enabled) return false;
  if (c.status === "Disabled" || c.status === "Invalid Credentials" || c.status === "Needs Attention") return false;
  if (c.admin_restriction === "test_only") return false;
  if (c.admin_restriction === "fallback_only" && !opts.allowFallbackOnly) return false;
  if (c.cooldown_until && c.cooldown_until.getTime() > now.getTime()) return false;
  if (c.allowed_models.length > 0 && !c.allowed_models.includes(model)) return false;
  return true;
}

export function poolIsAvailable(p: PoolSnapshot | undefined, estTokens: number, now: Date): { ok: boolean; reason?: string } {
  if (!p) return { ok: true };
  if (p.rate_limited_until && p.rate_limited_until.getTime() > now.getTime()) return { ok: false, reason: "rate_limited" };
  if (p.circuit_open_until && p.circuit_open_until.getTime() > now.getTime()) return { ok: false, reason: "circuit_open" };

  const sameMinute = p.minute_window_key === minuteKey(now);
  const minReq = sameMinute ? p.minute_requests_used : 0;
  const minTok = sameMinute ? p.minute_tokens_used : 0;
  if (p.minute_request_limit > 0 && minReq + 1 > p.minute_request_limit) return { ok: false, reason: "minute_requests" };
  if (p.minute_token_limit > 0 && minTok + estTokens > p.minute_token_limit) return { ok: false, reason: "minute_tokens" };

  const sameDay = p.day_key === dayKeyUtc(now);
  const dayReq = sameDay ? p.daily_requests_used : 0;
  const dayTok = sameDay ? p.daily_tokens_used : 0;
  if (p.daily_request_limit > 0 && dayReq + 1 > p.daily_request_limit) return { ok: false, reason: "daily_requests" };
  if (p.daily_token_limit > 0 && dayTok + estTokens > p.daily_token_limit) return { ok: false, reason: "daily_tokens" };

  // Note: Groq x-ratelimit-remaining-* headers are per-model (not shared across fallback models
  // in the model chain), so we do not pre-emptively block the entire org pool before calling the provider.
  return { ok: true };
}

/**
 * Groups routable credentials by organization and drops unavailable pools / excluded entries.
 * `excludedPools` carries orgs that already returned 429 / circuit-open during this request.
 */
export function buildEligibleGroups(args: {
  creds: CredSnapshot[];
  pools: PoolSnapshot[];
  model: string;
  estTokens: number;
  now: Date;
  excludedCredIds: Set<string>;
  excludedPoolIds: Set<string>;
  allowFallbackOnly: boolean;
}): { groups: PoolGroup[]; blockedReasons: Record<string, string> } {
  const poolMap = new Map(args.pools.map((p) => [p.organization_id, p]));
  const byOrg = new Map<string, CredSnapshot[]>();
  for (const c of args.creds) {
    if (args.excludedCredIds.has(c.id)) continue;
    if (!credIsRoutable(c, args.model, args.now, { allowFallbackOnly: args.allowFallbackOnly })) continue;
    const arr = byOrg.get(c.organization_id) || [];
    arr.push(c);
    byOrg.set(c.organization_id, arr);
  }

  const groups: PoolGroup[] = [];
  const blockedReasons: Record<string, string> = {};
  for (const [orgId, creds] of byOrg) {
    if (args.excludedPoolIds.has(orgId)) {
      blockedReasons[orgId] = "excluded_this_request";
      continue;
    }
    const pool = poolMap.get(orgId);
    const avail = poolIsAvailable(pool, args.estTokens, args.now);
    if (!avail.ok) {
      blockedReasons[orgId] = avail.reason || "unavailable";
      continue;
    }
    groups.push({
      organization_id: orgId,
      // MAX (not SUM): more keys in one organization must not increase its share.
      weight: Math.max(...creds.map((c) => Math.max(1, c.weight))),
      in_flight: pool?.in_flight_requests || 0,
      creds,
    });
  }
  return { groups, blockedReasons };
}

/** Weighted-fair selection across independent pools, then weighted pick within the pool. */
export function pickCredential(groups: PoolGroup[], rand: () => number = Math.random): { group: PoolGroup; cred: CredSnapshot } | null {
  if (groups.length === 0) return null;
  const scored = groups.map((g) => ({ g, score: g.weight / (1 + g.in_flight) }));
  const total = scored.reduce((s, x) => s + x.score, 0);
  let r = rand() * total;
  let chosen = scored[scored.length - 1].g;
  for (const s of scored) {
    r -= s.score;
    if (r <= 0) {
      chosen = s.g;
      break;
    }
  }
  const wTotal = chosen.creds.reduce((s, c) => s + Math.max(1, c.weight), 0);
  let rr = rand() * wTotal;
  let cred = chosen.creds[chosen.creds.length - 1];
  for (const c of chosen.creds) {
    rr -= Math.max(1, c.weight);
    if (rr <= 0) {
      cred = c;
      break;
    }
  }
  return { group: chosen, cred };
}

/** Bounded exponential backoff with full jitter. attempt starts at 1. */
export function backoffMs(attempt: number, rand: () => number = Math.random, baseMs = 250, capMs = 2000): number {
  const exp = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(exp / 2 + rand() * (exp / 2));
}

/** How long to hold a pool after a 429. Honors retry-after, then provider reset headers; bounded. */
export function cooldownAfter429(h: { retryAfterMs?: number; resetRequestsMs?: number; resetTokensMs?: number }): number {
  const candidate = h.retryAfterMs ?? Math.max(h.resetRequestsMs ?? 0, h.resetTokensMs ?? 0);
  const ms = candidate && candidate > 0 ? candidate : 30_000;
  return Math.min(3_600_000, Math.max(1_000, ms));
}

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_OPEN_MS = 60_000;
export const MAX_PROVIDER_ATTEMPTS = 4;

