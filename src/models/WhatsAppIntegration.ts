import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type WhatsAppProviderId = "green-api";
export type WhatsAppPlanTier = "developer" | "business";
export type WhatsAppConnectionStatus =
  | "not_configured"
  | "waiting_for_qr"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface IWhatsAppEncryptedToken {
  encrypted_value: string;
  iv: string;
  tag: string;
  key_version: number;
}

export interface IWhatsAppRecipient {
  slot: "owner" | "manager" | "accountant" | "extra";
  label: string;
  phone: string;
  verified: boolean;
  verified_at?: Date | null;
  whatsapp_exists?: boolean | null;
}

export interface IWhatsAppNumberCheckCacheEntry {
  phone: string;
  exists: boolean;
  checked_at: Date;
}

export interface IWhatsAppAlertPreferences {
  // Critical Alerts
  licenseSystem: boolean;
  backupFailure: boolean;
  cashIssues: boolean;
  security: boolean;
  // Sales
  largeSales: boolean;
  largeDiscounts: boolean;
  belowCostSales: boolean;
  largeReturns: boolean;
  // Financial
  largeCashAdjustment: boolean;
  largeCustomerBalanceAdjustment: boolean;
  largeSupplierPayment: boolean;
  // Inventory
  lowStockSummary: boolean;
  nearExpirySummary: boolean;
  majorStockAdjustment: boolean;
  // Reports
  dailySummary: boolean;
  weeklySummary: boolean;
  monthlySummary: boolean;
}

export interface IWhatsAppAlertThresholds {
  largeSaleAmount: number;
  largeDiscountPct: number;
  belowCostLossAmount: number;
  largeReturnAmount: number;
  largeCashAdjustmentAmount: number;
  largeCustomerBalanceAdjustmentAmount: number;
  largeSupplierPaymentAmount: number;
  majorStockAdjustmentUnits: number;
  lowStockReminderHours: number;
}

export interface IWhatsAppAlertSchedule {
  dailySummaryAfterClosing: boolean;
  dailyFallbackTime: string; // HH:mm in pharmacy timezone
  sendDailyNotClosedNotice: boolean;
  weeklySummaryDay: number; // 0 = Sun ... 6 = Sat
  weeklySummaryTime: string; // HH:mm
  monthlySummaryDay: number; // 1..28
  lastDailySummaryDate?: string | null; // YYYY-MM-DD
  lastWeeklySummaryKey?: string | null; // YYYY-Www
  lastMonthlySummaryKey?: string | null; // YYYY-MM
}

export interface IWhatsAppIntegration extends Document {
  id: string;
  license_id: string;
  provider: WhatsAppProviderId;
  plan_tier: WhatsAppPlanTier;

  instance_id?: string | null;
  api_url?: string | null;
  encrypted_api_token?: IWhatsAppEncryptedToken | null;
  token_mask?: string | null;

  sender_number?: string | null;
  primary_recipient?: string | null;
  secondary_recipients: string[];
  recipients: IWhatsAppRecipient[];
  max_recipients: number;

  enabled: boolean;
  alerts_enabled_at?: Date | null;
  connection_status: WhatsAppConnectionStatus;
  raw_provider_state?: string | null;

  last_verified_at?: Date | null;
  last_successful_message_at?: Date | null;
  last_error?: string | null;
  last_error_code?: string | null;
  consecutive_failures: number;
  paused_until?: Date | null;

  timezone: string;
  currency: string;
  preferences: IWhatsAppAlertPreferences;
  thresholds: IWhatsAppAlertThresholds;
  schedule: IWhatsAppAlertSchedule;
  number_check_cache: IWhatsAppNumberCheckCacheEntry[];

  created_at: Date;
  updated_at: Date;
}

const EncryptedTokenSchema = new Schema<IWhatsAppEncryptedToken>(
  {
    encrypted_value: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    key_version: { type: Number, default: 1 },
  },
  { _id: false }
);

const RecipientSchema = new Schema<IWhatsAppRecipient>(
  {
    slot: {
      type: String,
      enum: ["owner", "manager", "accountant", "extra"],
      default: "owner",
    },
    label: { type: String, default: "Owner" },
    phone: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verified_at: { type: Date, default: null },
    whatsapp_exists: { type: Boolean, default: null },
  },
  { _id: false }
);

const NumberCheckCacheSchema = new Schema<IWhatsAppNumberCheckCacheEntry>(
  {
    phone: { type: String, required: true },
    exists: { type: Boolean, required: true },
    checked_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const WhatsAppIntegrationSchema = new Schema<IWhatsAppIntegration>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true, unique: true, index: true },
    provider: { type: String, enum: ["green-api"], default: "green-api" },
    plan_tier: { type: String, enum: ["developer", "business"], default: "developer" },

    instance_id: { type: String, default: null },
    api_url: { type: String, default: null },
    encrypted_api_token: { type: EncryptedTokenSchema, default: null },
    token_mask: { type: String, default: null },

    sender_number: { type: String, default: null },
    primary_recipient: { type: String, default: null },
    secondary_recipients: { type: [String], default: [] },
    recipients: { type: [RecipientSchema], default: [] },
    max_recipients: { type: Number, default: 3 },

    enabled: { type: Boolean, default: false },
    alerts_enabled_at: { type: Date, default: null },
    connection_status: {
      type: String,
      enum: ["not_configured", "waiting_for_qr", "connecting", "connected", "disconnected", "error"],
      default: "not_configured",
      index: true,
    },
    raw_provider_state: { type: String, default: null },

    last_verified_at: { type: Date, default: null },
    last_successful_message_at: { type: Date, default: null },
    last_error: { type: String, default: null },
    last_error_code: { type: String, default: null },
    consecutive_failures: { type: Number, default: 0 },
    paused_until: { type: Date, default: null },

    timezone: { type: String, default: "Asia/Karachi" },
    currency: { type: String, default: "Rs" },

    preferences: {
      licenseSystem: { type: Boolean, default: true },
      backupFailure: { type: Boolean, default: true },
      cashIssues: { type: Boolean, default: true },
      security: { type: Boolean, default: true },
      largeSales: { type: Boolean, default: true },
      largeDiscounts: { type: Boolean, default: true },
      belowCostSales: { type: Boolean, default: true },
      largeReturns: { type: Boolean, default: true },
      largeCashAdjustment: { type: Boolean, default: true },
      largeCustomerBalanceAdjustment: { type: Boolean, default: true },
      largeSupplierPayment: { type: Boolean, default: true },
      lowStockSummary: { type: Boolean, default: true },
      nearExpirySummary: { type: Boolean, default: true },
      majorStockAdjustment: { type: Boolean, default: true },
      dailySummary: { type: Boolean, default: true },
      weeklySummary: { type: Boolean, default: true },
      monthlySummary: { type: Boolean, default: false },
    },

    thresholds: {
      largeSaleAmount: { type: Number, default: 50000 },
      largeDiscountPct: { type: Number, default: 15 },
      belowCostLossAmount: { type: Number, default: 1000 },
      largeReturnAmount: { type: Number, default: 10000 },
      largeCashAdjustmentAmount: { type: Number, default: 5000 },
      largeCustomerBalanceAdjustmentAmount: { type: Number, default: 10000 },
      largeSupplierPaymentAmount: { type: Number, default: 50000 },
      majorStockAdjustmentUnits: { type: Number, default: 50 },
      lowStockReminderHours: { type: Number, default: 24 },
    },

    schedule: {
      dailySummaryAfterClosing: { type: Boolean, default: true },
      dailyFallbackTime: { type: String, default: "22:00" },
      sendDailyNotClosedNotice: { type: Boolean, default: false },
      weeklySummaryDay: { type: Number, default: 0 },
      weeklySummaryTime: { type: String, default: "20:00" },
      monthlySummaryDay: { type: Number, default: 1 },
      lastDailySummaryDate: { type: String, default: null },
      lastWeeklySummaryKey: { type: String, default: null },
      lastMonthlySummaryKey: { type: String, default: null },
    },

    number_check_cache: { type: [NumberCheckCacheSchema], default: [] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret: any) {
        delete ret._id;
        delete ret.__v;
        delete ret.encrypted_api_token;
        return ret;
      },
    },
  }
);

WhatsAppIntegrationSchema.set("toObject", { virtuals: true });

export default mongoose.models.WhatsAppIntegration ||
  mongoose.model<IWhatsAppIntegration>("WhatsAppIntegration", WhatsAppIntegrationSchema);
