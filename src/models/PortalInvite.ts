import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IPortalInvite extends Document {
  id: string;
  token_hash: string;       // SHA-256 of the raw token — raw token goes to email only
  portal_user_id: string;   // FK → PortalUser.id
  expires_at: Date;         // 7 days from creation
  used_at?: Date;           // null until accepted
  created_at: Date;
}

const PortalInviteSchema = new Schema<IPortalInvite>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    portal_user_id: { type: String, required: true, index: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        delete ret.token_hash; // NEVER expose hash
        return ret;
      },
    },
  }
);

PortalInviteSchema.set("toObject", { virtuals: true });

export default mongoose.models.PortalInvite ||
  mongoose.model<IPortalInvite>("PortalInvite", PortalInviteSchema);
