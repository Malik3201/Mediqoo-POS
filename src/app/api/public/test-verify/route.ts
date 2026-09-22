import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Client from "@/models/Client";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import LicensePayment from "@/models/LicensePayment";
import { getLicenseBillingSummary, getCurrentBillingPeriod } from "@/lib/billing";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const now = new Date();

    const license = await License.findOne({ "billing.enabled": true, "billing.model": "per_invoice" }).lean();
    if (!license) return NextResponse.json({ error: "No per_invoice license found" });

    const client = await Client.findOne({ id: (license as any).client_id }).lean();

    // Use the SAME canonical helper that license-status and portal/billing use
    const summary = await getLicenseBillingSummary(
      (license as any).id,
      { LicenseBillingPeriod, BillingUsage, BillingAdjustment, LicensePayment },
      now
    );

    // Per-period breakdown for diagnostics
    const usageAgg = await BillingUsage.aggregate([
      { $match: { license_id: (license as any).id } },
      { $group: { _id: "$billing_period_id", count: { $sum: 1 }, total: { $sum: "$amount" } } }
    ]);
    const usageByPeriod: Record<string, { count: number; total: number }> = {};
    usageAgg.forEach((u: any) => { usageByPeriod[u._id] = { count: u.count, total: u.total }; });

    const allPayments = await LicensePayment.find({ license_id: (license as any).id }).lean();
    const paymentsByPeriod: Record<string, number> = {};
    (allPayments as any[]).forEach((p: any) => {
      paymentsByPeriod[p.billing_period_id] = (paymentsByPeriod[p.billing_period_id] || 0) + (p.amount_paid || 0);
    });

    const periodTable = summary.allPeriods.map((p: any) => {
      const usage = usageByPeriod[p.id] || { count: 0, total: 0 };
      const paid = paymentsByPeriod[p.id] || 0;
      const isCurrentPeriod = new Date(p.period_start) <= now && now < new Date(p.period_end);
      const isFuture = new Date(p.period_start) > now;
      return {
        id: p.id,
        period_start: p.period_start,
        period_end: p.period_end,
        billing_model: p.billing_model || "NOT_SET",
        rate_snapshot: p.rate_snapshot,
        status: p.status,
        amount_due: p.amount_due,
        amount_paid: p.amount_paid,
        usage_count: usage.count,
        usage_amount: usage.total,
        payments_on_period: paid,
        outstanding: Math.max(0, usage.total - paid),
        is_current_period: isCurrentPeriod,
        is_future: isFuture,
        label: isCurrentPeriod ? "CURRENT_ACTIVE" : isFuture ? "FUTURE_NEXT" : "PAST"
      };
    });

    return NextResponse.json({
      now: now.toISOString(),
      license_id: (license as any).id,
      client_name: (client as any)?.name,
      billing_model: (license as any).billing.model,
      billing_rate: (license as any).billing.rate_per_invoice,
      expires_at: (license as any).expires_at,

      // CANONICAL SUMMARY (same as license-status and portal use)
      canonical_summary: {
        current_period_id: (summary.currentPeriod as any)?.id,
        current_period_start: (summary.currentPeriod as any)?.period_start,
        current_period_end: (summary.currentPeriod as any)?.period_end,
        usage_count: summary.usageCount,
        usage_amount: summary.usageAmount,
        payments_on_past_current: summary.paymentsOnPastCurrent,
        adjustments_net: summary.adjustmentsNet,
        outstanding: summary.outstanding,
        next_period_id: (summary.nextPeriod as any)?.id,
      },

      periods: periodTable,

      payment_history: (allPayments as any[]).map((p: any) => ({
        id: p.id,
        billing_period_id: p.billing_period_id,
        amount_paid: p.amount_paid,
        paid_at: p.paid_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
