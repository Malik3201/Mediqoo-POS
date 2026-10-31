import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IAiUsageLog extends Document {
  id: string;
  request_id: string;
  license_id: string;
  client_id: string;
  pharmacy_name: string;
  seat_id?: string | null;
  terminal_number?: number | null;
  operator_id?: string | null;
  operator_role: string;
  request_type: string;
  language: "en" | "ur" | "roman_ur";
  model_used: string;
  credential_id?: string | null;
  credential_name?: string | null;
  organization_id?: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  status:
    | "success"
    | "rate_limited"
    | "quota_exceeded"
    | "auth_error"
    | "provider_error"
    | "blocked";
  http_status: number;
  error_code?: string | null;
  tool_calls_count: number;
  created_at: Date;
}

const AiUsageLogSchema = new Schema<IAiUsageLog>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    request_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },
    pharmacy_name: { type: String, default: "Pharmacy" },
    seat_id: { type: String, default: null },
    terminal_number: { type: Number, default: null },
    operator_id: { type: String, default: null },
    operator_role: { type: String, default: "cashier" },
    request_type: { type: String, default: "general_copilot", index: true },
    language: { type: String, enum: ["en", "ur", "roman_ur"], default: "en" },
    model_used: { type: String, required: true, index: true },
    credential_id: { type: String, default: null, index: true },
    credential_name: { type: String, default: null },
    organization_id: { type: String, default: null, index: true },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    cached_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    estimated_cost_usd: { type: Number, default: 0 },
    latency_ms: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "success",
        "rate_limited",
        "quota_exceeded",
        "auth_error",
        "provider_error",
        "blocked",
      ],
      default: "success",
      index: true,
    },
    http_status: { type: Number, default: 200 },
    error_code: { type: String, default: null },
    tool_calls_count: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
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

AiUsageLogSchema.index({ created_at: -1 });
// Operational metadata only (no prompts / answers). Auto-expire after 120 days.
AiUsageLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
AiUsageLogSchema.index({ license_id: 1, created_at: -1 });

export default mongoose.models.AiUsageLog ||
  mongoose.model<IAiUsageLog>("AiUsageLog", AiUsageLogSchema);

