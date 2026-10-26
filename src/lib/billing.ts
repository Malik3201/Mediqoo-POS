import { addMonths, addYears, startOfDay, endOfDay } from "date-fns";

export type BillingCycle = "monthly" | "yearly";
export type BillingModel = "fixed" | "per_invoice";

/** 
 * Canonical threshold for metering support.
 * Only POS versions >= this value support durable outbox and background sync.
 */
export const MIN_PER_INVOICE_POS_VERSION = "1.4.4";

export interface LicenseBillingState {
  expires_at?: Date | string | null;
  billing: {
    cycle: BillingCycle | string;
    grace_days: number;
  };
}

export interface RenewalOptions {
  extensionMonths?: number;
  customExpiryDate?: string | Date | null;
  isLifetime?: boolean;
}

export interface RenewalCalculationResult {
  renewalType: "fixed" | "custom" | "lifetime";
  baseDate: Date;
  newExpiry: Date | null;
  newGraceUntil: Date | null;
}

/**
 * Canonically calculates the grace_until date based on expiry and configured grace days.
 * If expiresAt is missing/null, returns null.
 * If graceDays <= 0, returns the expiry date.
 */
export function calculateGraceUntil(expiresAt: Date | string | null | undefined, graceDays: number | null | undefined): Date | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const days = typeof graceDays === "number" ? Math.max(0, graceDays) : 0;
  if (days === 0) return expiry;

  const graceUntil = new Date(expiry);
  graceUntil.setDate(graceUntil.getDate() + days);
  return graceUntil;
}

/**
 * Canonically calculates the next expiry and grace_until dates for a license renewal / extension.
 *
 * RENEWAL BASE DATE RULE:
 * 1. If current expiry is in the future (> today): extend FROM current expiry (preserving remaining days).
 * 2. If current expiry is already expired or missing (<= today): extension starts FROM TODAY.
 * 3. If customExpiryDate is specified: sets exact expiry to custom date.
 * 4. If isLifetime is specified: sets newExpiry to null and newGraceUntil to null.
 */
export function calculateRenewalDates(
  license: LicenseBillingState, 
  options?: RenewalOptions | Date
): RenewalCalculationResult {
  const graceDays = license.billing?.grace_days ?? 3;
  const now = startOfDay(new Date());

  // 1. Lifetime / No Expiry
  if (options && typeof options === "object" && !(options instanceof Date) && options.isLifetime) {
    return {
      renewalType: "lifetime",
      baseDate: now,
      newExpiry: null,
      newGraceUntil: null,
    };
  }

  // 2. Custom Exact Expiry Date
  if (options && typeof options === "object" && !(options instanceof Date) && options.customExpiryDate) {
    const customDate = endOfDay(new Date(options.customExpiryDate));
    if (isNaN(customDate.getTime())) {
      throw new Error("Invalid custom expiry date");
    }
    const newGraceUntil = calculateGraceUntil(customDate, graceDays);
    return {
      renewalType: "custom",
      baseDate: now,
      newExpiry: customDate,
      newGraceUntil,
    };
  }

  // 3. Extension duration (in months)
  let months = 1;
  if (options && typeof options === "object" && !(options instanceof Date) && typeof options.extensionMonths === "number") {
    months = Math.max(1, options.extensionMonths);
  } else if (license.billing?.cycle === "yearly") {
    months = 12;
  }

  // Determine base date:
  // If current expiry is in the future (> now): extend from current expiry.
  // If expired or missing: default extension starts from today.
  let baseDate = now;
  if (license.expires_at) {
    const currentExpiry = new Date(license.expires_at);
    if (currentExpiry.getTime() > now.getTime()) {
      baseDate = currentExpiry;
    }
  }

  // If a Date was passed directly (legacy support) AND it is in the future compared to baseDate
  if (options instanceof Date) {
    const passedDate = endOfDay(options);
    if (passedDate.getTime() > baseDate.getTime()) {
      const newGraceUntil = calculateGraceUntil(passedDate, graceDays);
      return {
        renewalType: "fixed",
        baseDate,
        newExpiry: passedDate,
        newGraceUntil,
      };
    }
  }

  const newExpiry = endOfDay(addMonths(baseDate, months));
  const newGraceUntil = calculateGraceUntil(newExpiry, graceDays);

  return {
    renewalType: "fixed",
    baseDate,
    newExpiry,
    newGraceUntil,
  };
}

/**
 * Calculates the period_start and period_end for a given base expiry date.
 */
export function calculatePeriodDates(baseDate: Date, cycle: BillingCycle | string) {
  const period_end = cycle === "yearly" ? addYears(baseDate, 1) : addMonths(baseDate, 1);
  return {
    period_start: baseDate,
    period_end,
    due_at: baseDate, // Payment is typically due at the start of the period
  };
}


// ============================================================================
// PER-INVOICE BILLING HELPERS
//
// These functions resolve billing cycles, rates, and version eligibility.
// They do NOT modify any existing fixed-billing behavior.
// ============================================================================

/**
 * Resolves the effective billing model for a license.
 * Returns "fixed" for licenses without model field (backward compat).
 */
export function resolveBillingModel(billing: { model?: string } | null | undefined): BillingModel {
  if (!billing || !billing.model || billing.model === "fixed") return "fixed";
  if (billing.model === "per_invoice") return "per_invoice";
  return "fixed"; // any unexpected value defaults to fixed
}

/**
 * Result of resolving a billing cycle for a usage event.
 */
export interface CycleResolutionResult {
  ok: true;
  period_id: string;
  period_start: Date;
  period_end: Date;
  rate_snapshot: number;
  billing_model: BillingModel;
}

export interface CycleResolutionError {
  ok: false;
  reason: "no_period_found" | "not_per_invoice" | "outside_legitimate_use";
}

/**
 * Resolves the authoritative billing period for a usage event's occurred_at timestamp.
 *
 * Rules:
 * 1. The authoritative cycle boundaries are LicenseBillingPeriod.period_start and period_end.
 * 2. Usage events during the grace window (after period_end, up to grace_until) belong to
 *    the period that just ended — the POS was legitimately usable.
 * 3. Late/offline events that arrive after a period is settled (paid/renewed) MUST be
 *    assigned to their original period based on occurred_at. The rate_snapshot from that
 *    original period applies — NOT the current/new cycle's rate.
 * 4. If no matching period is found, the event is rejected.
 *
 * @param occurredAt - When the invoice was finalized on POS
 * @param periods    - ALL billing periods for this license, sorted by period_start ASC
 * @param graceUntil - The license's grace_until at the time the period was active
 *                     (if available, used to extend the matching window)
 */
export function resolveBillingPeriod(
  occurredAt: Date,
  periods: Array<{
    id: string;
    period_start: Date;
    period_end: Date;
    created_at?: Date;
    billing_model?: string;
    rate_snapshot?: number;
  }>,
  graceDays: number = 0,
): CycleResolutionResult | CycleResolutionError {
  const ts = occurredAt.getTime();

  const makeResult = (p: typeof periods[0]): CycleResolutionResult | CycleResolutionError => {
    const model = resolveBillingModel({ model: p.billing_model });
    if (model !== "per_invoice") {
      return { ok: false, reason: "not_per_invoice" };
    }
    return {
      ok: true,
      period_id: p.id,
      period_start: new Date(p.period_start),
      period_end: new Date(p.period_end),
      rate_snapshot: p.rate_snapshot ?? 0,
      billing_model: model,
    };
  };

  // ── Pass 1: Exact match — occurred_at within [period_start, period_end) ──
  // Search newest-first so the most recent matching period wins.
  let exactMatch: typeof periods[0] | null = null;
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    const start = new Date(p.period_start).getTime();
    const end = new Date(p.period_end).getTime();
    if (ts >= start && ts < end) {
      exactMatch = p;
      break;
    }
  }

  // ── Pass 2: Grace match — occurred_at within [period_end, period_end + grace) ──
  // Checked FIRST logically because grace-period invoices belong to the period that
  // just ended, UNLESS the license was already renewed (exactMatch exists AND
  // exactMatch.created_at <= occurredAt).
  if (graceDays > 0) {
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const end = new Date(p.period_end).getTime();
      const graceEnd = end + (graceDays * 24 * 60 * 60 * 1000);
      
      if (ts >= end && ts < graceEnd) {
        // We found a grace match. Does it override the exact match?
        if (exactMatch) {
          // If the invoice occurred AFTER the new exact match period was created,
          // it belongs to the new period (Case 2: Renewed active cycle).
          // If it occurred BEFORE the new period was created (e.g. offline invoice),
          // it belongs to the old period's grace window (Case 3: Historical state).
          const newPeriodCreated = exactMatch.created_at 
            ? new Date(exactMatch.created_at).getTime() 
            : new Date(exactMatch.period_start).getTime(); // Fallback if created_at is missing
            
          if (ts >= newPeriodCreated) {
             return makeResult(exactMatch);
          }
        }
        return makeResult(p);
      }
    }
  }

  if (exactMatch) {
    return makeResult(exactMatch);
  }

  return { ok: false, reason: "no_period_found" };
}

/**
 * Validates whether an occurred_at timestamp falls within a legitimate use window
 * for the license (active, expiring, or grace period).
 *
 * This does NOT check billing model — it only checks whether the POS was
 * legitimately usable at the given time.
 *
 * @param occurredAt  - When the invoice was finalized
 * @param issuedAt    - When the license was first issued
 * @param periods     - All billing periods for the license
 * @param graceDays   - Configured grace_days for the license
 */
export function isWithinLegitimateUseWindow(
  occurredAt: Date,
  issuedAt: Date | string | null | undefined,
  periods: Array<{ period_start: Date; period_end: Date }>,
  graceDays: number = 0,
): boolean {
  const ts = occurredAt.getTime();

  // Must not be before license issuance
  if (issuedAt) {
    const issued = new Date(issuedAt).getTime();
    if (ts < issued) return false;
  }

  // Must fall within at least one billing period + grace window
  for (const p of periods) {
    const start = new Date(p.period_start).getTime();
    const end = new Date(p.period_end).getTime();
    const graceEnd = graceDays > 0
      ? end + (graceDays * 24 * 60 * 60 * 1000)
      : end;

    if (ts >= start && ts < graceEnd) return true;
  }

  return false;
}

/**
 * Minimum POS app version required for per-invoice metering.
 * Compared using semver-compatible logic (major.minor.patch).
 *
 * Returns true if appVersion >= minVersion.
 * Returns false if versions cannot be parsed (fail-closed).
 */
export function isVersionEligible(
  appVersion: string | null | undefined,
  minVersion: string | null | undefined,
): boolean {
  if (!minVersion) return true; // no minimum set, allow
  if (!appVersion) return false; // no version reported, reject

  const parse = (v: string): number[] => {
    const parts = v.replace(/^v/, "").split(".").map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  try {
    const [aMaj, aMin, aPat] = parse(appVersion);
    const [mMaj, mMin, mPat] = parse(minVersion);

    if (aMaj !== mMaj) return aMaj > mMaj;
    if (aMin !== mMin) return aMin > mMin;
    return aPat >= mPat;
  } catch {
    return false; // unparseable = fail-closed
  }
}

/**
 * Derives the total outstanding amount for a per-invoice billing period.
 *
 * Outstanding = charges + adjustments(debit) - adjustments(credit+waiver) - payments
 *
 * This is ALWAYS derived, never stored as a mutable field.
 * Late usage can increase charges after payments were recorded.
 */
export function deriveOutstanding(
  totalUsageAmount: number,
  adjustments: Array<{ type: "credit" | "debit" | "waiver"; amount: number }>,
  totalPayments: number,
): number {
  let outstanding = totalUsageAmount;

  for (const adj of adjustments) {
    if (adj.type === "debit") {
      outstanding += adj.amount;
    } else {
      // credit and waiver both reduce outstanding
      outstanding -= adj.amount;
    }
  }

  outstanding -= totalPayments;

  // Can be negative (overpayment/excess credit) — that's a valid balance
  return outstanding;
}


// ============================================================================
// CANONICAL BILLING PERIOD + SUMMARY HELPERS
//
// These are the SINGLE authoritative functions for determining:
// 1. Which billing period is "current" (by date, NOT by payment status)
// 2. What the billing summary is for a license
//
// ALL surfaces must use these: admin table, admin detail, action modal,
// owner portal, POS license-status.
// ============================================================================

/**
 * Returns the current active billing period for a license.
 *
 * Rules:
 * 1. Prefer the period where period_start <= now < period_end
 * 2. If no exact match, use the most recent period where period_start <= now
 * 3. NEVER select a future period (period_start > now)
 * 4. A pre-created next period must NOT become current before its start date
 *
 * "Current" is a TIME concept, not a PAYMENT concept.
 * An unpaid period is not necessarily "current".
 * A future period is never "current" even if unpaid.
 */
export function getCurrentBillingPeriod(
  periods: Array<{
    id: string;
    period_start: Date | string;
    period_end: Date | string;
    status?: string;
    billing_model?: string;
    rate_snapshot?: number;
    [key: string]: any;
  }>,
  now: Date = new Date()
): typeof periods[0] | null {
  const nowMs = now.getTime();

  // Pass 1: Exact active period (period_start <= now < period_end)
  for (const p of periods) {
    const start = new Date(p.period_start).getTime();
    const end = new Date(p.period_end).getTime();
    if (nowMs >= start && nowMs < end) {
      return p;
    }
  }

  // Pass 2: Most recent period that started before now (handles gaps)
  let best: typeof periods[0] | null = null;
  for (const p of periods) {
    const start = new Date(p.period_start).getTime();
    if (start <= nowMs) {
      if (!best || start > new Date(best.period_start).getTime()) {
        best = p;
      }
    }
  }

  return best;
}

/**
 * Comprehensive billing summary for a per_invoice license.
 * Used by ALL surfaces to get a single consistent view.
 *
 * Requires database models to be passed in (keeps this function importable from any context).
 */
export async function getLicenseBillingSummary(
  licenseId: string,
  models: {
    LicenseBillingPeriod: any;
    BillingUsage: any;
    BillingAdjustment: any;
    LicensePayment: any;
  },
  now: Date = new Date()
) {
  const { LicenseBillingPeriod, BillingUsage, BillingAdjustment, LicensePayment } = models;

  // Load all periods and payments
  const allPeriods = await LicenseBillingPeriod.find({ license_id: licenseId })
    .sort({ period_start: 1 }).lean();
  const allPayments = await LicensePayment.find({ license_id: licenseId }).lean();

  // Determine current period by TIME
  const currentPeriod = getCurrentBillingPeriod(allPeriods, now);

  // Categorize periods BY TIME, NOT BY PAYMENT STATUS
  const nowMs = now.getTime();
  const accruedPeriods = allPeriods.filter((p: any) =>
    new Date(p.period_start).getTime() <= nowMs
  );
  const futurePeriods = allPeriods.filter((p: any) =>
    new Date(p.period_start).getTime() > nowMs
  );
  const accruedPeriodIds = accruedPeriods.map((p: any) => p.id);
  const futurePeriodIds = futurePeriods.map((p: any) => p.id);

  // ── Per-period usage aggregation ──
  const usageByPeriodAgg = await BillingUsage.aggregate([
    { $match: { license_id: licenseId } },
    { $group: { _id: "$billing_period_id", count: { $sum: 1 }, total: { $sum: "$amount" } } }
  ]);
  const usageByPeriod: Record<string, { count: number; total: number }> = {};
  usageByPeriodAgg.forEach((u: any) => { usageByPeriod[u._id] = { count: u.count, total: u.total }; });

  // ── Accrued usage (past+current periods only) ──
  let accruedUsageCount = 0;
  let accruedUsageAmount = 0;
  for (const pid of accruedPeriodIds) {
    const u = usageByPeriod[pid];
    if (u) { accruedUsageCount += u.count; accruedUsageAmount += u.total; }
  }

  // ── Adjustments on accrued periods ──
  const adjustments = await BillingAdjustment.find({
    billing_period_id: { $in: accruedPeriodIds }
  }).lean();
  const adjustmentDebits = (adjustments as any[])
    .filter((a: any) => a.type === "debit")
    .reduce((sum: number, a: any) => sum + a.amount, 0);
  const adjustmentCredits = (adjustments as any[])
    .filter((a: any) => a.type === "credit" || a.type === "waiver")
    .reduce((sum: number, a: any) => sum + a.amount, 0);

  // ── Payments applied to accrued balance ──
  // Only count payments whose billing_period_id is an accrued (past/current) period.
  // Payments misallocated to future periods are NOT subtracted from accrued outstanding.
  const paymentsAppliedToAccrued = (allPayments as any[])
    .filter((p: any) => accruedPeriodIds.includes(p.billing_period_id))
    .reduce((sum: number, p: any) => sum + (p.amount_paid || 0), 0);

  // Payments misallocated to future periods (informational)
  const paymentsMisallocatedToFuture = (allPayments as any[])
    .filter((p: any) => futurePeriodIds.includes(p.billing_period_id))
    .reduce((sum: number, p: any) => sum + (p.amount_paid || 0), 0);

  // ── Account Outstanding ──
  // outstanding = accrued_charges + debits - credits - payments_on_accrued
  const accruedCharges = accruedUsageAmount + adjustmentDebits - adjustmentCredits;
  const accountOutstanding = Math.max(0, accruedCharges - paymentsAppliedToAccrued);

  // ── Derive effective status for each accrued period ──
  const paymentsByPeriod: Record<string, number> = {};
  (allPayments as any[]).forEach((p: any) => {
    paymentsByPeriod[p.billing_period_id] = (paymentsByPeriod[p.billing_period_id] || 0) + (p.amount_paid || 0);
  });

  // For display: unpaid periods by status (informational)
  const unpaidPeriods = accruedPeriods.filter((p: any) =>
    p.status !== "paid" && p.status !== "waived"
  );

  return {
    currentPeriod,
    nextPeriod: futurePeriods[0] || null,

    // Accrued usage (past+current periods, by TIME)
    accruedUsageCount,
    accruedUsageAmount,

    // Adjustments
    adjustmentDebits,
    adjustmentCredits,

    // Payments
    paymentsAppliedToAccrued,
    paymentsMisallocatedToFuture,

    // Account-level outstanding (ONE canonical number)
    accountOutstanding,

    // Period metadata
    allPeriods,
    accruedPeriods,
    unpaidPeriods,
    futurePeriods,

    // Per-period breakdown
    usageByPeriod,
    paymentsByPeriod,

    // Full payment history
    paymentHistory: allPayments,
  };
}

/**
 * Derives the effective financial status for a per_invoice billing period.
 * Does NOT trust stored status — computes from actual ledger data.
 */
export function deriveEffectiveStatus(
  usageAmount: number,
  paymentsApplied: number,
): "unpaid" | "partially_paid" | "paid" | "no_activity" {
  if (usageAmount <= 0 && paymentsApplied <= 0) return "no_activity";
  if (usageAmount <= 0 && paymentsApplied > 0) return "paid"; // overpayment edge
  if (paymentsApplied <= 0) return "unpaid";
  if (paymentsApplied < usageAmount) return "partially_paid";
  return "paid";
}
