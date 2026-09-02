import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IClientTemplate extends Document {
  id: string;
  client_id: string;
  template_id: string;
  created_at: Date;
}

const ClientTemplateSchema = new Schema<IClientTemplate>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true },
    template_id: { type: String, required: true },
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

ClientTemplateSchema.set("toObject", { virtuals: true });

// Prevent duplicate template assignments to the same client
ClientTemplateSchema.index({ client_id: 1, template_id: 1 }, { unique: true });

export default mongoose.models.ClientTemplate || mongoose.model<IClientTemplate>("ClientTemplate", ClientTemplateSchema);
