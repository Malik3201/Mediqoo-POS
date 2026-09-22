import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import Counter from "@/models/Counter";
import Client from "@/models/Client";
import Project from "@/models/Project";
import { calculateRenewalDates, calculatePeriodDates, resolveBillingModel, deriveOutstanding } from "@/lib/billing";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();

  const body = await req.json();
  const { billing_period_ids, amount_paid, payment_method, payment_reference, idempotency_key, notes, override_renewal, override_reason } = body;

  if (!billing_period_ids || !Array.isArray(billing_period_ids) || billing_period_ids.length === 0) {
    return NextResponse.json({ error: "billing_period_ids array required" }, { status: 400 });
  }
  if (!idempotency_key) return NextResponse.json({ error: "idempotency_key required" }, { status: 400 });

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

    const periods = await LicenseBillingPeriod.find({ 
      id: { $in: billing_period_ids },
      license_id: license.id
    }).session(session);

    if (periods.length !== billing_period_ids.length) {
      throw new Error("One or more billing periods not found or do not belong to this license");
    }

    periods.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

    let totalDue = 0;
    const billingModel = resolveBillingModel(license.billing);

    if (billingModel === "per_invoice") {
      const usages = await BillingUsage.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).session(session);
      const payments = await LicensePayment.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).session(session);
      const adjustments = await BillingAdjustment.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).session(session);

      const usage_amount = usages.reduce((sum, u) => sum + u.amount, 0);
      const payment_amount = payments.reduce((sum, p) => sum + p.amount_paid, 0);
      totalDue = deriveOutstanding(usage_amount, adjustments, payment_amount);
      totalDue = Math.max(0, totalDue); // Don't let totalDue be negative for payment requirement checks
    } else {
      for (let i = 0; i < periods.length; i++) {
        if (periods[i].status === "paid" || periods[i].status === "waived") {
          throw new Error(`Billing period ${periods[i].id} is already settled`);
        }
        totalDue += periods[i].amount_due;
      }
    }

    if (Number(amount_paid) < totalDue && !override_renewal) {
      throw new Error("Amount paid is insufficient to cover outstanding debt. Full payment required to renew.");
    }
    
    if (override_renewal && !override_reason) {
      throw new Error("Override reason is required when bypassing debt.");
    }

    const currentYear = new Date().getFullYear();
    const counterId = `invoice_${currentYear}`;
    const counter = await Counter.findByIdAndUpdate(counterId, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
    const invoiceNumber = `AVR-REN-${currentYear}-${String(counter.seq).padStart(6, '0')}`;

    let paymentId = null;
    if (Number(amount_paid) > 0) {
      const payment = await LicensePayment.create([{
        client_id: license.client_id,
        license_id: license.id,
        billing_period_id: periods[0].id,
        amount_paid: Number(amount_paid),
        currency: periods[0].currency,
        payment_method,
        payment_reference,
        idempotency_key,
        notes,
        recorded_by: token.email || token.name || "admin"
      }], { session });
      paymentId = payment[0].id;
    }

    let amountRemaining = Number(amount_paid);
    let lastSettledPeriod = null;
    let anyPeriodPaid = false;

    // 2. Settle the billing periods
    for (const bp of periods) {
      if (amountRemaining <= 0 && !override_renewal) break;
      
      let amountDueForPeriod = bp.amount_due;
      if (billingModel === "per_invoice") {
        const usages = await BillingUsage.find({ billing_period_id: bp.id }).session(session);
        const payments = await LicensePayment.find({ billing_period_id: bp.id }).session(session);
        const adjustments = await BillingAdjustment.find({ billing_period_id: bp.id }).session(session);
        
        const usageAmount = usages.reduce((sum, u) => sum + u.amount, 0);
        const priorPayments = payments.filter(p => p.id !== paymentId).reduce((sum, p) => sum + p.amount_paid, 0);
        amountDueForPeriod = deriveOutstanding(usageAmount, adjustments, priorPayments);
      }

      const needed = Math.max(0, amountDueForPeriod - (bp.amount_paid || 0));
      const allocation = Math.min(amountRemaining, needed);
      
      bp.amount_paid = (bp.amount_paid || 0) + allocation;
      amountRemaining = Math.max(0, amountRemaining - allocation);
      
      if (bp.amount_paid >= amountDueForPeriod && amountDueForPeriod > 0) {
        bp.status = "paid";
        lastSettledPeriod = bp;
        anyPeriodPaid = true;
      } else {
        bp.status = "partially_paid";
      }

      // If override_renewal is true, we force it to be considered for renewal dates
      if (override_renewal) {
         lastSettledPeriod = bp;
         anyPeriodPaid = true;
      }

      await bp.save({ session });
    }

    const previousExpiry = license.expires_at;

    // 3. If any periods were fully paid (or overridden), update expiry
    if (anyPeriodPaid && lastSettledPeriod) {
      const dates = calculateRenewalDates(license, lastSettledPeriod.period_end);

      license.expires_at = dates.newExpiry;
      license.grace_until = dates.newGraceUntil;

      // ── Apply pending billing changes at renewal boundary ────────────
      if (license.billing?.pending_changes) {
        const pc = license.billing.pending_changes;
        if (pc.model) license.billing.model = pc.model;
        if (pc.amount !== undefined && pc.amount !== null) license.billing.amount = pc.amount;
        if (pc.rate_per_invoice !== undefined && pc.rate_per_invoice !== null) {
          license.billing.rate_per_invoice = pc.rate_per_invoice;
        }
        license.billing.pending_changes = null; // Clear after applying
      }
      
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
        
        // Use the (now-applied) billing config for the new period
        const newModel = resolveBillingModel(license.billing);
        const isPerInvoice = newModel === "per_invoice";

        await LicenseBillingPeriod.create([{
          client_id: license.client_id,
          license_id: license.id,
          period_start: periodDates.period_start,
          period_end: periodDates.period_end,
          due_at: periodDates.due_at,
          amount_due: isPerInvoice ? 0 : (license.billing.amount || 0),
          currency: license.billing.currency,
          status: "unpaid",
          billing_model: newModel,
          rate_snapshot: isPerInvoice ? (license.billing.rate_per_invoice || 0) : (license.billing.amount || 0),
        }], { session });
      }
    }

    // 4. Create LicenseRenewalInvoice Snapshot
    const invoice = await LicenseRenewalInvoice.create([{
      invoice_number: invoiceNumber,
      client_id: license.client_id,
      license_id: license.id,
      payment_id: paymentId,
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
      status: override_renewal ? "overridden" : (anyPeriodPaid ? "paid" : "partially_paid"),
      idempotency_key,
      notes: override_renewal ? `OVERRIDE RENEWAL: ${override_reason} (${token.email})` : "",
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
