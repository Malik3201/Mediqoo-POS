import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type WhatsAppDeliveryStatus =
  | "queued"
  | "sent"
  | "retry_scheduled"
  | "failed_permanent"
  | "ignored"
  | "stale_ignored"
  | "paused_disconnected";

export interface IWhatsAppAlertDelivery extends Document {
  id: string;
  license_id: string;
  event_id: string;
  event_type: string;
  event_key: string;
  dedupe_key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  reference_label?: string | null;

  recipient_phone: string;
  masked_recipient: string;
  provider: string;
  provider_message_id?: string | null;

  status: WhatsAppDeliveryStatus;
  attempts: number;
  next_attempt_at?: Date | null;
  error_code?: string | null;
  error_message?: string | null;

  /** Structured non-sensitive event payload retained only for pending retries / formatting; stripped once sent. */
  retry_payload?: Record<string, unknown> | null;
  pharmacy_name?: string | null;

  event_occurred_at: Date;
  queued_at: Date;
  sent_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const WhatsAppAlertDeliverySchema = new Schema<IWhatsAppAlertDelivery>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true, index: true },
    event_id: { type: String, required: true },
    event_type: { type: String, required: true, index: true },
    event_key: { type: String, required: true },
    dedupe_key: { type: String, required: true },
    severity: { type: String, enum: ["critical", "warning", "info"], default: "info" },
    title: { type: String, required: true },
    reference_label: { type: String, default: null },

    recipient_phone: { type: String, required: true },
    masked_recipient: { type: String, required: true },
    provider: { type: String, default: "green-api" },
    provider_message_id: { type: String, default: null },

    status: {
      type: String,
      enum: [
        "queued",
        "sent",
        "retry_scheduled",
        "failed_permanent",
        "ignored",
        "stale_ignored",
        "paused_disconnected",
      ],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    next_attempt_at: { type: Date, default: null, index: true },
    error_code: { type: String, default: null },
    error_message: { type: String, default: null },

    retry_payload: { type: Schema.Types.Mixed, default: null },
    pharmacy_name: { type: String, default: null },

    event_occurred_at: { type: Date, required: true },
    queued_at: { type: Date, default: Date.now },
    sent_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret: any) {
        delete ret._id;
        delete ret.__v;
        delete ret.recipient_phone;
        delete ret.retry_payload;
        return ret;
      },
    },
  }
);

// Prevent duplicate alert delivery for same license + dedupe_key
WhatsAppAlertDeliverySchema.index({ license_id: 1, dedupe_key: 1 }, { unique: true });
WhatsAppAlertDeliverySchema.index({ license_id: 1, queued_at: -1 });
WhatsAppAlertDeliverySchema.index({ status: 1, next_attempt_at: 1 });

export default mongoose.models.WhatsAppAlertDelivery ||
  mongoose.model<IWhatsAppAlertDelivery>("WhatsAppAlertDelivery", WhatsAppAlertDeliverySchema);
