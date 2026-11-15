import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import LicenseSeat from "@/models/LicenseSeat";
import ReleaseInstall from "@/models/ReleaseInstall";
import {
  calculateNextPaymentDate,
  calculatePeriodDates,
  isRecurringBillingEnabled,
  isVersionEligible,
  MIN_PER_INVOICE_POS_VERSION,
  resolveBillingModel,
} from "@/lib/billing";
import { createOrGetActivationVoucher } from "@/lib/renewal-voucher";
import { sendVoucherEmail } from "@/lib/email";

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
      message: "Pending billing changes cancelled.",
    });
  }

  if (!body.billing) {
    return NextResponse.json({ error: "Missing billing configuration" }, { status: 400 });
  }

  const b = body.billing;
  const billingEnabled = Boolean(b.enabled);
  const setupType: "none" | "installation" | "lifetime" =
    b.setup_type === "installation" || b.setup_type === "lifetime" ? b.setup_type : "none";
  const recurringEnabled =
    b.recurring_enabled !== undefined
      ? Boolean(b.recurring_enabled)
      : setupType !== "lifetime";
  const requestedModel: "fixed" | "per_invoice" =
    b.model === "per_invoice" ? "per_invoice" : "fixed";

  // ── Per-invoice version eligibility check (only when recurring per_invoice is active) ──
  if (billingEnabled && recurringEnabled && requestedModel === "per_invoice") {
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
    const rate = Number(b.rate_per_invoice);
    if (!rate || rate <= 0 || !isFinite(rate)) {
      return NextResponse.json({
        error: "invalid_rate",
        detail: "rate_per_invoice must be a positive finite number for per_invoice billing model.",
      }, { status: 400 });
    }
  }

  const adminIdentity =
    (token.email as string) || (token.name as string) || "Super Admin";
  const requestIdemKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : null;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");

    // ── Optional License Expiry / Lifetime Expiry update ────────────────
    if (b.set_lifetime_expiry === true || body.set_lifetime_expiry === true || b.expires_at === null) {
      license.set("expires_at", null);
    } else if (typeof b.expires_at === "string" && b.expires_at.trim()) {
      const parsedExpiry = new Date(b.expires_at);
      if (!isNaN(parsedExpiry.getTime())) {
        license.set("expires_at", parsedExpiry);
      }
    } else if (typeof body.expires_at === "string" && body.expires_at.trim()) {
      const parsedExpiry = new Date(body.expires_at);
      if (!isNaN(parsedExpiry.getTime())) {
        license.set("expires_at", parsedExpiry);
      }
    }

    const previousModel = resolveBillingModel(license.billing);
    const previousRate = license.billing?.rate_per_invoice || 0;
    const previousAmount = license.billing?.amount || 0;
    const wasRecurring = isRecurringBillingEnabled(license.billing);
    const recurringActiveAndRemainsActive =
      wasRecurring && billingEnabled && recurringEnabled;

    // ── Determine if recurring model/rate is changing ───────────────────
    const modelChanging = requestedModel !== previousModel;
    const rateChanging =
      requestedModel === "per_invoice" &&
      Number(b.rate_per_invoice) !== previousRate;
    const amountChanging =
      requestedModel === "fixed" && Number(b.amount) !== previousAmount;
    const billingConfigChanging = modelChanging || rateChanging || amountChanging;

    // ── Determine if immediate application is safe ──────────────────────
    const activePeriods = await LicenseBillingPeriod.find({
      license_id: license.id,
      status: { $in: ["unpaid", "partially_paid"] },
    }).session(session);

    const canApplyImmediately = activePeriods.length === 0;

    // ── Setup / Installation / Lifetime fields ──────────────────────────
    const prevSetupType = license.billing?.setup_type || "none";
    const prevSetupPaid = Math.max(
      0,
      Number(license.billing?.setup_paid_amount || 0)
    );
    const installationCharges =
      setupType === "installation"
        ? Math.max(0, Number(b.installation_charges ?? 0) || 0)
        : 0;
    const lifetimeAmount =
      setupType === "lifetime"
        ? Math.max(0, Number(b.lifetime_amount ?? 0) || 0)
        : 0;
    const setupTotalCharge =
      setupType === "installation"
        ? installationCharges
        : setupType === "lifetime"
        ? lifetimeAmount
        : 0;

    const hasExplicitSetupPaid =
      b.setup_paid_amount !== undefined &&
      b.setup_paid_amount !== null &&
      b.setup_paid_amount !== "";
    const setupPaidAmount = hasExplicitSetupPaid
      ? Math.max(0, Number(b.setup_paid_amount) || 0)
      : prevSetupType === setupType
      ? prevSetupPaid
      : 0;

    const deltaPaid =
      setupType === "none"
        ? 0
        : prevSetupType === setupType
        ? Math.max(0, setupPaidAmount - prevSetupPaid)
        : setupPaidAmount;

    const setupPaymentStatus: "paid" | "partially_paid" | "unpaid" =
      setupTotalCharge <= 0
        ? setupPaidAmount > 0
          ? "paid"
          : "unpaid"
        : setupPaidAmount >= setupTotalCharge
        ? "paid"
        : setupPaidAmount > 0
        ? "partially_paid"
        : "unpaid";

    const setupPaymentMethod =
      b.setup_payment_method || license.billing?.setup_payment_method || "Cash";
    const setupPaymentReference =
      b.setup_payment_reference !== undefined
        ? b.setup_payment_reference
        : license.billing?.setup_payment_reference;
    const setupNotes =
      b.setup_notes !== undefined ? b.setup_notes : license.billing?.setup_notes;
    const setupPaidAt =
      deltaPaid > 0
        ? new Date()
        : setupPaidAmount > 0
        ? license.billing?.setup_paid_at || new Date()
        : null;

    const currency = b.currency || license.billing?.currency || "PKR";
    const resolvedGraceDays =
      b.grace_days !== undefined && b.grace_days !== null && b.grace_days !== ""
        ? Number(b.grace_days)
        : license.billing?.grace_days ?? 3;

    const billingBase: any = {
      enabled: billingEnabled,
      recurring_enabled: recurringEnabled,
      setup_type: setupType,
      installation_charges: installationCharges,
      lifetime_amount: lifetimeAmount,
      setup_paid_amount: setupPaidAmount,
      setup_payment_status: setupPaymentStatus,
      setup_payment_method: setupPaymentMethod,
      setup_payment_reference: setupPaymentReference,
      setup_paid_at: setupPaidAt,
      setup_voucher_id: license.billing?.setup_voucher_id || null,
      setup_notes: setupNotes,
      currency,
      cycle: b.cycle || license.billing?.cycle || "monthly",
      grace_days: recurringEnabled ? (Number.isFinite(resolvedGraceDays) ? resolvedGraceDays : 3) : 0,
      reminder_days: b.reminder_days || license.billing?.reminder_days || [1],
      min_app_version: b.min_app_version || license.billing?.min_app_version || undefined,
    };

    let appliedMode: "immediate" | "pending" = "immediate";

    if (recurringActiveAndRemainsActive && billingConfigChanging && !canApplyImmediately) {
      // ── PENDING CHANGE: Store recurring change for next renewal ──────
      appliedMode = "pending";
      license.billing = {
        ...billingBase,
        model: previousModel,
        amount: previousAmount,
        rate_per_invoice: previousModel === "per_invoice" ? previousRate : undefined,
        pending_changes: {
          model: requestedModel,
          amount: requestedModel === "fixed" ? Number(b.amount) || 0 : undefined,
          rate_per_invoice: requestedModel === "per_invoice" ? Number(b.rate_per_invoice) || 0 : undefined,
          effective_from: activePeriods[0]?.period_end || null,
        },
      };
    } else {
      // ── IMMEDIATE APPLICATION ───────────────────────────────────────
      license.billing = {
        ...billingBase,
        model: requestedModel,
        amount: recurringEnabled ? Number(b.amount) || 0 : 0,
        rate_per_invoice:
          recurringEnabled && requestedModel === "per_invoice"
            ? Number(b.rate_per_invoice)
            : undefined,
        pending_changes: null,
      };
    }

    license.license_version = (license.license_version || 1) + 1;

    // ── Record one-time Setup / Installation / Lifetime payment ledger ──
    let createdPayment: any = null;
    if (billingEnabled && deltaPaid > 0) {
      const paymentIdemKey = requestIdemKey
        ? `setup-pay:${requestIdemKey}`
        : `setup-pay:${license.id}:${crypto.randomUUID()}`;

      createdPayment = await LicensePayment.findOne({
        license_id: license.id,
        idempotency_key: paymentIdemKey,
      }).session(session);

      if (!createdPayment) {
        const paymentAction =
          setupType === "lifetime"
            ? "lifetime_activation"
            : "installation_activation";
        const receiptNumber = `AV-SET-${crypto
          .randomBytes(3)
          .toString("hex")
          .toUpperCase()}`;

        const [savedPay] = await LicensePayment.create(
          [
            {
              client_id: license.client_id,
              license_id: license.id,
              billing_period_id: "one_time_setup",
              billing_period_ids: [],
              amount_paid: deltaPaid,
              currency,
              paid_at: setupPaidAt || new Date(),
              payment_method: setupPaymentMethod,
              payment_reference: setupPaymentReference || undefined,
              idempotency_key: paymentIdemKey,
              notes:
                setupNotes ||
                (setupType === "lifetime"
                  ? "Lifetime license settlement collected at billing activation"
                  : "Software installation charges collected at billing activation"),
              recorded_by: adminIdentity,
              receipt_number: receiptNumber,
              action: paymentAction,
              email_status: "pending",
            },
          ],
          { session }
        );
        createdPayment = savedPay;
      }
    }

    // ── Idempotently create the initial recurring billing period ────────
    if (isRecurringBillingEnabled(license.billing)) {
      const existingPeriod = await LicenseBillingPeriod.findOne({
        license_id: license.id,
      }).session(session);

      if (!existingPeriod) {
        const now = new Date();
        const periodStart = license.issued_at ? new Date(license.issued_at) : now;
        const fallbackEnd = calculatePeriodDates(
          periodStart,
          license.billing.cycle || "monthly"
        ).period_end;
        const periodEnd = license.expires_at ? new Date(license.expires_at) : fallbackEnd;
        const effectiveModel = resolveBillingModel(license.billing);
        const isPerInvoice = effectiveModel === "per_invoice";

        await LicenseBillingPeriod.create(
          [
            {
              client_id: license.client_id,
              license_id: license.id,
              period_start: periodStart,
              period_end: periodEnd,
              due_at: periodStart,
              amount_due: isPerInvoice ? 0 : license.billing.amount || 0,
              currency: license.billing.currency || "PKR",
              billing_model: effectiveModel,
              rate_snapshot: isPerInvoice
                ? license.billing.rate_per_invoice || 0
                : undefined,
              status: "unpaid",
            },
          ],
          { session }
        );
      }
    }

    // ── Create Activation / Installation / Lifetime Voucher ─────────────
    let createdVoucher: any = null;
    const shouldGenerateVoucher =
      billingEnabled &&
      (body.generate_voucher === true ||
        (body.generate_voucher !== false &&
          (setupTotalCharge > 0 || deltaPaid > 0)));

    if (shouldGenerateVoucher) {
      const voucherIdemKey = requestIdemKey
        ? `act-voucher:${requestIdemKey}`
        : `act-voucher:${license.id}:${crypto.randomUUID()}`;

      const nextPaymentDate = calculateNextPaymentDate(license);
      const effectiveModel = resolveBillingModel(license.billing);

      createdVoucher = await createOrGetActivationVoucher({
        license: license.toObject ? license.toObject() : license,
        payment: createdPayment,
        action:
          setupType === "lifetime"
            ? "lifetime_activation"
            : setupType === "installation"
            ? "installation_activation"
            : "billing_activation",
        idempotency_key: voucherIdemKey,
        currency,
        setup_type: setupType,
        installation_charges: installationCharges,
        lifetime_amount: lifetimeAmount,
        recurring_enabled: recurringEnabled,
        recurring_model: recurringEnabled ? effectiveModel : null,
        recurring_cycle: recurringEnabled
          ? (license.billing?.cycle as "monthly" | "yearly") || "monthly"
          : null,
        recurring_amount:
          recurringEnabled && effectiveModel === "fixed"
            ? Number(license.billing?.amount || 0)
            : 0,
        recurring_rate_per_invoice:
          recurringEnabled && effectiveModel === "per_invoice"
            ? Number(license.billing?.rate_per_invoice || 0)
            : 0,
        next_payment_date: nextPaymentDate,
        total_payable: setupTotalCharge,
        amount_paid: setupPaidAmount,
        payment_method: setupPaymentMethod,
        payment_reference: setupPaymentReference,
        processed_by: adminIdentity,
        notes: setupNotes,
        include_acceptance_terms: true,
        session,
      });

      license.set("billing.setup_voucher_id", createdVoucher.id);
    }

    await license.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ── Auto-email PDF voucher to client (non-blocking error handling) ──
    let emailResult: any = null;
    const autoEmail = body.auto_email !== false;
    if (createdVoucher && autoEmail) {
      try {
        emailResult = await sendVoucherEmail(createdVoucher.id);
      } catch (emailErr: any) {
        emailResult = {
          sent: false,
          error: emailErr?.message || "Email dispatch failed",
        };
      }
    }

    const voucherObj = createdVoucher?.toJSON
      ? createdVoucher.toJSON()
      : createdVoucher;
    if (voucherObj && emailResult) {
      voucherObj.email_status = emailResult.sent
        ? "sent"
        : emailResult.reason
        ? "skipped"
        : "failed";
    }

    return NextResponse.json({
      success: true,
      billing: license.billing,
      expires_at: license.expires_at || null,
      applied: appliedMode,
      message:
        appliedMode === "pending"
          ? `Setup saved and recurring change scheduled for next renewal. Current cycle remains ${previousModel}.`
          : undefined,
      payment: createdPayment?.toJSON ? createdPayment.toJSON() : createdPayment,
      voucher: voucherObj || null,
      email_result: emailResult,
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
