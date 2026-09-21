import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * BillingUsage — immutable per-invoice metering record.
 *
 * Created server-side when a POS client reports a finalized invoice.
 * Contains ONLY minimal billing metadata — NO medicine/customer/line-item data.
 *
 * Immutable after acceptance (no updates, no deletes).
 * Corrections use BillingAdjustment records.
 *
 * Unique index { license_id, invoice_uuid } guarantees exactly-once charging
 * across all terminals, LAN replications, and retry attempts.
 */
export interface IBillingUsage extends Document {
  id: string;
  client_id: string;
  license_id: string;
  /** POS invoice Row.id (UUID) — immutable idempotency key */
  invoice_uuid: string;
  /** Human-readable invoice number — display/debugging only, NOT authoritative */
  invoice_number_snapshot: string;
  /** seatId or machineId of the terminal that created the invoice */
  terminal_id: string;
  /** Human-readable terminal number (1, 2, 3…) — may be null for legacy seats */
  terminal_number: number | null;
  /** When the invoice was finalized on POS (from occurred_at in the usage event) */
  occurred_at: Date;
  /** When the server accepted this usage event */
  received_at: Date;
  /** Resolved billing cycle boundaries — from LicenseBillingPeriod */
  billing_period_id: string;
  billing_cycle_start: Date;
  billing_cycle_end: Date;
  /** Number of billable units (always 1 for per-invoice model) */
  unit_count: number;
  /** Rate resolved server-side from the billing period's rate_snapshot */
  rate_snapshot: number;
  /** Computed amount = unit_count × rate_snapshot */
  amount: number;
  created_at: Date;
}

const BillingUsageSchema = new Schema<IBillingUsage>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    invoice_uuid: { type: String, required: true },
    invoice_number_snapshot: { type: String, default: "" },
    terminal_id: { type: String, default: "" },
    terminal_number: { type: Number, default: null },
    occurred_at: { type: Date, required: true, index: true },
    received_at: { type: Date, required: true, default: Date.now },
    billing_period_id: { type: String, required: true, index: true },
    billing_cycle_start: { type: Date, required: true },
    billing_cycle_end: { type: Date, required: true },
    unit_count: { type: Number, required: true, default: 1, min: 1 },
    rate_snapshot: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

BillingUsageSchema.set("toObject", { virtuals: true });

// ── Primary deduplication index: exactly-once per invoice per license ────────
BillingUsageSchema.index({ license_id: 1, invoice_uuid: 1 }, { unique: true });

// ── Query index: all usage for a billing period ─────────────────────────────
BillingUsageSchema.index({ license_id: 1, billing_period_id: 1 });

// ── Query index: usage by cycle date range (for late-arrival resolution) ────
BillingUsageSchema.index({ license_id: 1, occurred_at: 1 });

export default mongoose.models.BillingUsage ||
  mongoose.model<IBillingUsage>("BillingUsage", BillingUsageSchema);
