import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * Shared Organization Quota Pool for Groq.
 *
 * CRITICAL RULE: Groq rate limits (RPM, RPD, TPM, TPD) apply at the
 * ORGANIZATION level, not individually per API key. Multiple keys belonging
 * to the same Groq organization share this single capacity & cooldown state.
 */
export interface IAiOrgPool extends Document {
  id: string;
  organization_id: string;
  organization_name: string;
  status: "Healthy" | "Rate Limited" | "Temporarily Unavailable" | "Needs Attention";
  rate_limited_until?: Date | null;
  circuit_open_until?: Date | null;
  consecutive_429s: number;
  consecutive_5xxs: number;
  in_flight_requests: number;
  day_key: string;
  daily_requests_used: number;
  daily_tokens_used: number;
  daily_request_limit: number;
  daily_token_limit: number;
  minute_window_key: string;
  minute_requests_used: number;
  minute_tokens_used: number;
  minute_request_limit: number;
  minute_token_limit: number;
  provider_remaining_requests?: number | null;
  provider_remaining_tokens?: number | null;
  provider_reset_requests_at?: Date | null;
  provider_reset_tokens_at?: Date | null;
  last_request_at?: Date | null;
  last_rate_limit_at?: Date | null;
  last_error?: string | null;
  created_at: Date;
  updated_at: Date;
}

const AiOrgPoolSchema = new Schema<IAiOrgPool>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    organization_id: { type: String, required: true, unique: true, index: true, trim: true },
    organization_name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["Healthy", "Rate Limited", "Temporarily Unavailable", "Needs Attention"],
      default: "Healthy",
    },
    rate_limited_until: { type: Date, default: null },
    circuit_open_until: { type: Date, default: null },
    consecutive_429s: { type: Number, default: 0 },
    consecutive_5xxs: { type: Number, default: 0 },
    in_flight_requests: { type: Number, default: 0 },
    day_key: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    daily_requests_used: { type: Number, default: 0 },
    daily_tokens_used: { type: Number, default: 0 },
    daily_request_limit: { type: Number, default: 14400 },
    daily_token_limit: { type: Number, default: 500000 },
    minute_window_key: { type: String, default: () => new Date().toISOString().slice(0, 16) },
    minute_requests_used: { type: Number, default: 0 },
    minute_tokens_used: { type: Number, default: 0 },
    minute_request_limit: { type: Number, default: 30 },
    minute_token_limit: { type: Number, default: 15000 },
    provider_remaining_requests: { type: Number, default: null },
    provider_remaining_tokens: { type: Number, default: null },
    provider_reset_requests_at: { type: Date, default: null },
    provider_reset_tokens_at: { type: Date, default: null },
    last_request_at: { type: Date, default: null },
    last_rate_limit_at: { type: Date, default: null },
    last_error: { type: String, default: null },
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

export default mongoose.models.AiOrgPool ||
  mongoose.model<IAiOrgPool>("AiOrgPool", AiOrgPoolSchema);

