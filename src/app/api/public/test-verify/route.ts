import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import LicensePayment from "@/models/LicensePayment";
import { getLicenseBillingSummary, deriveEffectiveStatus, getCurrentBillingPeriod } from "@/lib/billing";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const now = new Date();

    const license = await License.findOne({ "billing.enabled": true, "billing.model": "per_invoice" }).lean();
    if (!license) return NextResponse.json({ error: "No per_invoice license found" });

    // Use canonical summary
    const summary = await getLicenseBillingSummary(
      (license as any).id,
      { LicenseBillingPeriod, BillingUsage, BillingAdjustment, LicensePayment },
      now
    );

    // Per-period breakdown with effective status
    const periodTable = summary.allPeriods.map((p: any) => {
      const usage = summary.usageByPeriod[p.id] || { count: 0, total: 0 };
      const paid = summary.paymentsByPeriod[p.id] || 0;
      const isCurrent = new Date(p.period_start) <= now && now < new Date(p.period_end);
      const isFuture = new Date(p.period_start) > now;
      return {
        id: p.id,
        dates: `${new Date(p.period_start).toISOString().slice(0,10)} → ${new Date(p.period_end).toISOString().slice(0,10)}`,
        stored_status: p.status,
        effective_status: deriveEffectiveStatus(usage.total, paid),
        usage_count: usage.count,
        usage_amount: usage.total,
        payments_allocated: paid,
        outstanding: Math.max(0, usage.total - paid),
        label: isCurrent ? "CURRENT_ACTIVE" : isFuture ? "FUTURE_NEXT" : "PAST"
      };
    });

    // Reconciliation audit
    const reconciliation = {
      misallocated_to_future: summary.paymentsMisallocatedToFuture,
      misallocated_payments: (summary.paymentHistory as any[])
        .filter((p: any) => summary.futurePeriods.some((fp: any) => fp.id === p.billing_period_id))
        .map((p: any) => ({
          payment_id: p.id,
          amount: p.amount_paid,
          allocated_to_period: p.billing_period_id,
          paid_at: p.paid_at,
          should_be_on: summary.currentPeriod ? (summary.currentPeriod as any).id : "unknown"
        })),
    };

    return NextResponse.json({
      now: now.toISOString(),
      license_id: (license as any).id,
      billing_rate: (license as any).billing.rate_per_invoice,

      // CANONICAL ACCOUNT SUMMARY (same for ALL surfaces)
      account_summary: {
        accrued_usage_count: summary.accruedUsageCount,
        accrued_usage_amount: summary.accruedUsageAmount,
        payments_applied_to_accrued: summary.paymentsAppliedToAccrued,
        payments_misallocated_to_future: summary.paymentsMisallocatedToFuture,
        adjustment_debits: summary.adjustmentDebits,
        adjustment_credits: summary.adjustmentCredits,
        account_outstanding: summary.accountOutstanding,
      },

      current_period: summary.currentPeriod ? {
        id: (summary.currentPeriod as any).id,
        dates: `${new Date((summary.currentPeriod as any).period_start).toISOString().slice(0,10)} → ${new Date((summary.currentPeriod as any).period_end).toISOString().slice(0,10)}`,
      } : null,

      periods: periodTable,
      reconciliation,

      payment_history: (summary.paymentHistory as any[]).map((p: any) => ({
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

/**
 * POST /api/public/test-verify?action=reconcile
 * Reconciles misallocated payments: moves future-period payments to current period.
 * Preserves all LicensePayment records (immutable history).
 * Only changes billing_period_id allocation.
 */
export async function POST(req: any) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    if (action !== "reconcile") {
      return NextResponse.json({ error: "Use ?action=reconcile" }, { status: 400 });
    }

    await connectToDatabase();
    const now = new Date();

    const license = await License.findOne({ "billing.enabled": true, "billing.model": "per_invoice" }).lean();
    if (!license) return NextResponse.json({ error: "No per_invoice license found" });

    const allPeriods = await LicenseBillingPeriod.find({ license_id: (license as any).id })
      .sort({ period_start: 1 }).lean();
    const currentPeriod = getCurrentBillingPeriod(allPeriods, now);
    if (!currentPeriod) return NextResponse.json({ error: "No current period found" });

    const futurePeriods = allPeriods.filter((p: any) => new Date(p.period_start) > now);
    const futurePeriodIds = futurePeriods.map((p: any) => p.id);

    // Find payments misallocated to future periods
    const misallocated = await LicensePayment.find({
      license_id: (license as any).id,
      billing_period_id: { $in: futurePeriodIds }
    });

    if (misallocated.length === 0) {
      return NextResponse.json({ message: "No misallocated payments found", reconciled: 0 });
    }

    const results = [];
    for (const payment of misallocated) {
      const oldPeriodId = payment.billing_period_id;
      payment.billing_period_id = (currentPeriod as any).id;
      // Add reconciliation note
      payment.notes = `${payment.notes || ""} [RECONCILED: reallocated from period ${oldPeriodId} to ${(currentPeriod as any).id} at ${now.toISOString()}]`.trim();
      await payment.save();
      results.push({
        payment_id: payment.id,
        amount: payment.amount_paid,
        from_period: oldPeriodId,
        to_period: (currentPeriod as any).id,
      });
    }

    // Fix future period status back to "unpaid" (no usage, no payments now)
    for (const fp of futurePeriods) {
      await LicenseBillingPeriod.updateOne(
        { _id: (fp as any)._id },
        { $set: { status: "unpaid", amount_paid: 0 } }
      );
    }

    // Fix current period status: derive from actual usage vs payments
    const currentUsage = await BillingUsage.aggregate([
      { $match: { billing_period_id: (currentPeriod as any).id } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const currentPayments = await LicensePayment.find({ billing_period_id: (currentPeriod as any).id });
    const usageTotal = currentUsage[0]?.total || 0;
    const paymentTotal = currentPayments.reduce((s, p) => s + (p.amount_paid || 0), 0);
    const newStatus = deriveEffectiveStatus(usageTotal, paymentTotal);

    await LicenseBillingPeriod.updateOne(
      { id: (currentPeriod as any).id },
      { $set: { status: newStatus === "no_activity" ? "unpaid" : newStatus, amount_paid: paymentTotal } }
    );

    return NextResponse.json({
      success: true,
      reconciled: results.length,
      results,
      current_period_new_status: newStatus,
      current_period_usage: usageTotal,
      current_period_payments: paymentTotal,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
