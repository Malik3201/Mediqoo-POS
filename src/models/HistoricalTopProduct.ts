import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * HistoricalTopProduct — aggregated top-product analytics from bootstrap.
 *
 * One record per (client_id, license_id, product_id).
 * Covers the entire bootstrap historical period (period_start to period_end).
 *
 * These records are combined with live AnalyticsEvent item aggregations in the
 * dashboard /api/portal/dashboard/top endpoint.
 *
 * Cutover: live events cover dates AFTER bootstrap_cutoff_date.
 * Historical top products cover up to and including bootstrap_cutoff_date.
 * Dashboard combines: historical totals + live item aggregations.
 *
 * product_id uniqueness: one record per product per license.
 * If POS sends the same bootstrap again (duplicate), the idempotency check at
 * the AnalyticsBootstrap level prevents this endpoint from re-processing.
 */
export interface IHistoricalTopProduct extends Document {
  id: string;
  client_id: string;
  license_id: string;
  product_id: string;
  product_name: string;
  period_start: string;   // "YYYY-MM-DD" — first date in historical period
  period_end: string;     // "YYYY-MM-DD" — last date in historical period (= cutoff_date)
  qty: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  created_at: Date;
  updated_at: Date;
}

const HistoricalTopProductSchema = new Schema<IHistoricalTopProduct>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    product_id: { type: String, required: true },
    product_name: { type: String, required: true },
    period_start: { type: String, required: true },
    period_end: { type: String, required: true },
    qty: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    cogs: { type: Number, default: 0 },
    gross_profit: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc: any, ret: Record<string, any>) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// One product record per license
HistoricalTopProductSchema.index(
  { client_id: 1, license_id: 1, product_id: 1 },
  { unique: true }
);

export default mongoose.models.HistoricalTopProduct ||
  mongoose.model<IHistoricalTopProduct>("HistoricalTopProduct", HistoricalTopProductSchema);
