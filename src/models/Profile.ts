import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IProfile extends Document {
  id: string; // Same as the User's ID in Auth
  name: string;
  email: string;
  password_hash?: string;
  created_at: Date;
  updated_at: Date;
}

const ProfileSchema = new Schema<IProfile>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password_hash: { type: String },
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
