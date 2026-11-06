import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicenseSeat extends Document {
  id: string;
  license_id: string;
  machine_id: string;
  hostname?: string;
  role: string;
  /**
   * Human-readable terminal number.
   * - Scoped per license (not globally unique).
   * - Positive integer starting from 1.
   * - Optional for backward compat: existing rows may have this absent.
   * - Once assigned, NEVER changes for the same physical seat.
   * - Never reused after seat deletion (counter only increments).
   */
  terminal_number?: number;
  last_seen_version?: string;
  location?: {
    lat?: number;
    lng?: number;
    city?: string;
    region?: string;
    country?: string;
    ip?: string;
    isp?: string;
    address?: string;
    source?: string;
    updated_at?: Date;
  };
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const LicenseSeatSchema = new Schema<ILicenseSeat>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    license_id: { type: String, required: true },
    machine_id: { type: String, required: true },
    hostname: { type: String },
    role: { type: String, default: "client" },
    /**
     * terminal_number is intentionally NOT required so that existing rows
     * are untouched by schema changes. The backfill script assigns values
     * to all existing seats. New seats always receive a terminal_number
     * from the register-seat API.
     */
    terminal_number: { type: Number, index: true },
    last_seen_version: { type: String },
    location: {
      lat: { type: Number },
      lng: { type: Number },
      city: { type: String },
      region: { type: String },
      country: { type: String },
      ip: { type: String },
      isp: { type: String },
      address: { type: String },
      source: { type: String },
      updated_at: { type: Date },
    },
    first_seen_at: { type: Date, default: Date.now },
    last_seen_at: { type: Date, default: Date.now },
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

LicenseSeatSchema.set("toObject", { virtuals: true });

// ── Index 1: One seat per machine per license ──────────────────────────────
// Prevents any machine from occupying two seats on the same license.
LicenseSeatSchema.index({ license_id: 1, machine_id: 1 }, { unique: true });

// ── Index 2: terminal_number uniqueness within a license ───────────────────
// sparse: true → documents where terminal_number is null/undefined are
// excluded from this index, so pre-backfill rows never violate uniqueness.
// Once terminal_number is assigned, it is enforced unique per license.
LicenseSeatSchema.index(
  { license_id: 1, terminal_number: 1 },
  { unique: true, sparse: true }
);

// ── Index 3: DB-level invariant — only ONE "main" seat per license ─────────
// partialFilterExpression restricts the unique index to docs where role="main".
// "client" seats are unaffected. This acts as a hard DB constraint that
// prevents two concurrent transactions from both committing a "main" role,
// providing a second safety layer beyond the transaction-level count check.
LicenseSeatSchema.index(
  { license_id: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "main" },
    name: "license_main_role_unique",
  }
);

export default mongoose.models.LicenseSeat ||
  mongoose.model<ILicenseSeat>("LicenseSeat", LicenseSeatSchema);
