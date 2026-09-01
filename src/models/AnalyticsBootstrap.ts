import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * AnalyticsBootstrap — tracks one-time historical analytics bootstrap per License.
 *
 * Idempotency:
 *   Unique index on { license_id, bootstrap_version } prevents duplicate bootstraps.
 *   If same (license_id, bootstrap_version) is submitted again → already_completed response.
 *   Version 1 is the initial bootstrap.
 *
 * Single-terminal rule:
 *   First valid submission for a license_id+version wins.
 *   All subsequent terminals submitting same license+version get already_completed.
 *   This prevents Terminal 1 + Terminal 2 from doubling historical totals.
 *
 * Cutover strategy:
 *   bootstrap_cutoff_date: the LAST local business date included in the bootstrap.
 *   Example: "2026-08-31" means:
 *     - Historical data: HistoricalDailyAnalytics for dates <= "2026-08-31"
 *     - Live data: AnalyticsEvent.occurred_at >= start of "2026-09-01" in client timezone (UTC-stored)
 *   bootstrap_cutoff_utc: precomputed UTC boundary = start of (cutoff_date + 1 day) in client timezone.
 *   Dashboard query splits at this boundary to avoid double-counting.
 */
export type BootstrapStatus = "completed" | "failed";

export interface IAnalyticsBootstrap extends Document {
  id: string;
  client_id: string;
  project_id: string;
  license_id: string;
  seat_id?: string;
  terminal_number?: number;
  bootstrap_version: number;
  status: BootstrapStatus;
  bootstrap_cutoff_date: string;    // "YYYY-MM-DD" local business date (last date covered)
  bootstrap_cutoff_utc: Date;       // UTC boundary: start of (cutoff_date + 1 day) in client timezone
  daily_records_count: number;      // how many daily records were ingested
  top_products_count: number;       // how many top product records were ingested
  recent_sales_count: number;       // how many recent sale records were stored
  has_inventory_snapshot: boolean;
  generated_at?: Date;              // when POS generated the bootstrap
  started_at: Date;
  completed_at: Date;
  created_at: Date;
  updated_at: Date;
}

const AnalyticsBootstrapSchema = new Schema<IAnalyticsBootstrap>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    project_id: { type: String, required: true },
    license_id: { type: String, required: true },
    seat_id: { type: String },
    terminal_number: { type: Number },
    bootstrap_version: { type: Number, required: true, default: 1 },
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
    bootstrap_cutoff_date: { type: String, required: true },
    bootstrap_cutoff_utc: { type: Date, required: true },
    daily_records_count: { type: Number, default: 0 },
    top_products_count: { type: Number, default: 0 },
    recent_sales_count: { type: Number, default: 0 },
    has_inventory_snapshot: { type: Boolean, default: false },
    generated_at: { type: Date },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Core idempotency: one bootstrap per (license, version)
AnalyticsBootstrapSchema.index(
  { license_id: 1, bootstrap_version: 1 },
  { unique: true }
);

export default mongoose.models.AnalyticsBootstrap ||
  mongoose.model<IAnalyticsBootstrap>("AnalyticsBootstrap", AnalyticsBootstrapSchema);
