import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IRelease extends Document {
  id: string;
  version: string;
  mandatory: boolean;
  min_version?: string;
  rollout_type: string;
  target_client_ids?: string[];
  is_prerelease?: boolean;
  disabled?: boolean;
  app_type?: "windows-pos" | "android-pos";
  platform?: "windows" | "android";
  channel?: "stable" | "beta" | "debug";
  release_seq?: number;
  package_id?: string;
  version_code?: number;
  min_native_version_code?: number;
  max_native_version_code?: number | null;
  min_web_version?: string | null;
  schema_version?: number;
  signing_cert_sha256?: string | null;
  status: string;
  changelog?: string;
  release_type?: "hot" | "full" | "web-bundle" | "apk";
  asar_url?: string;
  full_package_url?: string;
  bundle_url?: string;
  object_key?: string;
  storage_path?: string;
  installer_size?: number;
  sha256?: string;
  manifest_json?: string;
  manifest_signature?: string;
  manifest_key_id?: string;
  signature_status?: "signed" | "unsigned" | "failed";
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
    target_client_ids: { type: [String], default: [] },
    is_prerelease: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    app_type: {
      type: String,
      enum: ["windows-pos", "android-pos"],
      default: "windows-pos",
      index: true,
    },
    platform: {
      type: String,
      enum: ["windows", "android"],
      default: "windows",
      index: true,
    },
    channel: {
      type: String,
      enum: ["stable", "beta", "debug"],
      default: "stable",
      index: true,
    },
    release_seq: { type: Number },
    package_id: { type: String },
    version_code: { type: Number },
    min_native_version_code: { type: Number, default: 1 },
    max_native_version_code: { type: Number, default: null },
    min_web_version: { type: String, default: null },
    schema_version: { type: Number, default: 1 },
    signing_cert_sha256: { type: String, default: null },
    status: { type: String, default: "draft" },
    changelog: { type: String },
    release_type: {
      type: String,
      enum: ["hot", "full", "web-bundle", "apk"],
      default: "hot",
    },
    asar_url: { type: String },
    full_package_url: { type: String },
    bundle_url: { type: String },
    object_key: { type: String },
    storage_path: { type: String },
    installer_size: { type: Number },
    sha256: { type: String },
    manifest_json: { type: String },
    manifest_signature: { type: String },
    manifest_key_id: { type: String },
    signature_status: {
      type: String,
      enum: ["signed", "unsigned", "failed"],
      default: "unsigned",
    },
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

ReleaseSchema.index({ app_type: 1, platform: 1, release_type: 1, status: 1, channel: 1 });
ReleaseSchema.set("toObject", { virtuals: true });

export default mongoose.models.Release || mongoose.model<IRelease>("Release", ReleaseSchema);
