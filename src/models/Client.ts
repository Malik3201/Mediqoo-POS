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
    created_by: { type: String },
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

// This ensures Mongoose doesn't try to use _id for population if we specifically link by string `id`
ClientSchema.set("toObject", { virtuals: true });

export default mongoose.models.Client || mongoose.model<IClient>("Client", ClientSchema);
