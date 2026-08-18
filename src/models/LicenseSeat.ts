import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicenseSeat extends Document {
  id: string;
  license_id: string;
  machine_id: string;
  hostname?: string;
  role: string;
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const LicenseSeatSchema = new Schema<ILicenseSeat>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true },
    machine_id: { type: String, required: true },
    hostname: { type: String },
    role: { type: String, default: "client" },
    first_seen_at: { type: Date, default: Date.now },
    last_seen_at: { type: Date, default: Date.now },
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

LicenseSeatSchema.set("toObject", { virtuals: true });

// A machine can only occupy one seat per license
LicenseSeatSchema.index({ license_id: 1, machine_id: 1 }, { unique: true });

export default mongoose.models.LicenseSeat || mongoose.model<ILicenseSeat>("LicenseSeat", LicenseSeatSchema);
