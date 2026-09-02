import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IUserRole extends Document {
  id: string;
  user_id: string;
  role: string;
  created_at: Date;
}

const UserRoleSchema = new Schema<IUserRole>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    user_id: { type: String, required: true },
    role: { type: String, required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
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

UserRoleSchema.set("toObject", { virtuals: true });

// Prevent duplicate roles for the same user
UserRoleSchema.index({ user_id: 1, role: 1 }, { unique: true });

export default mongoose.models.UserRole || mongoose.model<IUserRole>("UserRole", UserRoleSchema);
