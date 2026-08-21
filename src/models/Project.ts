import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IProject extends Document {
  id: string;
  client_id: string;
  template_id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  branding?: any;
  modules_config?: any;
  hardware_config?: any;
  notes?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true },
    template_id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    status: { type: String, default: "active" },
    branding: { type: Schema.Types.Mixed, default: {} },
    modules_config: { type: Schema.Types.Mixed, default: {} },
    hardware_config: { type: Schema.Types.Mixed, default: {} },
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

ProjectSchema.set("toObject", { virtuals: true });

export default mongoose.models.Project || mongoose.model<IProject>("Project", ProjectSchema);
