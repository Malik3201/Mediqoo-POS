import { addMonths, addYears } from "date-fns";

export type BillingCycle = "monthly" | "yearly";

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
 * Canonically calculates the next expiry and grace_until dates for a license renewal.
 * FIXED ANNIVERSARY RULE: The new expiry precisely becomes the period_end of the settled billing period.
 * Payment date does NOT reset the billing anniversary.
 */
export function calculateRenewalDates(license: LicenseBillingState, settledPeriodEnd: Date): RenewalCalculationResult {
  const newExpiry = new Date(settledPeriodEnd);
  
  const graceDays = license.billing.grace_days ?? 3;
  const newGraceUntil = new Date(newExpiry);
  newGraceUntil.setDate(newGraceUntil.getDate() + graceDays);

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
