#!/usr/bin/env node
/**
 * AivraSol — Terminal Number Backfill Script
 * ==========================================
 *
 * CANONICAL production migration method for assigning terminal_number to
 * all existing LicenseSeat records and initializing LicenseCounter.
 *
 * Usage:
 *   node src/scripts/backfill-terminals.mjs
 *   node src/scripts/backfill-terminals.mjs --dry-run
 *
 * Options:
 *   --dry-run    Print what would change without writing anything
 *   --verbose    Print per-seat detail
 *
 * Requirements:
 *   MONGODB_URI must be set (in environment or .env.local)
 *
 * Safety guarantees:
 *   ✅ Idempotent — safe to run multiple times
 *   ✅ Interruption-safe — can be resumed after a crash
 *   ✅ Existing terminal_numbers are NEVER overwritten or reassigned
 *   ✅ Continuation from current max (not from 1) after partial run
 *   ✅ Counter initialized via $max (never decremented)
 *   ✅ No changes to seat_id, machine_id, license_id
 *
 * Terminal-number non-reuse policy:
 *   Once a terminal_number is assigned, it is retired permanently.
 *   The counter only ever increases. Deleting seat 2 (out of 1,2,3)
 *   means the next new seat receives 4, not 2.
 *
 * Example run (3 existing seats without terminal_number):
 *   $ node src/scripts/backfill-terminals.mjs
 *   [backfill] Connecting to MongoDB...
 *   [backfill] Connected.
 *   [backfill] Processing license: abc-123
 *     Seat xyz-001 (first_seen: 2026-01-01) → terminal_number = 1 ✅
 *     Seat xyz-002 (first_seen: 2026-01-02) → terminal_number = 2 ✅
 *     Seat xyz-003 (first_seen: 2026-01-03) → terminal_number = 3 ✅
 *     Counter set to 3
 *   [backfill] Complete: 1 license, 3 seats assigned, 0 skipped, 0 errors
 *
 * Example second run (idempotent):
 *   [backfill] Complete: 1 license, 0 seats assigned, 3 skipped, 0 errors
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Load .env.local (project root) ──────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

for (const envFile of [".env.local", ".env"]) {
  try {
    const content = readFileSync(resolve(projectRoot, envFile), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
    console.log(`[backfill] Loaded env from ${envFile}`);
    break;
  } catch {
    // file not found — try next
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("[backfill] ERROR: MONGODB_URI is not set.");
  console.error("           Set it in .env.local or as an environment variable.");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const VERBOSE = args.includes("--verbose");

if (DRY_RUN) {
  console.log("[backfill] ⚠️  DRY RUN — no data will be written.\n");
}

// ─── Inline schema definitions (avoids TypeScript compilation dependency) ────
import mongoose from "mongoose";

const licenseSchema = new mongoose.Schema(
  { id: { type: String, required: true } },
  { strict: false }
);
const licenseCounterSchema = new mongoose.Schema(
  {
    license_id: { type: String, required: true, unique: true },
    next_terminal: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: "updated_at" } }
);
const licenseSeatSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    license_id: { type: String, required: true },
    machine_id: { type: String, required: true },
    terminal_number: { type: Number },
    first_seen_at: { type: Date },
  },
  { strict: false }
);

const License =
  mongoose.models.License || mongoose.model("License", licenseSchema);
const LicenseCounter =
  mongoose.models.LicenseCounter ||
  mongoose.model("LicenseCounter", licenseCounterSchema);
const LicenseSeat =
  mongoose.models.LicenseSeat || mongoose.model("LicenseSeat", licenseSeatSchema);

// ─── Main backfill logic ──────────────────────────────────────────────────────
async function run() {
  console.log("[backfill] Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log("[backfill] Connected.\n");

  const totals = {
    licenses_processed: 0,
    seats_assigned: 0,
    seats_skipped: 0,
    counters_initialized: 0,
    errors: 0,
  };

  // Fetch all license IDs
  const licenses = await License.find({}).select("id").lean();
  console.log(`[backfill] Found ${licenses.length} licenses.\n`);

  for (const lic of licenses) {
    const licId = lic.id;
    totals.licenses_processed++;

    console.log(`[backfill] Processing license: ${licId}`);

    try {
      // Fetch seats for this license, ordered deterministically
      const seats = await LicenseSeat.find({ license_id: licId })
        .sort({ first_seen_at: 1, id: 1 })
        .lean();

      if (seats.length === 0) {
        console.log("  (no seats)\n");
        continue;
      }

      // ── Inspect existing terminal_number assignments ────────────────────
      let currentMax = 0;
      for (const seat of seats) {
        const tn = seat.terminal_number;
        if (tn != null && tn > currentMax) currentMax = tn;
      }

      if (VERBOSE && currentMax > 0) {
        console.log(`  Existing max terminal_number: ${currentMax}`);
      }

      // ── Assign missing terminal_numbers ────────────────────────────────
      let nextNum = currentMax + 1;
      let maxAssignedInRun = currentMax;

      for (const seat of seats) {
        const seatId = seat.id;
        const existingTn = seat.terminal_number;

        if (existingTn != null) {
          if (VERBOSE) {
            console.log(
              `  Seat ${seatId} (first_seen: ${seat.first_seen_at?.toISOString?.()?.slice(0, 10) ?? "unknown"}) → terminal_number = ${existingTn} (already assigned, skipped)`
            );
          }
          totals.seats_skipped++;
          continue;
        }

        const assignNum = nextNum;
        nextNum++;

        console.log(
          `  Seat ${seatId} (first_seen: ${seat.first_seen_at?.toISOString?.()?.slice(0, 10) ?? "unknown"}) → terminal_number = ${assignNum}${DRY_RUN ? " (dry run)" : " ✅"}`
        );

        if (!DRY_RUN) {
          // Conditional write — idempotency guard
          const updated = await LicenseSeat.findOneAndUpdate(
            {
              id: seatId,
              $or: [
                { terminal_number: { $exists: false } },
                { terminal_number: null },
              ],
            },
            { $set: { terminal_number: assignNum } },
            { new: true }
          );

          if (updated) {
            maxAssignedInRun = Math.max(maxAssignedInRun, assignNum);
            totals.seats_assigned++;
          } else {
            // Another process (or a previous interrupted run) already assigned.
            const requeried = await LicenseSeat.findOne({ id: seatId }).lean();
            const actualTn = requeried?.terminal_number;
            if (actualTn != null) {
              maxAssignedInRun = Math.max(maxAssignedInRun, actualTn);
              nextNum--; // We didn't consume this slot
            }
            console.log(`    ↳ Concurrent assignment detected — skipping (actual: ${actualTn})`);
            totals.seats_skipped++;
          }
        } else {
          maxAssignedInRun = Math.max(maxAssignedInRun, assignNum);
          totals.seats_assigned++;
        }
      }

      // ── Initialize / correct LicenseCounter ────────────────────────────
      // $max: only raises the stored counter, never lowers it.
      // This is idempotent — safe if the counter was already set correctly.
      if (!DRY_RUN && maxAssignedInRun > 0) {
        await LicenseCounter.findOneAndUpdate(
          { license_id: licId },
          { $max: { next_terminal: maxAssignedInRun } },
          { upsert: true }
        );
        totals.counters_initialized++;
        console.log(`  Counter initialized/verified to ${maxAssignedInRun}`);
      } else if (DRY_RUN) {
        console.log(`  Counter would be set to ${maxAssignedInRun} (dry run)`);
      }

      console.log();
    } catch (e) {
      console.error(`  ❌ ERROR on license ${licId}: ${e.message}`);
      totals.errors++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("[backfill] Complete:");
  console.log(`  Licenses processed:    ${totals.licenses_processed}`);
  console.log(`  Seats assigned:        ${totals.seats_assigned}`);
  console.log(`  Seats skipped:         ${totals.seats_skipped} (already had terminal_number)`);
  console.log(`  Counters initialized:  ${totals.counters_initialized}`);
  console.log(`  Errors:                ${totals.errors}`);
  if (DRY_RUN) {
    console.log("\n  ⚠️  DRY RUN — no data was written.");
  }
  console.log("─".repeat(60));

  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("[backfill] Fatal error:", e);
  process.exit(1);
});
