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
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
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

export default mongoose.models.License || mongoose.model<ILicense>("License", LicenseSchema);
