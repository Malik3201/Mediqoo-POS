import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IRelease extends Document {
  id: string;
  version: string;
  mandatory: boolean;
  min_version?: string;
  rollout_type: string;
  status: string;
  changelog?: string;
  release_type?: string;
  asar_url?: string;
  full_package_url?: string;
  storage_path?: string;
  installer_size?: number;
  sha256?: string;
  published_at?: Date;
  created_by?: string;
  protected?: boolean;
  cleanup_approved?: boolean;
  storage_deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const ReleaseSchema = new Schema<IRelease>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    version: { type: String, required: true },
    mandatory: { type: Boolean, default: false },
    min_version: { type: String },
    rollout_type: { type: String, default: "all" },
    status: { type: String, default: "draft" },
    changelog: { type: String },
    release_type: { type: String, enum: ["hot", "full"], default: "hot" },
    asar_url: { type: String },
    full_package_url: { type: String },
    storage_path: { type: String },
    installer_size: { type: Number },
    sha256: { type: String },
    published_at: { type: Date },
    created_by: { type: String },
    protected: { type: Boolean, default: false },
    cleanup_approved: { type: Boolean, default: false },
    storage_deleted_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
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

ReleaseSchema.set("toObject", { virtuals: true });

export default mongoose.models.Release || mongoose.model<IRelease>("Release", ReleaseSchema);
