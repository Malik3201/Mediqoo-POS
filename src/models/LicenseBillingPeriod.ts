import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicenseBillingPeriod extends Document {
  id: string;
  client_id: string;
  license_id: string;
  period_start: Date;
  period_end: Date;
  due_at: Date;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: "unpaid" | "partially_paid" | "paid" | "overdue" | "waived";
  created_at: Date;
  updated_at: Date;
}

const LicenseBillingPeriodSchema = new Schema<ILicenseBillingPeriod>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    period_start: { type: Date, required: true },
    period_end: { type: Date, required: true },
    due_at: { type: Date, required: true, index: true },
    amount_due: { type: Number, required: true, min: 0 },
    amount_paid: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "PKR" },
    status: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid", "overdue", "waived"],
      default: "unpaid",
      index: true
    }
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

LicenseBillingPeriodSchema.set("toObject", { virtuals: true });
LicenseBillingPeriodSchema.index({ license_id: 1, period_start: 1, period_end: 1 }, { unique: true });

export default mongoose.models.LicenseBillingPeriod ||
  mongoose.model<ILicenseBillingPeriod>("LicenseBillingPeriod", LicenseBillingPeriodSchema);
