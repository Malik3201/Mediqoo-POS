import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Client from "@/models/Client";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import LicensePayment from "@/models/LicensePayment";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const now = new Date();

    const license = await License.findOne({ "billing.enabled": true, "billing.model": "per_invoice" }).lean();
    if (!license) return NextResponse.json({ error: "No per_invoice license found" });

    const client = await Client.findOne({ id: (license as any).client_id }).lean();

    // PHASE 3: ALL billing periods for this license
    const allPeriods = await LicenseBillingPeriod.find({ license_id: (license as any).id })
      .sort({ period_start: 1 }).lean();

    // Per-period usage aggregation
    const usageAgg = await BillingUsage.aggregate([
      { $match: { license_id: (license as any).id } },
      { $group: { _id: "$billing_period_id", count: { $sum: 1 }, total: { $sum: "$amount" } } }
    ]);
    const usageByPeriod: Record<string, { count: number; total: number }> = {};
    usageAgg.forEach((u: any) => { usageByPeriod[u._id] = { count: u.count, total: u.total }; });

    // Per-period payment aggregation
    const allPayments = await LicensePayment.find({ license_id: (license as any).id }).lean();
    const paymentsByPeriod: Record<string, number> = {};
    (allPayments as any[]).forEach((p: any) => {
      paymentsByPeriod[p.billing_period_id] = (paymentsByPeriod[p.billing_period_id] || 0) + (p.amount_paid || 0);
    });

    // Build period table
    const periodTable = allPeriods.map((p: any) => {
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
        due_at: p.due_at,
        created_at: p.created_at,
        // Computed
        usage_count: usage.count,
        usage_amount: usage.total,
        payments_on_period: paid,
        outstanding: Math.max(0, usage.total - paid),
        is_current_period: isCurrentPeriod,
        is_future: isFuture,
        label: isCurrentPeriod ? "CURRENT_ACTIVE" : isFuture ? "FUTURE_NEXT" : "PAST"
      };
    });

    // Identify current active period (period_start <= now < period_end)
    const currentPeriod = periodTable.find(p => p.is_current_period);
    
    // Total across ALL unpaid periods
    const unpaidPeriods = periodTable.filter(p => p.status !== "paid" && p.status !== "waived");
    const totalUsageCount = unpaidPeriods.reduce((s, p) => s + p.usage_count, 0);
    const totalUsageAmount = unpaidPeriods.reduce((s, p) => s + p.usage_amount, 0);
    const totalPayments = unpaidPeriods.reduce((s, p) => s + p.payments_on_period, 0);
    const totalOutstanding = Math.max(0, totalUsageAmount - totalPayments);

    // What license-status SHOULD return
    const licenseStatusExpected = {
      billing_cycle_start: currentPeriod?.period_start || null,
      billing_cycle_end: currentPeriod?.period_end || null,
      billing_confirmed_count: totalUsageCount,
      billing_confirmed_amount: totalUsageAmount,
      billing_outstanding: totalOutstanding
    };

    // All usage records (to verify billing_period_id mapping)
    const allUsages = await BillingUsage.find({ license_id: (license as any).id }).sort({ occurred_at: -1 }).limit(5).lean();
    const sampleUsages = (allUsages as any[]).map((u: any) => ({
      id: u.id,
      billing_period_id: u.billing_period_id,
      occurred_at: u.occurred_at,
      amount: u.amount,
      invoice_number: u.invoice_number_snapshot
    }));

    return NextResponse.json({
      now: now.toISOString(),
      license_id: (license as any).id,
      client_name: (client as any)?.name,
      billing_model: (license as any).billing.model,
      billing_rate: (license as any).billing.rate_per_invoice,
      expires_at: (license as any).expires_at,

      period_count: allPeriods.length,
      periods: periodTable,

      current_active_period: currentPeriod || "NONE_FOUND",

      total_unpaid_summary: {
        unpaid_period_count: unpaidPeriods.length,
        total_usage_count: totalUsageCount,
        total_usage_amount: totalUsageAmount,
        total_payments: totalPayments,
        total_outstanding: totalOutstanding
      },

      license_status_expected: licenseStatusExpected,

      payment_history: (allPayments as any[]).map((p: any) => ({
        id: p.id,
        billing_period_id: p.billing_period_id,
        amount_paid: p.amount_paid,
        paid_at: p.paid_at,
        receipt_number: p.receipt_number
      })),

      sample_recent_usages: sampleUsages
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
