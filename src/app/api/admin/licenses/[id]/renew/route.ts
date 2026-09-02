import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import { addMonths, addYears, isBefore } from "date-fns";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();

  const body = await req.json();
  const { billing_period_id, amount_paid, payment_method, payment_reference, idempotency_key, notes } = body;

  if (!billing_period_id) return NextResponse.json({ error: "billing_period_id required" }, { status: 400 });
  if (!idempotency_key) return NextResponse.json({ error: "idempotency_key required" }, { status: 400 });

  // Early idempotency check outside transaction to save resources
  const existingPayment = await LicensePayment.findOne({ license_id: id, idempotency_key });
  if (existingPayment) {
    return NextResponse.json({ success: true, payment: existingPayment, idempotent: true });
  }

  // Use MongoDB sessions for transaction if supported by replica set
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const billingPeriod = await LicenseBillingPeriod.findOne({ id: billing_period_id }).session(session);
    if (!billingPeriod) throw new Error("Billing period not found");
    if (billingPeriod.status === "paid" || billingPeriod.status === "waived") {
      throw new Error("Billing period is already settled");
    }

    // 1. Create the LicensePayment
    const payment = await LicensePayment.create([{
      client_id: license.client_id,
      license_id: license.id,
      billing_period_id: billingPeriod.id,
      amount_paid: Number(amount_paid),
      currency: billingPeriod.currency,
      payment_method,
      payment_reference,
      idempotency_key,
      notes,
    }], { session });

    // 2. Settle the billing period
    const totalPaid = billingPeriod.amount_paid + Number(amount_paid);
    billingPeriod.amount_paid = totalPaid;
    if (totalPaid >= billingPeriod.amount_due) {
      billingPeriod.status = "paid";
    } else {
      billingPeriod.status = "partially_paid";
    }
    await billingPeriod.save({ session });

    // 3. If fully paid, calculate new expiry according to early/late logic
    if (billingPeriod.status === "paid") {
      const now = new Date();
      let baseDate = license.expires_at ? new Date(license.expires_at) : now;
      
      // If late (now is past baseDate), renew from payment date
      if (isBefore(baseDate, now)) {
        baseDate = now;
      }
      
      let nextExpiry: Date;
      if (license.billing.cycle === "yearly") {
        nextExpiry = addYears(baseDate, 1);
      } else {
        nextExpiry = addMonths(baseDate, 1);
      }

      license.expires_at = nextExpiry;
      // Calculate grace_until
      const graceDays = license.billing.grace_days ?? 3;
      const graceUntil = new Date(nextExpiry);
      graceUntil.setDate(graceUntil.getDate() + graceDays);
      license.grace_until = graceUntil;
      
      await license.save({ session });

      // Generate the next billing period proactively
      await LicenseBillingPeriod.create([{
        client_id: license.client_id,
        license_id: license.id,
        period_start: nextExpiry,
        period_end: license.billing.cycle === "yearly" ? addYears(nextExpiry, 1) : addMonths(nextExpiry, 1),
        due_at: nextExpiry,
        amount_due: license.billing.amount,
        currency: license.billing.currency,
        status: "unpaid"
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    // TODO: Send confirmation email if fully paid

    return NextResponse.json({ success: true, payment: payment[0] });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    // Concurrent idempotency hit handling
    if (error.code === 11000 && error.keyPattern && error.keyPattern.idempotency_key) {
      const existing = await LicensePayment.findOne({ license_id: id, idempotency_key });
      return NextResponse.json({ success: true, payment: existing, idempotent: true });
    }
    
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
