import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicensePayment extends Document {
  id: string;
  client_id: string;
  license_id: string;
  billing_period_id: string;
  amount_paid: number;
  currency: string;
  paid_at: Date;
  payment_method?: string;
  payment_reference?: string;
  idempotency_key: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

const LicensePaymentSchema = new Schema<ILicensePayment>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    billing_period_id: { type: String, required: true, index: true },
    amount_paid: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "PKR" },
    paid_at: { type: Date, required: true, default: Date.now, index: true },
    payment_method: { type: String },
    payment_reference: { type: String },
    idempotency_key: { type: String, required: true },
    notes: { type: String },
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
