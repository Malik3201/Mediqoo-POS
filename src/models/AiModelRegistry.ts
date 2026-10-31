import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type AiModelUsagePolicy =
  | "all_queries"
  | "simple_only"
  | "complex_only"
  | "fallback_only";

export interface IAiModelRegistry extends Document {
  id: string;
  model_name: string;
  provider_model_id: string;
  provider: "groq";
  enabled: boolean;
  is_default: boolean;
  is_complex_default: boolean;
  is_fallback: boolean;
  context_window: number;
  supports_tools: boolean;
  supports_structured_json: boolean;
  max_output_tokens: number;
  usage_policy: AiModelUsagePolicy;
  cost_per_million_input_usd: number;
  availability: "unknown" | "available" | "unavailable";
  cost_per_million_output_usd: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_latency_ms: number;
  last_verified_at?: Date | null;
  last_error?: string | null;
  created_at: Date;
  updated_at: Date;
}

const AiModelRegistrySchema = new Schema<IAiModelRegistry>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    model_name: { type: String, required: true, trim: true },
    provider_model_id: { type: String, required: true, unique: true, trim: true, index: true },
    provider: { type: String, default: "groq", enum: ["groq"] },
    enabled: { type: Boolean, default: true },
    is_default: { type: Boolean, default: false },
    is_complex_default: { type: Boolean, default: false },
    is_fallback: { type: Boolean, default: false },
    context_window: { type: Number, default: 128000 },
    supports_tools: { type: Boolean, default: true },
    supports_structured_json: { type: Boolean, default: true },
    max_output_tokens: { type: Number, default: 1024, min: 64, max: 8192 },
    usage_policy: {
      type: String,
      enum: ["all_queries", "simple_only", "complex_only", "fallback_only"],
      default: "all_queries",
    },
    cost_per_million_input_usd: { type: Number, default: 0, min: 0 },
    availability: { type: String, enum: ["unknown", "available", "unavailable"], default: "unknown" },
    cost_per_million_output_usd: { type: Number, default: 0, min: 0 },
    total_requests: { type: Number, default: 0 },
    successful_requests: { type: Number, default: 0 },
    failed_requests: { type: Number, default: 0 },
    avg_latency_ms: { type: Number, default: 0 },
    last_verified_at: { type: Date, default: null },
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

export default mongoose.models.AiModelRegistry ||
  mongoose.model<IAiModelRegistry>("AiModelRegistry", AiModelRegistrySchema);

