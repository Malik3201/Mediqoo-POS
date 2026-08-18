import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IReleaseInstall extends Document {
  id: string;
  release_id: string;
  license_id?: string;
  license_key?: string;
  machine_id?: string;
  version: string;
  status: string;
  error?: string;
  created_at: Date;
}

const ReleaseInstallSchema = new Schema<IReleaseInstall>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    release_id: { type: String, required: true },
    license_id: { type: String },
    license_key: { type: String },
    machine_id: { type: String },
    version: { type: String, required: true },
    status: { type: String, required: true },
    error: { type: String },
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

ReleaseInstallSchema.set("toObject", { virtuals: true });

export default mongoose.models.ReleaseInstall || mongoose.model<IReleaseInstall>("ReleaseInstall", ReleaseInstallSchema);
