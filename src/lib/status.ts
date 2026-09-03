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
  | "No Period";

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

export function deriveBillingStatus(license: any, currentPeriod?: any): BillingStatus {
  if (!license.billing?.enabled) return "Billing Disabled";
  if (!currentPeriod) return "No Period";

  const status = currentPeriod.status; // "paid", "unpaid", "partially_paid", "waived"
  
  if (status === "paid") return "Paid";
  if (status === "waived") return "Waived";

  // For unpaid or partially paid, evaluate dates based on due_at
  const now = startOfDay(new Date());
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

  return status === "partially_paid" ? "Partially Paid" : "Unpaid";
}
