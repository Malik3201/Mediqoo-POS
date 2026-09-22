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
  
  await connectToDatabase();
  
  try {
    const license = await License.findOne({ id }).lean();
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const allPeriods = await LicenseBillingPeriod.find({ license_id: license.id }).lean();
    if (allPeriods.length === 0) throw new Error("No billing periods found");

    // Sort chronologically
    allPeriods.sort((a: any, b: any) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
    const lastPeriod = allPeriods[allPeriods.length - 1];

    const preview = calculateRenewalDates(license as any, lastPeriod.period_end);

    const billingModel = resolveBillingModel(license.billing);
    let amount_due = 0;
    let extra_details: any = {};
    let payableCount = 0;

    if (billingModel === "per_invoice") {
      // Fetch authoritative usage and payments across ALL periods
      const usages = await BillingUsage.find({ license_id: id }).lean();
      const payments = await LicensePayment.find({ license_id: id }).lean();
      const adjustments = await BillingAdjustment.find({ license_id: id }).lean();

      const usage_amount = usages.reduce((sum, u) => sum + u.amount, 0);
      const payment_amount = payments.reduce((sum, p) => sum + p.amount_paid, 0);
      const adjustments_amount = adjustments.reduce((sum, a) => sum + (a.type === "debit" ? a.amount : -a.amount), 0);
      
      amount_due = deriveOutstanding(usage_amount, adjustments as any, payment_amount);

      // Determine how many periods actually have an outstanding amount
      for (const bp of allPeriods) {
        const bpUsages = usages.filter(u => u.billing_period_id === bp.id);
        const bpPayments = payments.filter(p => p.billing_period_id === bp.id);
        const bpAdjustments = adjustments.filter(a => a.billing_period_id === bp.id);
        
        const bpOutstanding = deriveOutstanding(
          bpUsages.reduce((sum, u) => sum + u.amount, 0),
          bpAdjustments as any,
          bpPayments.reduce((sum, p) => sum + p.amount_paid, 0)
        );
        if (bpOutstanding > 0) payableCount++;
      }
      
      extra_details = {
        usage_amount,
        payment_amount,
        adjustments_amount,
        invoice_count: usages.reduce((sum, u) => sum + u.unit_count, 0)
      };
    } else {
      for (const bp of allPeriods) {
        const bpOutstanding = Math.max(0, bp.amount_due - (bp.amount_paid || 0));
        amount_due += bpOutstanding;
        if (bpOutstanding > 0) payableCount++;
      }
      const payments = await LicensePayment.find({ license_id: id }).lean();
      extra_details = {
        payment_amount: payments.reduce((sum, p) => sum + p.amount_paid, 0)
      };
    }

    // Default to 1 period if fully paid, since renewal would apply to the end of the last period
    if (payableCount === 0) payableCount = 1;

    return NextResponse.json({
      renewal_type: preview.renewalType,
      current_expiry: license.expires_at,
      base_date: preview.baseDate,
      new_expiry: preview.newExpiry,
      new_grace_until: preview.newGraceUntil,
      amount_due,
      periods_count: payableCount,
      currency: license.billing.currency,
      billing_model: billingModel,
      ...extra_details
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
