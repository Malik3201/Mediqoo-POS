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
import { deriveOutstanding, resolveBillingModel, getCurrentBillingPeriod } from "@/lib/billing";

// Note: we'll call email sending without awaiting it to not block the request.
// We'll import it dynamically or fetch the internal API, but since we're in the same project, we can import it.
// Assuming we'll add sendPaymentReceipt to @/lib/email
import { sendPaymentReceipt } from "@/lib/email";

/**
 * GET /api/admin/licenses/[id]/payments
 * Returns payment history for a license (admin read-only).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const license = await License.findOne({ id }).lean();
  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });

  const payments = await LicensePayment.find({ license_id: id })
    .sort({ paid_at: -1 })
    .lean();

  return NextResponse.json({
    success: true,
    items: payments.map((p: any) => ({
      id: p.id,
      receipt_number: p.receipt_number,
      paid_at: p.paid_at,
      amount_paid: p.amount_paid,
      payment_method: p.payment_method,
      currency: p.currency,
      email_status: p.email_status,
      billing_period_id: p.billing_period_id,
      snapshot: p.snapshot,
      notes: p.notes,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();

  const body = await req.json();
  const { amount_paid, payment_method, payment_reference, idempotency_key, notes, action } = body;

  if (!idempotency_key) return NextResponse.json({ error: "idempotency_key required" }, { status: 400 });
  const paymentAmount = Number(amount_paid);
  if (paymentAmount <= 0) return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });

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

    // Find all billing periods
    const allPeriods = await LicenseBillingPeriod.find({ license_id: license.id }).session(session);
    allPeriods.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

    let totalOutstandingBefore = 0;
    let totalUsageAmount = 0;
    let totalInvoiceCount = 0;
    let latestRate = license.billing.rate || 0;
    
    // Server resolves which periods are payable
    const payablePeriods = [];

    if (billingModel === "per_invoice") {
      const usages = await BillingUsage.find({ license_id: id }).session(session);
      const payments = await LicensePayment.find({ license_id: id }).session(session);
      const adjustments = await BillingAdjustment.find({ license_id: id }).session(session);

      totalUsageAmount = usages.reduce((sum, u) => sum + u.amount, 0);
      totalInvoiceCount = usages.reduce((sum, u) => sum + u.unit_count, 0);
      const totalPayments = payments.reduce((sum, p) => sum + p.amount_paid, 0);
      totalOutstandingBefore = deriveOutstanding(totalUsageAmount, adjustments as any, totalPayments);

      // Distribute to periods mathematically
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
      // Fixed model
      for (const bp of allPeriods) {
        const bpOutstanding = Math.max(0, bp.amount_due - (bp.amount_paid || 0));
        if (bpOutstanding > 0) {
          payablePeriods.push({ period: bp, outstanding: bpOutstanding });
        }
        totalOutstandingBefore += bpOutstanding;
        latestRate = bp.rate_snapshot || latestRate;
      }
    }

    if (paymentAmount > totalOutstandingBefore) {
      throw new Error(`Overpayment blocked. Amount (${paymentAmount}) exceeds current outstanding (${totalOutstandingBefore}).`);
    }

    const shortId = idempotency_key.split("_").pop() || Date.now().toString().slice(-6);
    const receiptNumber = `AV-PAY-${new Date().toISOString().slice(2,10).replace(/-/g, "")}-${shortId.slice(-6).toUpperCase()}`;

    // Create the LicensePayment
    // Primary period = oldest payable period, or current period by time — NEVER newest/future
    const currentPeriodByTime = getCurrentBillingPeriod(allPeriods.map(p => p.toObject ? p.toObject() : p));
    const primaryPeriodId = payablePeriods.length > 0 ? payablePeriods[0].period.id : (currentPeriodByTime?.id || allPeriods[0]?.id || "");
    const allocatedPeriodIds = payablePeriods.map(p => p.period.id);

    const payment = await LicensePayment.create([{
      client_id: license.client_id,
      license_id: license.id,
      billing_period_id: primaryPeriodId,
      billing_period_ids: allocatedPeriodIds,
      amount_paid: paymentAmount,
      currency: license.billing.currency || "PKR",
      payment_method,
      payment_reference,
      idempotency_key,
      notes,
      recorded_by: token.email || token.name || "admin",
      
      // Snapshots
      usage_count_snapshot: totalInvoiceCount,
      usage_amount_snapshot: totalUsageAmount,
      outstanding_before: totalOutstandingBefore,
      outstanding_after: totalOutstandingBefore - paymentAmount,
      rate_snapshot: latestRate,
      receipt_number: receiptNumber,
      action: action || "payment_only",
      email_status: "pending"
    }], { session });
    
    paymentRecord = payment[0];

    // Distribute payment to periods
    let amountRemaining = paymentAmount;

    for (const { period, outstanding } of payablePeriods) {
      if (amountRemaining <= 0) break;
      
      const allocation = Math.min(amountRemaining, outstanding);
      period.amount_paid = (period.amount_paid || 0) + allocation;
      amountRemaining -= allocation;
      
      if (period.amount_paid >= period.amount_due && period.amount_due > 0) {
        period.status = "paid";
      } else {
        period.status = "partially_paid";
      }
      await period.save({ session });
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

  // Trigger Email & PDF Generation asynchronously
  try {
    sendPaymentReceipt(paymentRecord.id).catch(err => {
      console.error("Failed to send payment receipt in background:", err);
    });
  } catch (err) {
    console.error("Failed to trigger sendPaymentReceipt:", err);
  }

  return NextResponse.json({ success: true, payment: paymentRecord });
}

