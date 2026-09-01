import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * InventorySnapshot — current inventory state per License.
 *
 * ONE canonical record per License. Not summed across terminals.
 *
 * Semantics:
 * - POS terminals sharing LAN-synchronized inventory MUST send identical snapshots.
 * - Server always upserts/replaces the LATEST snapshot for a given license_id.
 * - `reported_by_terminal` is metadata only — which terminal last reported.
 * - Dashboard: get the LATEST snapshot per license, then aggregate across licenses
 *   belonging to the client. Do NOT sum multiple terminal snapshots for same license.
 *
 * Unique index: { client_id, license_id } — one current state per installation.
 *
 * Historical trend snapshots are a future feature (separate collection).
 */
export interface IInventorySnapshot extends Document {
  id: string;
  client_id: string;
  license_id: string;
  reported_by_terminal?: number; // terminal_number of the reporting terminal (metadata only)
  reported_by_seat_id?: string;  // seat_id of the reporting terminal (metadata only)
  captured_at: Date;             // POS timestamp when snapshot was taken
  stock_value: number;           // total inventory value at cost
  low_stock_count: number;       // items below reorder level
  out_of_stock_count: number;    // items with qty = 0
  expiring_soon_count: number;   // items expiring within configured window (e.g., 30 days)
  created_at: Date;
  updated_at: Date;
}

const InventorySnapshotSchema = new Schema<IInventorySnapshot>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    reported_by_terminal: { type: Number },
    reported_by_seat_id: { type: String },
    captured_at: { type: Date, required: true },
    stock_value: { type: Number, required: true, default: 0 },
    low_stock_count: { type: Number, required: true, default: 0 },
    out_of_stock_count: { type: Number, required: true, default: 0 },
    expiring_soon_count: { type: Number, required: true, default: 0 },
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

// One canonical snapshot per license (enforced by upsert logic in API)
InventorySnapshotSchema.index({ client_id: 1, license_id: 1 }, { unique: true });

export default mongoose.models.InventorySnapshot ||
  mongoose.model<IInventorySnapshot>("InventorySnapshot", InventorySnapshotSchema);
