import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicenseSeat from "@/models/LicenseSeat";
import ReleaseInstall from "@/models/ReleaseInstall";
import { calculatePeriodDates, resolveBillingModel, isVersionEligible, MIN_PER_INVOICE_POS_VERSION } from "@/lib/billing";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();
  const body = await req.json();

  // ── Cancel pending changes ────────────────────────────────────────────
  if (body.cancel_pending === true) {
    const license = await License.findOne({ id });
    if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });
    
    license.billing = {
      ...license.billing,
      pending_changes: null,
    };
    await license.save();
    
    return NextResponse.json({ 
      success: true, 
      billing: license.billing,
      message: "Pending billing changes cancelled." 
    });
  }

  if (!body.billing) {
    return NextResponse.json({ error: "Missing billing configuration" }, { status: 400 });
  }

  const requestedModel = body.billing.model || "fixed";

  // ── Per-invoice version eligibility check ─────────────────────────────
  if (requestedModel === "per_invoice") {
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
    if (!rate || rate <= 0 || !isFinite(rate)) {
      return NextResponse.json({
        error: "invalid_rate",
        detail: "rate_per_invoice must be a positive finite number for per_invoice billing model.",
      }, { status: 400 });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");

    const previousModel = resolveBillingModel(license.billing);
    const previousRate = license.billing?.rate_per_invoice || 0;
    const previousAmount = license.billing?.amount || 0;

    // ── Determine if model/rate is actually changing ────────────────────
    const modelChanging = requestedModel !== previousModel;
    const rateChanging = requestedModel === "per_invoice" && Number(body.billing.rate_per_invoice) !== previousRate;
    const amountChanging = requestedModel === "fixed" && Number(body.billing.amount) !== previousAmount;
    const billingConfigChanging = modelChanging || rateChanging || amountChanging;

    // ── Determine if immediate application is safe ──────────────────────
    // Safe = no active (unpaid/partially_paid) billing periods exist.
    // This means the license is either new, or all periods are settled.
    const activePeriods = await LicenseBillingPeriod.find({
      license_id: license.id,
      status: { $in: ["unpaid", "partially_paid"] },
    }).session(session);

    const canApplyImmediately = activePeriods.length === 0;

    // ── Always-updatable fields (grace, cycle, currency, enabled) ───────
    // These are safe to update mid-cycle as they affect future behavior.
    const billingBase: any = {
      enabled: Boolean(body.billing.enabled),
      currency: body.billing.currency || license.billing?.currency || "PKR",
      cycle: body.billing.cycle || license.billing?.cycle || "monthly",
      grace_days: Number(body.billing.grace_days) ?? license.billing?.grace_days ?? 3,
      reminder_days: body.billing.reminder_days || license.billing?.reminder_days || [1],
      min_app_version: body.billing.min_app_version || license.billing?.min_app_version || undefined,
    };

    if (billingConfigChanging && !canApplyImmediately) {
      // ── PENDING CHANGE: Store for next renewal ──────────────────────
      // Keep current model/amount/rate frozen for the active cycle.
      license.billing = {
        ...billingBase,
        model: previousModel,
        amount: previousAmount,
        rate_per_invoice: previousModel === "per_invoice" ? previousRate : undefined,
        pending_changes: {
          model: requestedModel,
          amount: requestedModel === "fixed" ? Number(body.billing.amount) : undefined,
          rate_per_invoice: requestedModel === "per_invoice" ? Number(body.billing.rate_per_invoice) : undefined,
          effective_from: activePeriods[0]?.period_end || null,
        },
      };

      license.license_version = (license.license_version || 1) + 1;
      await license.save({ session });

      await session.commitTransaction();
      session.endSession();

      return NextResponse.json({ 
        success: true, 
        billing: license.billing,
        applied: "pending",
        message: `Change scheduled for next renewal. Current cycle remains ${previousModel}.`,
      });
    }

    // ── IMMEDIATE APPLICATION ─────────────────────────────────────────
    license.billing = {
      ...billingBase,
      model: requestedModel,
      amount: Number(body.billing.amount) || 0,
      rate_per_invoice: requestedModel === "per_invoice" ? Number(body.billing.rate_per_invoice) : undefined,
      pending_changes: null, // Clear any prior pending changes
    };

    license.license_version = (license.license_version || 1) + 1;
    await license.save({ session });

    // Idempotently create the initial billing period if billing is enabled
    if (license.billing.enabled) {
      const existingPeriod = await LicenseBillingPeriod.findOne({ license_id: license.id }).session(session);
      
      if (!existingPeriod) {
        const now = new Date();
        const periodStart = license.issued_at ? new Date(license.issued_at) : now;
        const fallbackEnd = calculatePeriodDates(periodStart, license.billing.cycle).period_end;
        const periodEnd = license.expires_at ? new Date(license.expires_at) : fallbackEnd;

        const isPerInvoice = requestedModel === "per_invoice";

        await LicenseBillingPeriod.create([{
          client_id: license.client_id,
          license_id: license.id,
          period_start: periodStart,
          period_end: periodEnd,
          due_at: periodStart,
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

    return NextResponse.json({ 
      success: true, 
      billing: license.billing,
      applied: "immediate",
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
