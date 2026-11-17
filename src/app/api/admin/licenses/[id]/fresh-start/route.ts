import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import { recordFreshStartAudit, type FreshStartAuditAction } from "@/lib/fresh-start-audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const nextStatus = body.status;
    if (!["enabled", "disabled", "completed", "rejected", "pending"].includes(nextStatus)) {
      return NextResponse.json(
        { error: "Invalid status. Must be 'enabled', 'disabled', 'completed', 'rejected', or 'pending'." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const existing = await License.findOne({ id }).lean();
    if (!existing) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    const now = new Date();
    const actorId = (token.sub || token.id || undefined) as string | undefined;
    const actorEmail = (token.email || undefined) as string | undefined;
    const operatorName = (token.name || token.email || "Super Administrator") as string;

    const currentFreshStart = existing.fresh_start || { status: "disabled" };
    const prevStatus = currentFreshStart.status || "disabled";

    // Strict State Transition Guards (Requirement 3 & 4)
    if (prevStatus === "completed" && nextStatus === "enabled" && body.new_cycle !== true) {
      return NextResponse.json(
        {
          error:
            "Fresh Start has already been completed for this license. Enabling another reset requires explicit new_cycle=true confirmation.",
        },
        { status: 409 }
      );
    }

    if (prevStatus === "completed" && (nextStatus === "disabled" || nextStatus === "pending")) {
      return NextResponse.json(
        {
          error: `Cannot revert completed Fresh Start directly to "${nextStatus}". Authorize a new Fresh Start cycle if another reset is explicitly required.`,
        },
        { status: 409 }
      );
    }

    if (nextStatus === "completed" && prevStatus !== "enabled") {
      return NextResponse.json(
        { error: `Cannot mark Fresh Start completed from status "${prevStatus}".` },
        { status: 409 }
      );
    }

    const currentVersion = Number(currentFreshStart.authorization_version || 1);
    const isNewCycle =
      body.new_cycle === true ||
      (prevStatus === "completed" && nextStatus === "enabled");

    const nextVersion = isNewCycle ? currentVersion + 1 : currentVersion;
    const nextCycleId =
      isNewCycle || !currentFreshStart.cycle_id
        ? `cycle_${nextVersion}_${crypto.randomUUID().slice(0, 8)}`
        : currentFreshStart.cycle_id;

    const isRepeatCycle =
      isNewCycle || Boolean(currentFreshStart.is_repeat_cycle_request || currentFreshStart.previous_completed_at);

    const updatedFreshStart = {
      ...currentFreshStart,
      status: nextStatus,
      cycle_id: nextCycleId,
      authorization_version: nextVersion,
      is_repeat_cycle_request: nextStatus === "completed" ? false : isRepeatCycle,
      ...(isNewCycle
        ? {
            previous_cycle_id: currentFreshStart.cycle_id || currentFreshStart.previous_cycle_id || null,
            previous_authorization_version: currentVersion,
            previous_completed_at: currentFreshStart.completed_at || currentFreshStart.previous_completed_at || now,
            previous_completed_by: currentFreshStart.completed_by || currentFreshStart.previous_completed_by || null,
          }
        : {}),
      notes: typeof body.notes === "string" ? body.notes : currentFreshStart.notes || null,
      ...(nextStatus === "enabled"
        ? {
            enabled_at: now,
            enabled_by: operatorName,
            completed_at: isNewCycle ? null : currentFreshStart.completed_at || null,
            completed_by: isNewCycle ? null : currentFreshStart.completed_by || null,
            revoked_at: null,
            revoked_by: null,
            rejected_at: null,
            rejected_by: null,
            rejection_reason: null,
          }
        : {}),
      ...(nextStatus === "rejected"
        ? {
            rejected_at: now,
            rejected_by: operatorName,
            rejection_reason: body.rejection_reason || body.notes || "Rejected by Super Administrator",
          }
        : {}),
      ...(nextStatus === "disabled"
        ? {
            revoked_at: now,
            revoked_by: operatorName,
          }
        : {}),
      ...(nextStatus === "completed"
        ? {
            completed_at: now,
            completed_by: operatorName,
          }
        : {}),
    };

    const updated = await License.findOneAndUpdate(
      { id },
      {
        $set: {
          fresh_start: updatedFreshStart,
        },
        $inc: { license_version: 1 },
      },
      { new: true }
    ).lean();

    let auditAction: FreshStartAuditAction = "fresh_start_approved";
    if (nextStatus === "enabled") {
      auditAction = isNewCycle || isRepeatCycle ? "fresh_start_reauthorized" : "fresh_start_approved";
    } else if (nextStatus === "rejected") {
      auditAction = "fresh_start_rejected";
    } else if (nextStatus === "disabled") {
      auditAction = "fresh_start_revoked";
    } else if (nextStatus === "completed") {
      auditAction = "fresh_start_completed";
    } else if (nextStatus === "pending") {
      auditAction = isRepeatCycle ? "fresh_start_new_cycle_requested" : "fresh_start_requested";
    }

    await recordFreshStartAudit({
      action: auditAction,
      license: existing,
      previousState: prevStatus,
      newState: nextStatus,
      actorId,
      actorEmail,
      actorName: operatorName,
      cycleId: nextCycleId,
      authorizationVersion: nextVersion,
      reason: body.rejection_reason || body.notes || null,
      extra: {
        is_new_cycle: isNewCycle,
        is_repeat_cycle_request: isRepeatCycle,
        license_version: updated?.license_version,
      },
    });

    return NextResponse.json({
      ok: true,
      fresh_start: updated?.fresh_start,
      license_version: updated?.license_version,
    });
  } catch (error: any) {
    console.error("License Fresh Start Update Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
