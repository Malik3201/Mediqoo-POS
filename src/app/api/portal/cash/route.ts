import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";
import { getClientDateRange, formatLocalDate } from "@/lib/analytics";

/**
 * GET /api/portal/cash
 *
 * Cash Drawer & Daily Closing Supervision (Part G).
 * Returns:
 * 1. Current Drawer State (open/closed, opening float, cash sales, cash receipts, cash refunds,
 *    cash expenses, cash in/out, expected cash, counted cash, variance, reconciliation timestamp).
 * 2. Drawer Shift History (with clickable shift movements).
 * 3. Daily Closing History (with fallback daily reconciliation summaries when formal daily closings
 *    have not yet been recorded).
 */
export async function GET(_req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;

    const [client, portalState, actionState] = await Promise.all([
      Client.findOne({ id: clientId }).select("timezone name").lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerActionState.findOne({ client_id: clientId })
        .select("cash_reviews")
        .lean<any>(),
    ]);

    const cashReviewsMap = new Map<string, any>();
    for (const cr of actionState?.cash_reviews || []) {
      if (cr?.session_id) cashReviewsMap.set(cr.session_id, cr);
    }

    const timezone = client?.timezone ?? "Asia/Karachi";
    const { start: todayStart, end: todayEnd } = getClientDateRange(timezone, "today");
    const { start: monthStart, end: monthEnd } = getClientDateRange(timezone, "30d");

    // Fetch live today's cash events + 30d events for daily cash breakdown
    const [todayEvents, todayExpenses, monthEvents, monthExpenses] = await Promise.all([
      AnalyticsEvent.find({
        client_id: clientId,
        occurred_at: { $gte: todayStart, $lte: todayEnd },
        type: {
          $in: [
            "sale.completed",
            "sale.returned",
            "khata.payment",
            "supplier.payment",
          ],
        },
      }).lean<any[]>(),
      CloudExpense.find({
        client_id: clientId,
        is_deleted: false,
        occurred_at: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ occurred_at: -1 })
        .lean<any[]>(),
      AnalyticsEvent.find({
        client_id: clientId,
        occurred_at: { $gte: monthStart, $lte: monthEnd },
        type: {
          $in: [
            "sale.completed",
            "sale.returned",
            "khata.payment",
            "supplier.payment",
          ],
        },
      })
        .select("type occurred_at payload.net_sales payload.gross_sales payload.payment_method payload.return_amount payload.refund_method payload.amount payload.method")
        .lean<any[]>(),
      CloudExpense.find({
        client_id: clientId,
        is_deleted: false,
        occurred_at: { $gte: monthStart, $lte: monthEnd },
      })
        .sort({ occurred_at: -1 })
        .lean<any[]>(),
    ]);

    // Compute live today's cash movements from synced events
    let todayCashSales = 0;
    let todayCardSales = 0;
    let todayWalletSales = 0;
    let todayCreditSales = 0;
    let todayCashRefunds = 0;
    let todayCashReceipts = 0;
    let todayCashSupplierPayments = 0;

    for (const ev of todayEvents) {
      const p = ev.payload || {};
      if (ev.type === "sale.completed") {
        const amt = Number(p.net_sales ?? p.gross_sales ?? 0);
        const m = (p.payment_method || "cash").toLowerCase();
        if (m === "cash") todayCashSales += amt;
        else if (m === "card") todayCardSales += amt;
        else if (m === "wallet") todayWalletSales += amt;
        else if (m === "credit") todayCreditSales += amt;
      } else if (ev.type === "sale.returned") {
        const amt = Number(p.return_amount ?? 0);
        const m = (p.refund_method || "cash").toLowerCase();
        if (m === "cash") todayCashRefunds += amt;
      } else if (ev.type === "khata.payment") {
        const amt = Number(p.amount ?? 0);
        if ((p.method || "cash").toLowerCase() === "cash") todayCashReceipts += amt;
      } else if (ev.type === "supplier.payment") {
        const amt = Number(p.amount ?? 0);
        if ((p.method || "cash").toLowerCase() === "cash") todayCashSupplierPayments += amt;
      }
    }

    const todayExpensesTotal = todayExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const derivedExpectedCash = Math.round(
      (todayCashSales +
        todayCashReceipts -
        todayCashRefunds -
        todayExpensesTotal -
        todayCashSupplierPayments) *
      100
    ) / 100;

    const snapDrawer = portalState?.current_drawer;
    const currentDrawer = snapDrawer
      ? {
        source: "drawer_session",
        status: snapDrawer.status || "closed",
        session_id: snapDrawer.session_id || null,
        drawer_name: snapDrawer.drawer_name || "Main Counter Drawer",
        terminal_number: snapDrawer.terminal_number ?? 1,
        business_date: snapDrawer.business_date || formatLocalDate(new Date(), timezone),
        opened_by: snapDrawer.opened_by || "Operator",
        opened_at: snapDrawer.opened_at || null,
        closed_by: snapDrawer.closed_by || null,
        closed_at: snapDrawer.closed_at || null,
        opening_float: Math.round(Number(snapDrawer.opening_float ?? 0) * 100) / 100,
        cash_sales: Math.round(Number(snapDrawer.cash_sales ?? todayCashSales) * 100) / 100,
        cash_receipts: Math.round(Number(snapDrawer.cash_receipts ?? todayCashReceipts) * 100) / 100,
        cash_refunds: Math.round(Number(snapDrawer.cash_refunds ?? todayCashRefunds) * 100) / 100,
        cash_expenses: Math.round(Number(snapDrawer.cash_expenses ?? todayExpensesTotal) * 100) / 100,
        cash_supplier_payments: Math.round(
          Number(snapDrawer.cash_supplier_payments ?? todayCashSupplierPayments) * 100
        ) / 100,
        cash_in: Math.round(Number(snapDrawer.cash_in ?? 0) * 100) / 100,
        cash_out: Math.round(Number(snapDrawer.cash_out ?? 0) * 100) / 100,
        expected_cash: Math.round(Number(snapDrawer.expected_cash ?? derivedExpectedCash) * 100) / 100,
        counted_cash:
          snapDrawer.counted_cash !== undefined && snapDrawer.counted_cash !== null
            ? Math.round(Number(snapDrawer.counted_cash) * 100) / 100
            : null,
        variance:
          snapDrawer.variance !== undefined && snapDrawer.variance !== null
            ? Math.round(Number(snapDrawer.variance) * 100) / 100
            : null,
        variance_reason: snapDrawer.variance_reason || null,
        notes: snapDrawer.notes || null,
        last_reconciled_at:
          snapDrawer.last_reconciled_at ||
          (portalState?.captured_at ? new Date(portalState.captured_at).toISOString() : null),
      }
      : {
        source: "live_cashflow",
        status: todayEvents.length > 0 ? "open" : "closed",
        session_id: null,
        drawer_name: "Main Counter Cash Flow",
        terminal_number: 1,
        business_date: formatLocalDate(new Date(), timezone),
        opened_by: "POS Operator",
        opened_at: todayEvents.length > 0 ? new Date(todayStart).toISOString() : null,
        closed_by: null,
        closed_at: null,
        opening_float: 0,
        cash_sales: Math.round(todayCashSales * 100) / 100,
        cash_receipts: Math.round(todayCashReceipts * 100) / 100,
        cash_refunds: Math.round(todayCashRefunds * 100) / 100,
        cash_expenses: Math.round(todayExpensesTotal * 100) / 100,
        cash_supplier_payments: Math.round(todayCashSupplierPayments * 100) / 100,
        cash_in: 0,
        cash_out: 0,
        expected_cash: derivedExpectedCash,
        counted_cash: null,
        variance: null,
        variance_reason: null,
        notes: "Calculated from today's synced POS cash transactions.",
        last_reconciled_at: null,
      };

    const drawerSessions: any[] = (portalState?.drawer_sessions || []).map((s: any) => ({
      ...s,
      owner_review: cashReviewsMap.get(s.id) || null,
    }));
    const formalDailyClosings: any[] = portalState?.daily_closings || [];

    // Also build daily cash breakdown for the last 14 active business days so owners can inspect
    // daily cash reconciliation even on days where a formal closing record was not locked
    const dailyMap = new Map<
      string,
      {
        business_date: string;
        total_sales: number;
        cash_sales: number;
        card_sales: number;
        wallet_sales: number;
        credit_sales: number;
        verified_collections: number;
        returns_total: number;
        cash_returns: number;
        expenses_total: number;
      }
    >();

    const ensureDay = (dateStr: string) => {
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          business_date: dateStr,
          total_sales: 0,
          cash_sales: 0,
          card_sales: 0,
          wallet_sales: 0,
          credit_sales: 0,
          verified_collections: 0,
          returns_total: 0,
          cash_returns: 0,
          expenses_total: 0,
        });
      }
      return dailyMap.get(dateStr)!;
    };

    for (const ev of monthEvents) {
      const dStr = formatLocalDate(new Date(ev.occurred_at), timezone);
      const day = ensureDay(dStr);
      const p = ev.payload || {};
      if (ev.type === "sale.completed") {
        const amt = Number(p.net_sales ?? p.gross_sales ?? 0);
        const m = (p.payment_method || "cash").toLowerCase();
        day.total_sales += amt;
        if (m === "cash") day.cash_sales += amt;
        else if (m === "card") day.card_sales += amt;
        else if (m === "wallet") day.wallet_sales += amt;
        else if (m === "credit") day.credit_sales += amt;
      } else if (ev.type === "sale.returned") {
        const amt = Number(p.return_amount ?? 0);
        day.returns_total += amt;
        if ((p.refund_method || "cash").toLowerCase() === "cash") day.cash_returns += amt;
      } else if (ev.type === "khata.payment") {
        const amt = Number(p.amount ?? 0);
        if ((p.method || "cash").toLowerCase() === "cash") day.verified_collections += amt;
      }
    }

    for (const exp of monthExpenses) {
      const dStr = formatLocalDate(new Date(exp.occurred_at), timezone);
      const day = ensureDay(dStr);
      day.expenses_total += Number(exp.amount) || 0;
    }

    const formalByDate = new Map<string, any>();
    for (const fc of formalDailyClosings) {
      if (fc.business_date && !formalByDate.has(fc.business_date)) {
        formalByDate.set(fc.business_date, fc);
      }
    }

    const combinedDates = new Set<string>([
      ...formalByDate.keys(),
      ...dailyMap.keys(),
    ]);

    const dailyClosings = Array.from(combinedDates)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 30)
      .map((dateStr) => {
        const formal = formalByDate.get(dateStr);
        const computed = dailyMap.get(dateStr);
        if (formal) {
          return {
            ...formal,
            is_formal_closing: true,
          };
        }
        const c = computed!;
        const expectedCash = Math.round(
          (c.cash_sales + c.verified_collections - c.cash_returns - c.expenses_total) * 100
        ) / 100;
        return {
          id: `daily-${dateStr}`,
          business_date: dateStr,
          scope: "store",
          terminal_number: 1,
          status: "unclosed_activity",
          revision: 1,
          closed_at: null,
          closed_by: null,
          verified_by: null,
          notes: "Daily activity summary (formal end-of-day closing not yet locked in POS)",
          total_sales: Math.round((c.total_sales - c.returns_total) * 100) / 100,
          cash_sales: Math.round(c.cash_sales * 100) / 100,
          card_sales: Math.round(c.card_sales * 100) / 100,
          wallet_sales: Math.round(c.wallet_sales * 100) / 100,
          credit_sales: Math.round(c.credit_sales * 100) / 100,
          verified_collections: Math.round(c.verified_collections * 100) / 100,
          returns_total: Math.round(c.returns_total * 100) / 100,
          expenses_total: Math.round(c.expenses_total * 100) / 100,
          expected_cash: expectedCash,
          counted_cash: null,
          variance: null,
          is_formal_closing: false,
        };
      });

    const recentExpenses = monthExpenses.slice(0, 30).map((e) => ({
      id: e.source_record_id || e.id,
      category: e.category || "Operating Expense",
      amount: Math.round(Number(e.amount ?? 0) * 100) / 100,
      occurred_at: new Date(e.occurred_at).toISOString(),
    }));

    return NextResponse.json({
      timezone,
      current_drawer: {
        ...currentDrawer,
        owner_review: cashReviewsMap.get(currentDrawer.session_id || "current") || null,
      },
      cash_reviews: actionState?.cash_reviews || [],
      today_tenders: {
        cash_sales: Math.round(todayCashSales * 100) / 100,
        card_sales: Math.round(todayCardSales * 100) / 100,
        wallet_sales: Math.round(todayWalletSales * 100) / 100,
        credit_sales: Math.round(todayCreditSales * 100) / 100,
      },
      drawer_sessions: drawerSessions,
      daily_closings: dailyClosings,
      recent_expenses: recentExpenses,
    });
  } catch (e: any) {
    console.error("Portal cash supervision error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

