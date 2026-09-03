import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicense extends Document {
  id: string;
  client_id: string;
  project_id: string;
  license_key: string;
  seats: number;
  status: string;
  features: any;
  issued_at: Date;
  expires_at?: Date;
  revoked_at?: Date;
  revoked_reason?: string;
  machine_fingerprint?: string;
  notes?: string;
  issued_by?: string;
  license_version: number;
  grace_until?: Date;
  billing?: {
    enabled: boolean;
    amount?: number;
    currency: string;
    cycle?: "monthly" | "yearly";
    grace_days: number;
    reminder_days: number[];
  };
  created_at: Date;
  updated_at: Date;
}

const LicenseSchema = new Schema<ILicense>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true },
    project_id: { type: String, required: true },
    license_key: { type: String, required: true, unique: true },
    seats: { type: Number, default: 1 },
    status: { type: String, default: "active" },
    features: { type: Schema.Types.Mixed, default: {} },
    issued_at: { type: Date, default: Date.now },
    expires_at: { type: Date },
    revoked_at: { type: Date },
    revoked_reason: { type: String },
    machine_fingerprint: { type: String },
    notes: { type: String },
    issued_by: { type: String },
    license_version: { type: Number, default: 1 },
    grace_until: { type: Date },
    billing: {
      enabled: { type: Boolean, default: false },
      amount: { type: Number },
      currency: { type: String, default: "PKR" },
      cycle: { type: String, enum: ["monthly", "yearly"] },
      grace_days: { type: Number, default: 3 },
      reminder_days: { type: [Number], default: [1] }
    },
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

LicenseSchema.virtual('clients', {
  ref: 'Client',
  localField: 'client_id',
  foreignField: 'id',
  justOne: true
});

LicenseSchema.virtual('projects', {
  ref: 'Project',
  localField: 'project_id',
  foreignField: 'id',
  justOne: true
});

function shouldIncrementVersion(update: any) {
  if (!update) return false;
  // If the update already explicitly increments or sets license_version, don't double-increment
  if (update.$inc?.license_version || update.$set?.license_version !== undefined) return false;

  const setObj = update.$set || {};
  const unsetObj = update.$unset || {};

  const sensitiveFields = ["status", "expires_at", "grace_until", "seats", "features", "revoked_at"];
  return sensitiveFields.some(field => setObj[field] !== undefined || unsetObj[field] !== undefined);
}

LicenseSchema.pre("findOneAndUpdate", function () {
  const update = this.getUpdate() as any;
  if (shouldIncrementVersion(update)) {
    this.setUpdate({ ...update, $inc: { ...(update.$inc || {}), license_version: 1 } });
  }
});

LicenseSchema.pre("updateOne", function () {
  const update = this.getUpdate() as any;
  if (shouldIncrementVersion(update)) {
    this.setUpdate({ ...update, $inc: { ...(update.$inc || {}), license_version: 1 } });
  }
});

LicenseSchema.pre("save", function () {
  if (
    this.isModified("status") ||
    this.isModified("expires_at") ||
    this.isModified("grace_until") ||
    this.isModified("seats") ||
    this.isModified("features") ||
    this.isModified("revoked_at")
  ) {
    if (!this.isNew && !this.isModified("license_version")) {
      this.license_version = (this.license_version || 1) + 1;
    }
  }
});

export default mongoose.models.License || mongoose.model<ILicense>("License", LicenseSchema);
