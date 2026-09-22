import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import { isVersionEligible, MIN_PER_INVOICE_POS_VERSION } from "@/lib/billing";

/**
 * GET /api/admin/licenses/[id]/billing-eligibility
 *
 * Proactive server-side check for per-invoice billing eligibility.
 * Uses the SAME helper (isVersionEligible) and constants (MIN_PER_INVOICE_POS_VERSION)
 * as the billing PATCH endpoint. The UI only displays these server results.
 *
 * Also returns whether immediate billing model change is safe
 * (no active billing period with usage).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const license = await License.findOne({ id }).lean();
  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });

  // ── Seat compatibility ────────────────────────────────────────────────
  const activeSeats = await LicenseSeat.find({ license_id: id }).lean();

  const seats = activeSeats.map((seat: any) => {
    const version = seat.last_seen_version || null;
    const eligible = isVersionEligible(version, MIN_PER_INVOICE_POS_VERSION);
    let reason = "";
    if (!version) {
      reason = "No version reported — terminal must connect at least once with a modern version.";
    } else if (!eligible) {
      reason = `Running v${version}, minimum required is v${MIN_PER_INVOICE_POS_VERSION}.`;
    }
    return {
      seatId: seat.id,
      displayName: seat.hostname
        ? `${seat.hostname}${seat.terminal_number ? ` (#${seat.terminal_number})` : ""}`
        : `Terminal ${seat.terminal_number || seat.machine_id.slice(0, 8)}`,
      role: seat.role,
      terminalNumber: seat.terminal_number || null,
      version,
      lastSeenAt: seat.last_seen_at,
      eligible,
      reason,
    };
  });

  const allEligible = seats.length === 0 || seats.every((s: any) => s.eligible);

  // ── Immediate application safety ──────────────────────────────────────
  // Immediate model change is safe ONLY when there is no active billing period,
  // or all existing periods are settled (paid/waived) with no pending usage.
  const activePeriods = await LicenseBillingPeriod.find({
    license_id: id,
    status: { $in: ["unpaid", "partially_paid"] },
  }).lean();

  const canApplyImmediately = activePeriods.length === 0;

  return NextResponse.json({
    eligible: allEligible,
    minVersion: MIN_PER_INVOICE_POS_VERSION,
    seats,
    canApplyImmediately,
    currentModel: license.billing?.model || "fixed",
    pendingChanges: license.billing?.pending_changes || null,
  });
}
