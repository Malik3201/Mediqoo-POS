import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const VALID_TYPES = new Set([
  "sale.completed",
  "sale.returned",
  "purchase.received",
  "expense.created",
  "expense.updated",
  "expense.deleted",
]);

const MAX_EVENTS_PER_BATCH = 50;

/**
 * POST /api/public/analytics/events
 *
 * POS analytics event ingestion endpoint.
 *
 * Authentication (per correction #7):
 *   - license_key + machine_id must resolve an active license AND a registered LicenseSeat
 *   - seat_id, terminal_number, client_id, project_id supplied by POS are IGNORED for auth
 *   - They are resolved server-side from the trusted license + seat record
 *
 * Feature flag:
 *   - license.features.cloud_dashboard must be true
 *
 * Idempotency (per correction #9):
 *   - event_id is globally unique (DB unique index)
 *   - Concurrent duplicate requests handled via try/catch on duplicate-key error (code 11000)
 *   - Returns { event_id, duplicate: true } for already-processed events
 *
 * Expense CRUD side effects:
 *   - After storing the event, expense events update the CloudExpense projection
 *
 * Body:
 * {
 *   license_key: string,
 *   machine_id: string,
 *   events: [{
 *     event_id: string,         // POS UUID, globally unique
 *     type: string,
 *     source_record_id: string,
 *     occurred_at: string,      // ISO 8601
 *     payload: object
 *   }]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const { license_key, machine_id, events } = body ?? {};

    if (!license_key || !machine_id) {
      return NextResponse.json(
        { error: "missing_fields", message: "license_key and machine_id are required." },
        { status: 400, headers: CORS }
      );
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "invalid_events", message: "events must be a non-empty array." },
        { status: 400, headers: CORS }
      );
    }

    if (events.length > MAX_EVENTS_PER_BATCH) {
      return NextResponse.json(
        { error: "too_many_events", message: `Maximum ${MAX_EVENTS_PER_BATCH} events per batch.` },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // ── Step 1: Resolve License ───────────────────────────────────────────
    const license = await License.findOne({ license_key }).lean<{
      id: string; client_id: string; project_id: string;
      status: string; features: any;
    }>();

    if (!license) {
      return NextResponse.json(
        { error: "invalid_license", message: "License not found." },
        { status: 401, headers: CORS }
      );
    }

    if (license.status !== "active") {
      return NextResponse.json(
        { error: "license_not_active", status: license.status },
        { status: 403, headers: CORS }
      );
    }

    // ── Step 2: Feature flag check ────────────────────────────────────────
    if (!license.features?.cloud_dashboard) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Cloud dashboard is not enabled for this license." },
        { status: 403, headers: CORS }
      );
    }

    // ── Step 3: Verify registered seat (per correction #7) ───────────────
    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: String(machine_id),
    }).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json(
        { error: "machine_not_registered", message: "This machine is not registered for this license." },
        { status: 401, headers: CORS }
      );
    }

    // ── Step 4: Process each event ────────────────────────────────────────
    const results: Array<{ event_id: string; duplicate: boolean; error?: string }> = [];

    for (const ev of events) {
      const { event_id, type, source_record_id, occurred_at, payload } = ev ?? {};

      if (!event_id || !type || !source_record_id || !occurred_at || !payload) {
        results.push({ event_id: event_id ?? "unknown", duplicate: false, error: "missing_fields" });
        continue;
      }

      if (!VALID_TYPES.has(type)) {
        results.push({ event_id, duplicate: false, error: "invalid_type" });
        continue;
      }

      const occurredAtDate = new Date(occurred_at);
      if (isNaN(occurredAtDate.getTime())) {
        results.push({ event_id, duplicate: false, error: "invalid_occurred_at" });
        continue;
      }

      // Idempotent insert — catch duplicate-key error
      try {
        await AnalyticsEvent.create({
          event_id,
          client_id: license.client_id,        // server-resolved
          project_id: license.project_id,       // server-resolved
          license_id: license.id,               // server-resolved
          seat_id: seat.id,                     // server-resolved
          terminal_number: seat.terminal_number, // server-resolved
          type,
          source_record_id: String(source_record_id),
          occurred_at: occurredAtDate,
          received_at: new Date(),
          payload,
        });

        // Side effect: update CloudExpense projection for expense events
        if (type.startsWith("expense.")) {
          await upsertExpenseProjection(
            license.client_id,
            license.id,
            String(source_record_id),
            type,
            payload,
            occurredAtDate
          );
        }

        results.push({ event_id, duplicate: false });
      } catch (e: any) {
        if (e.code === 11000) {
          // Duplicate event_id — idempotent: return success with duplicate flag
          results.push({ event_id, duplicate: true });
        } else {
          console.error(`Error storing event ${event_id}:`, e);
          results.push({ event_id, duplicate: false, error: "storage_error" });
        }
      }
    }

    return NextResponse.json({ ok: true, results }, { headers: CORS });
  } catch (e: any) {
    console.error("Analytics events error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}

/**
 * Updates the CloudExpense materialized projection for expense events.
 *
 * Rules (per correction #3):
 *   expense.created → create or update projection (idempotent by source_record_id)
 *   expense.updated → replace with latest state (only if source_updated_at is newer)
 *   expense.deleted → set is_deleted=true, amount=0
 *
 * The projection always reflects the CURRENT valid state of the expense.
 * Final state: create 1000 → update 1500 → delete → contributes 0.
 */
async function upsertExpenseProjection(
  clientId: string,
  licenseId: string,
  sourceRecordId: string,
  type: string,
  payload: any,
  occurredAt: Date
) {
  const filter = { client_id: clientId, license_id: licenseId, source_record_id: sourceRecordId };

  if (type === "expense.deleted") {
    // Mark deleted — always idempotent
    await CloudExpense.findOneAndUpdate(
      filter,
      {
        $set: {
          is_deleted: true,
          amount: 0,
          source_updated_at: occurredAt,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (type === "expense.created" || type === "expense.updated") {
    const amount = Number(payload?.amount ?? 0);
    const category = payload?.category ?? undefined;
    const occurredAtDate = payload?.occurred_at ? new Date(payload.occurred_at) : occurredAt;

    // Only update if the incoming event is NEWER than the current projection
    // This prevents out-of-order event replay from corrupting state
    await CloudExpense.findOneAndUpdate(
      {
        ...filter,
        $or: [
          { source_updated_at: { $exists: false } },
          { source_updated_at: { $lt: occurredAt } },
        ],
      },
      {
        $set: {
          amount,
          category,
          occurred_at: occurredAtDate,
          is_deleted: false,
          source_updated_at: occurredAt,
        },
        $setOnInsert: { client_id: clientId, license_id: licenseId, source_record_id: sourceRecordId },
      },
      { upsert: true }
    );
  }
}
