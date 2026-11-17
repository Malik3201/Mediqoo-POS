import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import { recordFreshStartAudit } from "@/lib/fresh-start-audit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.license_key || !body.machine_id) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    const license = await License.findOne({ license_key: body.license_key }).lean();
    if (!license) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS }
      );
    }

    if (body.license_id && body.license_id !== license.id) {
      return NextResponse.json(
        { error: "license_id_mismatch" },
        { status: 403, headers: CORS }
      );
    }

    if (license.status === "revoked" || license.status === "suspended") {
      return NextResponse.json(
        { error: "license_inactive", message: `License status is "${license.status}".` },
        { status: 403, headers: CORS }
      );
    }

    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: body.machine_id,
    }).lean();

    if (!seat) {
      return NextResponse.json(
        { error: "unregistered_machine" },
        { status: 403, headers: CORS }
      );
    }

    if (body.seat_id && body.seat_id !== seat.id) {
      return NextResponse.json(
        { error: "seat_id_mismatch" },
        { status: 403, headers: CORS }
      );
    }

    // Strict Guard: Only Main seat can complete Fresh Start
    if (seat.role === "client") {
      await recordFreshStartAudit({
        action: "fresh_start_completion_rejected",
        license,
        previousState: license.fresh_start?.status || "disabled",
        newState: license.fresh_start?.status || "disabled",
        actorName: body.completed_by || "Peer POS Seat",
        cycleId: license.fresh_start?.cycle_id || null,
        authorizationVersion: license.fresh_start?.authorization_version || 1,
        reason: "Peer seat attempted completion",
        extra: { machine_id: body.machine_id, seat_id: seat.id },
      });
      return NextResponse.json(
        { error: "peer_seats_not_allowed", message: "Peer seats cannot complete Fresh Start." },
        { status: 403, headers: CORS }
      );
    }

    const currentStatus = license.fresh_start?.status || "disabled";
    const currentCycleId = license.fresh_start?.cycle_id || null;
    const currentAuthVersion = Number(license.fresh_start?.authorization_version || 1);

    // Normalize both snake_case (from Electron main.cjs) and camelCase
    const incomingCycleId = body.cycle_id ?? body.cycleId ?? null;
    const incomingAuthVersionRaw = body.authorization_version ?? body.authorizationVersion;
    const incomingAuthVersion =
      incomingAuthVersionRaw !== undefined && incomingAuthVersionRaw !== null
        ? Number(incomingAuthVersionRaw)
        : null;

    // CRITICAL GUARD: Only allow completion when status is strictly "enabled"
    if (currentStatus !== "enabled") {
      await recordFreshStartAudit({
        action: "fresh_start_completion_rejected",
        license,
        previousState: currentStatus,
        newState: currentStatus,
        actorName: body.completed_by || "POS Operator",
        cycleId: currentCycleId,
        authorizationVersion: currentAuthVersion,
        reason: `Rejected completion when status="${currentStatus}"`,
        extra: { machine_id: body.machine_id, seat_id: seat.id, incoming_cycle_id: incomingCycleId },
      });
      return NextResponse.json(
        {
          error: "invalid_status_transition",
          message: `Fresh Start cannot be completed from status "${currentStatus}". Status must be "enabled".`,
          current_status: currentStatus,
        },
        { status: 409, headers: CORS }
      );
    }

    // CYCLE GUARD: Verify cycle_id and authorization_version match
    if (currentCycleId && (!incomingCycleId || incomingCycleId !== currentCycleId)) {
      await recordFreshStartAudit({
        action: "fresh_start_completion_rejected",
        license,
        previousState: currentStatus,
        newState: currentStatus,
        actorName: body.completed_by || "POS Operator",
        cycleId: currentCycleId,
        authorizationVersion: currentAuthVersion,
        reason: `Cycle mismatch: expected "${currentCycleId}", got "${incomingCycleId}"`,
        extra: { machine_id: body.machine_id, seat_id: seat.id },
      });
      return NextResponse.json(
        {
          error: "cycle_mismatch",
          message: "Authorization cycle mismatch. This completion request does not match the active approved cycle.",
          expected_cycle: currentCycleId,
          received_cycle: incomingCycleId,
        },
        { status: 409, headers: CORS }
      );
    }

    if (incomingAuthVersion !== null && incomingAuthVersion !== currentAuthVersion) {
      await recordFreshStartAudit({
        action: "fresh_start_completion_rejected",
        license,
        previousState: currentStatus,
        newState: currentStatus,
        actorName: body.completed_by || "POS Operator",
        cycleId: currentCycleId,
        authorizationVersion: currentAuthVersion,
        reason: `Authorization version mismatch: expected ${currentAuthVersion}, got ${incomingAuthVersion}`,
        extra: { machine_id: body.machine_id, seat_id: seat.id },
      });
      return NextResponse.json(
        {
          error: "version_mismatch",
          message: "Authorization version mismatch.",
          expected_version: currentAuthVersion,
          received_version: incomingAuthVersion,
        },
        { status: 409, headers: CORS }
      );
    }

    const now = new Date();
    const completedBy = body.completed_by || "POS Operator";
    const completionNotes = body.notes || "Fresh Start Reset executed successfully in POS";

    // Atomic compare-and-set: only transition when fresh_start.status is still "enabled"
    const updated = await License.findOneAndUpdate(
      {
        id: license.id,
        "fresh_start.status": "enabled",
        ...(currentCycleId ? { "fresh_start.cycle_id": currentCycleId } : {}),
      },
      {
        $set: {
          "fresh_start.status": "completed",
          "fresh_start.completed_at": now,
          "fresh_start.completed_by": completedBy,
          "fresh_start.is_repeat_cycle_request": false,
          "fresh_start.notes": completionNotes,
        },
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return NextResponse.json(
        {
          error: "concurrent_or_stale_completion",
          message: "Fresh Start status changed concurrently and can no longer be completed for this cycle.",
        },
        { status: 409, headers: CORS }
      );
    }

    await recordFreshStartAudit({
      action: "fresh_start_completed",
      license,
      previousState: currentStatus,
      newState: "completed",
      actorName: completedBy,
      cycleId: updated.fresh_start?.cycle_id || currentCycleId,
      authorizationVersion: updated.fresh_start?.authorization_version || currentAuthVersion,
      reason: completionNotes,
      extra: {
        machine_id: body.machine_id,
        seat_id: seat.id,
        license_version: updated.license_version,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "completed",
        completed_at: updated.fresh_start?.completed_at,
        authorization_version: updated.fresh_start?.authorization_version || currentAuthVersion,
        cycle_id: updated.fresh_start?.cycle_id || currentCycleId,
        license_version: updated.license_version,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Complete Fresh Start Error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
