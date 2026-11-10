import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IStorefrontPairingCode extends Document {
  id: string;
  code: string;
  client_id: string;
  storefront_id: string;
  created_by: string;
  expires_at: Date;
  used_at?: Date | null;
  used_by_machine_id?: string | null;
  failed_attempts: number;
  created_at: Date;
}

const StorefrontPairingCodeSchema = new Schema<IStorefrontPairingCode>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    code: { type: String, required: true, unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    storefront_id: { type: String, required: true },
    created_by: { type: String, required: true },
    expires_at: { type: Date, required: true, index: { expires: 0 } },
    used_at: { type: Date, default: null },
    used_by_machine_id: { type: String, default: null },
    failed_attempts: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

export default mongoose.models.StorefrontPairingCode ||
  mongoose.model<IStorefrontPairingCode>("StorefrontPairingCode", StorefrontPairingCodeSchema);

