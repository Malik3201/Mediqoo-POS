import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type AnalyticsEventType =
  | "sale.completed"
  | "sale.returned"
  | "purchase.received"
  | "purchase.returned"
  | "khata.payment"
  | "supplier.payment"
  | "drawer.session"
  | "daily.closing"
  | "expense.created"
  | "expense.updated"
  | "expense.deleted";

/**
 * Sale item analytics snapshot — used in sale.completed and sale.returned payloads.
 * These are finalized sale-time values. COGS is the snapshot cost at sale time.
 * Do NOT recompute from current product cost.
 */
export interface SaleItem {
  product_id: string;
  product_name: string;
  code?: string;
  qty: number;
  unit_type?: string;       // e.g., "tablet", "strip", "box"
  unit_multiplier?: number; // base units per pack (optional context)
  unit_price?: number;      // selling price per unit
  discount?: number;        // line discount amount
  tax?: number;             // line tax amount
  revenue: number;          // line total after discount (sale-time)
  cogs: number;             // line COGS snapshot at sale time
  gross_profit: number;     // revenue - cogs
}

/**
 * AnalyticsEvent — immutable event log for idempotent ingestion.
 *
 * Identity fields (client_id, project_id, license_id, seat_id, terminal_number)
 * are ALWAYS resolved server-side from the authenticated license record.
 * The POS may send them for diagnostics but they are IGNORED for authorization.
 *
 * Idempotency: event_id is globally unique (DB unique index).
 * Duplicate submissions return { duplicate: true } without creating a new record.
 */
export interface IAnalyticsEvent extends Document {
  id: string;
  event_id: string;             // POS-supplied UUID, globally unique
  client_id: string;            // server-resolved
  project_id: string;           // server-resolved
  license_id: string;           // server-resolved
  seat_id?: string;             // server-resolved from LicenseSeat
  terminal_number?: number;     // server-resolved from LicenseSeat
  type: AnalyticsEventType;
  source_record_id: string;     // POS record ID (invoice_id, expense_id, etc.)
  occurred_at: Date;            // POS absolute timestamp (UTC stored, timezone applied on display)
  received_at: Date;            // server timestamp
  payload: Record<string, any>; // validated per event type
  created_at: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    event_id: { type: String, required: true, unique: true }, // idempotency key
    client_id: { type: String, required: true, index: true },
    project_id: { type: String, required: true },
    license_id: { type: String, required: true, index: true },
    seat_id: { type: String },
    terminal_number: { type: Number },
    type: {
      type: String,
      required: true,
      enum: [
        "sale.completed",
        "sale.returned",
        "purchase.received",
        "purchase.returned",
        "khata.payment",
        "supplier.payment",
        "drawer.session",
        "daily.closing",
        "expense.created",
        "expense.updated",
        "expense.deleted",
      ],
    },
    source_record_id: { type: String, required: true },
    occurred_at: { type: Date, required: true },
    received_at: { type: Date, default: Date.now },
    payload: { type: Schema.Types.Mixed, required: true },
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

// Compound indexes for aggregation performance
AnalyticsEventSchema.index({ client_id: 1, occurred_at: -1 });
AnalyticsEventSchema.index({ client_id: 1, type: 1, occurred_at: -1 });
AnalyticsEventSchema.index({ client_id: 1, license_id: 1, occurred_at: -1 });
AnalyticsEventSchema.index({ client_id: 1, source_record_id: 1 });

export default mongoose.models.AnalyticsEvent ||
  mongoose.model<IAnalyticsEvent>("AnalyticsEvent", AnalyticsEventSchema);
