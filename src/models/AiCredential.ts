import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type AiCredentialHealthStatus =
  | "Healthy"
  | "Rate Limited"
  | "Temporarily Unavailable"
  | "Invalid Credentials"
  | "Disabled"
  | "Needs Attention";

export interface IAiCredentialHealthEvent {
  timestamp: Date;
  status: AiCredentialHealthStatus;
  http_status?: number | null;
  latency_ms?: number | null;
  reason?: string | null;
}

export interface IAiCredential extends Document {
  id: string;
  name: string;
  provider: "groq";
  organization_id: string;
  organization_name: string;
  masked_key: string;
  key_fingerprint: string;
  encrypted_key: {
    encrypted_value: string;
    iv: string;
    tag: string;
    key_version: number;
  };
  enabled: boolean;
  weight: number;
  allowed_models: string[];
  admin_restriction: "none" | "fallback_only" | "test_only";
  status: AiCredentialHealthStatus;
  cooldown_until?: Date | null;
  last_success_at?: Date | null;
  last_failure_at?: Date | null;
  last_failure_reason?: string | null;
  last_http_status?: number | null;
  consecutive_failures: number;
  total_requests: number;
  total_failures: number;
  total_tokens: number;
  health_history: IAiCredentialHealthEvent[];
  created_by?: string;
  updated_by?: string;
  rotated_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const HealthEventSchema = new Schema<IAiCredentialHealthEvent>(
  {
    timestamp: { type: Date, default: Date.now },
    status: { type: String, required: true },
    http_status: { type: Number, default: null },
    latency_ms: { type: Number, default: null },
    reason: { type: String, default: null },
  },
  { _id: false }
);

const AiCredentialSchema = new Schema<IAiCredential>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    name: { type: String, required: true, trim: true },
    provider: { type: String, default: "groq", enum: ["groq"] },
    organization_id: { type: String, required: true, trim: true, index: true },
    organization_name: { type: String, required: true, trim: true },
    masked_key: { type: String, required: true },
    key_fingerprint: { type: String, required: true, index: true },
    encrypted_key: {
      type: new Schema(
        {
          encrypted_value: { type: String, required: true },
          iv: { type: String, required: true },
          tag: { type: String, required: true },
          key_version: { type: Number, default: 1 },
        },
        { _id: false }
      ),
      required: true,
      select: false,
    },
    enabled: { type: Boolean, default: true },
    weight: { type: Number, default: 100, min: 1, max: 1000 },
    allowed_models: { type: [String], default: [] },
    admin_restriction: {
      type: String,
      enum: ["none", "fallback_only", "test_only"],
      default: "none",
    },
    status: {
      type: String,
      enum: [
        "Healthy",
        "Rate Limited",
        "Temporarily Unavailable",
        "Invalid Credentials",
        "Disabled",
        "Needs Attention",
      ],
      default: "Healthy",
    },
    cooldown_until: { type: Date, default: null },
    last_success_at: { type: Date, default: null },
    last_failure_at: { type: Date, default: null },
    last_failure_reason: { type: String, default: null },
    last_http_status: { type: Number, default: null },
    consecutive_failures: { type: Number, default: 0 },
    total_requests: { type: Number, default: 0 },
    total_failures: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    health_history: { type: [HealthEventSchema], default: [] },
    created_by: { type: String },
    updated_by: { type: String },
    rotated_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        delete (ret as any).encrypted_key;
        delete (ret as any).key_fingerprint;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        delete (ret as any).encrypted_key;
        delete (ret as any).key_fingerprint;
        return ret;
      },
    },
  }
);

export default mongoose.models.AiCredential ||
  mongoose.model<IAiCredential>("AiCredential", AiCredentialSchema);

