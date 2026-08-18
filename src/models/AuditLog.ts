import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IAuditLog extends Document {
  id: string;
  action: string;
  actor_id?: string;
  actor_email?: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: any;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    action: { type: String, required: true },
    actor_id: { type: String },
    actor_email: { type: String },
    entity_type: { type: String },
    entity_id: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
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

AuditLogSchema.set("toObject", { virtuals: true });

export default mongoose.models.AuditLog || mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
