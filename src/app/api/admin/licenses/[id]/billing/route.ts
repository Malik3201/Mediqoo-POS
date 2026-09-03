import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import { calculatePeriodDates } from "@/lib/billing";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();
  const body = await req.json();

  if (!body.billing) {
    return NextResponse.json({ error: "Missing billing configuration" }, { status: 400 });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");

    // Update the billing config
    license.billing = {
      enabled: Boolean(body.billing.enabled),
      amount: Number(body.billing.amount) || 0,
      currency: body.billing.currency || "PKR",
      cycle: body.billing.cycle || "monthly",
      grace_days: Number(body.billing.grace_days) || 3,
      reminder_days: body.billing.reminder_days || [1],
    };

    await license.save({ session });

    // Idempotently create the initial billing period if billing is enabled
    if (license.billing.enabled) {
      const existingPeriod = await LicenseBillingPeriod.findOne({ license_id: license.id }).session(session);
      
      if (!existingPeriod) {
        const now = new Date();
        const baseDate = license.expires_at ? new Date(license.expires_at) : now;
        const periodDates = calculatePeriodDates(baseDate, license.billing.cycle);

        await LicenseBillingPeriod.create([{
          client_id: license.client_id,
          license_id: license.id,
          period_start: periodDates.period_start,
          period_end: periodDates.period_end,
          due_at: periodDates.due_at,
          amount_due: license.billing.amount,
          currency: license.billing.currency,
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
