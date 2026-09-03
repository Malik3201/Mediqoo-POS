import { addMonths, addYears, isBefore } from "date-fns";

export type BillingCycle = "monthly" | "yearly";

export interface LicenseBillingState {
  expires_at?: Date | string | null;
  billing: {
    cycle: BillingCycle | string;
    grace_days: number;
  };
}

export interface RenewalCalculationResult {
  renewalType: "early" | "late";
  baseDate: Date;
  newExpiry: Date;
  newGraceUntil: Date;
}

/**
 * Canonically calculates the next expiry and grace_until dates for a license renewal.
 * Early renewal: before expiry -> extends from current expiry.
 * Late renewal: after expiry -> extends from today.
 */
export function calculateRenewalDates(license: LicenseBillingState): RenewalCalculationResult {
  const now = new Date();
  let baseDate = license.expires_at ? new Date(license.expires_at) : now;
  
  let renewalType: "early" | "late" = "early";
  if (isBefore(baseDate, now)) {
    baseDate = now;
    renewalType = "late";
  }
  
  let newExpiry: Date;
  if (license.billing.cycle === "yearly") {
    newExpiry = addYears(baseDate, 1);
  } else {
    newExpiry = addMonths(baseDate, 1);
  }

  const graceDays = license.billing.grace_days ?? 3;
  const newGraceUntil = new Date(newExpiry);
  newGraceUntil.setDate(newGraceUntil.getDate() + graceDays);

  return {
    renewalType,
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
