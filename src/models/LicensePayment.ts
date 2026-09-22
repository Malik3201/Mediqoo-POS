import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicensePayment extends Document {
  id: string;
  client_id: string;
  license_id: string;
  billing_period_id: string; // The primary period this payment applies to
  billing_period_ids?: string[]; // Array of period IDs allocated by this payment
  amount_paid: number;
  currency: string;
  paid_at: Date;
  payment_method?: string;
  payment_reference?: string;
  idempotency_key: string;
  notes?: string;
  /** Admin identity (email/name from JWT) who recorded this payment */
  recorded_by?: string;

  // Snapshot fields (immutable)
  usage_count_snapshot?: number;
  usage_amount_snapshot?: number;
  outstanding_before?: number;
  outstanding_after?: number;
  rate_snapshot?: number;
  receipt_number?: string;
  action?: string; // e.g. "payment_only" or "payment_and_renew"
  
  // Email delivery tracking
  email_status?: "pending" | "sent" | "failed";
  email_sent_at?: Date;
  email_error?: string;

  created_at: Date;
  updated_at: Date;
}

const LicensePaymentSchema = new Schema<ILicensePayment>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    billing_period_id: { type: String, required: true, index: true },
    billing_period_ids: { type: [String], default: [] },
    amount_paid: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "PKR" },
    paid_at: { type: Date, required: true, default: Date.now, index: true },
    payment_method: { type: String },
    payment_reference: { type: String },
    idempotency_key: { type: String, required: true },
    notes: { type: String },
    recorded_by: { type: String },
    
    // Snapshot fields
    usage_count_snapshot: { type: Number },
    usage_amount_snapshot: { type: Number },
    outstanding_before: { type: Number },
    outstanding_after: { type: Number },
    rate_snapshot: { type: Number },
    receipt_number: { type: String, index: true, unique: true, sparse: true },
    action: { type: String },
    
    // Email delivery
    email_status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
    email_sent_at: { type: Date },
    email_error: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
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

LicensePaymentSchema.set("toObject", { virtuals: true });
LicensePaymentSchema.index({ license_id: 1, idempotency_key: 1 }, { unique: true });

export default mongoose.models.LicensePayment ||
  mongoose.model<ILicensePayment>("LicensePayment", LicensePaymentSchema);
