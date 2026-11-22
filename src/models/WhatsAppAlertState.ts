import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * Tracks stateful alert conditions per license (e.g. low-stock item or grouped stock snapshot)
 * so repeated alerts are suppressed while a condition stays unchanged, and re-armed only once
 * the condition recovers and occurs again (or after an explicit reminder window).
 */
export interface IWhatsAppAlertState extends Document {
  id: string;
  license_id: string;
  state_key: string;
  event_type: string;
  is_active: boolean;
  state_hash: string;
  last_alerted_at?: Date | null;
  recovered_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const WhatsAppAlertStateSchema = new Schema<IWhatsAppAlertState>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true },
    state_key: { type: String, required: true },
    event_type: { type: String, required: true },
    is_active: { type: Boolean, default: true },
    state_hash: { type: String, required: true },
    last_alerted_at: { type: Date, default: null },
    recovered_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

WhatsAppAlertStateSchema.index({ license_id: 1, state_key: 1 }, { unique: true });

export default mongoose.models.WhatsAppAlertState ||
  mongoose.model<IWhatsAppAlertState>("WhatsAppAlertState", WhatsAppAlertStateSchema);
