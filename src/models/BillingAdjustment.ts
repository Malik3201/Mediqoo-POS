import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * BillingAdjustment — immutable admin credit/debit/waiver record.
 *
 * Used for corrections, goodwill credits, and waivers.
 * Adjustments are NEVER edited or deleted after creation.
 * To reverse an adjustment, create a compensating entry (opposite type/amount).
 *
 * Outstanding is always DERIVED:
 *   charges (BillingUsage) + adjustments − payments (LicensePayment)
 */
export interface IBillingAdjustment extends Document {
  id: string;
  client_id: string;
  license_id: string;
  /** Optional: tie to a specific billing period. Null = general account level. */
  billing_period_id: string | null;
  type: "credit" | "debit" | "waiver";
  /** Positive amount. Sign is determined by type: credit reduces outstanding, debit increases it. */
  amount: number;
  currency: string;
  /** Mandatory description of why this adjustment was made */
  reason: string;
  /** Admin identity (email/name) from JWT — required */
  recorded_by: string;
  /** Optional: links to another adjustment if this is a reversal */
  reverses_adjustment_id: string | null;
  created_at: Date;
}

const BillingAdjustmentSchema = new Schema<IBillingAdjustment>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    billing_period_id: { type: String, default: null, index: true },
    type: { type: String, enum: ["credit", "debit", "waiver"], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "PKR" },
    reason: { type: String, required: true },
    recorded_by: { type: String, required: true },
    reverses_adjustment_id: { type: String, default: null },
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

BillingAdjustmentSchema.set("toObject", { virtuals: true });

// ── Query index: all adjustments for a license ──────────────────────────────
BillingAdjustmentSchema.index({ license_id: 1, created_at: 1 });

export default mongoose.models.BillingAdjustment ||
  mongoose.model<IBillingAdjustment>("BillingAdjustment", BillingAdjustmentSchema);
