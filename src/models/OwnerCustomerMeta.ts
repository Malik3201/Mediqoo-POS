import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type CustomerFollowUpStatus =
  | "none"
  | "promised_to_pay"
  | "follow_up_needed"
  | "disputed"
  | "vip";

export interface IOwnerCustomerMeta extends Document {
  id: string;
  client_id: string;
  customer_id: string;
  follow_up_status: CustomerFollowUpStatus;
  promised_date?: string;
  owner_note?: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

const OwnerCustomerMetaSchema = new Schema<IOwnerCustomerMeta>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    customer_id: { type: String, required: true },
    follow_up_status: {
      type: String,
      enum: ["none", "promised_to_pay", "follow_up_needed", "disputed", "vip"],
      default: "none",
    },
    promised_date: { type: String },
    owner_note: { type: String, maxlength: 1000 },
    updated_by: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

OwnerCustomerMetaSchema.index({ client_id: 1, customer_id: 1 }, { unique: true });

export default mongoose.models.OwnerCustomerMeta ||
  mongoose.model<IOwnerCustomerMeta>("OwnerCustomerMeta", OwnerCustomerMetaSchema);

