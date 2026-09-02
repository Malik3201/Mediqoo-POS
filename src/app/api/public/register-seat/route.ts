import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import LicenseCounter from "@/models/LicenseCounter";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error tokens used inside withTransaction() callbacks.
// These are NOT transient MongoDB errors, so withTransaction() will NOT retry
// them — they bubble up immediately to the outer catch after transaction abort.
// ─────────────────────────────────────────────────────────────────────────────
class ManagedSeatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ManagedSeatError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomically issues the next terminal_number for a license using $inc.
// This is a single atomic MongoDB operation — safe under Vercel/serverless
// concurrency. Works both inside and outside a transaction session.
// ─────────────────────────────────────────────────────────────────────────────
async function allocateTerminalNumber(
  licenseId: string,
  session?: mongoose.ClientSession
): Promise<number> {
  const opts: mongoose.QueryOptions = { new: true, upsert: true };
  if (session) opts.session = session;

  const counter = await LicenseCounter.findOneAndUpdate(
    { license_id: licenseId },
    { $inc: { next_terminal: 1 } },
    opts
  );
  return counter!.next_terminal;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY non-atomic fallback.
// Called ONLY in local/development environments when MongoDB transactions are
// not available (standalone instance without replica set).
//
// ⚠️  THIS IS NOT SAFE IN PRODUCTION.
//     Seat-limit and main-role invariants are probabilistic, not guaranteed.
//     For production: fix the MongoDB URI to point to a Replica Set (Atlas).
// ─────────────────────────────────────────────────────────────────────────────
async function devOnlyFallbackRegistration(
  lic: any,
  body: any
): Promise<NextResponse> {
  console.warn(
    "\n" +
    "╔══════════════════════════════════════════════════════════════════════╗\n" +
    "║  ⚠️  DEV-ONLY: MongoDB transactions unavailable (standalone mode)   ║\n" +
    "║  Seat-limit and main-role checks are NON-ATOMIC in this mode.       ║\n" +
    "║  DO NOT run this in production. Point MONGODB_URI to Atlas.         ║\n" +
    "╚══════════════════════════════════════════════════════════════════════╝\n"
  );

  const count = await LicenseSeat.countDocuments({ license_id: lic.id });
  if (count >= (lic.seats ?? 1)) {
    return NextResponse.json(
      { error: "seat_limit_reached", seats: lic.seats, seats_used: count },
      { status: 403, headers: CORS }
    );
  }

  if (body.role === "main") {
    const mainCount = await LicenseSeat.countDocuments({
      license_id: lic.id,
      role: "main",
    });
    if (mainCount > 0) {
      return NextResponse.json(
        { error: "main_already_exists" },
        { status: 409, headers: CORS }
      );
    }
  }

  const terminal_number = await allocateTerminalNumber(lic.id);
  const inserted = await LicenseSeat.create({
    license_id: lic.id,
    machine_id: body.machine_id,
    role: body.role,
    hostname: body.hostname ?? null,
    terminal_number,
  });

  return NextResponse.json(
    { ok: true, seat_id: inserted.id, terminal_number, reused: false },
    { headers: CORS }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detects if a MongoDB error is the "transactions not supported" error that
// occurs when connecting to a standalone mongod (no replica set).
// ─────────────────────────────────────────────────────────────────────────────
function isTransactionNotSupportedError(err: any): boolean {
  // Error code 20: "Transaction numbers are only allowed on a replica member or mongos"
  if (err?.code === 20) return true;
  // Also seen as code 263 in some driver versions
  if (err?.code === 263) return true;
  const msg: string = err?.message ?? "";
  return (
    msg.includes("Transaction numbers are only allowed") ||
    msg.includes("replica member") ||
    msg.includes("not support sessions")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/register-seat
//
// POS calls this on startup and periodically to register/heartbeat a terminal.
//
// Request body:
//   { license_key: string, machine_id: string, role: "main"|"client", hostname?: string }
//
// Success response:
//   { ok: true, seat_id: string, terminal_number: number, reused: boolean }
//
// Backward compat: old POS versions that ignore terminal_number are unaffected.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ── 1. Validate input ───────────────────────────────────────────────────
    const body = await req.json();

    if (!body.license_key || !body.machine_id || !body.role) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400, headers: CORS }
      );
    }
    if (body.role !== "main" && body.role !== "client") {
      return NextResponse.json(
        { error: "invalid_role" },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // ── 2. Validate license (read-only, outside transaction) ────────────────
    const lic = await License.findOne({ license_key: body.license_key }).lean();
    if (!lic) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS }
      );
    }
    if (lic.status !== "active") {
      return NextResponse.json(
        { error: "license_not_active", status: lic.status },
        { status: 403, headers: CORS }
      );
    }

    // ── 3. Fast path: existing seat for this machine ────────────────────────
    //
    // Read outside the transaction for performance. The transaction recheck
    // (step 4a) handles the race where this returns null but a concurrent
    // request is creating the same seat right now.
    const existingSeat = await LicenseSeat.findOne({
      license_id: lic.id,
      machine_id: body.machine_id,
    }).lean();

    if (existingSeat) {
      // ── 3a. Seat exists WITH terminal_number (normal heartbeat) ──────────
      if (existingSeat.terminal_number != null) {
        await LicenseSeat.updateOne(
          { id: existingSeat.id },
          {
            $set: {
              role: body.role,
              last_seen_at: new Date(),
              ...(body.hostname ? { hostname: body.hostname } : {}),
            }
          }
        );

        return NextResponse.json(
          {
            ok: true,
            seat_id: existingSeat.id,
            terminal_number: existingSeat.terminal_number,
            reused: true,
          },
          { headers: CORS }
        );
      }

      // ── 3b. Seat exists WITHOUT terminal_number (pre-backfill record) ────
      //
      // The seat_id UUID and machine_id are preserved.
      // We atomically allocate a terminal_number and conditionally write it
      // to the seat (only if still missing — handles concurrent requests).
      const newTerminalNumber = await allocateTerminalNumber(lic.id);

      const updatedSeat = await LicenseSeat.findOneAndUpdate(
        {
          id: existingSeat.id,
          // Guard: only write if terminal_number is still absent.
          // Prevents two concurrent requests from writing different numbers.
          $or: [
            { terminal_number: { $exists: false } },
            { terminal_number: null },
          ],
        },
        {
          $set: {
            terminal_number: newTerminalNumber,
            role: body.role,
            last_seen_at: new Date(),
            ...(body.hostname ? { hostname: body.hostname } : {}),
          },
        },
        { new: true }
      );

      if (updatedSeat) {
        // We won the concurrent race — our terminal_number was written.
        return NextResponse.json(
          {
            ok: true,
            seat_id: updatedSeat.id,
            terminal_number: updatedSeat.terminal_number,
            reused: true,
          },
          { headers: CORS }
        );
      }

      // A concurrent request already assigned a terminal_number.
      // One terminal_number from the counter is "consumed" but unused —
      // this creates a small gap, which is acceptable and non-harmful.
      // The counter's non-reuse policy is maintained either way.
      const refreshed = await LicenseSeat.findOne({ id: existingSeat.id }).lean();
      if (!refreshed) {
        throw new Error("Seat disappeared during concurrent terminal assignment");
      }
      return NextResponse.json(
        {
          ok: true,
          seat_id: refreshed.id,
          terminal_number: refreshed.terminal_number,
          reused: true,
        },
        { headers: CORS }
      );
    }

    // ── 4. New seat registration — requires transaction ─────────────────────
    //
    // All three invariants (seat limit, main uniqueness, terminal assignment)
    // must be checked and written atomically within a single transaction.
    const session = await mongoose.startSession();

    // Result holder — populated inside the transaction callback.
    let txResult: { seat_id: string; terminal_number: number; reused: boolean } | null = null;

    try {
      await session.withTransaction(async () => {
        // ── 4a. Recheck inside transaction ─────────────────────────────────
        // Handles the case where a concurrent request created this machine's
        // seat between our pre-transaction read (step 3) and now.
        const recheckSeat = await LicenseSeat.findOne({
          license_id: lic.id,
          machine_id: body.machine_id,
        }).session(session);

        if (recheckSeat) {
          // Seat was just created by a concurrent request. Treat as reuse.
          txResult = {
            seat_id: recheckSeat.id,
            terminal_number: recheckSeat.terminal_number!,
            reused: true,
          };
          // Commit with no writes — perfectly valid.
          return;
        }

        // ── 4b. Enforce seat limit (atomic within transaction) ──────────────
        const count = await LicenseSeat.countDocuments({
          license_id: lic.id,
        }).session(session);

        if (count >= (lic.seats ?? 1)) {
          throw new ManagedSeatError("seat_limit_reached", "Seat limit reached", {
            seats: lic.seats,
            seats_used: count,
          });
        }

        // ── 4c. Enforce main-role uniqueness (atomic within transaction) ────
        // The partial unique index (Index 3 in LicenseSeat) provides an
        // additional DB-level constraint. This transaction-level check is the
        // first line of defense; the DB index is the hard backstop.
        if (body.role === "main") {
          const mainCount = await LicenseSeat.countDocuments({
            license_id: lic.id,
            role: "main",
          }).session(session);

          if (mainCount > 0) {
            throw new ManagedSeatError(
              "main_already_exists",
              "A main terminal already exists for this license"
            );
          }
        }

        // ── 4d. Atomic terminal_number allocation ───────────────────────────
        // $inc on LicenseCounter is a single atomic operation. When passed a
        // session, it participates in the transaction and rolls back if the
        // transaction aborts (e.g., due to write conflict with a concurrent tx).
        const terminal_number = await allocateTerminalNumber(lic.id, session);

        // ── 4e. Create the seat ─────────────────────────────────────────────
        const [inserted] = await LicenseSeat.create(
          [
            {
              license_id: lic.id,
              machine_id: body.machine_id,
              role: body.role,
              hostname: body.hostname ?? null,
              terminal_number,
            },
          ],
          { session }
        );

        txResult = {
          seat_id: inserted.id,
          terminal_number: inserted.terminal_number!,
          reused: false,
        };
      });
    } catch (txError: any) {
      // ── Handle our own managed errors (intentional throws from callback) ──
      if (txError instanceof ManagedSeatError) {
        if (txError.code === "seat_limit_reached") {
          return NextResponse.json(
            {
              error: "seat_limit_reached",
              seats: txError.extra?.seats,
              seats_used: txError.extra?.seats_used,
            },
            { status: 403, headers: CORS }
          );
        }
        if (txError.code === "main_already_exists") {
          return NextResponse.json(
            { error: "main_already_exists" },
            { status: 409, headers: CORS }
          );
        }
      }

      // ── MongoDB duplicate key: DB-level invariant was triggered ───────────
      // Code 11000 = E11000 duplicate key error.
      // This happens when the partial index on (license_id + role="main")
      // catches two concurrent main-role creates that both pass the count check.
      if (txError?.code === 11000) {
        const keyPattern = txError?.keyPattern ?? {};
        const keyMsg: string = txError?.message ?? "";
        if (
          keyPattern.role !== undefined ||
          keyMsg.includes("license_main_role_unique") ||
          keyMsg.includes("role")
        ) {
          return NextResponse.json(
            { error: "main_already_exists" },
            { status: 409, headers: CORS }
          );
        }
        // Duplicate key on machine_id (extremely unlikely, another concurrent
        // request on same machine) — safe to surface as a conflict.
        return NextResponse.json(
          { error: "concurrent_registration_conflict", hint: "retry" },
          { status: 409, headers: CORS }
        );
      }

      // ── Transaction not supported (standalone MongoDB) ────────────────────
      if (isTransactionNotSupportedError(txError)) {
        const isProduction = process.env.NODE_ENV === "production";

        if (isProduction) {
          // ── PRODUCTION: fail controlled, do NOT fall back to unsafe flow ──
          console.error(
            "[register-seat] CRITICAL: MongoDB transactions are not available " +
            "in the production environment. MONGODB_URI must point to a " +
            "Replica Set (MongoDB Atlas M0+). Registration is blocked for safety."
          );
          return NextResponse.json(
            {
              error: "server_configuration_error",
              message:
                "Seat registration is temporarily unavailable due to a " +
                "server configuration issue. Please contact support.",
            },
            { status: 503, headers: CORS }
          );
        }

        // ── DEVELOPMENT: explicit non-atomic fallback with loud warning ─────
        return devOnlyFallbackRegistration(lic, body);
      }

      // ── Unknown / unexpected error ────────────────────────────────────────
      throw txError;
    } finally {
      await session.endSession();
    }

    if (!txResult) {
      // Should never happen — safety net.
      throw new Error("Unexpected: txResult is null after transaction committed");
    }

    // ── 5. Handle concurrent-reuse case (txResult.reused = true from recheck)
    const result = txResult as { seat_id: string; terminal_number: number; reused: boolean };
    if (result.reused) {
      // Heartbeat: update last_seen_at and role outside the transaction.
      await LicenseSeat.findOneAndUpdate(
        { license_id: lic.id, machine_id: body.machine_id },
        {
          $set: {
            role: body.role,
            last_seen_at: new Date(),
            ...(body.hostname ? { hostname: body.hostname } : {}),
          },
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        seat_id: result.seat_id,
        terminal_number: result.terminal_number,
        reused: result.reused,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Register seat API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS }
    );
  }
}
