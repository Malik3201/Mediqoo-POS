import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import AuditLog from "@/models/AuditLog";
import { calculateRenewalDates, calculatePeriodDates, resolveBillingModel, deriveOutstanding, getCurrentBillingPeriod } from "@/lib/billing";
import { sendPaymentReceipt } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const body = await req.json();
  const { 
    amount_paid, 
    payment_method, 
    payment_reference, 
    idempotency_key, 
    notes, 
    override_renewal, 
    override_reason, 
    action, // "extend_only", "renew_only", "payment_only", "payment_and_renew", "renew"
    extension_months,
    custom_expiry,
    is_lifetime
  } = body;

  if (!idempotency_key) return NextResponse.json({ error: "idempotency_key required" }, { status: 400 });
  const paymentAmount = Number(amount_paid || 0);

  // Early idempotency check
  const existingPayment = await LicensePayment.findOne({ license_id: id, idempotency_key }).lean();
  if (existingPayment) {
    return NextResponse.json({ success: true, payment: existingPayment, idempotent: true });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let paymentRecord: any;

  try {
    const license = await License.findOne({ id }).populate("clients").session(session);
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const billingModel = resolveBillingModel(license.billing);

    const allPeriods = await LicenseBillingPeriod.find({ license_id: license.id }).session(session);
    allPeriods.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

    let totalOutstandingBefore = 0;
    let totalUsageAmount = 0;
    let totalInvoiceCount = 0;
    let latestRate = license.billing.rate || 0;
    const payablePeriods = [];

    if (billingModel === "per_invoice") {
      const usages = await BillingUsage.find({ license_id: id }).session(session);
      const payments = await LicensePayment.find({ license_id: id }).session(session);
      const adjustments = await BillingAdjustment.find({ license_id: id }).session(session);

      totalUsageAmount = usages.reduce((sum, u) => sum + u.amount, 0);
      totalInvoiceCount = usages.reduce((sum, u) => sum + u.unit_count, 0);
      const totalPayments = payments.reduce((sum, p) => sum + p.amount_paid, 0);
      totalOutstandingBefore = deriveOutstanding(totalUsageAmount, adjustments as any, totalPayments);

      for (const bp of allPeriods) {
        const bpUsages = usages.filter(u => u.billing_period_id === bp.id);
        const bpPayments = payments.filter(p => p.billing_period_id === bp.id);
        const bpAdjustments = adjustments.filter(a => a.billing_period_id === bp.id);
        
        const bpUsageAmount = bpUsages.reduce((sum, u) => sum + u.amount, 0);
        const bpPaymentAmount = bpPayments.reduce((sum, p) => sum + p.amount_paid, 0);
        const bpOutstanding = deriveOutstanding(bpUsageAmount, bpAdjustments as any, bpPaymentAmount);
        
        if (bpOutstanding > 0) {
          payablePeriods.push({ period: bp, outstanding: bpOutstanding });
        }
        latestRate = bp.rate_snapshot || latestRate;
      }
    } else {
      for (const bp of allPeriods) {
        const bpOutstanding = Math.max(0, bp.amount_due - (bp.amount_paid || 0));
        if (bpOutstanding > 0) {
          payablePeriods.push({ period: bp, outstanding: bpOutstanding });
        }
        totalOutstandingBefore += bpOutstanding;
        latestRate = bp.rate_snapshot || latestRate;
      }
    }

    const isExtendOnly = action === "extend_only" || action === "renew_only";
    const isPaymentOnly = action === "payment_only";
    const isPaymentAndRenew = action === "payment_and_renew" || action === "renew" || !action;

    // Determine operations
    const shouldRecordPayment = !isExtendOnly && (paymentAmount > 0 || override_renewal);
    const shouldExtendLicense = isExtendOnly || (isPaymentAndRenew && (paymentAmount > 0 || totalOutstandingBefore === 0 || override_renewal));

    if (shouldRecordPayment || (isPaymentAndRenew && totalOutstandingBefore > 0)) {
      if (paymentAmount < totalOutstandingBefore && !override_renewal) {
        throw new Error(`Amount paid (${paymentAmount}) is insufficient to cover outstanding debt (${totalOutstandingBefore}). Full payment required to renew.`);
      }
    }

    if (override_renewal && !override_reason) {
      throw new Error("Override reason is required when bypassing debt.");
    }

    if (paymentAmount > totalOutstandingBefore) {
      throw new Error(`Overpayment blocked. Amount (${paymentAmount}) exceeds current outstanding (${totalOutstandingBefore}).`);
    }

    // 1. Process Payment if requested
    if (shouldRecordPayment) {
      const shortId = idempotency_key.split("_").pop() || Date.now().toString().slice(-6);
      const receiptNumber = `AV-PAY-${new Date().toISOString().slice(2,10).replace(/-/g, "")}-${shortId.slice(-6).toUpperCase()}`;
      
      const currentPeriodByTime = getCurrentBillingPeriod(allPeriods.map(p => p.toObject ? p.toObject() : p));
      const primaryPeriodId = payablePeriods.length > 0 
        ? payablePeriods[0].period.id 
        : (currentPeriodByTime?.id || allPeriods[0]?.id || "");
      const allocatedPeriodIds = payablePeriods.map(p => p.period.id);

      const payment = await LicensePayment.create([{
        client_id: license.client_id,
        license_id: license.id,
        billing_period_id: primaryPeriodId,
        billing_period_ids: allocatedPeriodIds,
        amount_paid: paymentAmount,
        currency: license.billing?.currency || "PKR",
        payment_method,
        payment_reference,
        idempotency_key,
        notes: override_renewal ? `OVERRIDE RENEWAL: ${override_reason} - ${notes || ""}` : notes,
        recorded_by: token.email || token.name || "admin",
        
        usage_count_snapshot: totalInvoiceCount,
        usage_amount_snapshot: totalUsageAmount,
        outstanding_before: totalOutstandingBefore,
        outstanding_after: Math.max(0, totalOutstandingBefore - paymentAmount),
        rate_snapshot: latestRate,
        receipt_number: receiptNumber,
        action: action || "payment_and_renew",
        email_status: "pending"
      }], { session });
      
      paymentRecord = payment[0];
      
      let amountRemaining = paymentAmount;
      for (const { period, outstanding } of payablePeriods) {
        if (amountRemaining <= 0 && !override_renewal) break;
        
        const allocation = Math.min(amountRemaining, outstanding);
        period.amount_paid = (period.amount_paid || 0) + allocation;
        amountRemaining = Math.max(0, amountRemaining - allocation);
        
        if (billingModel === "per_invoice") {
          const periodUsages = await BillingUsage.find({ billing_period_id: period.id }).session(session);
          const periodUsageAmount = periodUsages.reduce((s: number, u: any) => s + u.amount, 0);
          const allPeriodPayments = await LicensePayment.find({ billing_period_id: period.id }).session(session);
          const periodTotalPaid = allPeriodPayments.reduce((s: number, p: any) => s + p.amount_paid, 0);
          
          if (periodTotalPaid >= periodUsageAmount && periodUsageAmount > 0) {
            period.status = "paid";
          } else if (periodTotalPaid > 0) {
            period.status = "partially_paid";
          }
        } else {
          if (period.amount_paid >= period.amount_due && period.amount_due > 0) {
            period.status = "paid";
          } else {
            period.status = "partially_paid";
          }
        }

        await period.save({ session });
      }
    }

    // 2. Extend License Expiry if requested
    if (shouldExtendLicense) {
      const dates = calculateRenewalDates(license, {
        extensionMonths: typeof extension_months === "number" ? extension_months : undefined,
        customExpiryDate: custom_expiry || undefined,
        isLifetime: Boolean(is_lifetime),
      });

      const oldExpiry = license.expires_at;
      license.expires_at = dates.newExpiry;
      license.grace_until = dates.newGraceUntil;

      if (license.billing?.pending_changes) {
        const pc = license.billing.pending_changes;
        if (pc.model) license.billing.model = pc.model;
        if (pc.amount !== undefined && pc.amount !== null) license.billing.amount = pc.amount;
        if (pc.rate_per_invoice !== undefined && pc.rate_per_invoice !== null) {
          license.billing.rate_per_invoice = pc.rate_per_invoice;
        }
        license.billing.pending_changes = null;
      }
      
      await license.save({ session });

      // Record AuditLog
      try {
        await AuditLog.create([{
          action: isExtendOnly ? "license.manual_extension" : "license.renew",
          actor_id: (token.sub as string) || (token.id as string) || "",
          actor_email: token.email || token.name || "admin",
          entity_type: "License",
          entity_id: license.id,
          metadata: {
            client_id: license.client_id,
            old_expiry: oldExpiry,
            new_expiry: dates.newExpiry,
            new_grace_until: dates.newGraceUntil,
            renewal_type: dates.renewalType,
            extension_months: extension_months,
            change_type: isExtendOnly ? "Manual License Extension" : "Renewal & Payment",
            notes: notes || override_reason || undefined,
          }
        }], { session });
      } catch (auditErr) {
        console.warn("AuditLog creation failed:", auditErr);
      }

      // Ensure next billing period exists if newExpiry is set
      if (dates.newExpiry) {
        const futurePeriods = await LicenseBillingPeriod.countDocuments({
          license_id: license.id,
          period_start: { $gte: dates.newExpiry }
        }).session(session);

        if (futurePeriods === 0) {
          const periodDates = calculatePeriodDates(dates.newExpiry, license.billing?.cycle || "monthly");
          const newModel = resolveBillingModel(license.billing);
          const isPerInvoice = newModel === "per_invoice";

          await LicenseBillingPeriod.create([{
            client_id: license.client_id,
            license_id: license.id,
            period_start: periodDates.period_start,
            period_end: periodDates.period_end,
            due_at: periodDates.due_at,
            amount_due: isPerInvoice ? 0 : (license.billing?.amount || 0),
            currency: license.billing?.currency || "PKR",
            status: "unpaid",
            billing_model: newModel,
            rate_snapshot: isPerInvoice ? (license.billing?.rate_per_invoice || 0) : (license.billing?.amount || 0),
          }], { session });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    if (error.code === 11000 && error.keyPattern && error.keyPattern.idempotency_key) {
      const existing = await LicensePayment.findOne({ license_id: id, idempotency_key });
      return NextResponse.json({ success: true, payment: existing, idempotent: true });
    }
    
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Trigger Email & PDF Generation asynchronously if payment was recorded
  if (paymentRecord) {
    try {
      sendPaymentReceipt(paymentRecord.id).catch(err => {
        console.error("Failed to send payment receipt in background:", err);
      });
    } catch (err) {
      console.error("Failed to trigger sendPaymentReceipt:", err);
    }
  }

  return NextResponse.json({ 
    success: true, 
    payment: paymentRecord || null,
    license: {
      id,
      action
    }
  });
}
