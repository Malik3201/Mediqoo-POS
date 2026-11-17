import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

    // Strict Guard: Peer seats cannot request Fresh Start (Rule 15 / Rule 40)
    if (seat.role === "client") {
      await recordFreshStartAudit({
        action: "fresh_start_request_rejected",
        license,
        previousState: license.fresh_start?.status || "disabled",
        newState: license.fresh_start?.status || "disabled",
        actorName: body.requested_by || "Peer POS Seat",
        cycleId: license.fresh_start?.cycle_id || null,
        authorizationVersion: license.fresh_start?.authorization_version || 1,
        reason: "Peer seat attempted Fresh Start request",
        extra: { machine_id: body.machine_id, seat_id: seat.id },
      });
      return NextResponse.json(
        { error: "peer_seats_not_allowed", message: "Fresh Start is managed from the Main POS." },
        { status: 403, headers: CORS }
      );
    }

    const currentFs = license.fresh_start || { status: "disabled" };
    const currentStatus = currentFs.status || "disabled";
    const currentVersion = Number(currentFs.authorization_version || 1);
    const currentCycleId = currentFs.cycle_id || null;
    const requestedBy = body.requested_by || "Main POS Owner";

    // Idempotent return when already enabled for active cycle
    if (currentStatus === "enabled") {
      return NextResponse.json(
        {
          ok: true,
          status: "enabled",
          message: "Fresh Start is already approved",
          authorization_version: currentVersion,
          cycle_id: currentCycleId,
        },
        { headers: CORS }
      );
    }

    // Idempotent return when already pending
    if (currentStatus === "pending") {
      return NextResponse.json(
        {
          ok: true,
          status: "pending",
          message: "Fresh Start request is already pending Super Admin approval",
          requested_at: currentFs.requested_at,
          authorization_version: currentVersion,
          cycle_id: currentCycleId,
        },
        { headers: CORS }
      );
    }

    // HARD GUARD FOR COMPLETED LICENSES (Requirement 4):
    // A completed license must NEVER transition back to pending from a normal first-time request.
    // A subsequent reset strictly requires an explicit new-cycle request that increments authorization_version
    // and mints a fresh cycle_id while preserving completion history for Super Admin warning.
    const wantsNewCycle = body.new_cycle === true || body.request_new_cycle === true;
    if (currentStatus === "completed" && !wantsNewCycle) {
      await recordFreshStartAudit({
        action: "fresh_start_request_rejected",
        license,
        previousState: "completed",
        newState: "completed",
        actorName: requestedBy,
        cycleId: currentCycleId,
        authorizationVersion: currentVersion,
        reason: "Normal Fresh Start request rejected because current cycle is already completed; explicit new cycle required.",
        extra: { machine_id: body.machine_id, seat_id: seat.id },
      });
      return NextResponse.json(
        {
          error: "fresh_start_already_completed",
          message:
            "Fresh Start has already been completed for this license. A subsequent reset requires an explicit New Authorization Cycle request and Super Admin re-approval.",
          current_status: "completed",
          authorization_version: currentVersion,
          cycle_id: currentCycleId,
        },
        { status: 409, headers: CORS }
      );
    }

    const now = new Date();
    const isRepeatCycle = currentStatus === "completed" && wantsNewCycle;
    const nextVersion = isRepeatCycle ? currentVersion + 1 : currentVersion;
    const nextCycleId =
      isRepeatCycle || !currentCycleId
        ? `cycle_${nextVersion}_${crypto.randomUUID().slice(0, 8)}`
        : currentCycleId;

    const updateSet: Record<string, unknown> = {
      "fresh_start.status": "pending",
      "fresh_start.cycle_id": nextCycleId,
      "fresh_start.authorization_version": nextVersion,
      "fresh_start.requested_at": now,
      "fresh_start.requested_by": requestedBy,
      "fresh_start.app_version": body.app_version || null,
      "fresh_start.notes": body.notes || (isRepeatCycle ? "Explicit new Fresh Start cycle requested from Main POS" : "Requested from Main POS seat"),
      "fresh_start.rejected_at": null,
      "fresh_start.rejected_by": null,
      "fresh_start.rejection_reason": null,
      "fresh_start.is_repeat_cycle_request": isRepeatCycle,
    };

    if (isRepeatCycle) {
      updateSet["fresh_start.previous_cycle_id"] = currentCycleId;
      updateSet["fresh_start.previous_authorization_version"] = currentVersion;
      updateSet["fresh_start.previous_completed_at"] = currentFs.completed_at || now;
      updateSet["fresh_start.previous_completed_by"] = currentFs.completed_by || null;
      // Clear active-cycle enabled/completed stamps until Super Admin approves the new cycle
      updateSet["fresh_start.enabled_at"] = null;
      updateSet["fresh_start.enabled_by"] = null;
      updateSet["fresh_start.completed_at"] = null;
      updateSet["fresh_start.completed_by"] = null;
    }

    const updated = await License.findOneAndUpdate(
      { id: license.id, "fresh_start.status": currentStatus },
      {
        $set: updateSet,
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return NextResponse.json(
        { error: "concurrent_status_change", message: "License Fresh Start status changed concurrently. Please retry." },
        { status: 409, headers: CORS }
      );
    }

    await recordFreshStartAudit({
      action: isRepeatCycle ? "fresh_start_new_cycle_requested" : "fresh_start_requested",
      license,
      previousState: currentStatus,
      newState: "pending",
      actorName: requestedBy,
      cycleId: nextCycleId,
      authorizationVersion: nextVersion,
      reason: (updateSet["fresh_start.notes"] as string) || null,
      extra: {
        machine_id: body.machine_id,
        seat_id: seat.id,
        app_version: body.app_version || null,
        is_repeat_cycle_request: isRepeatCycle,
        previous_cycle_id: isRepeatCycle ? currentCycleId : null,
        previous_authorization_version: isRepeatCycle ? currentVersion : null,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "pending",
        requested_at: updated.fresh_start?.requested_at,
        authorization_version: updated.fresh_start?.authorization_version || nextVersion,
        cycle_id: updated.fresh_start?.cycle_id || nextCycleId,
        is_repeat_cycle_request: isRepeatCycle,
        license_version: updated.license_version,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Request Fresh Start Error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
