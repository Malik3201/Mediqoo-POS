import connectToDatabase from "@/lib/db";
import AiPharmacyEntitlement from "@/models/AiPharmacyEntitlement";
import { getAiSettings } from "./settings";

/** Calendar day / month keys in the pharmacy's configured timezone (explicit reset policy). */
export function periodKeys(timezone: string, now: Date = new Date()): { day: string; month: string } {
  let tz = timezone || "Asia/Karachi";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "Asia/Karachi";
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return { day: `${y}-${m}-${d}`, month: `${y}-${m}` };
}

export interface EntitlementLimits {
  dailyRequests: number;
  monthlyRequests: number;
  dailyTokens: number;
  monthlyTokens: number;
}

/** Effective limits = base + temporary promo (only while the promo has not expired). */
export function effectiveLimits(e: any, now: Date = new Date()): EntitlementLimits {
  const promoActive = (e.promo_extra_requests > 0 || e.promo_extra_tokens > 0) && (!e.promo_expires_at || new Date(e.promo_expires_at).getTime() > now.getTime());
  const pr = promoActive ? e.promo_extra_requests || 0 : 0;
  const pt = promoActive ? e.promo_extra_tokens || 0 : 0;
  return {
    dailyRequests: (e.daily_request_limit || 0) + pr,
    monthlyRequests: (e.monthly_request_limit || 0) + pr,
    dailyTokens: (e.daily_token_limit || 0) + pt,
    monthlyTokens: (e.monthly_token_limit || 0) + pt,
  };
}

/** Finds or lazily creates the entitlement for a license, using portal defaults. */
export async function getOrCreateEntitlement(licenseId: string, clientId: string) {
  await connectToDatabase();
  let doc: any = await AiPharmacyEntitlement.findOne({ license_id: licenseId });
  if (doc) return doc;
  const s = await getAiSettings();
  try {
    doc = await AiPharmacyEntitlement.create({
      license_id: licenseId,
      client_id: clientId,
      daily_request_limit: s.default_daily_requests,
      monthly_request_limit: s.default_monthly_requests,
      daily_token_limit: s.default_daily_tokens,
      monthly_token_limit: s.default_monthly_tokens,
      max_output_tokens: s.default_max_output_tokens,
    });
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    doc = await AiPharmacyEntitlement.findOne({ license_id: licenseId });
  }
  return doc;
}

/** Resets daily / monthly counters at period rollover and recovers leaked in-flight reservations. */
export async function rolloverEntitlement(licenseId: string, timezone: string, now: Date = new Date()) {
  const { day, month } = periodKeys(timezone, now);
  await AiPharmacyEntitlement.updateOne(
    { license_id: licenseId, day_key: { $ne: day } },
    { $set: { day_key: day, daily_requests_used: 0, daily_tokens_used: 0, last_reset_at: now } }
  );
  await AiPharmacyEntitlement.updateOne(
    { license_id: licenseId, month_key: { $ne: month } },
    { $set: { month_key: month, monthly_requests_used: 0, monthly_tokens_used: 0 } }
  );
  // A function that died mid-request must not lock a pharmacy out forever.
  await AiPharmacyEntitlement.updateOne(
    { license_id: licenseId, in_flight_requests: { $gt: 0 }, last_request_at: { $lt: new Date(now.getTime() - 120_000) } },
    { $set: { in_flight_requests: 0, reserved_tokens: 0 } }
  );
}

export type ReserveFailure =
  | "ai_disabled"
  | "daily_limit_reached"
  | "monthly_limit_reached"
  | "token_limit_reached"
  | "too_many_concurrent";

export interface Reservation {
  ok: true;
  licenseId: string;
  estTokens: number;
  countedRequest: boolean;
}

/**
 * ATOMIC reservation.
 *
 * One conditional findOneAndUpdate both checks every limit and applies the reservation, so
 * concurrent requests cannot jointly exceed a limit (no read-then-write race).
 *  - request budget: consumed at the first step of a turn (`countRequest`)
 *  - token budget:   `estTokens` is reserved now and settled from provider usage later
 *  - concurrency:    in_flight_requests is bounded by concurrent_request_limit
 */
export async function reserveQuota(
  licenseId: string,
  estTokens: number,
  countRequest: boolean,
  now: Date = new Date()
): Promise<Reservation | { ok: false; error: ReserveFailure }> {
  const e: any = await AiPharmacyEntitlement.findOne({ license_id: licenseId }).lean();
  if (!e) return { ok: false, error: "ai_disabled" };
  await rolloverEntitlement(licenseId, e.timezone, now);

  const fresh: any = await AiPharmacyEntitlement.findOne({ license_id: licenseId }).lean();
  const lim = effectiveLimits(fresh, now);
  const reqInc = countRequest ? 1 : 0;

  const conds: any[] = [
    { $lt: ["$in_flight_requests", "$concurrent_request_limit"] },
    { $lte: [{ $add: ["$daily_requests_used", reqInc] }, lim.dailyRequests] },
    { $lte: [{ $add: ["$monthly_requests_used", reqInc] }, lim.monthlyRequests] },
    { $lte: [{ $add: ["$daily_tokens_used", "$reserved_tokens", estTokens] }, lim.dailyTokens] },
    { $lte: [{ $add: ["$monthly_tokens_used", "$reserved_tokens", estTokens] }, lim.monthlyTokens] },
  ];

  const updated = await AiPharmacyEntitlement.findOneAndUpdate(
    { license_id: licenseId, ai_enabled: true, $expr: { $and: conds } },
    {
      $inc: {
        in_flight_requests: 1,
        reserved_tokens: estTokens,
        daily_requests_used: reqInc,
        monthly_requests_used: reqInc,
      },
      $set: { last_request_at: now },
    },
    { new: true }
  );
  if (updated) return { ok: true, licenseId, estTokens, countedRequest: !!countRequest };

  // Diagnose which limit blocked (best effort, for a precise friendly message).
  const d: any = await AiPharmacyEntitlement.findOne({ license_id: licenseId }).lean();
  if (!d || !d.ai_enabled) return { ok: false, error: "ai_disabled" };
  if (d.in_flight_requests >= d.concurrent_request_limit) return { ok: false, error: "too_many_concurrent" };
  if (d.daily_requests_used + reqInc > lim.dailyRequests) return { ok: false, error: "daily_limit_reached" };
  if (d.monthly_requests_used + reqInc > lim.monthlyRequests) return { ok: false, error: "monthly_limit_reached" };
  return { ok: false, error: "token_limit_reached" };
}

/** Settles a reservation using actual provider usage (success path). */
export async function settleQuota(r: Reservation, actualTokens: number) {
  await AiPharmacyEntitlement.updateOne(
    { license_id: r.licenseId },
    [
      {
        $set: {
          in_flight_requests: { $max: [0, { $subtract: ["$in_flight_requests", 1] }] },
          reserved_tokens: { $max: [0, { $subtract: ["$reserved_tokens", r.estTokens] }] },
          daily_tokens_used: { $add: ["$daily_tokens_used", actualTokens] },
          monthly_tokens_used: { $add: ["$monthly_tokens_used", actualTokens] },
        },
      },
    ]
  );
}

/**
 * Releases a reservation when the provider call did not complete.
 * The request is refunded because no provider capacity was consumed for this pharmacy.
 */
export async function releaseQuota(r: Reservation, refundRequest: boolean) {
  const refund = refundRequest && r.countedRequest ? 1 : 0;
  await AiPharmacyEntitlement.updateOne(
    { license_id: r.licenseId },
    [
      {
        $set: {
          in_flight_requests: { $max: [0, { $subtract: ["$in_flight_requests", 1] }] },
          reserved_tokens: { $max: [0, { $subtract: ["$reserved_tokens", r.estTokens] }] },
          daily_requests_used: { $max: [0, { $subtract: ["$daily_requests_used", refund] }] },
          monthly_requests_used: { $max: [0, { $subtract: ["$monthly_requests_used", refund] }] },
        },
      },
    ]
  );
}

