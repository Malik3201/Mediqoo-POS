import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IPackage extends Document {
  id: string;
  project_id: string;
  license_id?: string;
  version: string;
  filename: string;
  size_bytes: number;
  checksum_sha256: string;
  signature: string;
  public_key: string;
  notes?: string;
  created_by?: string;
  created_at: Date;
}

const PackageSchema = new Schema<IPackage>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    project_id: { type: String, required: true },
    license_id: { type: String },
    version: { type: String, required: true },
    filename: { type: String, required: true },
    size_bytes: { type: Number, required: true },
    checksum_sha256: { type: String, required: true },
    signature: { type: String, required: true },
    public_key: { type: String, required: true },
    notes: { type: String },
    created_by: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

PackageSchema.set("toObject", { virtuals: true });

export default mongoose.models.Package || mongoose.model<IPackage>("Package", PackageSchema);
