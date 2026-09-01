import mongoose, { Schema, Document } from "mongoose";

/**
 * LicenseCounter — one document per license.
 *
 * Tracks the last terminal_number that was issued for a given license.
 * This counter ONLY ever increases via `$inc`. It is never decremented
 * when a seat is deleted. This enforces the terminal-number non-reuse
 * policy: a deleted terminal number is permanently retired.
 *
 * Usage (atomic, serverless-safe):
 *   const counter = await LicenseCounter.findOneAndUpdate(
 *     { license_id: lic.id },
 *     { $inc: { next_terminal: 1 } },
 *     { new: true, upsert: true }
 *   );
 *   const terminalNumber = counter.next_terminal; // 1 on first use
 *
 * Design notes:
 * - `next_terminal` starts at 0 (document default).
 * - First `$inc` → 0 + 1 = 1. Returns new value 1. First terminal = 1. ✅
 * - This is a single atomic MongoDB operation — safe under Vercel serverless
 *   concurrency where no in-memory state is shared across invocations.
 * - Scoped by license_id (unique index). Each license has its own counter.
 */
export interface ILicenseCounter extends Document {
  license_id: string;     // one counter per license, globally unique
  next_terminal: number;  // last issued terminal number (0 = none issued yet)
  updated_at: Date;
}

const LicenseCounterSchema = new Schema<ILicenseCounter>(
  {
    license_id: { type: String, required: true, unique: true, index: true },
    next_terminal: { type: Number, default: 0, min: 0 },
  },
  {
    // Only track updatedAt — no createdAt needed for a counter
    timestamps: { createdAt: false, updatedAt: "updated_at" },
  }
);

export default mongoose.models.LicenseCounter ||
  mongoose.model<ILicenseCounter>("LicenseCounter", LicenseCounterSchema);
