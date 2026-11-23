import type {
  IWhatsAppAlertPreferences,
  IWhatsAppAlertThresholds,
  WhatsAppConnectionStatus,
} from "@/models/WhatsAppIntegration";
import type {
  IncomingWhatsAppAlertEvent,
  WhatsAppAlertEventType,
  WhatsAppLowStockAlertItem,
  WhatsAppNearExpiryAlertItem,
  WhatsAppSaleItemBrief,
} from "./types";

const DIVIDER = "───────────────";

/**
 * Strips newlines and stray WhatsApp markdown control characters from dynamic names/notes
 * so user-entered strings never break bold/italic formatting.
 */
function cleanMd(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

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

function fmtSignedMoney(value: unknown, currency = "Rs"): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return `${currency} 0`;
  return n > 0 ? `+${fmtMoney(n, currency)}` : fmtMoney(n, currency);
}

function fmtNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n) : Number(n.toFixed(2));
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 2,
  });
}

function pluralizeUnit(qty: number, rawUnit?: string): string {
  const u = cleanMd(rawUnit || "unit", "unit").toLowerCase();
  if (Math.abs(qty) === 1) return u;
  if (
    u.endsWith("s") ||
    u === "ml" ||
    u === "mg" ||
    u === "g" ||
    u === "gm" ||
    u === "kg" ||
    u === "l" ||
    u === "pcs"
  ) {
    return u;
  }
  if (u === "box" || u === "pouch" || u === "batch") return `${u}es`;
  return `${u}s`;
}

function fmtQtyUnit(qty: number, unit?: string): string {
  const q = Number.isFinite(qty) ? qty : 0;
  return `${fmtNumber(q)} ${pluralizeUnit(q, unit)}`;
}

function fmtCompactDateTime(iso: string | Date | undefined, timezone = "Asia/Karachi"): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  try {
    const datePart = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return `${datePart}, ${timePart}`;
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
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function fmtDayMonth(iso: string | Date | undefined, timezone = "Asia/Karachi"): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
    }).format(d);
  } catch {
    return d.toISOString().slice(5, 10);
  }
}

function fmtDateLabel(raw: unknown, occurredAt: string | Date | undefined, timezone: string): string {
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(`${trimmed}T12:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) return fmtShortDate(parsed, timezone);
    }
    return cleanMd(trimmed);
  }
  return fmtShortDate(occurredAt, timezone);
}

function fmtPaymentMethod(raw: unknown, fallback = "Cash"): string {
  const s = cleanMd(typeof raw === "string" ? raw : "", "").toLowerCase();
  if (!s) return fallback;
  switch (s) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "bank":
    case "bank_transfer":
      return "Bank";
    case "wallet":
      return "Wallet";
    case "credit":
      return "Credit (Khata)";
    case "cod_pending":
    case "cod":
      return "COD";
    case "cheque":
      return "Cheque";
    case "mixed":
      return "Mixed";
    default:
      return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

function formatItemBriefList(rawItems: unknown, totalItemCount?: number, maxShow = 2): string | null {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const valid = rawItems
    .filter((x): x is WhatsAppSaleItemBrief => Boolean(x && typeof x === "object" && typeof (x as any).name === "string"))
    .slice(0, maxShow);
  if (valid.length === 0) return null;

  const parts = valid.map((it) => {
    const name = cleanMd(it.name, "Item");
    const qty = Number(it.qty);
    if (Number.isFinite(qty) && qty > 0) {
      return `*${name}* ×${fmtNumber(qty)}`;
    }
    return `*${name}*`;
  });

  const total = Math.max(Number(totalItemCount) || 0, rawItems.length);
  const more = total - valid.length;
  return more > 0 ? `${parts.join(", ")} _(+${more} more)_` : parts.join(", ");
}

function normalizeLowStockItems(p: Record<string, unknown>): WhatsAppLowStockAlertItem[] {
  const raw = Array.isArray(p.items) ? p.items : Array.isArray(p.topItems) ? p.topItems : [];
  const out: WhatsAppLowStockAlertItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = cleanMd(e.name, "");
    if (!name) continue;
    const stockNum = Number(e.stock ?? e.qty ?? 0);
    const stock = Number.isFinite(stockNum) ? stockNum : 0;
    const reorderNum = Number(e.reorderLevel ?? e.reorder_level ?? 0);
    const reorderLevel = Number.isFinite(reorderNum) && reorderNum > 0 ? reorderNum : undefined;
    const status: "out" | "low" =
      e.status === "out" || e.status === "low" ? e.status : stock <= 0 ? "out" : "low";
    const unit = typeof e.unit === "string" && e.unit.trim() ? cleanMd(e.unit) : undefined;
    const supplierName =
      typeof e.supplierName === "string" && e.supplierName.trim()
        ? cleanMd(e.supplierName)
        : typeof e.supplier_name === "string" && e.supplier_name.trim()
          ? cleanMd(e.supplier_name)
          : undefined;

    out.push({ name, stock, unit, reorderLevel, status, supplierName });
  }
  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === "out" ? -1 : 1;
    if (a.stock !== b.stock) return a.stock - b.stock;
    return a.name.localeCompare(b.name);
  });
}

function normalizeNearExpiryItems(p: Record<string, unknown>, timezone: string): WhatsAppNearExpiryAlertItem[] {
  const out: WhatsAppNearExpiryAlertItem[] = [];
  if (Array.isArray(p.items)) {
    for (const entry of p.items) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const name = cleanMd(e.name, "");
      if (!name) continue;
      const qtyNum = Number(e.qty ?? 0);
      const daysNum = Number(e.daysLeft ?? e.days_left);
      const expiryRaw =
        typeof e.expiryDate === "string"
          ? e.expiryDate
          : typeof e.expiry === "string"
            ? e.expiry
            : undefined;
      let daysLeft = Number.isFinite(daysNum) ? Math.round(daysNum) : NaN;
      if (!Number.isFinite(daysLeft) && expiryRaw) {
        const expMs = new Date(expiryRaw).getTime();
        if (!Number.isNaN(expMs)) {
          daysLeft = Math.ceil((expMs - Date.now()) / 86_400_000);
        }
      }
      out.push({
        name,
        batchNo: typeof e.batchNo === "string" && e.batchNo.trim() ? cleanMd(e.batchNo) : undefined,
        qty: Number.isFinite(qtyNum) ? qtyNum : 0,
        unit: typeof e.unit === "string" && e.unit.trim() ? cleanMd(e.unit) : undefined,
        daysLeft: Number.isFinite(daysLeft) ? daysLeft : 0,
        expiryDate: expiryRaw,
        supplierName:
          typeof e.supplierName === "string" && e.supplierName.trim() ? cleanMd(e.supplierName) : undefined,
      });
    }
  } else if (p.nextExpiry && typeof p.nextExpiry === "object") {
    const next = p.nextExpiry as Record<string, unknown>;
    const name = cleanMd(next.name, "");
    if (name) {
      const expiryRaw = typeof next.expiry === "string" ? next.expiry : undefined;
      let daysLeft = 0;
      if (expiryRaw) {
        const expMs = new Date(expiryRaw).getTime();
        if (!Number.isNaN(expMs)) {
          daysLeft = Math.ceil((expMs - Date.now()) / 86_400_000);
        }
      }
      out.push({
        name,
        batchNo: typeof next.batchNo === "string" && next.batchNo.trim() ? cleanMd(next.batchNo) : undefined,
        qty: Number(next.qty) || 0,
        unit: typeof next.unit === "string" ? cleanMd(next.unit) : undefined,
        daysLeft,
        expiryDate: expiryRaw,
      });
    }
  }

  void timezone;
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

function buildCard(params: {
  icon: string;
  heading: string;
  pharmacy: string;
  subMeta: string;
  body: string[];
  footer?: string;
}): string {
  const header = `${params.icon} *${cleanMd(params.heading)}*`;
  const sub = params.subMeta ? `*${cleanMd(params.pharmacy, "Pharmacy")}* · ${params.subMeta}` : `*${cleanMd(params.pharmacy, "Pharmacy")}*`;
  const lines = [header, sub, DIVIDER, ...params.body];
  if (params.footer) {
    lines.push(DIVIDER, params.footer);
  }
  return lines.join("\n");
}

function buildStockHealthLines(p: Record<string, unknown>): string[] {
  const outCount = Number(p.outOfStockCount) || 0;
  const rawLow = Number(p.lowStockCount) || 0;
  const hasSeparateCounts = p.outOfStockCount !== undefined;
  const lowOnly =
    typeof p.lowOnlyCount === "number"
      ? Math.max(0, Number(p.lowOnlyCount))
      : hasSeparateCounts
        ? Math.max(0, rawLow - (p.lowStockIncludesOut ? outCount : 0))
        : rawLow;
  const nearExpiry = Number(p.nearExpiryCount) || 0;

  if (outCount <= 0 && lowOnly <= 0 && nearExpiry <= 0) {
    return [];
  }

  const badges: string[] = [];
  if (hasSeparateCounts) {
    if (outCount > 0) badges.push(`🔴 Out: *${outCount}*`);
    if (lowOnly > 0) badges.push(`🟡 Low: *${lowOnly}*`);
  } else if (rawLow > 0) {
    badges.push(`🟡 Low/Out: *${rawLow}*`);
  }
  if (nearExpiry > 0) badges.push(`⏳ Expiring: *${nearExpiry}*`);

  const lines = ["", "*Stock Watch*", `• ${badges.join(" · ")}`];

  const urgentItems = normalizeLowStockItems({
    items: Array.isArray(p.topLowStockItems) ? p.topLowStockItems : undefined,
  }).slice(0, 3);

  if (urgentItems.length > 0) {
    const preview = urgentItems
      .map((it) => (it.supplierName ? `*${it.name}* _(${it.supplierName})_` : `*${it.name}*`))
      .join(", ");
    lines.push(`• Reorder: ${preview}`);
  }

  return lines;
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

export function buildTestMessageText(pharmacyName: string, timezone = "Asia/Karachi"): string {
  return buildCard({
    icon: "✅",
    heading: "WhatsApp Alerts Connected",
    pharmacy: pharmacyName || "Your Pharmacy",
    subMeta: fmtCompactDateTime(new Date(), timezone),
    body: [
      "Your live pharmacy alerts are active on this number:",
      "• High-value sales, margins & cash issues",
      "• Low stock & expiry action lists",
      "• Daily, weekly & monthly business summaries",
    ],
    footer: "💡 Adjust preferences in *POS → Settings → WhatsApp*.",
  });
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
    case "daily_closing.not_closed":
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
    case "daily_closing.not_closed":
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
    eventType === "daily_closing.not_closed" ||
    eventType === "system.test"
  );
}

/**
 * Formats any canonical alert event into an executive, scannable, actionable WhatsApp card.
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
  const pharmacy = cleanMd(params.pharmacyName, "Pharmacy");
  const timeStr = fmtCompactDateTime(occurredAt, timezone);
  const str = (k: string, fb = "") => cleanMd(p[k], fb);
  const num = (k: string) => Number(p[k]) || 0;

  switch (eventType) {
    case "system.test":
      return buildTestMessageText(pharmacy, timezone);

    // =========================================================================
    // Inventory & Reorder Alerts
    // =========================================================================

    case "inventory.low_stock_summary":
    case "inventory.out_of_stock_summary": {
      const lowCount = Math.max(0, Math.round(num("lowStockCount")));
      const outCount = Math.max(0, Math.round(num("outOfStockCount")));
      const allItems = normalizeLowStockItems(p);
      const outItems = allItems.filter((it) => it.status === "out");
      const lowItems = allItems.filter((it) => it.status === "low");

      const MAX_VISIBLE = 5;
      let shownOut: WhatsAppLowStockAlertItem[] = [];
      let shownLow: WhatsAppLowStockAlertItem[] = [];

      if (outItems.length > 0 && lowItems.length > 0) {
        const outCap = Math.min(outItems.length, Math.max(3, MAX_VISIBLE - Math.min(2, lowItems.length)));
        shownOut = outItems.slice(0, outCap);
        shownLow = lowItems.slice(0, MAX_VISIBLE - shownOut.length);
      } else if (outItems.length > 0) {
        shownOut = outItems.slice(0, MAX_VISIBLE);
      } else {
        shownLow = lowItems.slice(0, MAX_VISIBLE);
      }

      const body: string[] = [];

      if (shownOut.length > 0) {
        const badgeCount = Math.max(outCount, outItems.length);
        body.push(`🔴 *Out of Stock (${badgeCount})*`);
        for (const it of shownOut) {
          body.push(`• *${it.name}* — 0 left`);
          if (it.supplierName) {
            body.push(`  ↳ Reorder from: *${it.supplierName}*`);
          }
        }
      } else if (outCount > 0) {
        body.push(`🔴 *Out of Stock:* ${outCount} item${outCount === 1 ? "" : "s"}`);
      }

      if (shownLow.length > 0) {
        if (body.length > 0) body.push("");
        const badgeCount = Math.max(lowCount, lowItems.length);
        body.push(`🟡 *Low Stock (${badgeCount})*`);
        for (const it of shownLow) {
          const minTag = it.reorderLevel ? ` _(Min: ${fmtNumber(it.reorderLevel)})_` : "";
          body.push(`• *${it.name}* — ${fmtQtyUnit(it.stock, it.unit)} left${minTag}`);
          if (it.supplierName) {
            body.push(`  ↳ Reorder from: *${it.supplierName}*`);
          }
        }
      } else if (lowCount > 0) {
        if (body.length > 0) body.push("");
        body.push(`🟡 *Low Stock:* ${lowCount} item${lowCount === 1 ? "" : "s"}`);
      }

      if (body.length === 0) {
        body.push("Inventory items are below reorder threshold.");
      }

      const totalFlagged = Math.max(outCount + lowCount, allItems.length);
      const totalShown = shownOut.length + shownLow.length;
      if (totalShown > 0 && totalFlagged > totalShown) {
        const remaining = totalFlagged - totalShown;
        body.push("", `_+${remaining} more item${remaining === 1 ? "" : "s"} in POS_`);
      }

      const heading =
        outCount > 0 && lowCount === 0
          ? "Out of Stock Alert"
          : "Low Stock & Reorder Alert";

      return buildCard({
        icon: outCount > 0 ? "⚠️" : "📦",
        heading,
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Open *Inventory → Reorder* to generate PO.",
      });
    }

    case "inventory.near_expiry_summary": {
      const nearCount = Math.max(0, Math.round(num("nearExpiryCount")));
      const expiredCount = Math.max(0, Math.round(num("expiredCount")));
      const items = normalizeNearExpiryItems(p, timezone);
      const shown = items.slice(0, 5);

      const summaryParts: string[] = [];
      if (expiredCount > 0) {
        summaryParts.push(`🔴 *${expiredCount} expired*`);
      }
      if (nearCount > 0) {
        summaryParts.push(`🟡 *${nearCount} expiring soon*`);
      }

      const body: string[] = [];
      if (summaryParts.length > 0) {
        body.push(summaryParts.join(" · "));
      } else {
        body.push("Stock batches require expiry attention.");
      }

      if (shown.length > 0) {
        body.push("");
        for (const it of shown) {
          const dot = it.daysLeft < 0 ? "🔴" : it.daysLeft <= 15 ? "🟠" : "🟡";
          const qtyText = it.qty > 0 ? ` — ${fmtQtyUnit(it.qty, it.unit)}` : "";
          body.push(`${dot} *${it.name}*${qtyText}`);

          const metaParts: string[] = [];
          if (it.batchNo && it.batchNo !== "—") {
            metaParts.push(`Batch *${it.batchNo}*`);
          }
          const timing =
            it.daysLeft < 0
              ? `*Expired ${Math.abs(it.daysLeft)}d ago*`
              : it.daysLeft === 0
                ? "*Expires today*"
                : `*${it.daysLeft}d left*`;
          const dateTag = it.expiryDate ? ` _(${fmtDayMonth(it.expiryDate, timezone)})_` : "";
          metaParts.push(`${timing}${dateTag}`);
          if (it.supplierName) {
            metaParts.push(`*${it.supplierName}*`);
          }
          body.push(`  ↳ ${metaParts.join(" · ")}`);
        }
      }

      const totalBatches = Math.max(nearCount + expiredCount, items.length);
      if (shown.length > 0 && totalBatches > shown.length) {
        const remaining = totalBatches - shown.length;
        body.push("", `_+${remaining} more batch${remaining === 1 ? "" : "es"} in POS_`);
      }

      return buildCard({
        icon: "⏳",
        heading: "Expiry Watch Alert",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Open *Inventory → Expiry* to return or clear stock.",
      });
    }

    case "inventory.major_stock_adjustment": {
      const delta = num("deltaBaseQty");
      const newStock = num("newStock");
      const unit = str("unit", "unit");
      const prevStock =
        typeof p.previousStock === "number" && Number.isFinite(p.previousStock)
          ? p.previousStock
          : Math.max(0, newStock - delta);
      const sign = delta >= 0 ? "+" : "";
      const reason = str("reason");

      const body = [
        `Item: *${str("productName", "Medicine")}*`,
        `Change: *${sign}${fmtQtyUnit(delta, unit)}* _(${fmtNumber(prevStock)} → ${fmtQtyUnit(newStock, unit)})_`,
        ...(reason ? [`Reason: _${reason}_`] : []),
        `By: *${str("operator", "Admin")}*`,
      ];

      return buildCard({
        icon: "📦",
        heading: "Major Stock Adjustment",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Review in *Inventory → Stock Ledger*.",
      });
    }

    // =========================================================================
    // Sales & Margin Alerts
    // =========================================================================

    case "sale.below_cost": {
      const loss = Math.abs(num("estimatedLoss"));
      const netSale = num("netSale");
      const customer = str("customerName");
      const invNo = str("invoiceNumber", "—");
      const invLine = customer ? `Invoice: *${invNo}* · *${customer}*` : `Invoice: *${invNo}*`;

      const body = [
        `Est. Loss: *-${fmtMoney(loss, currency)}* on *${fmtMoney(netSale, currency)}* sale`,
        invLine,
        `Cashier: *${str("operator", "Cashier")}*`,
      ];

      const rawAffected = Array.isArray(p.belowCostItems) ? p.belowCostItems : [];
      const affected = rawAffected
        .filter((x): x is WhatsAppSaleItemBrief => Boolean(x && typeof x === "object" && typeof (x as any).name === "string"))
        .slice(0, 4);

      if (affected.length > 0) {
        body.push("", "*Affected Items:*");
        for (const it of affected) {
          const qtyTag = it.qty && it.qty > 0 ? ` (${fmtQtyUnit(it.qty, it.unit)})` : "";
          const lossTag = it.loss && it.loss > 0 ? ` — Loss *${fmtMoney(it.loss, currency)}*` : "";
          body.push(`• *${cleanMd(it.name)}*${qtyTag}${lossTag}`);
        }
        if (rawAffected.length > affected.length) {
          body.push(`_+${rawAffected.length - affected.length} more item${rawAffected.length - affected.length === 1 ? "" : "s"} in POS_`);
        }
      }

      return buildCard({
        icon: "🚨",
        heading: "Below-Cost Sale Alert",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Check margin in *POS → Sales History*.",
      });
    }

    case "sale.large_discount": {
      const pct = num("discountPct").toFixed(1);
      const discAmt = num("discountAmount");
      const netSale = num("netSale");
      const subtotal = num("subtotal");
      const customer = str("customerName");
      const invNo = str("invoiceNumber", "—");
      const itemsPreview = formatItemBriefList(p.topItems, num("itemCount"), 2);

      const body = [
        `Discount: *${pct}%* (*${fmtMoney(discAmt, currency)}* off)`,
        subtotal > netSale
          ? `Net Sale: *${fmtMoney(netSale, currency)}* _(Subtotal: ${fmtMoney(subtotal, currency)})_`
          : `Net Sale: *${fmtMoney(netSale, currency)}*`,
        customer ? `Invoice: *${invNo}* · *${customer}*` : `Invoice: *${invNo}*`,
        ...(itemsPreview ? [`Items: ${itemsPreview}`] : []),
        `Cashier: *${str("operator", "Cashier")}*`,
      ];

      return buildCard({
        icon: "🏷️",
        heading: "Large Discount Alert",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Review in *POS → Sales History*.",
      });
    }

    case "sale.large": {
      const netSale = num("netSale");
      const payLabel = fmtPaymentMethod(p.paymentMethod, "Cash");
      const accountLabel = str("paymentAccountLabel");
      const payTag = accountLabel ? `${payLabel} · ${accountLabel}` : payLabel;
      const invNo = str("invoiceNumber", "—");
      const customer = str("customerName", "Walk-in");
      const saleMode = str("saleMode") === "wholesale" ? " · _Wholesale_" : "";
      const itemsPreview = formatItemBriefList(p.topItems, num("itemCount"), 2);

      const body = [
        `Net Sale: *${fmtMoney(netSale, currency)}* _(${payTag})_`,
        `Invoice: *${invNo}* · *${customer}*${saleMode}`,
        ...(itemsPreview ? [`Items: ${itemsPreview}`] : []),
        `Cashier: *${str("operator", "Cashier")}*`,
      ];

      return buildCard({
        icon: "💰",
        heading: "Large Sale Recorded",
        pharmacy,
        subMeta: timeStr,
        body,
      });
    }

    case "sale.large_return": {
      const refund = Math.abs(num("refundAmount"));
      const refundMethod = p.refundMethod ? ` _(${fmtPaymentMethod(p.refundMethod)})_` : "";
      const retNo = str("returnNumber", "—");
      const invNo = str("invoiceNumber", "Loose Return");
      const customer = str("customerName");
      const itemsPreview = formatItemBriefList(p.topItems, num("itemCount"), 2);
      const reason = str("reason", "Customer return");

      const body = [
        `Refund: *${fmtMoney(refund, currency)}*${refundMethod}`,
        `Return: *${retNo}* · Ref: *${invNo}*`,
        ...(customer && customer !== "Walk-in" ? [`Customer: *${customer}*`] : []),
        ...(itemsPreview ? [`Items: ${itemsPreview}`] : []),
        `Reason: _${reason}_`,
        `By: *${str("operator", "Cashier")}*`,
      ];

      return buildCard({
        icon: "↩️",
        heading: "Large Sales Return",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Verify restock in *POS → Sales Returns*.",
      });
    }

    // =========================================================================
    // Cash, Khata & Supplier Alerts
    // =========================================================================

    case "cash.issue": {
      const diff = num("difference");
      const isShortage = diff < 0;
      const isOverage = diff > 0;
      const heading = isShortage
        ? "Cash Drawer Shortage"
        : isOverage
          ? "Cash Drawer Overage"
          : "Cash Issue Detected";
      const operator = str("operator");
      const drawer = str("drawerName");
      const reason = str("reason");
      const byLine =
        operator && drawer
          ? `By: *${operator}* · _${drawer}_`
          : operator
            ? `By: *${operator}*`
            : drawer
              ? `Drawer: _${drawer}_`
              : "";

      const body = [
        str("summary", "Physical Cash variance detected."),
        `Expected: *${fmtMoney(num("expected"), currency)}* · Counted: *${fmtMoney(num("counted"), currency)}*`,
        `Difference: *${fmtSignedMoney(diff, currency)}*`,
        ...(reason ? [`Reason: _${reason}_`] : []),
        ...(byLine ? [byLine] : []),
      ];

      return buildCard({
        icon: isShortage ? "🚨" : "⚠️",
        heading,
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Review in *POS → Cashbook → Money Issues*.",
      });
    }

    case "cash.large_adjustment": {
      const amount = num("amount");
      const isExpense = p.entryKind === "expense" || amount < 0;
      const directionTag = isExpense ? "Expense" : "Inflow";
      const note = str("note");

      const body = [
        `Amount: *${fmtSignedMoney(amount, currency)}* _(${directionTag})_`,
        `Category: *${str("kind", "Cashbook Entry")}*`,
        `Account: *${str("accountName", "Physical Cash")}*`,
        ...(note ? [`Note: _${note}_`] : []),
        `By: *${str("operator", "Admin")}*`,
      ];

      return buildCard({
        icon: "💸",
        heading: "Large Cashbook Entry",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Review in *POS → Cashbook*.",
      });
    }

    case "customer.large_balance_adjustment": {
      const amount = num("amount");
      const note = str("note");

      const body = [
        `Customer: *${str("customerName", "Customer")}*`,
        `Amount: *${fmtMoney(amount, currency)}*`,
        `Type: *${str("adjustmentType", "Khata Adjustment")}*`,
        ...(note ? [`Note: _${note}_`] : []),
        `By: *${str("operator", "Admin")}*`,
      ];

      return buildCard({
        icon: "📒",
        heading: "Customer Khata Adjustment",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Review in *POS → Customers → Khata*.",
      });
    }

    case "supplier.large_payment": {
      const amount = Math.abs(num("amount"));
      const method = fmtPaymentMethod(p.method, "Cash");
      const account = str("accountName");
      const ref = str("reference");
      const grn = str("purchaseNumber");
      const note = str("note");
      const refParts = [ref ? `Ref: *${ref}*` : "", grn ? `GRN *${grn}*` : ""].filter(Boolean);

      const body = [
        `Supplier: *${str("supplierName", "Supplier")}*`,
        `Paid: *${fmtMoney(amount, currency)}* _(${method})_`,
        ...(account ? [`Account: *${account}*`] : []),
        ...(refParts.length > 0 ? [refParts.join(" · ")] : []),
        ...(note ? [`Note: _${note}_`] : []),
        `By: *${str("operator", "Admin")}*`,
      ];

      return buildCard({
        icon: "🏦",
        heading: "Large Supplier Payment",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 View ledger in *POS → Suppliers*.",
      });
    }

    // =========================================================================
    // Business Summaries
    // =========================================================================

    case "daily_closing.not_closed": {
      const dateLabel = fmtDateLabel(p.dateLabel ?? p.businessDate, occurredAt, timezone);
      return buildCard({
        icon: "🕒",
        heading: "Daily Closing Pending",
        pharmacy,
        subMeta: dateLabel,
        body: [
          "Today's daily closing has not been completed yet.",
          "Close today's shift to lock cash count and receive the final summary.",
        ],
        footer: "💡 Open *POS → Cashbook → Daily Closing*.",
      });
    }

    case "summary.daily": {
      const dateLabel = fmtDateLabel(p.dateLabel ?? p.businessDate, occurredAt, timezone);
      if (p.notClosedNotice === true) {
        return buildCard({
          icon: "🕒",
          heading: "Daily Closing Pending",
          pharmacy,
          subMeta: dateLabel,
          body: [
            "Today's daily closing has not been completed yet.",
            "Close today's shift to lock cash count and receive the final summary.",
          ],
          footer: "💡 Open *POS → Cashbook → Daily Closing*.",
        });
      }

      const netSales = num("netSales");
      const grossProfit = num("grossProfit");
      const marginTag =
        netSales > 0 ? ` _(${((grossProfit / netSales) * 100).toFixed(1)}%)_` : "";
      const invoiceCount = Math.round(num("invoiceCount"));
      const billsTag = invoiceCount > 0 ? ` _(${invoiceCount} bill${invoiceCount === 1 ? "" : "s"})_` : "";
      const expenses = num("expenses");
      const closedBy = str("closedBy");

      const body = [
        "*Sales & Profit*",
        `• Net Sales: *${fmtMoney(netSales, currency)}*${billsTag}`,
        `• Gross Profit: *${fmtMoney(grossProfit, currency)}*${marginTag}`,
        `• Cash: *${fmtMoney(num("cashSales"), currency)}* · Credit: *${fmtMoney(num("creditSales"), currency)}*`,
        `• Returns: *${fmtMoney(num("returns"), currency)}* · Purchases: *${fmtMoney(num("purchases"), currency)}*`,
        ...(expenses > 0 ? [`• Operating Expenses: *${fmtMoney(expenses, currency)}*`] : []),
        "",
        "*Cash & Balances*",
        `• Closing Cash: *${fmtMoney(num("closingCash"), currency)}*`,
        `• Receivables: *${fmtMoney(num("receivables"), currency)}* · Payables: *${fmtMoney(num("payables"), currency)}*`,
        ...buildStockHealthLines(p),
      ];

      return buildCard({
        icon: "📊",
        heading: "Daily Business Summary",
        pharmacy,
        subMeta: dateLabel,
        body,
        footer: closedBy ? `Closed by *${closedBy}* · _AivraSol POS_` : "_AivraSol Pharmacy POS_",
      });
    }

    case "summary.weekly": {
      const periodLabel = str("periodLabel", "Last 7 Days");
      const netSales = num("netSales");
      const grossProfit = num("grossProfit");
      const marginTag =
        netSales > 0 ? ` _(${((grossProfit / netSales) * 100).toFixed(1)}%)_` : "";
      const salesCount = Math.round(num("salesCount"));
      const billsTag = salesCount > 0 ? ` _(${salesCount} bills)_` : "";

      const body = [
        "*Performance*",
        `• Net Sales: *${fmtMoney(netSales, currency)}*${billsTag}`,
        `• Gross Profit: *${fmtMoney(grossProfit, currency)}*${marginTag}`,
        `• Expenses: *${fmtMoney(num("expenses"), currency)}* · Returns: *${fmtMoney(num("returns"), currency)}*`,
        `• *Net Profit: ${fmtMoney(num("netProfit"), currency)}*`,
        "",
        "*Procurement & Ledgers*",
        `• Purchases: *${fmtMoney(num("purchases"), currency)}*`,
        `• Receivables: *${fmtMoney(num("receivables"), currency)}* · Payables: *${fmtMoney(num("payables"), currency)}*`,
        ...buildStockHealthLines(p),
      ];

      return buildCard({
        icon: "📈",
        heading: "Weekly Business Summary",
        pharmacy,
        subMeta: periodLabel,
        body,
        footer: "_AivraSol Pharmacy POS_",
      });
    }

    case "summary.monthly": {
      const periodLabel = str("periodLabel", "Monthly Overview");
      const netSales = num("netSales");
      const grossProfit = num("grossProfit");
      const marginTag =
        netSales > 0 ? ` _(${((grossProfit / netSales) * 100).toFixed(1)}%)_` : "";
      const salesCount = Math.round(num("salesCount"));
      const billsTag = salesCount > 0 ? ` _(${salesCount} bills)_` : "";
      const receivables = num("receivables");
      const payables = num("payables");

      const body = [
        "*Performance*",
        `• Net Sales: *${fmtMoney(netSales, currency)}*${billsTag}`,
        `• Gross Profit: *${fmtMoney(grossProfit, currency)}*${marginTag}`,
        `• Expenses: *${fmtMoney(num("expenses"), currency)}* · Returns: *${fmtMoney(num("returns"), currency)}*`,
        `• *Net Profit: ${fmtMoney(num("netProfit"), currency)}*`,
        "",
        "*Procurement & Ledgers*",
        `• Purchases: *${fmtMoney(num("purchases"), currency)}*`,
        ...(receivables > 0 || payables > 0
          ? [`• Receivables: *${fmtMoney(receivables, currency)}* · Payables: *${fmtMoney(payables, currency)}*`]
          : []),
        ...buildStockHealthLines(p),
      ];

      return buildCard({
        icon: "📅",
        heading: "Monthly Business Summary",
        pharmacy,
        subMeta: periodLabel,
        body,
        footer: "_AivraSol Pharmacy POS_",
      });
    }

    // =========================================================================
    // Critical System, Backup, License & Security Alerts
    // =========================================================================

    case "license.expiring_soon": {
      const days = Math.max(0, Math.round(num("daysRemaining")));
      const dayLabel = days === 0 ? "*today*" : `in *${days} day${days === 1 ? "" : "s"}*`;
      const body = [
        `Your AivraSol POS license expires ${dayLabel}.`,
        ...(p.expiresAt ? [`Expiry Date: *${fmtShortDate(String(p.expiresAt), timezone)}*`] : []),
      ];

      return buildCard({
        icon: "🔔",
        heading: "License Expiring Soon",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Renew now to avoid billing interruption.",
      });
    }

    case "license.grace_entered": {
      const body = [
        "Your AivraSol POS license has entered its grace period.",
        ...(p.graceUntil ? [`Grace Ends: *${fmtShortDate(String(p.graceUntil), timezone)}*`] : []),
      ];

      return buildCard({
        icon: "🚨",
        heading: "License Grace Period Active",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Renew immediately to keep POS uninterrupted.",
      });
    }

    case "backup.failure_repeated": {
      const fails = Math.max(1, Math.round(num("consecutiveFailures")));
      const lastErr = str("lastError");
      const body = [
        `Cloud backup failed *${fails} consecutive time${fails === 1 ? "" : "s"}*.`,
        ...(lastErr ? [`Error: _${lastErr}_`] : []),
      ];

      return buildCard({
        icon: "🚨",
        heading: "Cloud Backup Failing",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Check internet & *Settings → Backup & Data*.",
      });
    }

    case "backup.restore_completed": {
      const source = str("source");
      const body = [
        "Pharmacy data was restored from an encrypted backup.",
        ...(source ? [`Source: *${source}*`] : []),
        `Restored By: *${str("operator", "Admin")}*`,
      ];

      return buildCard({
        icon: "⚠️",
        heading: "Backup Restore Completed",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Confirm latest sales & stock balances in POS.",
      });
    }

    case "sync.main_disconnected": {
      const terminal = str("terminalLabel");
      const body = [
        str("detail", "Client terminal lost connection to Main POS seat."),
        ...(terminal ? [`Terminal: *${terminal}*`] : []),
      ];

      return buildCard({
        icon: "⚠️",
        heading: "Main POS Sync Disconnected",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Check LAN / Wi-Fi on Main POS terminal.",
      });
    }

    case "security.failed_pin_attempts": {
      const attempts = Math.max(1, Math.round(num("attempts")));
      const target = str("operatorName");
      const terminal = str("terminalLabel");
      const body = [
        `Failed PIN Attempts: *${attempts}*`,
        ...(target ? [`Account: *${target}*`] : []),
        ...(terminal ? [`Terminal: *${terminal}*`] : []),
      ];

      return buildCard({
        icon: "🚨",
        heading: "Security Alert — Failed PINs",
        pharmacy,
        subMeta: timeStr,
        body,
        footer: "💡 Verify who is accessing the POS terminal.",
      });
    }

    case "fresh_start.requested":
      return buildCard({
        icon: "⚠️",
        heading: "Fresh Start Requested",
        pharmacy,
        subMeta: timeStr,
        body: [
          "A Fresh Start reset authorization was requested from Main POS.",
          `Requested By: *${str("operator", "Admin")}*`,
        ],
        footer: "💡 Approve or reject in *AivraSol Admin Portal*.",
      });

    case "fresh_start.executed":
      return buildCard({
        icon: "🚨",
        heading: "Fresh Start Executed",
        pharmacy,
        subMeta: timeStr,
        body: [
          "Training data reset completed with encrypted safety backup.",
          `Executed By: *${str("operator", "Admin")}*`,
        ],
        footer: "💡 Verify live opening cash & stock in POS.",
      });

    case "terminal.authorization_changed":
      return buildCard({
        icon: "🔐",
        heading: "Terminal Policy Updated",
        pharmacy,
        subMeta: timeStr,
        body: [
          str("detail", "A terminal seat or permission policy was updated."),
          `Updated By: *${str("operator", "Admin")}*`,
        ],
        footer: "💡 Review in *POS → Settings → Terminals*.",
      });

    default:
      return buildCard({
        icon: "🔔",
        heading: params.title || "POS Alert",
        pharmacy,
        subMeta: timeStr,
        body: ["Open *AivraSol Pharmacy POS* for details."],
      });
  }
}
