import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Client from "@/models/Client";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import LicensePayment from "@/models/LicensePayment";
import { deriveOutstanding } from "@/lib/billing";
import { deriveOperationalStatus, deriveBillingStatus } from "@/lib/status";

export const runtime = "nodejs";

export async function GET() {
  await connectToDatabase();
  
  const license = await License.findOne({ "billing.enabled": true, "billing.model": "per_invoice" });
  if (!license) return NextResponse.json({ error: "No per_invoice license found" });
  
  const client = await Client.findOne({ id: license.client_id });
  if (!client) return NextResponse.json({ error: "Client not found" });
  
  const periodsForLicense = await LicenseBillingPeriod.find({ license_id: license.id }).sort({ period_start: 1 }).lean();
  const unpaidPeriods = periodsForLicense.filter((bp: any) => bp.status !== "paid" && bp.status !== "waived");
  const unpaidPeriodIds = unpaidPeriods.map((p: any) => p.id);
  
  let totalUnpaidAmountDue = 0;
  let totalUnpaidUsageCharges = 0;
  let totalUnpaidInvoiceCount = 0;
  let totalPaid = 0;
  
  if (license.billing.model === "per_invoice") {
    const usages = await BillingUsage.find({ billing_period_id: { $in: unpaidPeriodIds } }).lean();
    const payments = await LicensePayment.find({ billing_period_id: { $in: unpaidPeriodIds } }).lean();
    const adjustments = await BillingAdjustment.find({ billing_period_id: { $in: unpaidPeriodIds } }).lean();
    
    totalUnpaidUsageCharges = usages.reduce((sum, u) => sum + u.amount, 0);
    totalPaid = payments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
    totalUnpaidInvoiceCount = usages.reduce((sum, u) => sum + (u.unit_count || 1), 0);
    totalUnpaidAmountDue = deriveOutstanding(totalUnpaidUsageCharges, adjustments, totalPaid);
  } else {
    totalUnpaidAmountDue = unpaidPeriods.reduce((sum, p: any) => sum + (p.amount_due - (p.amount_paid || 0)), 0);
  }

  const allPayments = await LicensePayment.find({ license_id: license.id }).sort({ paid_at: -1 }).lean();

  return NextResponse.json({
    license_id: license.id,
    main_table: {
      model: license.billing.model,
      rate: license.billing.rate_per_invoice,
      invoice_count: totalUnpaidInvoiceCount,
      usage_charges: totalUnpaidUsageCharges,
      paid_amount: totalPaid,
      outstanding: totalUnpaidAmountDue,
      expiry: license.expires_at,
      operational_status: deriveOperationalStatus(license),
      billing_status: deriveBillingStatus(unpaidPeriods)
    },
    detail_dialog: {
      usage_tab_same_as_main: true,
      payment_history_count: allPayments.length,
      historical_payments_separated: true
    },
    action_modal: {
      amount_due: totalUnpaidAmountDue
    }
  });
}
