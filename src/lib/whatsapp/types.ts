import type {
  IWhatsAppAlertPreferences,
  IWhatsAppAlertSchedule,
  IWhatsAppAlertThresholds,
  WhatsAppConnectionStatus,
  WhatsAppPlanTier,
  WhatsAppProviderId,
} from "@/models/WhatsAppIntegration";

export type WhatsAppAlertEventType =
  // Critical / System
  | "license.expiring_soon"
  | "license.grace_entered"
  | "backup.failure_repeated"
  | "sync.main_disconnected"
  | "fresh_start.requested"
  | "fresh_start.executed"
  | "backup.restore_completed"
  | "terminal.authorization_changed"
  | "security.failed_pin_attempts"
  // Financial & Sales
  | "sale.large"
  | "sale.below_cost"
  | "sale.large_discount"
  | "sale.large_return"
  | "cash.issue"
  | "cash.large_adjustment"
  | "customer.large_balance_adjustment"
  | "supplier.large_payment"
  // Inventory
  | "inventory.low_stock_summary"
  | "inventory.out_of_stock_summary"
  | "inventory.near_expiry_summary"
  | "inventory.major_stock_adjustment"
  // Business Summary
  | "summary.daily"
  | "summary.weekly"
  | "summary.monthly"
  | "daily_closing.not_closed"
  // System Test
  | "system.test";

export type WhatsAppAlertSeverity = "critical" | "warning" | "info";

export interface WhatsAppLowStockAlertItem {
  name: string;
  stock: number;
  /** Legacy alias supported for backward compatibility */
  qty?: number;
  unit?: string;
  reorderLevel?: number;
  status: "out" | "low";
  supplierName?: string;
}

export interface WhatsAppNearExpiryAlertItem {
  name: string;
  batchNo?: string;
  qty: number;
  unit?: string;
  daysLeft: number;
  expiryDate?: string;
  /** Legacy alias supported for backward compatibility */
  expiry?: string;
  supplierName?: string;
}

export interface WhatsAppSaleItemBrief {
  name: string;
  qty?: number;
  unit?: string;
  loss?: number;
}

export interface IncomingWhatsAppAlertEvent {
  id: string;
  eventType: WhatsAppAlertEventType;
  eventKey: string;
  severity: WhatsAppAlertSeverity;
  title: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
  createdAt?: string;
  stateFingerprint?: string;
}

export const DEFAULT_WHATSAPP_PREFERENCES: IWhatsAppAlertPreferences = {
  licenseSystem: true,
  backupFailure: true,
  cashIssues: true,
  security: true,
  largeSales: true,
  largeDiscounts: true,
  belowCostSales: true,
  largeReturns: true,
  largeCashAdjustment: true,
  largeCustomerBalanceAdjustment: true,
  largeSupplierPayment: true,
  lowStockSummary: true,
  nearExpirySummary: true,
  majorStockAdjustment: true,
  dailySummary: true,
  weeklySummary: true,
  monthlySummary: false,
};

export const DEFAULT_WHATSAPP_THRESHOLDS: IWhatsAppAlertThresholds = {
  largeSaleAmount: 50000,
  largeDiscountPct: 15,
  belowCostLossAmount: 1000,
  largeReturnAmount: 10000,
  largeCashAdjustmentAmount: 5000,
  largeCustomerBalanceAdjustmentAmount: 10000,
  largeSupplierPaymentAmount: 50000,
  majorStockAdjustmentUnits: 50,
  lowStockReminderHours: 24,
};

export const DEFAULT_WHATSAPP_SCHEDULE: IWhatsAppAlertSchedule = {
  dailySummaryAfterClosing: true,
  dailyFallbackTime: "22:00",
  sendDailyNotClosedNotice: false,
  weeklySummaryDay: 0,
  weeklySummaryTime: "20:00",
  monthlySummaryDay: 1,
  lastDailySummaryDate: null,
  lastWeeklySummaryKey: null,
  lastMonthlySummaryKey: null,
};

export const DEVELOPER_MAX_RECIPIENTS = 3;
export const BUSINESS_MAX_RECIPIENTS = 25;

export interface SanitizedWhatsAppSettings {
  configured: boolean;
  provider: WhatsAppProviderId;
  planTier: WhatsAppPlanTier;
  maxRecipients: number;
  enabled: boolean;
  alertsEnabledAt: string | null;
  connectionStatus: WhatsAppConnectionStatus;
  statusMessage: string;

  apiUrl: string;
  instanceId: string;
  hasToken: boolean;
  tokenMask: string | null;

  senderNumber: string | null;
  maskedSenderNumber: string | null;
  primaryRecipient: string | null;
  secondaryRecipients: string[];
  recipients: Array<{
    slot: "owner" | "manager" | "accountant" | "extra";
    label: string;
    phone: string;
    verified: boolean;
    verifiedAt: string | null;
    whatsappExists: boolean | null;
  }>;

  timezone: string;
  currency: string;
  preferences: IWhatsAppAlertPreferences;
  thresholds: IWhatsAppAlertThresholds;
  schedule: IWhatsAppAlertSchedule;

  lastVerifiedAt: string | null;
  lastSuccessfulMessageAt: string | null;
  lastError: string | null;
  lastMessage: {
    id: string;
    eventType: string;
    title: string;
    status: string;
    maskedRecipient: string;
    sentAt: string | null;
    queuedAt: string;
    errorMessage: string | null;
  } | null;
}

export const ALL_VALID_ALERT_EVENT_TYPES = new Set<string>([
  "license.expiring_soon",
  "license.grace_entered",
  "backup.failure_repeated",
  "sync.main_disconnected",
  "fresh_start.requested",
  "fresh_start.executed",
  "backup.restore_completed",
  "terminal.authorization_changed",
  "security.failed_pin_attempts",
  "sale.large",
  "sale.below_cost",
  "sale.large_discount",
  "sale.large_return",
  "cash.issue",
  "cash.large_adjustment",
  "customer.large_balance_adjustment",
  "supplier.large_payment",
  "inventory.low_stock_summary",
  "inventory.out_of_stock_summary",
  "inventory.near_expiry_summary",
  "inventory.major_stock_adjustment",
  "summary.daily",
  "summary.weekly",
  "summary.monthly",
  "daily_closing.not_closed",
  "system.test",
]);
