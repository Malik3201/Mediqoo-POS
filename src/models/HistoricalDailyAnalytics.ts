import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * HistoricalDailyAnalytics — compact daily summary records from bootstrap.
 *
 * One record per (client_id, license_id, date).
 * Date is a local business-day string "YYYY-MM-DD" in the Client timezone.
 *
 * This collection is written ONCE during bootstrap and remains immutable.
 * Live events (from AnalyticsEvent) cover dates AFTER bootstrap_cutoff_date.
 * Dashboard queries split at the cutover boundary to avoid double-counting.
 *
 * Financial field semantics match the canonical analytics formulas:
 *   net_sales     = gross_sales - sales_returns
 *   net_cogs      = cogs - cogs_reversed
 *   gross_profit  = net_sales - net_cogs
 *   net_profit    = gross_profit - expenses
 *
 * Fields match IAnalyticsBootstrapDailySummary in the bootstrap request schema.
 */
export interface IHistoricalDailyAnalytics extends Document {
  id: string;
  client_id: string;
  license_id: string;
  date: string;           // "YYYY-MM-DD" — local business date in client timezone

  // Revenue
  gross_sales: number;
  discounts: number;
  tax: number;
  net_sales: number;

  // Returns
  sales_returns: number;  // total return amount
  cogs_reversed: number;  // COGS recovered on returns

  // COGS
  cogs: number;           // sale-time COGS (not reversed)

  // Profit
  gross_profit: number;   // net_sales - (cogs - cogs_reversed)

  // Expenses
  expenses: number;       // total non-payroll expenses for the day

  // Purchases
  purchases: number;      // purchase received total

  // Net
  net_profit: number;     // gross_profit - expenses

  created_at: Date;
  updated_at: Date;
}

const HistoricalDailyAnalyticsSchema = new Schema<IHistoricalDailyAnalytics>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    date: { type: String, required: true },  // "YYYY-MM-DD"

    gross_sales: { type: Number, default: 0 },
    discounts: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    net_sales: { type: Number, default: 0 },

    sales_returns: { type: Number, default: 0 },
    cogs_reversed: { type: Number, default: 0 },

    cogs: { type: Number, default: 0 },
    gross_profit: { type: Number, default: 0 },
    expenses: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    net_profit: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc: any, ret: Record<string, any>) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// One daily record per (client, license, local-date)
HistoricalDailyAnalyticsSchema.index(
  { client_id: 1, license_id: 1, date: 1 },
  { unique: true }
);

// Performance index for date-range queries
HistoricalDailyAnalyticsSchema.index({ client_id: 1, license_id: 1, date: -1 });

export default mongoose.models.HistoricalDailyAnalytics ||
  mongoose.model<IHistoricalDailyAnalytics>(
    "HistoricalDailyAnalytics",
    HistoricalDailyAnalyticsSchema
  );
