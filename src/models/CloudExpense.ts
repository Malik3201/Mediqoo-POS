import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * CloudExpense — materialized current-state projection of expense CRUD events.
 *
 * Purpose: AnalyticsEvent records are immutable audit log (idempotent).
 * CloudExpense is the "latest known state" per expense record, derived from events.
 *
 * Processing rules:
 *   expense.created  → upsert projection (create or update if source_record_id exists)
 *   expense.updated  → replace projection with latest valid state (use source_updated_at to pick newer)
 *   expense.deleted  → set is_deleted = true, amount = 0
 *
 * Dashboard query: sum(amount) WHERE is_deleted=false AND occurred_at in [range]
 *
 * This ensures:
 *   create 1000 → update 1500 → delete
 *   → contributes 0, not -500 or any incorrect value
 *
 * Idempotency: processing the same event twice does not corrupt state.
 *   - expense.created: only writes if no existing record OR if occurred_at is newer
 *   - expense.updated: only replaces if source_updated_at >= existing source_updated_at
 *   - expense.deleted: always idempotent (sets is_deleted=true)
 *
 * Unique index: { client_id, license_id, source_record_id } — one projection per expense record per installation.
 */
export interface ICloudExpense extends Document {
  id: string;
  client_id: string;
  license_id: string;
  source_record_id: string;    // POS expense ID — immutable key
  amount: number;              // current valid amount (0 if deleted)
  category?: string;           // expense category
  occurred_at: Date;           // business date of expense
  is_deleted: boolean;         // true after expense.deleted event
  source_updated_at: Date;     // latest event timestamp (for ordering updates correctly)
  created_at: Date;
  updated_at: Date;
}

const CloudExpenseSchema = new Schema<ICloudExpense>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    source_record_id: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
    category: { type: String },
    occurred_at: { type: Date, required: true },
    is_deleted: { type: Boolean, default: false },
    source_updated_at: { type: Date, required: true },
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

// One projection per expense record per license
CloudExpenseSchema.index(
  { client_id: 1, license_id: 1, source_record_id: 1 },
  { unique: true }
);

// Performance index for dashboard date-range queries
CloudExpenseSchema.index({ client_id: 1, occurred_at: -1, is_deleted: 1 });

export default mongoose.models.CloudExpense ||
  mongoose.model<ICloudExpense>("CloudExpense", CloudExpenseSchema);
