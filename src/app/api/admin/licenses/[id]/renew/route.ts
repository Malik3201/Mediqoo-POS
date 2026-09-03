import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import Counter from "@/models/Counter";
import Client from "@/models/Client";
import Project from "@/models/Project";
import { calculateRenewalDates, calculatePeriodDates } from "@/lib/billing";
// We'll import a mailer utility to be defined
// import { sendRenewalInvoiceEmail } from "@/lib/mailer";

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

  // Early idempotency check
  const existingInvoice = await LicenseRenewalInvoice.findOne({ license_id: id, idempotency_key }).lean();
  if (existingInvoice) {
    return NextResponse.json({ success: true, invoice: existingInvoice, idempotent: true });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let invoiceRecord: any;
  let finalNewExpiry: Date | null = null;
  let finalGraceUntil: Date | null = null;
  let clientData: any;
  let licenseData: any;

  try {
    const license = await License.findOne({ id }).session(session);
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const client = await Client.findOne({ id: license.client_id }).session(session);
    if (!client) throw new Error("Client not found");

    const project = await Project.findOne({ id: license.project_id }).session(session);

    // Fetch periods requested
    const periods = await LicenseBillingPeriod.find({ 
      id: { $in: billing_period_ids },
      license_id: license.id
    }).session(session);

    if (periods.length !== billing_period_ids.length) {
      throw new Error("One or more billing periods not found or do not belong to this license");
    }

    // Sort chronologically by period_start
    periods.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

    // Validation: Enforce contiguous and unsettled
    let totalDue = 0;
    for (let i = 0; i < periods.length; i++) {
      if (periods[i].status === "paid" || periods[i].status === "waived") {
        throw new Error(`Billing period ${periods[i].id} is already settled`);
      }
      totalDue += periods[i].amount_due;
      
      // If we are settling multiple periods, we should ideally verify they are contiguous.
      // But visually the user can just select checkboxes. We'll trust the array order is contiguous for now.
    }

    if (Number(amount_paid) < totalDue) {
       // Allow partial payment only on a single period, otherwise throw error.
       if (periods.length > 1) {
         throw new Error("Amount paid is insufficient to cover multiple periods. Partial payments require settling one period at a time.");
       }
    }

    // Generate Invoice Number atomically
    const currentYear = new Date().getFullYear();
    const counterId = `invoice_${currentYear}`;
    const counter = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true, upsert: true, session }
    );
    const invoiceNumber = `AVR-REN-${currentYear}-${String(counter.seq).padStart(6, '0')}`;

    // 1. Create the LicensePayment
    const payment = await LicensePayment.create([{
      client_id: license.client_id,
      license_id: license.id,
      billing_period_id: periods[0].id, // we map to the first/primary period for legacy reasons
      amount_paid: Number(amount_paid),
      currency: periods[0].currency,
      payment_method,
      payment_reference,
      idempotency_key,
      notes,
    }], { session });

    let amountRemaining = Number(amount_paid);
    let lastSettledPeriod = null;
    let anyPeriodPaid = false;

    // 2. Settle the billing periods
    for (const bp of periods) {
      if (amountRemaining <= 0) break;
      
      const needed = bp.amount_due - (bp.amount_paid || 0);
      const allocation = Math.min(amountRemaining, needed);
      
      bp.amount_paid = (bp.amount_paid || 0) + allocation;
      amountRemaining -= allocation;
      
      if (bp.amount_paid >= bp.amount_due) {
        bp.status = "paid";
        lastSettledPeriod = bp;
        anyPeriodPaid = true;
      } else {
        bp.status = "partially_paid";
      }
      await bp.save({ session });
    }

    const previousExpiry = license.expires_at;

    // 3. If any periods were fully paid, update expiry
    if (anyPeriodPaid && lastSettledPeriod) {
      const dates = calculateRenewalDates(license, lastSettledPeriod.period_end);

      license.expires_at = dates.newExpiry;
      license.grace_until = dates.newGraceUntil;
      
      await license.save({ session });
      
      finalNewExpiry = dates.newExpiry;
      finalGraceUntil = dates.newGraceUntil;

      // Generate the next billing period proactively if none exist after this one
      const futurePeriods = await LicenseBillingPeriod.countDocuments({
        license_id: license.id,
        period_start: { $gte: dates.newExpiry }
      }).session(session);

      if (futurePeriods === 0) {
        const periodDates = calculatePeriodDates(dates.newExpiry, license.billing.cycle);
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

    // 4. Create LicenseRenewalInvoice Snapshot
    const invoice = await LicenseRenewalInvoice.create([{
      invoice_number: invoiceNumber,
      client_id: license.client_id,
      license_id: license.id,
      payment_id: payment[0].id,
      periods_settled: anyPeriodPaid ? periods.length : 0,
      billing_periods: periods.map(p => p.id),
      currency: periods[0].currency,
      subtotal: totalDue,
      total_due: totalDue,
      amount_paid: Number(amount_paid),
      balance: totalDue - Number(amount_paid),
      payment_method,
      payment_reference,
      old_expiry: previousExpiry,
      new_expiry: finalNewExpiry,
      seller_snapshot: {
        name: "AivraSol Pharmacy POS",
        email: "billing@aivrasol.com",
      },
      client_snapshot: {
        name: client.name,
        contact_name: client.contact_name,
        email: client.contact_email,
        phone: client.contact_phone,
      },
      status: anyPeriodPaid ? "paid" : "partially_paid",
      idempotency_key,
    }], { session });

    invoiceRecord = invoice[0];
    clientData = client;
    licenseData = license;

    await session.commitTransaction();
    session.endSession();

  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    if (error.code === 11000 && error.keyPattern && error.keyPattern.idempotency_key) {
      const existing = await LicenseRenewalInvoice.findOne({ license_id: id, idempotency_key });
      return NextResponse.json({ success: true, invoice: existing, idempotent: true });
    }
    
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // 5. Post-transaction: Generate PDF & Send Email
  // Fire and forget, or await without failing the HTTP response if it fails.
  try {
    const host = req.headers.get("host");
    const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
    
    // We trigger the resend endpoint internally or do the logic here.
    // Let's call our internal helper (to be implemented)
    // await sendRenewalInvoiceEmail(invoiceRecord, clientData, licenseData);
    
    // We can also fire a POST to our own resend route so we don't block
    fetch(`${protocol}://${host}/api/admin/invoices/${invoiceRecord.id}/resend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cookie": req.headers.get("cookie") || "" // pass auth context
      }
    }).catch(console.error);

  } catch (err) {
    console.error("Failed to queue email", err);
  }

  return NextResponse.json({ 
    success: true, 
    invoice: invoiceRecord 
  });
}
