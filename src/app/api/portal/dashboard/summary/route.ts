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
import {
  getClientDateRange,
  computeFinancialSummary,
  type EventTypeAgg,
} from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/summary
 *
 * Returns the financial summary for the authenticated portal user's client.
 *
 * Query params:
 *   period: "today" | "7d" | "30d" (default: "today")
 *   license_id: optional — filter to a specific installation
 *
 * Security:
 *   - client_id is ALWAYS from the authenticated session (DB-revalidated).
 *   - license_id filter is validated to belong to this client. Client A cannot
 *     submit Client B's license_id.
 *
 * Financial formulas (canonical — per correction #14):
 *   Net Sales = Gross Sales - Sales Returns
 *   Net COGS = Sale COGS - Returned COGS
 *   Gross Profit = Net Sales - Net COGS
 *   Expenses = sum of non-deleted CloudExpense in period
 *   Net Profit = Gross Profit - Expenses
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);

    await connectToDatabase();

    const clientId = user.client_id; // ALWAYS from session — never from request
    const periodParam = req.nextUrl.searchParams.get("period") ?? "today";
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");

    // Validate period
    if (!["today", "7d", "30d"].includes(periodParam)) {
      return NextResponse.json({ error: "Invalid period. Use: today, 7d, 30d" }, { status: 400 });
    }

    const period = periodParam as "today" | "7d" | "30d";

    // Get client timezone for correct date boundaries
    const client = await Client.findOne({ id: clientId })
      .select("timezone")
      .lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";

    // Compute date range in client's local timezone
    const { start, end } = getClientDateRange(timezone, period);

    // Build match filter — always scoped by client_id from session
    const matchFilter: Record<string, any> = {
      client_id: clientId,
      occurred_at: { $gte: start, $lte: end },
    };

    // Optional license filter — MUST be validated to belong to this client
    if (licenseIdParam) {
      const licenseCheck = await License.findOne({
        id: licenseIdParam,
        client_id: clientId, // ensures Client A cannot access Client B license
      }).lean();

      if (!licenseCheck) {
        return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      }
      matchFilter.license_id = licenseIdParam;
    }

    // ── Aggregate events by type ──────────────────────────────────────────
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
            $sum: {
              $cond: [{ $eq: ["$payload.payment_method", "cash"] }, "$payload.net_sales", 0],
            },
          },
          credit_sales: {
            $sum: {
              $cond: [{ $ne: ["$payload.payment_method", "cash"] }, "$payload.net_sales", 0],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // ── Expense total from CloudExpense projection ─────────────────────────
    const expenseFilter: Record<string, any> = {
      client_id: clientId,
      is_deleted: false,
      occurred_at: { $gte: start, $lte: end },
    };
    if (licenseIdParam) {
      expenseFilter.license_id = licenseIdParam;
    }

    const expenseAgg = await CloudExpense.aggregate([
      { $match: expenseFilter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const expenseTotal = expenseAgg[0]?.total ?? 0;

    // ── Compute canonical financial summary ───────────────────────────────
    const summary = computeFinancialSummary(eventAgg, expenseTotal);

    return NextResponse.json({
      ok: true,
      period,
      timezone,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      summary,
    });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Dashboard summary error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
