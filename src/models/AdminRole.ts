import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IAdminRole extends Document {
  id: string;
  slug: string;
  name: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  created_by?: string;
  created_by_name?: string;
  created_at: Date;
  updated_at: Date;
}

const AdminRoleSchema = new Schema<IAdminRole>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    permissions: { type: [String], default: [] },
    is_system: { type: Boolean, default: false },
    created_by: { type: String },
    created_by_name: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

AdminRoleSchema.set("toObject", { virtuals: true });

export default mongoose.models.AdminRole || mongoose.model<IAdminRole>("AdminRole", AdminRoleSchema);
