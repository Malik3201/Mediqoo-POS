import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IStorageCleanupItem {
  key: string;
  category: string;
  size_bytes: number;
  policy: string;
  reason: string;
  owner_label?: string;
  status: "eligible" | "deleted" | "already_absent" | "skipped_protected" | "failed";
  error?: string;
}

export interface IStorageCleanupRun extends Document {
  id: string;
  mode: "dry_run" | "execute";
  trigger: "manual" | "cron_daily" | "cron_weekly" | "post_migration" | "threshold_auto";
  actor: {
    id: string;
    email: string;
  };
  status: "running" | "completed" | "failed";
  policies_applied: string[];
  candidates_count: number;
  reclaimable_bytes: number;
  deleted_count: number;
  deleted_bytes: number;
  failed_count: number;
  protected_excluded_count: number;
  db_reconciled_count: number;
  multipart_aborted_count: number;
  items: IStorageCleanupItem[];
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  error_message?: string;
}

const StorageCleanupRunSchema = new Schema<IStorageCleanupRun>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    mode: { type: String, enum: ["dry_run", "execute"], required: true, index: true },
    trigger: {
      type: String,
      enum: ["manual", "cron_daily", "cron_weekly", "post_migration", "threshold_auto"],
      default: "manual",
    },
    actor: {
      id: { type: String, required: true },
      email: { type: String, required: true },
    },
    status: { type: String, enum: ["running", "completed", "failed"], default: "running", index: true },
    policies_applied: { type: [String], default: [] },
    candidates_count: { type: Number, default: 0 },
    reclaimable_bytes: { type: Number, default: 0 },
    deleted_count: { type: Number, default: 0 },
    deleted_bytes: { type: Number, default: 0 },
    failed_count: { type: Number, default: 0 },
    protected_excluded_count: { type: Number, default: 0 },
    db_reconciled_count: { type: Number, default: 0 },
    multipart_aborted_count: { type: Number, default: 0 },
    items: { type: Schema.Types.Mixed, default: [] },
    started_at: { type: Date, default: Date.now, index: true },
    completed_at: { type: Date },
    duration_ms: { type: Number },
    error_message: { type: String },
  },
  {
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret: any) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export default mongoose.models.StorageCleanupRun ||
  mongoose.model<IStorageCleanupRun>("StorageCleanupRun", StorageCleanupRunSchema);

