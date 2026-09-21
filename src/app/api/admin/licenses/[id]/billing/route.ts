import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import ReleaseInstall from "@/models/ReleaseInstall";
import { calculatePeriodDates, resolveBillingModel, isVersionEligible, MIN_PER_INVOICE_POS_VERSION } from "@/lib/billing";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();
  const body = await req.json();

  if (!body.billing) {
    return NextResponse.json({ error: "Missing billing configuration" }, { status: 400 });
  }

  const requestedModel = body.billing.model || "fixed";

  // ── Per-invoice version eligibility check ─────────────────────────────
  // A per_invoice billing model MUST NOT be assignable unless all active seats
  // for the license have a metering-capable POS version.
  if (requestedModel === "per_invoice") {
    // We get all assigned seats. Seats that are released/inactive are already deleted from the collection.
    const activeSeats = await LicenseSeat.find({ license_id: id }).lean();
    
    for (const seat of activeSeats) {
      if (!seat.last_seen_version) {
        return NextResponse.json({
          error: "no_version_reported",
          detail: `Cannot enable per_invoice billing: Seat ${seat.terminal_number || seat.machine_id} has never reported its version. The client must connect at least once with a modern version.`,
          min_version: MIN_PER_INVOICE_POS_VERSION,
        }, { status: 400 });
      }

      if (!isVersionEligible(seat.last_seen_version, MIN_PER_INVOICE_POS_VERSION)) {
        return NextResponse.json({
          error: "version_too_old",
          detail: `Cannot enable per_invoice billing: Seat ${seat.terminal_number || seat.machine_id} is running version ${seat.last_seen_version}, but minimum required is ${MIN_PER_INVOICE_POS_VERSION}.`,
          reported_version: seat.last_seen_version,
          min_version: MIN_PER_INVOICE_POS_VERSION,
          machine_id: seat.machine_id,
        }, { status: 400 });
      }
    }

    // Validate rate_per_invoice is set and positive
    const rate = Number(body.billing.rate_per_invoice);
    if (!rate || rate <= 0) {
      return NextResponse.json({
        error: "invalid_rate",
        detail: "rate_per_invoice must be a positive number for per_invoice billing model.",
      }, { status: 400 });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");

    const previousModel = resolveBillingModel(license.billing);

    // Update the billing config
    license.billing = {
      enabled: Boolean(body.billing.enabled),
      model: requestedModel,
      amount: Number(body.billing.amount) || 0,
      rate_per_invoice: requestedModel === "per_invoice" ? Number(body.billing.rate_per_invoice) : undefined,
      currency: body.billing.currency || "PKR",
      cycle: body.billing.cycle || "monthly",
      grace_days: Number(body.billing.grace_days) || 3,
      reminder_days: body.billing.reminder_days || [1],
      min_app_version: body.billing.min_app_version || undefined,
      // Preserve existing pending_changes unless explicitly set
      pending_changes: body.billing.pending_changes !== undefined
        ? body.billing.pending_changes
        : (license.billing?.pending_changes || null),
    };

    license.license_version = (license.license_version || 1) + 1;

    await license.save({ session });

    // Idempotently create the initial billing period if billing is enabled
    if (license.billing.enabled) {
      const existingPeriod = await LicenseBillingPeriod.findOne({ license_id: license.id }).session(session);
      
      if (!existingPeriod) {
        const now = new Date();
        const baseDate = license.expires_at ? new Date(license.expires_at) : now;
        const periodDates = calculatePeriodDates(baseDate, license.billing.cycle);

        const isPerInvoice = requestedModel === "per_invoice";

        await LicenseBillingPeriod.create([{
          client_id: license.client_id,
          license_id: license.id,
          period_start: periodDates.period_start,
          period_end: periodDates.period_end,
          due_at: periodDates.due_at,
          // For per_invoice: amount_due starts at 0 (derived from usage)
          // For fixed: amount_due is the configured amount
          amount_due: isPerInvoice ? 0 : (license.billing.amount || 0),
          currency: license.billing.currency,
          billing_model: requestedModel,
          rate_snapshot: isPerInvoice ? (license.billing.rate_per_invoice || 0) : undefined,
          status: "unpaid"
        }], { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    return NextResponse.json({ success: true, billing: license.billing });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
