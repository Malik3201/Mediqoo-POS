import type {
  IWhatsAppAlertPreferences,
  IWhatsAppAlertThresholds,
  WhatsAppConnectionStatus,
} from "@/models/WhatsAppIntegration";
import type { IncomingWhatsAppAlertEvent, WhatsAppAlertEventType } from "./types";

function fmtMoney(value: unknown, currency = "Rs"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${currency} 0`;
  const abs = Math.abs(n);
  const rounded = Math.abs(abs - Math.round(abs)) < 0.005 ? Math.round(abs) : Number(abs.toFixed(2));
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-${currency} ${formatted}` : `${currency} ${formatted}`;
}

function fmtDateTime(iso: string | Date | undefined, timezone = "Asia/Karachi"): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

function fmtShortDate(iso: string | Date | undefined, timezone = "Asia/Karachi"): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function getFriendlyConnectionMessage(status: WhatsAppConnectionStatus, lastError?: string | null): string {
  switch (status) {
    case "not_configured":
      return "Add your WhatsApp provider details and connect via QR to start receiving alerts.";
    case "waiting_for_qr":
      return "Waiting for QR scan from WhatsApp → Linked Devices.";
    case "connecting":
      return "Connecting your WhatsApp sender…";
    case "connected":
      return "Connected and ready to deliver pharmacy alerts.";
    case "disconnected":
      return "WhatsApp disconnected. Click Reconnect WhatsApp and scan the QR code.";
    case "error":
      return lastError || "Connection error. Please verify your provider setup or reconnect.";
    default:
      return "Not configured.";
  }
}

export function buildTestMessageText(pharmacyName: string): string {
  return [
    "✅ AivraSol WhatsApp Alerts Connected",
    "",
    pharmacyName || "Your Pharmacy",
    "",
    "This is a test message from AivraSol Pharmacy POS.",
    "",
    "Your important pharmacy alerts and summaries can now be delivered here.",
  ].join("\n");
}

/**
 * Checks whether an alert event is enabled by user preferences and exceeds configured thresholds.
 */
export function evaluateAlertPreferenceAndThreshold(
  event: IncomingWhatsAppAlertEvent,
  prefs: IWhatsAppAlertPreferences,
  thresholds: IWhatsAppAlertThresholds
): { allowed: boolean; reason?: string } {
  const p = event.payload || {};
  const num = (k: string) => Number(p[k]) || 0;

  switch (event.eventType) {
    case "system.test":
      return { allowed: true };

    // Critical / System
    case "license.expiring_soon":
    case "license.grace_entered":
    case "sync.main_disconnected":
    case "fresh_start.requested":
    case "fresh_start.executed":
    case "backup.restore_completed":
    case "terminal.authorization_changed":
      return prefs.licenseSystem ? { allowed: true } : { allowed: false, reason: "pref_disabled:licenseSystem" };

    case "backup.failure_repeated":
      return prefs.backupFailure ? { allowed: true } : { allowed: false, reason: "pref_disabled:backupFailure" };

    case "security.failed_pin_attempts":
      return prefs.security ? { allowed: true } : { allowed: false, reason: "pref_disabled:security" };

    // Sales & Financial
    case "sale.large":
      if (!prefs.largeSales) return { allowed: false, reason: "pref_disabled:largeSales" };
      if (num("netSale") < Math.max(1, thresholds.largeSaleAmount)) {
        return { allowed: false, reason: "below_threshold:largeSaleAmount" };
      }
      return { allowed: true };

    case "sale.below_cost":
      if (!prefs.belowCostSales) return { allowed: false, reason: "pref_disabled:belowCostSales" };
      if (num("estimatedLoss") < Math.max(0, thresholds.belowCostLossAmount)) {
        return { allowed: false, reason: "below_threshold:belowCostLossAmount" };
      }
      return { allowed: true };

    case "sale.large_discount":
      if (!prefs.largeDiscounts) return { allowed: false, reason: "pref_disabled:largeDiscounts" };
      if (num("discountPct") < Math.max(0.1, thresholds.largeDiscountPct)) {
        return { allowed: false, reason: "below_threshold:largeDiscountPct" };
      }
      return { allowed: true };

    case "sale.large_return":
      if (!prefs.largeReturns) return { allowed: false, reason: "pref_disabled:largeReturns" };
      if (num("refundAmount") < Math.max(1, thresholds.largeReturnAmount)) {
        return { allowed: false, reason: "below_threshold:largeReturnAmount" };
      }
      return { allowed: true };

    case "cash.issue":
      return prefs.cashIssues ? { allowed: true } : { allowed: false, reason: "pref_disabled:cashIssues" };

    case "cash.large_adjustment":
      if (!prefs.largeCashAdjustment && !prefs.cashIssues) {
        return { allowed: false, reason: "pref_disabled:largeCashAdjustment" };
      }
      if (Math.abs(num("amount")) < Math.max(1, thresholds.largeCashAdjustmentAmount)) {
        return { allowed: false, reason: "below_threshold:largeCashAdjustmentAmount" };
      }
      return { allowed: true };

    case "customer.large_balance_adjustment":
      if (!prefs.largeCustomerBalanceAdjustment) {
        return { allowed: false, reason: "pref_disabled:largeCustomerBalanceAdjustment" };
      }
      if (Math.abs(num("amount")) < Math.max(1, thresholds.largeCustomerBalanceAdjustmentAmount)) {
        return { allowed: false, reason: "below_threshold:largeCustomerBalanceAdjustmentAmount" };
      }
      return { allowed: true };

    case "supplier.large_payment":
      if (!prefs.largeSupplierPayment) {
        return { allowed: false, reason: "pref_disabled:largeSupplierPayment" };
      }
      if (num("amount") < Math.max(1, thresholds.largeSupplierPaymentAmount)) {
        return { allowed: false, reason: "below_threshold:largeSupplierPaymentAmount" };
      }
      return { allowed: true };

    // Inventory
    case "inventory.low_stock_summary":
    case "inventory.out_of_stock_summary":
      return prefs.lowStockSummary ? { allowed: true } : { allowed: false, reason: "pref_disabled:lowStockSummary" };

    case "inventory.near_expiry_summary":
      return prefs.nearExpirySummary ? { allowed: true } : { allowed: false, reason: "pref_disabled:nearExpirySummary" };

    case "inventory.major_stock_adjustment":
      if (!prefs.majorStockAdjustment) {
        return { allowed: false, reason: "pref_disabled:majorStockAdjustment" };
      }
      if (Math.abs(num("deltaBaseQty")) < Math.max(1, thresholds.majorStockAdjustmentUnits)) {
        return { allowed: false, reason: "below_threshold:majorStockAdjustmentUnits" };
      }
      return { allowed: true };

    // Reports / Summaries
    case "summary.daily":
      return prefs.dailySummary ? { allowed: true } : { allowed: false, reason: "pref_disabled:dailySummary" };
    case "summary.weekly":
      return prefs.weeklySummary ? { allowed: true } : { allowed: false, reason: "pref_disabled:weeklySummary" };
    case "summary.monthly":
      return prefs.monthlySummary ? { allowed: true } : { allowed: false, reason: "pref_disabled:monthlySummary" };

    default:
      return { allowed: false, reason: "unknown_event_type" };
  }
}

/**
 * Classifies stale offline alerts that are no longer operationally useful once connectivity returns.
 * Example: a "Main Seat disconnected" alert from 2 days ago should NOT be sent after reconnect.
 */
export function isEventStale(eventType: WhatsAppAlertEventType, occurredAt: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - occurredAt.getTime();
  if (ageMs < 0) return false;
  const HOUR = 60 * 60 * 1000;
  switch (eventType) {
    case "sync.main_disconnected":
      return ageMs > 2 * HOUR;
    case "inventory.low_stock_summary":
    case "inventory.out_of_stock_summary":
    case "inventory.near_expiry_summary":
      return ageMs > 24 * HOUR;
    case "summary.daily":
      return ageMs > 36 * HOUR;
    case "summary.weekly":
    case "summary.monthly":
      return ageMs > 72 * HOUR;
    default:
      // Transactional & critical security/financial alerts remain useful for up to 7 days
      return ageMs > 7 * 24 * HOUR;
  }
}

export function isSummaryEvent(eventType: WhatsAppAlertEventType): boolean {
  return (
    eventType === "summary.daily" ||
    eventType === "summary.weekly" ||
    eventType === "summary.monthly" ||
    eventType === "system.test"
  );
}

/**
 * Formats any canonical alert event into a clean, short, readable WhatsApp message.
 * Never outputs raw JSON or sensitive secrets.
 */
export function formatWhatsAppAlertMessage(params: {
  eventType: WhatsAppAlertEventType;
  title: string;
  payload: Record<string, unknown>;
  pharmacyName: string;
  occurredAt?: string | Date;
  timezone?: string;
  currency?: string;
}): string {
  const { eventType, payload: p, occurredAt, timezone = "Asia/Karachi", currency = "Rs" } = params;
  const pharmacy = params.pharmacyName || "Pharmacy";
  const timeStr = fmtDateTime(occurredAt, timezone);
  const str = (k: string, fb = "—") => {
    const v = p[k];
    return typeof v === "string" && v.trim() ? v.trim() : fb;
  };
  const num = (k: string) => Number(p[k]) || 0;

  switch (eventType) {
    case "system.test":
      return buildTestMessageText(pharmacy);

    case "sale.below_cost":
      return [
        "⚠️ BELOW-COST SALE",
        "",
        pharmacy,
        "",
        `Invoice: ${str("invoiceNumber")}`,
        `Operator: ${str("operator", "Cashier")}`,
        `Sale: ${fmtMoney(num("netSale"), currency)}`,
        `Estimated Loss: ${fmtMoney(num("estimatedLoss"), currency)}`,
        "",
        `Time: ${timeStr}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    case "sale.large_discount":
      return [
        "⚠️ LARGE DISCOUNT",
        "",
        pharmacy,
        "",
        `Invoice: ${str("invoiceNumber")}`,
        `Discount: ${Number(num("discountPct")).toFixed(1)}%`,
        `Discount Amount: ${fmtMoney(num("discountAmount"), currency)}`,
        `Operator: ${str("operator", "Cashier")}`,
        `Net Sale: ${fmtMoney(num("netSale"), currency)}`,
        "",
        `Time: ${timeStr}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    case "sale.large":
      return [
        "💰 LARGE SALE",
        "",
        pharmacy,
        "",
        `Invoice: ${str("invoiceNumber")}`,
        `Customer: ${str("customerName", "Walk-in")}`,
        `Net Sale: ${fmtMoney(num("netSale"), currency)}`,
        `Payment: ${str("paymentMethod", "Cash")}`,
        `Operator: ${str("operator", "Cashier")}`,
        "",
        `Time: ${timeStr}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    case "sale.large_return":
      return [
        "↩️ LARGE SALES RETURN",
        "",
        pharmacy,
        "",
        `Return: ${str("returnNumber")}`,
        `Original Invoice: ${str("invoiceNumber", "Loose Return")}`,
        `Refund: ${fmtMoney(num("refundAmount"), currency)}`,
        `Operator: ${str("operator", "Cashier")}`,
        `Reason: ${str("reason", "Customer return")}`,
        "",
        `Time: ${timeStr}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    case "cash.issue":
      return [
        "⚠️ CASH ISSUE",
        "",
        pharmacy,
        "",
        str("summary", "Physical Cash shortage detected."),
        "",
        `Expected: ${fmtMoney(num("expected"), currency)}`,
        `Counted: ${fmtMoney(num("counted"), currency)}`,
        `Difference: ${fmtMoney(num("difference"), currency)}`,
        ...(p.operator ? [`Operator: ${str("operator")}`] : []),
        "",
        "Review in Cashbook.",
      ].join("\n");

    case "cash.large_adjustment":
      return [
        "⚠️ LARGE CASH ADJUSTMENT",
        "",
        pharmacy,
        "",
        `Type: ${str("kind", "Cashbook Entry")}`,
        `Account: ${str("accountName", "Physical Cash")}`,
        `Amount: ${fmtMoney(num("amount"), currency)}`,
        `Operator: ${str("operator", "Admin")}`,
        ...(p.note ? [`Note: ${str("note")}`] : []),
        "",
        `Time: ${timeStr}`,
      ].join("\n");

    case "customer.large_balance_adjustment":
      return [
        "⚠️ CUSTOMER BALANCE ADJUSTMENT",
        "",
        pharmacy,
        "",
        `Customer: ${str("customerName")}`,
        `Amount: ${fmtMoney(num("amount"), currency)}`,
        `Type: ${str("adjustmentType", "Khata Adjustment")}`,
        `Operator: ${str("operator", "Admin")}`,
        ...(p.note ? [`Note: ${str("note")}`] : []),
        "",
        `Time: ${timeStr}`,
      ].join("\n");

    case "supplier.large_payment":
      return [
        "🏦 LARGE SUPPLIER PAYMENT",
        "",
        pharmacy,
        "",
        `Supplier: ${str("supplierName")}`,
        `Amount Paid: ${fmtMoney(num("amount"), currency)}`,
        `Method: ${str("method", "Cash")}`,
        `Operator: ${str("operator", "Admin")}`,
        "",
        `Time: ${timeStr}`,
      ].join("\n");

    case "inventory.low_stock_summary":
    case "inventory.out_of_stock_summary": {
      const topItems = Array.isArray(p.topItems) ? (p.topItems as Array<{ name?: string; qty?: number; unit?: string }>) : [];
      const lines = [
        "📦 STOCK ALERT",
        pharmacy,
        "",
        `Low Stock: ${num("lowStockCount")}`,
        `Out of Stock: ${num("outOfStockCount")}`,
      ];
      if (topItems.length > 0) {
        lines.push("", "Top Items:");
        for (const it of topItems.slice(0, 6)) {
          lines.push(`• ${it.name || "Item"}: ${Number(it.qty) || 0}${it.unit ? ` ${it.unit}` : ""}`);
        }
      }
      lines.push("", "Open AivraSol POS for full details.");
      return lines.join("\n");
    }

    case "inventory.near_expiry_summary": {
      const count = num("nearExpiryCount");
      const expiredCount = num("expiredCount");
      const next = (p.nextExpiry && typeof p.nextExpiry === "object" ? p.nextExpiry : null) as
        | { name?: string; batchNo?: string; expiry?: string }
        | null;
      const lines = [
        "⏳ EXPIRY ALERT",
        pharmacy,
        "",
        `${count} batch${count === 1 ? " is" : "es are"} nearing expiry.`,
        ...(expiredCount > 0 ? [`Expired Batches: ${expiredCount}`] : []),
      ];
      if (next?.name) {
        lines.push(
          "",
          "Next expiry:",
          next.name,
          `Batch ${next.batchNo || "—"}`,
          next.expiry ? fmtShortDate(next.expiry, timezone) : "—"
        );
      }
      lines.push("", "Open Inventory → Expiry for details.");
      return lines.join("\n");
    }

    case "inventory.major_stock_adjustment":
      return [
        "📦 MAJOR STOCK ADJUSTMENT",
        "",
        pharmacy,
        "",
        `Item: ${str("productName")}`,
        `Change: ${num("deltaBaseQty") >= 0 ? "+" : ""}${num("deltaBaseQty")} ${str("unit", "unit")}`,
        `New Stock: ${num("newStock")} ${str("unit", "unit")}`,
        `Operator: ${str("operator", "Admin")}`,
        ...(p.reason ? [`Reason: ${str("reason")}`] : []),
        "",
        `Time: ${timeStr}`,
      ].join("\n");

    case "summary.daily": {
      if (p.notClosedNotice === true) {
        return [
          "📊 DAILY SUMMARY",
          pharmacy,
          str("dateLabel", fmtShortDate(occurredAt, timezone)),
          "",
          "Daily closing not completed yet.",
          "",
          "Open AivraSol POS → Cashbook → Daily Closing to close today's account.",
        ].join("\n");
      }
      return [
        "📊 DAILY SUMMARY",
        pharmacy,
        str("dateLabel", fmtShortDate(occurredAt, timezone)),
        "",
        `Net Sales: ${fmtMoney(num("netSales"), currency)}`,
        `Gross Profit: ${fmtMoney(num("grossProfit"), currency)}`,
        `Returns: ${fmtMoney(num("returns"), currency)}`,
        "",
        `Cash Sales: ${fmtMoney(num("cashSales"), currency)}`,
        `Credit Sales: ${fmtMoney(num("creditSales"), currency)}`,
        "",
        `Purchases: ${fmtMoney(num("purchases"), currency)}`,
        "",
        `Receivables: ${fmtMoney(num("receivables"), currency)}`,
        `Payables: ${fmtMoney(num("payables"), currency)}`,
        "",
        `Closing Cash: ${fmtMoney(num("closingCash"), currency)}`,
        "",
        `Low Stock: ${num("lowStockCount")}`,
        `Near Expiry: ${num("nearExpiryCount")}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");
    }

    case "summary.weekly":
      return [
        "📈 WEEKLY SUMMARY",
        pharmacy,
        str("periodLabel", "Last 7 Days"),
        "",
        `Net Sales: ${fmtMoney(num("netSales"), currency)}`,
        `Gross Profit: ${fmtMoney(num("grossProfit"), currency)}`,
        `Returns: ${fmtMoney(num("returns"), currency)}`,
        `Purchases: ${fmtMoney(num("purchases"), currency)}`,
        `Expenses: ${fmtMoney(num("expenses"), currency)}`,
        `Net Profit: ${fmtMoney(num("netProfit"), currency)}`,
        "",
        `Receivables: ${fmtMoney(num("receivables"), currency)}`,
        `Payables: ${fmtMoney(num("payables"), currency)}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    case "summary.monthly":
      return [
        "📅 MONTHLY SUMMARY",
        pharmacy,
        str("periodLabel", "Monthly Overview"),
        "",
        `Net Sales: ${fmtMoney(num("netSales"), currency)}`,
        `Gross Profit: ${fmtMoney(num("grossProfit"), currency)}`,
        `Returns: ${fmtMoney(num("returns"), currency)}`,
        `Purchases: ${fmtMoney(num("purchases"), currency)}`,
        `Expenses: ${fmtMoney(num("expenses"), currency)}`,
        `Net Profit: ${fmtMoney(num("netProfit"), currency)}`,
        "",
        "AivraSol Pharmacy POS",
      ].join("\n");

    // Critical System / Security
    case "license.expiring_soon":
      return [
        "🔔 LICENSE EXPIRING SOON",
        "",
        pharmacy,
        "",
        `Days Remaining: ${num("daysRemaining")}`,
        ...(p.expiresAt ? [`Expiry Date: ${fmtShortDate(String(p.expiresAt), timezone)}`] : []),
        "",
        "Please renew your AivraSol POS license to avoid interruption.",
      ].join("\n");

    case "license.grace_entered":
      return [
        "🚨 LICENSE GRACE PERIOD ACTIVE",
        "",
        pharmacy,
        "",
        "Your AivraSol POS license has entered its grace period.",
        ...(p.graceUntil ? [`Grace Ends: ${fmtShortDate(String(p.graceUntil), timezone)}`] : []),
        "",
        "Please renew immediately to keep POS operations uninterrupted.",
      ].join("\n");

    case "backup.failure_repeated":
      return [
        "🚨 CLOUD BACKUP FAILURE",
        "",
        pharmacy,
        "",
        `Consecutive Failures: ${num("consecutiveFailures")}`,
        ...(p.lastError ? [`Reason: ${str("lastError")}`] : []),
        "",
        `Time: ${timeStr}`,
        "Check internet connection or Settings → Backup & Data.",
      ].join("\n");

    case "sync.main_disconnected":
      return [
        "⚠️ MAIN POS SYNC ISSUE",
        "",
        pharmacy,
        "",
        str("detail", "Client terminal lost connection to Main POS seat."),
        ...(p.terminalLabel ? [`Terminal: ${str("terminalLabel")}`] : []),
        "",
        `Time: ${timeStr}`,
      ].join("\n");

    case "fresh_start.requested":
      return [
        "⚠️ FRESH START REQUESTED",
        "",
        pharmacy,
        "",
        `Requested By: ${str("operator", "Admin")}`,
        `Time: ${timeStr}`,
        "",
        "A Fresh Start reset authorization was requested from Main POS.",
      ].join("\n");

    case "fresh_start.executed":
      return [
        "🚨 FRESH START EXECUTED",
        "",
        pharmacy,
        "",
        `Executed By: ${str("operator", "Admin")}`,
        `Time: ${timeStr}`,
        "",
        "Pharmacy training data reset completed with safety backup.",
      ].join("\n");

    case "backup.restore_completed":
      return [
        "⚠️ BACKUP RESTORE COMPLETED",
        "",
        pharmacy,
        "",
        `Restored By: ${str("operator", "Admin")}`,
        ...(p.source ? [`Source: ${str("source")}`] : []),
        `Time: ${timeStr}`,
      ].join("\n");

    case "terminal.authorization_changed":
      return [
        "🔐 TERMINAL AUTHORIZATION CHANGED",
        "",
        pharmacy,
        "",
        str("detail", "A terminal seat or permission policy was updated."),
        `Updated By: ${str("operator", "Admin")}`,
        `Time: ${timeStr}`,
      ].join("\n");

    case "security.failed_pin_attempts":
      return [
        "🚨 SECURITY ALERT — FAILED PIN ATTEMPTS",
        "",
        pharmacy,
        "",
        `Failed Attempts: ${num("attempts")}`,
        ...(p.operatorName ? [`Target Account: ${str("operatorName")}`] : []),
        ...(p.terminalLabel ? [`Terminal: ${str("terminalLabel")}`] : []),
        `Time: ${timeStr}`,
      ].join("\n");

    default:
      return [
        `🔔 ${params.title || "POS Alert"}`,
        "",
        pharmacy,
        "",
        `Time: ${timeStr}`,
        "AivraSol Pharmacy POS",
      ].join("\n");
  }
}
