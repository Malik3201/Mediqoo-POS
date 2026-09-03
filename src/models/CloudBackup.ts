import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ICloudBackup extends Document {
  id: string;
  client_id: string;
  license_id: string;
  backup_type: "manual" | "day_end" | "weekly" | "month_end";
  period_key?: string;
  status: "pending_upload" | "uploaded" | "failed" | "deleted";
  object_key: string;
  original_filename: string;
  format: "aivrasol-backup";
  backup_version: number;
  app_version?: string;
  schema_version?: number;
  created_at: Date;
  uploaded_at?: Date;
  size_bytes?: number;
  checksum_sha256?: string;
  terminal_role?: "main" | "child";
  terminal_number?: number;
  source_created_at?: Date;
  failure_reason?: string;
  deleted_at?: Date;
}

const CloudBackupSchema = new Schema<ICloudBackup>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true },
    license_id: { type: String, required: true },
    backup_type: { 
      type: String, 
      enum: ["manual", "day_end", "weekly", "month_end"], 
      required: true 
    },
    period_key: { type: String },
    status: { 
      type: String, 
      enum: ["pending_upload", "uploaded", "failed", "deleted"], 
      default: "pending_upload" 
    },
    object_key: { type: String, required: true },
    original_filename: { type: String, required: true },
    format: { type: String, enum: ["aivrasol-backup"], required: true },
    backup_version: { type: Number, required: true },
    app_version: { type: String },
    schema_version: { type: Number },
    created_at: { type: Date, default: Date.now },
    uploaded_at: { type: Date },
    size_bytes: { type: Number },
    checksum_sha256: { type: String },
    terminal_role: { type: String, enum: ["main", "child"] },
    terminal_number: { type: Number },
    source_created_at: { type: Date },
    failure_reason: { type: String },
    deleted_at: { type: Date },
  },
  {
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// General Query Indexes
CloudBackupSchema.index({ client_id: 1, created_at: -1 });
CloudBackupSchema.index({ license_id: 1, created_at: -1 });
CloudBackupSchema.index({ status: 1, uploaded_at: -1 });

// Partial Unique Index for Scheduled Backup Idempotency
CloudBackupSchema.index(
  { license_id: 1, backup_type: 1, period_key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      backup_type: { $in: ["day_end", "weekly", "month_end"] },
      period_key: { $exists: true, $type: "string" }
    }
  }
);

export default mongoose.models.CloudBackup || mongoose.model<ICloudBackup>("CloudBackup", CloudBackupSchema);
