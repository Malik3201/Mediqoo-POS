import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IAuditLog extends Document {
  id: string;
  action: string;
  actor_id?: string;
  actor_name?: string;
  actor_email?: string;
  actor_role?: string;
  entity_type?: string;
  entity_id?: string;
  summary?: string;
  metadata?: any;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    action: { type: String, required: true },
    actor_id: { type: String },
    actor_name: { type: String },
    actor_email: { type: String },
    actor_role: { type: String },
    entity_type: { type: String },
    entity_id: { type: String },
    summary: { type: String },
    metadata: { type: Schema.Types.Mixed },
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

AuditLogSchema.set("toObject", { virtuals: true });

export default mongoose.models.AuditLog || mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
