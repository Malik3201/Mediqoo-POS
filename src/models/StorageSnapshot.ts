import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IStorageSnapshot extends Document {
  id: string;
  scanned_at: Date;
  triggered_by: string;
  bucket: string;
  budget_bytes: number;
  total_bytes: number;
  total_objects: number;
  reclaimable_bytes: number;
  reclaimable_objects: number;
  protected_backup_bytes: number;
  protected_backup_objects: number;
  protected_total_bytes: number;
  protected_total_objects: number;
  unclassified_bytes: number;
  unclassified_objects: number;
  multipart_uploads_count: number;
  db_mismatches_count: number;
  categories: Record<
    string,
    {
      count: number;
      bytes: number;
      protected_count: number;
      protected_bytes: number;
      reclaimable_count: number;
      reclaimable_bytes: number;
      review_count: number;
      review_bytes: number;
    }
  >;
  alerts: Array<{
    level: "info" | "warning" | "high" | "critical";
    code: string;
    title: string;
    message: string;
  }>;
  duration_ms: number;
}

const StorageSnapshotSchema = new Schema<IStorageSnapshot>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    scanned_at: { type: Date, default: Date.now, index: true },
    triggered_by: { type: String, default: "system" },
    bucket: { type: String, required: true },
    budget_bytes: { type: Number, required: true },
    total_bytes: { type: Number, required: true },
    total_objects: { type: Number, required: true },
    reclaimable_bytes: { type: Number, default: 0 },
    reclaimable_objects: { type: Number, default: 0 },
    protected_backup_bytes: { type: Number, default: 0 },
    protected_backup_objects: { type: Number, default: 0 },
    protected_total_bytes: { type: Number, default: 0 },
    protected_total_objects: { type: Number, default: 0 },
    unclassified_bytes: { type: Number, default: 0 },
    unclassified_objects: { type: Number, default: 0 },
    multipart_uploads_count: { type: Number, default: 0 },
    db_mismatches_count: { type: Number, default: 0 },
    categories: { type: Schema.Types.Mixed, default: {} },
    alerts: { type: Schema.Types.Mixed, default: [] },
    duration_ms: { type: Number, default: 0 },
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

export default mongoose.models.StorageSnapshot ||
  mongoose.model<IStorageSnapshot>("StorageSnapshot", StorageSnapshotSchema);

