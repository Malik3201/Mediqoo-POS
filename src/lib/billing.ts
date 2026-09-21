import { addMonths, addYears } from "date-fns";

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

export interface RenewalCalculationResult {
  renewalType: "fixed";
  baseDate: Date;
  newExpiry: Date;
  newGraceUntil: Date;
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
 * Canonically calculates the next expiry and grace_until dates for a license renewal.
 * FIXED ANNIVERSARY RULE: The new expiry precisely becomes the period_end of the settled billing period.
 * Payment date does NOT reset the billing anniversary.
 */
export function calculateRenewalDates(license: LicenseBillingState, settledPeriodEnd: Date): RenewalCalculationResult {
  const newExpiry = new Date(settledPeriodEnd);
  const graceDays = license.billing?.grace_days ?? 3;
  const newGraceUntil = calculateGraceUntil(newExpiry, graceDays) as Date;

  return {
    renewalType: "fixed",
    baseDate: new Date(license.expires_at || new Date()),
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

