import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IClient extends Document {
  id: string;
  name: string;
  status: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  notes?: string;
  location?: {
    lat?: number;
    lng?: number;
    city?: string;
    region?: string;
    country?: string;
    ip?: string;
    isp?: string;
    address?: string;
    source?: string;
    updated_at?: Date;
  };
  /**
   * IANA timezone string, e.g. "Asia/Karachi", "Asia/Dubai", "UTC".
   * Used by the portal dashboard to compute business-day date boundaries.
   * Portal ranges (Today, 7 Days, 30 Days) use this timezone.
   * POS event timestamps remain absolute UTC.
   */
  timezone: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

const ClientSchema = new Schema<IClient>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    name: { type: String, required: true },
    status: { type: String, default: "active" },
    contact_name: { type: String },
    contact_email: { type: String },
    contact_phone: { type: String },
    address: { type: String },
    notes: { type: String },
    location: {
      lat: { type: Number },
      lng: { type: Number },
      city: { type: String },
      region: { type: String },
      country: { type: String },
      ip: { type: String },
      isp: { type: String },
      address: { type: String },
      source: { type: String },
      updated_at: { type: Date },
    },
    timezone: { type: String, default: "Asia/Karachi" },
    created_by: { type: String },
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

// This ensures Mongoose doesn't try to use _id for population if we specifically link by string `id`
ClientSchema.set("toObject", { virtuals: true });

export default mongoose.models.Client || mongoose.model<IClient>("Client", ClientSchema);
