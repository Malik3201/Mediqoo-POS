import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import Client from "@/models/Client";
import License from "@/models/License";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import { getDailyBuckets } from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/trends
 *
 * Returns daily aggregated trends in the client's local timezone.
 *
 * Each day bucket is computed using the client's IANA timezone — so "today"
 * means 00:00–23:59 in their local time, not UTC midnight.
 *
 * Query params:
 *   days: 7 | 30 (default: 7)
 *   license_id: optional
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);

    await connectToDatabase();

    const clientId = user.client_id;
    const daysParam = req.nextUrl.searchParams.get("days") ?? "7";
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");

    const days = daysParam === "30" ? 30 : 7;

    // Get client timezone
    const client = await Client.findOne({ id: clientId })
      .select("timezone")
      .lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";

    // Validate optional license filter
    if (licenseIdParam) {
      const licenseCheck = await License.findOne({
        id: licenseIdParam,
        client_id: clientId,
      }).lean();
      if (!licenseCheck) {
        return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      }
    }

    // Build daily buckets in client timezone
    const buckets = getDailyBuckets(timezone, days);
    const overallStart = buckets[0].start;
    const overallEnd = buckets[buckets.length - 1].end;

    const matchFilter: Record<string, any> = {
      client_id: clientId,
      occurred_at: { $gte: overallStart, $lte: overallEnd },
    };
    if (licenseIdParam) matchFilter.license_id = licenseIdParam;

    // Aggregate events (all sales + returns + purchases in date range)
    const events = await AnalyticsEvent.find({
      ...matchFilter,
      type: { $in: ["sale.completed", "sale.returned", "purchase.received"] },
    })
      .select("type occurred_at payload")
      .lean();

    // Aggregate expenses from CloudExpense projection
    const expenseFilter: Record<string, any> = {
      client_id: clientId,
      is_deleted: false,
      occurred_at: { $gte: overallStart, $lte: overallEnd },
    };
    if (licenseIdParam) expenseFilter.license_id = licenseIdParam;

    const expenses = await CloudExpense.find(expenseFilter)
      .select("occurred_at amount")
      .lean();

    // Group into daily buckets using client timezone boundaries
    const trend = buckets.map(({ date, start, end }) => {
      const dayEvents = events.filter((e) => {
        const t = new Date(e.occurred_at).getTime();
        return t >= start.getTime() && t <= end.getTime();
      });
      const dayExpenses = expenses.filter((e) => {
        const t = new Date(e.occurred_at).getTime();
        return t >= start.getTime() && t <= end.getTime();
      });

      const gross_sales = sum(dayEvents, "sale.completed", "gross_sales");
      const sales_returns = sum(dayEvents, "sale.returned", "return_amount");
      const net_sales = gross_sales - sales_returns;
      const sale_cogs = sum(dayEvents, "sale.completed", "cogs");
      const returned_cogs = sum(dayEvents, "sale.returned", "cogs_reversed");
      const gross_profit = net_sales - (sale_cogs - returned_cogs);
      const expenses_total = dayExpenses.reduce((acc, e) => acc + (e.amount ?? 0), 0);
      const net_profit = gross_profit - expenses_total;
      const purchases = sum(dayEvents, "purchase.received", "purchase_total");

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
