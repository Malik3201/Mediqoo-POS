import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IProfile extends Document {
  id: string; // Same as the User's ID in Auth
  name: string;
  email: string;
  password_hash?: string;
  status?: "active" | "disabled";
  created_by?: string;
  created_by_name?: string;
  last_login_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const ProfileSchema = new Schema<IProfile>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password_hash: { type: String },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    created_by: { type: String },
    created_by_name: { type: String },
    last_login_at: { type: Date, default: null },
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

ProfileSchema.set("toObject", { virtuals: true });

export default mongoose.models.Profile || mongoose.model<IProfile>("Profile", ProfileSchema);
