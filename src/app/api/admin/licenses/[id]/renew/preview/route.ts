import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import LicensePayment from "@/models/LicensePayment";
import BillingAdjustment from "@/models/BillingAdjustment";
import { calculateRenewalDates, deriveOutstanding, resolveBillingModel } from "@/lib/billing";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  const searchParams = req.nextUrl.searchParams;
  const billingPeriodIdsParam = searchParams.get("billing_period_ids");
  
  if (!billingPeriodIdsParam) {
    return NextResponse.json({ error: "billing_period_ids query parameter required" }, { status: 400 });
  }

  const billing_period_ids = billingPeriodIdsParam.split(",");

  await connectToDatabase();
  
  try {
    const license = await License.findOne({ id }).lean();
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const periods = await LicenseBillingPeriod.find({ 
      id: { $in: billing_period_ids },
      license_id: license.id
    }).lean();

    if (periods.length !== billing_period_ids.length) {
      throw new Error("One or more billing periods not found");
    }

    // Sort chronologically
    periods.sort((a: any, b: any) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
    const lastPeriod = periods[periods.length - 1];

    const preview = calculateRenewalDates(license as any, lastPeriod.period_end);

    const billingModel = resolveBillingModel(license.billing);
    let amount_due = 0;
    let extra_details: any = {};

    if (billingModel === "per_invoice") {
      // Fetch authoritative usage and payments
      const usages = await BillingUsage.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).lean();
      const payments = await LicensePayment.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).lean();
      const adjustments = await BillingAdjustment.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).lean();

      const usage_amount = usages.reduce((sum, u) => sum + u.amount, 0);
      const payment_amount = payments.reduce((sum, p) => sum + p.amount_paid, 0);

      amount_due = deriveOutstanding(usage_amount, adjustments as any, payment_amount);
      // Floor it at 0 if you don't want negative renewals, but logically derived truth can be negative.
      
      extra_details = {
        usage_amount,
        payment_amount,
        adjustments_amount: adjustments.reduce((sum, a) => sum + (a.type === "debit" ? a.amount : -a.amount), 0),
        invoice_count: usages.reduce((sum, u) => sum + u.unit_count, 0)
      };
    } else {
      amount_due = periods.reduce((sum, p) => sum + p.amount_due, 0);
      // For fixed plan, adjust based on payments already made in partial state
      const payments = await LicensePayment.find({ license_id: id, billing_period_id: { $in: billing_period_ids } }).lean();
      const payment_amount = payments.reduce((sum, p) => sum + p.amount_paid, 0);
      amount_due = Math.max(0, amount_due - payment_amount);
    }

    return NextResponse.json({
      renewal_type: preview.renewalType,
      current_expiry: license.expires_at,
      base_date: preview.baseDate,
      new_expiry: preview.newExpiry,
      new_grace_until: preview.newGraceUntil,
      amount_due,
      periods_count: periods.length,
      currency: license.billing.currency,
      billing_model: billingModel,
      ...extra_details
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
