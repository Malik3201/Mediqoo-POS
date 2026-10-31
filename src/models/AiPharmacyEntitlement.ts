import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IAiPharmacyEntitlement extends Document {
  id: string;
  license_id: string;
  client_id: string;
  ai_enabled: boolean;
  allowed_models: string[];
  model_policy: "auto" | "fast_only" | "full_featured";
  daily_request_limit: number;
  monthly_request_limit: number;
  daily_token_limit: number;
  monthly_token_limit: number;
  max_output_tokens: number;
  concurrent_request_limit: number;
  advanced_copilot_enabled: boolean;
  purchase_preparation_enabled: boolean;
  allowed_roles: string[];
  promo_extra_requests: number;
  promo_extra_tokens: number;
  promo_expires_at?: Date | null;
  timezone: string;

  // Authoritative server-side quota & reservation counters
  day_key: string;
  month_key: string;
  daily_requests_used: number;
  monthly_requests_used: number;
  daily_tokens_used: number;
  monthly_tokens_used: number;
  reserved_requests: number;
  reserved_tokens: number;
  in_flight_requests: number;
  last_request_at?: Date | null;
  last_reset_at?: Date | null;
  last_adjustment_reason?: string | null;
  last_adjusted_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

const AiPharmacyEntitlementSchema = new Schema<IAiPharmacyEntitlement>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true, unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    ai_enabled: { type: Boolean, default: true },
    allowed_models: { type: [String], default: [] },
    model_policy: {
      type: String,
      enum: ["auto", "fast_only", "full_featured"],
      default: "auto",
    },
    daily_request_limit: { type: Number, default: 150, min: 0 },
    monthly_request_limit: { type: Number, default: 3000, min: 0 },
    daily_token_limit: { type: Number, default: 150000, min: 0 },
    monthly_token_limit: { type: Number, default: 3000000, min: 0 },
    max_output_tokens: { type: Number, default: 1536, min: 64, max: 4096 },
    concurrent_request_limit: { type: Number, default: 2, min: 1, max: 20 },
    advanced_copilot_enabled: { type: Boolean, default: true },
    purchase_preparation_enabled: { type: Boolean, default: true },
    allowed_roles: {
      type: [String],
      default: ["admin", "manager", "senior-cashier", "cashier"],
    },
    promo_extra_requests: { type: Number, default: 0, min: 0 },
    promo_extra_tokens: { type: Number, default: 0, min: 0 },
    promo_expires_at: { type: Date, default: null },
    timezone: { type: String, default: "Asia/Karachi" },

    day_key: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    month_key: { type: String, default: () => new Date().toISOString().slice(0, 7) },
    daily_requests_used: { type: Number, default: 0, min: 0 },
    monthly_requests_used: { type: Number, default: 0, min: 0 },
    daily_tokens_used: { type: Number, default: 0, min: 0 },
    monthly_tokens_used: { type: Number, default: 0, min: 0 },
    reserved_requests: { type: Number, default: 0, min: 0 },
    reserved_tokens: { type: Number, default: 0, min: 0 },
    in_flight_requests: { type: Number, default: 0, min: 0 },
    last_request_at: { type: Date, default: null },
    last_reset_at: { type: Date, default: null },
    last_adjustment_reason: { type: String, default: null },
    last_adjusted_by: { type: String, default: null },
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

export default mongoose.models.AiPharmacyEntitlement ||
  mongoose.model<IAiPharmacyEntitlement>("AiPharmacyEntitlement", AiPharmacyEntitlementSchema);

