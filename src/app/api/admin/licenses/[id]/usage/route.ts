import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import { resolveBillingModel, deriveOutstanding } from "@/lib/billing";

/**
 * GET /api/admin/licenses/[id]/usage
 *
 * Admin read-only view of per-invoice billing usage, periods, adjustments,
 * payments, and derived outstanding for a specific license.
 *
 * Returns comprehensive billing state without modifying any data.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const license = await License.findOne({ id }).lean();
  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });

  const model = resolveBillingModel(license.billing);

  // For fixed licenses, return minimal info
  if (model !== "per_invoice") {
    return NextResponse.json({
      license_id: id,
      billing_model: "fixed",
      message: "This license uses fixed billing. Usage view is only available for per_invoice licenses.",
    });
  }

  // ── Load all billing periods ──────────────────────────────────────────
  const periods = await LicenseBillingPeriod.find({ license_id: id })
    .sort({ period_start: -1 })
    .lean();

  // ── Load all payments ─────────────────────────────────────────────────
  const payments = await LicensePayment.find({ license_id: id })
    .sort({ created_at: -1 })
    .lean();

  // ── Load all adjustments ──────────────────────────────────────────────
  const adjustments = await BillingAdjustment.find({ license_id: id })
    .sort({ created_at: -1 })
    .lean();

  // ── Load usage counts per period ──────────────────────────────────────
  const usageSummary = await BillingUsage.aggregate([
    { $match: { license_id: id } },
    {
      $group: {
        _id: "$billing_period_id",
        count: { $sum: 1 },
        total_amount: { $sum: "$amount" },
        rate_snapshot: { $first: "$rate_snapshot" },
        earliest: { $min: "$occurred_at" },
        latest: { $max: "$occurred_at" },
      },
    },
  ]);

  const usageByPeriod: Record<string, any> = {};
  for (const u of usageSummary) {
    usageByPeriod[u._id] = {
      count: u.count,
      total_amount: u.total_amount,
      rate_snapshot: u.rate_snapshot,
      earliest_invoice: u.earliest,
      latest_invoice: u.latest,
    };
  }

  // ── Build period-level financial summaries ────────────────────────────
  const periodSummaries = periods.map((p: any) => {
    const usage = usageByPeriod[p.id] || { count: 0, total_amount: 0, rate_snapshot: p.rate_snapshot || 0 };

    // Payments allocated to this period's billing_period_id
    const periodPayments = payments.filter((pay: any) => pay.billing_period_id === p.id);
    const totalPaid = periodPayments.reduce((sum: number, pay: any) => sum + (pay.amount_paid || 0), 0);

    // Adjustments for this period
    const periodAdjustments = adjustments.filter((adj: any) => adj.billing_period_id === p.id);

    const outstanding = deriveOutstanding(usage.total_amount, periodAdjustments, totalPaid);

    return {
      period_id: p.id,
      period_start: p.period_start,
      period_end: p.period_end,
      billing_model: p.billing_model || "fixed",
      rate_snapshot: p.rate_snapshot,
      status: p.status,
      // Usage-derived financials
      usage_count: usage.count,
      usage_charges: usage.total_amount,
      earliest_invoice: usage.earliest_invoice || null,
      latest_invoice: usage.latest_invoice || null,
      // Payment summary
      total_paid: totalPaid,
      payment_count: periodPayments.length,
      // Adjustment summary
      adjustments_net: periodAdjustments.reduce((sum: number, adj: any) => {
        return sum + (adj.type === "debit" ? adj.amount : -adj.amount);
      }, 0),
      // Derived outstanding (NEVER stored — always computed)
      outstanding,
    };
  });

  // ── License-level totals ──────────────────────────────────────────────
  const totalUsage = usageSummary.reduce((sum, u) => sum + u.count, 0);
  const totalCharges = usageSummary.reduce((sum, u) => sum + u.total_amount, 0);
  const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount_paid || 0), 0);
  const totalAdjustmentsNet = adjustments.reduce((sum: number, adj: any) => {
    return sum + (adj.type === "debit" ? adj.amount : -adj.amount);
  }, 0);
  const totalOutstanding = totalCharges + totalAdjustmentsNet - totalPaid;

  return NextResponse.json({
    license_id: id,
    billing_model: "per_invoice",
    rate: license.billing?.rate_per_invoice || 0,
    currency: license.billing?.currency || "PKR",
    cycle: license.billing?.cycle || "monthly",
    pending_changes: license.billing?.pending_changes || null,
    min_app_version: license.billing?.min_app_version || null,

    // License-level totals
    totals: {
      usage_count: totalUsage,
      total_charges: totalCharges,
      total_paid: totalPaid,
      adjustments_net: totalAdjustmentsNet,
      outstanding: totalOutstanding,
    },

    // Per-period breakdown
    periods: periodSummaries,

    // Raw records for detail views
    recent_payments: payments.slice(0, 20),
    recent_adjustments: adjustments.slice(0, 20),
  });
}
