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
import { getDailyBuckets } from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/trends
 *
 * Returns daily aggregated trends perfectly split per-license between
 * historical bootstrap data and live analytics events.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);
    await connectToDatabase();

    const clientId = user.client_id;
    const daysParam = req.nextUrl.searchParams.get("days") ?? "7";
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");
    const days = daysParam === "30" ? 30 : 7;

    const client = await Client.findOne({ id: clientId }).select("timezone").lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";

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

    // 2. Fetch bootstraps to get cutoffs
    const bootstraps = await AnalyticsBootstrap.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      status: "completed",
    }).lean();
    
    const bootstrapMap = new Map<string, any>();
    for (const b of bootstraps) {
      const existing = bootstrapMap.get(b.license_id);
      if (!existing || b.bootstrap_version > existing.bootstrap_version) {
        bootstrapMap.set(b.license_id, b);
      }
    }

    // 3. Setup Buckets
    const buckets = getDailyBuckets(timezone, days);
    const overallStart = buckets[0].start;
    const overallEnd = buckets[buckets.length - 1].end;
    const firstDateStr = buckets[0].date;
    const lastDateStr = buckets[buckets.length - 1].date;

    // 4. Fetch all potential data (bulk fetch for efficiency)
    
    // Historical Data
    const histData = await HistoricalDailyAnalytics.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      date: { $gte: firstDateStr, $lte: lastDateStr }
    }).lean();

    // Live Data
    const liveEvents = await AnalyticsEvent.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      occurred_at: { $gte: overallStart, $lte: overallEnd },
      type: { $in: ["sale.completed", "sale.returned", "purchase.received"] },
    }).select("license_id type occurred_at payload").lean();

    const liveExpenses = await CloudExpense.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      is_deleted: false,
      occurred_at: { $gte: overallStart, $lte: overallEnd },
    }).select("license_id occurred_at amount").lean();

    // 5. Build Trend array
    const trend = buckets.map(({ date, start, end }) => {
      let gross_sales = 0, sales_returns = 0, cogs = 0, cogs_reversed = 0;
      let expenses_total = 0, purchases = 0, net_profit = 0, gross_profit = 0;

      for (const licId of targetLicenses) {
        const bootstrap = bootstrapMap.get(licId);
        const cutoffDate = bootstrap ? bootstrap.bootstrap_cutoff_date : null;

        if (cutoffDate && date <= cutoffDate) {
          // Use Historical data for this license on this day
          const hd = histData.find(h => h.license_id === licId && h.date === date);
          if (hd) {
            gross_sales += (hd.gross_sales || 0);
            sales_returns += (hd.sales_returns || 0);
            cogs += (hd.cogs || 0);
            cogs_reversed += (hd.cogs_reversed || 0);
            expenses_total += (hd.expenses || 0);
            purchases += (hd.purchases || 0);
          }
        } else {
          // Use Live data for this license on this day
          const dayEvents = liveEvents.filter((e) => {
             const t = new Date(e.occurred_at).getTime();
             return e.license_id === licId && t >= start.getTime() && t <= end.getTime();
          });
          const dayExpenses = liveExpenses.filter((e) => {
             const t = new Date(e.occurred_at).getTime();
             return e.license_id === licId && t >= start.getTime() && t <= end.getTime();
          });

          gross_sales += sum(dayEvents, "sale.completed", "gross_sales");
          sales_returns += sum(dayEvents, "sale.returned", "return_amount");
          cogs += sum(dayEvents, "sale.completed", "cogs");
          cogs_reversed += sum(dayEvents, "sale.returned", "cogs_reversed");
          purchases += sum(dayEvents, "purchase.received", "purchase_total");
          expenses_total += dayExpenses.reduce((acc, e) => acc + (e.amount ?? 0), 0);
        }
      }

      const net_sales = gross_sales - sales_returns;
      gross_profit = net_sales - (cogs - cogs_reversed);
      net_profit = gross_profit - expenses_total;

      return {
        date,
        gross_sales: r2(gross_sales),
        sales_returns: r2(sales_returns),
        net_sales: r2(net_sales),
        gross_profit: r2(gross_profit),
        net_profit: r2(net_profit),
        expenses: r2(expenses_total),
        purchases: r2(purchases),
      };
    });

    return NextResponse.json({ ok: true, days, timezone, trend });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Dashboard trends error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function sum(events: any[], type: string, field: string): number {
  return events
    .filter((e) => e.type === type)
    .reduce((acc, e) => acc + (Number(e.payload?.[field]) || 0), 0);
}

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
