import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import { deriveOutstanding, resolveBillingModel } from "@/lib/billing";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();

  const body = await req.json();
  const { billing_period_ids, amount_paid, payment_method, payment_reference, idempotency_key, notes } = body;

  if (!billing_period_ids || !Array.isArray(billing_period_ids) || billing_period_ids.length === 0) {
    return NextResponse.json({ error: "billing_period_ids array required" }, { status: 400 });
  }
  if (!idempotency_key) return NextResponse.json({ error: "idempotency_key required" }, { status: 400 });
  if (Number(amount_paid) <= 0) return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });

  // Early idempotency check
  const existingPayment = await LicensePayment.findOne({ license_id: id, idempotency_key }).lean();
  if (existingPayment) {
    return NextResponse.json({ success: true, payment: existingPayment, idempotent: true });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let paymentRecord: any;

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const periods = await LicenseBillingPeriod.find({ 
      id: { $in: billing_period_ids },
      license_id: license.id
    }).session(session);

    if (periods.length !== billing_period_ids.length) {
      throw new Error("One or more billing periods not found");
    }
    periods.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

    const billingModel = resolveBillingModel(license.billing);

    // Create the LicensePayment
    const payment = await LicensePayment.create([{
      client_id: license.client_id,
      license_id: license.id,
      billing_period_id: periods[0].id, // For accounting, map to primary
      amount_paid: Number(amount_paid),
      currency: periods[0].currency,
      payment_method,
      payment_reference,
      idempotency_key,
      notes,
      recorded_by: token.email || token.name || "admin",
    }], { session });
    
    paymentRecord = payment[0];

    // Distribute payment to periods in chronological order
    let amountRemaining = Number(amount_paid);

    for (const bp of periods) {
      if (amountRemaining <= 0) break;

      let amountDueForPeriod = bp.amount_due;
      if (billingModel === "per_invoice") {
        const usages = await BillingUsage.find({ billing_period_id: bp.id }).session(session);
        const payments = await LicensePayment.find({ billing_period_id: bp.id }).session(session);
        const adjustments = await BillingAdjustment.find({ billing_period_id: bp.id }).session(session);
        
        const usageAmount = usages.reduce((sum, u) => sum + u.amount, 0);
        // Exclude the current payment from derivation (it's already saved, but we want the prior state)
        const priorPayments = payments.filter(p => p.id !== paymentRecord.id).reduce((sum, p) => sum + p.amount_paid, 0);
        amountDueForPeriod = deriveOutstanding(usageAmount, adjustments, priorPayments);
      }

      // Existing amount paid on this specific period (for fixed model fallback mainly)
      const needed = Math.max(0, amountDueForPeriod - (bp.amount_paid || 0));
      const allocation = Math.min(amountRemaining, needed);
      
      bp.amount_paid = (bp.amount_paid || 0) + allocation;
      amountRemaining -= allocation;
      
      // We only confidently mark status as paid if amount_paid >= amount_due
      // But for per_invoice, outstanding derivation handles the real truth. We still update the fallback status.
      if (bp.amount_paid >= amountDueForPeriod && amountDueForPeriod > 0) {
        bp.status = "paid";
      } else {
        bp.status = "partially_paid";
      }
      await bp.save({ session });
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

  return NextResponse.json({ success: true, payment: paymentRecord });
}
