import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IRenewalNotification extends Document {
  id: string;
  license_id: string;
  expiry_date: Date;
  reminder_day: number;
  recipient_type: "admin" | "client";
  recipient: string;
  status: "sending" | "sent" | "failed";
  attempt_count: number;
  last_attempt_at?: Date;
  last_error?: string;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const RenewalNotificationSchema = new Schema<IRenewalNotification>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true },
    expiry_date: { type: Date, required: true },
    reminder_day: { type: Number, required: true },
    recipient_type: { type: String, enum: ["admin", "client"], required: true },
    recipient: { type: String, required: true },
    status: { type: String, enum: ["sending", "sent", "failed"], default: "sending" },
    attempt_count: { type: Number, default: 0 },
    last_attempt_at: { type: Date },
    last_error: { type: String },
    sent_at: { type: Date },
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

// Idempotency constraint: A specific reminder (e.g. 1-day) for a specific expiry date
// can only have ONE unique notification document per recipient type.
RenewalNotificationSchema.index(
  { license_id: 1, expiry_date: 1, reminder_day: 1, recipient_type: 1 },
  { unique: true }
);

RenewalNotificationSchema.set("toObject", { virtuals: true });

export default mongoose.models.RenewalNotification ||
  mongoose.model<IRenewalNotification>("RenewalNotification", RenewalNotificationSchema);
