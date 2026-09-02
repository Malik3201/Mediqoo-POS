import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IBusinessTemplate extends Document {
  id: string;
  name: string;
  slug: string;
  description?: string;
  version: string;
  is_active: boolean;
  modules: any;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

const BusinessTemplateSchema = new Schema<IBusinessTemplate>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    version: { type: String, default: "1.0.0" },
    is_active: { type: Boolean, default: true },
    modules: { type: Schema.Types.Mixed, default: {} },
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

BusinessTemplateSchema.set("toObject", { virtuals: true });

export default mongoose.models.BusinessTemplate || mongoose.model<IBusinessTemplate>("BusinessTemplate", BusinessTemplateSchema);
