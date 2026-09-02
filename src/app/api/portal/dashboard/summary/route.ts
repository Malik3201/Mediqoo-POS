import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import Client from "@/models/Client";
import License from "@/models/License";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import {
  getClientDateRange,
  computeFinancialSummary,
  splitDateRange,
  historicalToFinancialSummary,
  mergeFinancialSummaries,
  ZERO_FINANCIAL_SUMMARY,
  type EventTypeAgg,
} from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/summary
 *
 * Returns the financial summary for the authenticated portal user's client.
 * Includes both Historical bootstrap data and Live event data, split
 * perfectly at the cutover boundary per license.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);
    await connectToDatabase();

    const clientId = user.client_id;
    const periodParam = req.nextUrl.searchParams.get("period") ?? "today";
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");

    if (!["today", "7d", "30d"].includes(periodParam)) {
      return NextResponse.json({ error: "Invalid period. Use: today, 7d, 30d" }, { status: 400 });
    }
    const period = periodParam as "today" | "7d" | "30d";

    const client = await Client.findOne({ id: clientId }).select("timezone").lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";
    const { start, end } = getClientDateRange(timezone, period);

    // 1. Resolve licenses
    let targetLicenses: string[] = [];
    if (licenseIdParam) {
      const licenseCheck = await License.findOne({ id: licenseIdParam, client_id: clientId }).lean();
      if (!licenseCheck) return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      targetLicenses = [licenseIdParam];
    } else {
      const licenses = await License.find({ client_id: clientId }).select("id").lean<{ id: string }[]>();
      targetLicenses = licenses.map((l) => l.id);
    }

    // 2. Fetch bootstraps
    const bootstraps = await AnalyticsBootstrap.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      status: "completed",
    }).lean();
    
    // We only care about the latest bootstrap version per license (usually 1, but handled just in case)
    const bootstrapMap = new Map<string, any>();
    for (const b of bootstraps) {
      const existing = bootstrapMap.get(b.license_id);
      if (!existing || b.bootstrap_version > existing.bootstrap_version) {
        bootstrapMap.set(b.license_id, b);
      }
    }

    let finalSummary = { ...ZERO_FINANCIAL_SUMMARY };

    // 3. Process each license to respect its exact cutover boundary
    for (const licId of targetLicenses) {
      const bootstrap = bootstrapMap.get(licId);
      const cutoffUtc = bootstrap ? bootstrap.bootstrap_cutoff_utc : null;
      
      const { historical, live } = splitDateRange(start, end, cutoffUtc, timezone);

      // --- Historical ---
      if (historical) {
        const histAgg = await HistoricalDailyAnalytics.aggregate([
          {
            $match: {
              client_id: clientId,
              license_id: licId,
              date: { $gte: historical.startDate, $lte: historical.endDate },
            },
          },
          {
            $group: {
              _id: null,
              gross_sales: { $sum: "$gross_sales" },
              sales_returns: { $sum: "$sales_returns" },
              cogs: { $sum: "$cogs" },
              cogs_reversed: { $sum: "$cogs_reversed" },
              gross_profit: { $sum: "$gross_profit" },
              net_profit: { $sum: "$net_profit" },
              expenses: { $sum: "$expenses" },
              purchases: { $sum: "$purchases" },
            },
          },
        ]);

        if (histAgg.length > 0) {
          const hSum = historicalToFinancialSummary(histAgg[0]);
          finalSummary = mergeFinancialSummaries(finalSummary, hSum);
        }
      }

      // --- Live ---
      if (live) {
        const matchFilter = {
          client_id: clientId,
          license_id: licId,
          occurred_at: { $gte: live.start, $lte: live.end },
        };

        const eventAgg: EventTypeAgg[] = await AnalyticsEvent.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: "$type",
              gross_sales: { $sum: "$payload.gross_sales" },
              cogs: { $sum: "$payload.cogs" },
              return_amount: { $sum: "$payload.return_amount" },
              cogs_reversed: { $sum: "$payload.cogs_reversed" },
              purchase_total: { $sum: "$payload.purchase_total" },
              cash_sales: {
                $sum: { $cond: [{ $eq: ["$payload.payment_method", "cash"] }, "$payload.net_sales", 0] },
              },
              credit_sales: {
                $sum: { $cond: [{ $ne: ["$payload.payment_method", "cash"] }, "$payload.net_sales", 0] },
              },
              count: { $sum: 1 },
            },
          },
        ]);

        const expenseAgg = await CloudExpense.aggregate([
          { $match: { ...matchFilter, is_deleted: false } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const lSum = computeFinancialSummary(eventAgg, expenseAgg[0]?.total ?? 0);
        finalSummary = mergeFinancialSummaries(finalSummary, lSum);
      }
    }

    // 4. Determine last sync time
    const latestEvent = await AnalyticsEvent.findOne({ client_id: clientId })
      .sort({ occurred_at: -1 })
      .select("occurred_at")
      .lean<{ occurred_at: Date }>();
      
    const latestBootstrap = await AnalyticsBootstrap.findOne({ client_id: clientId, status: "completed" })
      .sort({ completed_at: -1 })
      .select("completed_at")
      .lean<{ completed_at: Date }>();
      
    let last_sync_at: string | null = null;
    const t1 = latestEvent?.occurred_at?.getTime() ?? 0;
    const t2 = latestBootstrap?.completed_at?.getTime() ?? 0;
    
    if (t1 > 0 || t2 > 0) {
      last_sync_at = new Date(Math.max(t1, t2)).toISOString();
    }

    return NextResponse.json({
      ok: true,
      period,
      timezone,
      last_sync_at,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      summary: finalSummary,
    });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Dashboard summary error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
