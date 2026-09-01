import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import LicenseCounter from "@/models/LicenseCounter";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";

/**
 * POST /api/admin/backfill-terminals
 *
 * Assigns terminal_number to all existing LicenseSeat records that don't have
 * one yet, and initializes LicenseCounter to the correct value per license.
 *
 * Access: super_admin or master admin (ADMIN_EMAIL) only.
 *
 * Query params:
 *   ?dry_run=true   — compute what would change without writing anything
 *
 * Idempotency guarantees:
 * - Existing terminal_number values are NEVER modified or reassigned.
 * - Per license, continuation starts from max(existing terminal_number) + 1.
 * - Safe to call multiple times; second run is a no-op if first was complete.
 * - Interruption-safe: each seat update is an independent conditional write.
 *   A partial run can be resumed; already-assigned seats are detected and skipped.
 *
 * Terminal-number non-reuse:
 * - LicenseCounter is set to max(assigned terminal_numbers) via $max.
 * - Deleting a seat after backfill does NOT decrement the counter.
 * - The next new seat will always receive (max + 1), not fill gaps.
 *
 * Counter initialization policy:
 * - Uses $max so the counter is only ever raised, never lowered.
 * - Safe for mixed states (some seats have numbers, some don't).
 */

interface BackfillResult {
  licenses_processed: number;
  seats_skipped: number;       // already had terminal_number
  seats_assigned: number;      // assigned in this run
  counters_initialized: number;
  dry_run: boolean;
  errors: Array<{ license_id: string; error: string }>;
  per_license: Array<{
    license_id: string;
    seats_total: number;
    seats_assigned: number;
    seats_skipped: number;
    counter_value: number;
  }>;
}

export async function POST(req: NextRequest) {
  // ── Auth: require super_admin or master admin ─────────────────────────────
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();

  const userEmail = token.email as string;
  const isMasterAdmin = userEmail === process.env.ADMIN_EMAIL;

  if (!isMasterAdmin) {
    const profile = await Profile.findOne({ email: userEmail }).lean();
    if (!profile) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const roles = await UserRole.find({ user_id: (profile as any).id }).lean();
    const hasSuperAdmin = roles.some(
      (r: any) => r.role === "super_admin"
    );
    if (!hasSuperAdmin) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message:
            "This endpoint requires super_admin role. " +
            "Regular admins cannot run the terminal backfill.",
        },
        { status: 403 }
      );
    }
  }

  // ── Parse options ─────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  // ── Run backfill ──────────────────────────────────────────────────────────
  const result: BackfillResult = {
    licenses_processed: 0,
    seats_skipped: 0,
    seats_assigned: 0,
    counters_initialized: 0,
    dry_run: dryRun,
    errors: [],
    per_license: [],
  };

  const allLicenses = await License.find({}).select("id").lean();

  for (const lic of allLicenses) {
    const licId = (lic as any).id as string;
    result.licenses_processed++;

    const licRow = {
      license_id: licId,
      seats_total: 0,
      seats_assigned: 0,
      seats_skipped: 0,
      counter_value: 0,
    };

    try {
      // Fetch all seats ordered deterministically:
      // first_seen_at ASC (chronological), then id ASC (tiebreaker)
      const seats = await LicenseSeat.find({ license_id: licId })
        .sort({ first_seen_at: 1, id: 1 })
        .lean();

      licRow.seats_total = seats.length;

      if (seats.length === 0) {
        result.per_license.push(licRow);
        continue;
      }

      // ── Inspect existing assignments ──────────────────────────────────────
      // Find the current maximum terminal_number among seats that already
      // have one. Continuation begins from (max + 1), preserving all existing
      // assignments and never reusing or conflicting with them.
      let currentMax = 0;
      for (const seat of seats) {
        const tn = (seat as any).terminal_number;
        if (tn != null && tn > currentMax) {
          currentMax = tn;
        }
      }

      // ── Assign missing terminal_numbers ───────────────────────────────────
      let nextNum = currentMax + 1;
      let maxAssignedInRun = currentMax;

      for (const seat of seats) {
        const seatId = (seat as any).id as string;
        const existingTn = (seat as any).terminal_number;

        if (existingTn != null) {
          // Already assigned — skip without modifying.
          licRow.seats_skipped++;
          result.seats_skipped++;
          continue;
        }

        const assignNum = nextNum;
        nextNum++;

        if (dryRun) {
          // Dry run: count what would happen, touch nothing.
          licRow.seats_assigned++;
          result.seats_assigned++;
          maxAssignedInRun = Math.max(maxAssignedInRun, assignNum);
          continue;
        }

        // Conditional write: only update if terminal_number is STILL missing.
        // The $or guard is the idempotency mechanism — if another process
        // (or a previous partial run) already assigned a number, this write
        // is a no-op and the existing value is preserved.
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
          licRow.seats_assigned++;
          result.seats_assigned++;
          maxAssignedInRun = Math.max(maxAssignedInRun, assignNum);
        } else {
          // Someone else (or a previous run) already assigned a number.
          // Re-query to get the actual value so our counter init is correct.
          const requeried = await LicenseSeat.findOne({ id: seatId }).lean();
          const actualTn = (requeried as any)?.terminal_number;
          if (actualTn != null) {
            maxAssignedInRun = Math.max(maxAssignedInRun, actualTn);
            nextNum--; // Rewind — we didn't consume this slot
          }
          licRow.seats_skipped++;
          result.seats_skipped++;
        }
      }

      licRow.counter_value = maxAssignedInRun;

      // ── Initialize / correct LicenseCounter ───────────────────────────────
      // $max: only raises the counter, never lowers it.
      // Idempotent: safe to call multiple times.
      // Upsert: creates the counter if it doesn't exist yet.
      if (!dryRun && maxAssignedInRun > 0) {
        await LicenseCounter.findOneAndUpdate(
          { license_id: licId },
          { $max: { next_terminal: maxAssignedInRun } },
          { upsert: true }
        );
        result.counters_initialized++;
      }

      result.per_license.push(licRow);
    } catch (e: any) {
      result.errors.push({ license_id: licId, error: e.message });
      result.per_license.push(licRow);
    }
  }

  const status = result.errors.length > 0 ? 207 : 200;

  return NextResponse.json(
    {
      ok: result.errors.length === 0,
      ...result,
    },
    { status }
  );
}
