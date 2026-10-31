import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type AiAlertType =
  | "api_key_invalid"
  | "repeated_auth_failures"
  | "sustained_rate_limiting"
  | "provider_capacity_exhausted"
  | "all_pools_unavailable"
  | "unusual_token_consumption"
  | "pharmacy_quota_exceeded"
  | "high_error_rate"
  | "gateway_unavailable"
  | "suspicious_credential_activity";

export type AiAlertSeverity = "critical" | "warning" | "info";
export type AiAlertStatus = "active" | "acknowledged" | "resolved";

export interface IAiAlert extends Document {
  id: string;
  dedup_key: string;
  alert_type: AiAlertType;
  severity: AiAlertSeverity;
  title: string;
  reason: string;
  recommended_action: string;
  affected_entity_type: "credential" | "org_pool" | "pharmacy" | "gateway";
  affected_entity_id: string;
  affected_entity_name: string;
  status: AiAlertStatus;
  occurrence_count: number;
  first_detected_at: Date;
  last_detected_at: Date;
  cooldown_until: Date;
  acknowledged_at?: Date | null;
  acknowledged_by?: string | null;
  resolved_at?: Date | null;
  resolved_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

const AiAlertSchema = new Schema<IAiAlert>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    dedup_key: { type: String, required: true, index: true },
    alert_type: {
      type: String,
      enum: [
        "api_key_invalid",
        "repeated_auth_failures",
        "sustained_rate_limiting",
        "provider_capacity_exhausted",
        "all_pools_unavailable",
        "unusual_token_consumption",
        "pharmacy_quota_exceeded",
        "high_error_rate",
        "gateway_unavailable",
        "suspicious_credential_activity",
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["critical", "warning", "info"],
      default: "warning",
      index: true,
    },
    title: { type: String, required: true },
    reason: { type: String, required: true },
    recommended_action: { type: String, required: true },
    affected_entity_type: {
      type: String,
      enum: ["credential", "org_pool", "pharmacy", "gateway"],
      default: "gateway",
    },
    affected_entity_id: { type: String, required: true },
    affected_entity_name: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "acknowledged", "resolved"],
      default: "active",
      index: true,
    },
    occurrence_count: { type: Number, default: 1 },
    first_detected_at: { type: Date, default: Date.now },
    last_detected_at: { type: Date, default: Date.now },
    cooldown_until: { type: Date, default: Date.now },
    acknowledged_at: { type: Date, default: null },
    acknowledged_by: { type: String, default: null },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: String, default: null },
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

AiAlertSchema.index({ status: 1, last_detected_at: -1 });

export default mongoose.models.AiAlert ||
  mongoose.model<IAiAlert>("AiAlert", AiAlertSchema);

