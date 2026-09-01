import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type PortalUserRole = "owner" | "manager" | "viewer";
export type PortalUserStatus = "invited" | "active" | "disabled";

export interface IPortalUser extends Document {
  id: string;
  client_id: string;          // FK → Client.id — ALWAYS resolved server-side
  name: string;
  email: string;
  password_hash?: string;     // null until invite is accepted and password is set
  role: PortalUserRole;
  status: PortalUserStatus;
  login_attempts: number;     // consecutive failed login attempts (rate limiting)
  locked_until?: Date;        // login locked until this time (backoff)
  last_login_at?: Date;
  created_by?: string;        // admin user id who created this
  created_at: Date;
  updated_at: Date;
}

const PortalUserSchema = new Schema<IPortalUser>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: { type: String, select: false }, // excluded from default projections
    role: {
      type: String,
      enum: ["owner", "manager", "viewer"],
      default: "owner",
      required: true,
    },
    status: {
      type: String,
      enum: ["invited", "active", "disabled"],
      default: "invited",
      required: true,
    },
    login_attempts: { type: Number, default: 0 },
    locked_until: { type: Date },
    last_login_at: { type: Date },
    created_by: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        delete ret.password_hash; // NEVER leak password_hash in JSON
        delete ret.login_attempts;
        delete ret.locked_until;
        return ret;
      },
    },
  }
);

PortalUserSchema.set("toObject", { virtuals: true });

export default mongoose.models.PortalUser ||
  mongoose.model<IPortalUser>("PortalUser", PortalUserSchema);
