import { isBefore, differenceInDays, startOfDay } from "date-fns";

export type OperationalStatus = 
  | "Active"
  | "Grace Period"
  | "Renewal Required"
  | "Suspended"
  | "Revoked"
  | "Unknown";

export type BillingStatus = 
  | "Due Today"
  | "Due Tomorrow"
  | "Due Soon"
  | "Paid"
  | "Overdue"
  | "Partially Paid"
  | "Waived"
  | "Unpaid"
  | "Billing Disabled"
  | "No Period"
  | "Not Due Yet"
  | "Current";

export function deriveOperationalStatus(license: any): OperationalStatus {
  if (license.status === "suspended") return "Suspended";
  if (license.status === "revoked") return "Revoked";
  if (!license.expires_at) return "Active"; // Perpetual license

  const now = startOfDay(new Date());
  const expiry = startOfDay(new Date(license.expires_at));
  
  if (isBefore(now, expiry) || now.getTime() === expiry.getTime()) {
    return "Active";
  }

  const graceUntil = license.grace_until ? startOfDay(new Date(license.grace_until)) : expiry;

  if (isBefore(now, graceUntil) || now.getTime() === graceUntil.getTime()) {
    return "Grace Period";
  }

  return "Renewal Required";
}

/**
 * Derives the financial/billing status of a license.
 * 
 * Rules:
 * 1. If total debt <= 0 (or period is marked paid/waived with 0 balance), status is "Paid" (or "Waived").
 * 2. If debt > 0:
 *    - Outstanding balance simply accumulates ("outstanding bus count krty jana hy").
 *    - Status is ONLY "Overdue" when license expiry has passed ("guzar jay", expired / grace).
 *    - Status is "Due Today", "Due Tomorrow", or "Due Soon" when license expiry is near (<= 7 days).
 *    - If license expiry is comfortably in the future (> 7 days), status is "Current" (not overdue!).
 */
export function deriveBillingStatus(
  license: any, 
  currentPeriod?: any, 
  previousPeriodsExist: boolean = true,
  totalOutstanding?: number
): BillingStatus {
  if (!license?.billing?.enabled) return "Billing Disabled";

  // Check if debt exists
  const effectiveOutstanding = totalOutstanding !== undefined 
    ? totalOutstanding 
    : (currentPeriod?.outstanding !== undefined 
        ? currentPeriod.outstanding 
        : (currentPeriod ? Math.max(0, (currentPeriod.amount_due || 0) - (currentPeriod.amount_paid || 0)) : 0));

  // If debt is 0 or less, they are Paid / Waived (never Overdue!)
  if (effectiveOutstanding <= 0) {
    if (currentPeriod?.status === "waived") return "Waived";
    return "Paid";
  }

  if (!currentPeriod && totalOutstanding === undefined) return "No Period";

  const now = startOfDay(new Date());

  // If license has an expiration date, status is strictly driven by the license validity window
  if (license.expires_at) {
    const expiry = startOfDay(new Date(license.expires_at));
    const daysUntilExpiry = differenceInDays(expiry, now);

    if (daysUntilExpiry < 0) {
      return "Overdue";
    } else if (daysUntilExpiry === 0) {
      return "Due Today";
    } else if (daysUntilExpiry === 1) {
      return "Due Tomorrow";
    } else if (daysUntilExpiry <= 7) {
      return "Due Soon";
    } else {
      // Expiry is in the future (> 7 days, e.g. 2 months away).
      // Outstanding balance is simply accumulating usage without alarming overdue alert.
      return "Current";
    }
  }

  // Fallback for perpetual licenses with billing periods
  if (currentPeriod?.due_at) {
    const due = startOfDay(new Date(currentPeriod.due_at));
    const daysDiff = differenceInDays(due, now);

    if (daysDiff < 0) {
      return "Overdue";
    } else if (daysDiff === 0) {
      return "Due Today";
    } else if (daysDiff === 1) {
      return "Due Tomorrow";
    } else if (daysDiff <= 7) {
      return "Due Soon";
    }
  }

  return "Current";
}

export function isCloudDashboardEnabled(license: any): boolean {
  return license?.features?.cloud_dashboard === true;
}
