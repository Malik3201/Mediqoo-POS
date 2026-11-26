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

    const [client, portalStates, actionState] = await Promise.all([
      Client.findOne({ id: clientId }).select("timezone name").lean<any>(),
      OwnerPortalState.find({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any[]>(),
      OwnerActionState.findOne({ client_id: clientId })
        .select("cash_reviews")
        .lean<any>(),
    ]);

    const portalState = portalStates[0] || null;

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
        const amt = Number(p.netSales ?? p.net_sales ?? p.grossSales ?? p.gross_sales ?? p.total ?? 0);
        const m = (p.paymentMethod || p.payment_method || "cash").toLowerCase();
        if (m === "cash") todayCashSales += amt;
        else if (m === "card") todayCardSales += amt;
        else if (m === "wallet" || m === "bank") todayWalletSales += amt;
        else if (m === "credit" || m === "khata") todayCreditSales += amt;
      } else if (ev.type === "sale.returned") {
        const amt = Number(p.returnAmount ?? p.return_amount ?? p.total ?? 0);
        const m = (p.refundMethod || p.refund_method || p.refund || "cash").toLowerCase();
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

    // Merge drawer_sessions, shift_sessions (supporting operator_shifts / shiftSessions aliases), and daily_closings across licenses
    const drawerSessionsMap = new Map<string, any>();
    const rawShiftsMap = new Map<string, any>();
    const formalDailyClosings: any[] = [];

    for (const st of portalStates) {
      for (const ds of st?.drawer_sessions || []) {
        const key = String(ds?.id || `${ds?.business_date}-${ds?.opened_at}`);
        if (!drawerSessionsMap.has(key)) drawerSessionsMap.set(key, ds);
      }
      const candidates = [
        ...(Array.isArray(st?.shift_sessions) ? st.shift_sessions : []),
        ...(Array.isArray((st as any)?.operator_shifts) ? (st as any).operator_shifts : []),
        ...(Array.isArray((st as any)?.shiftSessions) ? (st as any).shiftSessions : []),
      ];
      for (const raw of candidates) {
        if (!raw || typeof raw !== "object") continue;
        const sid = String(
          raw.session_id || raw.sessionId || raw.id || `${raw.business_date || raw.businessDate}-${raw.shift_number || raw.shiftNumber}-${raw.started_at || raw.startedAt}`
        );
        if (!rawShiftsMap.has(sid)) {
          rawShiftsMap.set(sid, raw);
        }
      }
      for (const dc of st?.daily_closings || []) {
        formalDailyClosings.push(dc);
      }
    }

    const drawerSessions: any[] = Array.from(drawerSessionsMap.values()).map((s: any) => ({
      ...s,
      owner_review: cashReviewsMap.get(s.id) || null,
    }));

    const normalizeShift = (s: any) => {
      const sessionId = String(s.session_id ?? s.sessionId ?? s.id ?? "");
      const statusRaw = String(s.status ?? "closed").toLowerCase();
      const status = statusRaw === "open" || statusRaw === "active" ? "active" : "closed";
      const openingCash = Number(s.opening_cash ?? s.openingCash ?? s.starting_balance ?? 0) || 0;
      const netSales = Number(s.net_sales ?? s.netSales ?? 0) || 0;
      const grossSales = Number(s.gross_sales ?? s.grossSales ?? netSales) || 0;
      const invoiceCount = Number(s.invoice_count ?? s.invoiceCount ?? 0) || 0;
      const returnCount = Number(s.return_count ?? s.returnCount ?? 0) || 0;
      const returnTotal = Number(s.return_total ?? s.returnTotal ?? 0) || 0;
      const cashRefunds = Number(s.cash_refunds ?? s.cashRefunds ?? returnTotal) || 0;
      const purchaseCount = Number(s.purchase_count ?? s.purchaseCount ?? 0) || 0;
      const totalPurchaseValue = Number(s.total_purchase_value ?? s.totalPurchaseValue ?? 0) || 0;
      const supplierPaymentCount = Number(s.supplier_payment_count ?? s.supplierPaymentCount ?? 0) || 0;
      const supplierPaymentTotal = Number(
        s.supplier_payment_total ?? s.supplierPaymentTotal ?? s.purchases_paid ?? 0
      ) || 0;
      const supplierCashPaid = Number(
        s.supplier_cash_paid ?? s.supplierCashPaid ?? supplierPaymentTotal
      ) || 0;
      const khataCollectionCount = Number(s.khata_collection_count ?? s.khataCollectionCount ?? 0) || 0;
      const khataCollectionTotal = Number(
        s.khata_collection_total ?? s.khataCollectionTotal ?? s.credit_collected ?? 0
      ) || 0;
      const khataCashCollected = Number(
        s.khata_cash_collected ?? s.khataCashCollected ?? khataCollectionTotal
      ) || 0;
      const expenseCount = Number(s.expense_count ?? s.expenseCount ?? 0) || 0;
      const totalExpenses = Number(s.total_expenses ?? s.totalExpenses ?? 0) || 0;
      const cashExpenses = Number(s.cash_expenses ?? s.cashExpenses ?? totalExpenses) || 0;
      const expectedCash = Number(s.expected_cash ?? s.expectedCash ?? openingCash) || 0;
      const countedCashRaw = s.counted_cash ?? s.countedCash;
      const countedCash =
        countedCashRaw !== undefined && countedCashRaw !== null ? Number(countedCashRaw) : null;
      const varianceRaw = s.cash_variance ?? s.cashVariance ?? s.variance;
      const cashVariance =
        varianceRaw !== undefined && varianceRaw !== null ? Number(varianceRaw) : null;

      return {
        ...s,
        id: sessionId,
        session_id: sessionId,
        business_date: s.business_date ?? s.businessDate ?? formatLocalDate(new Date(s.started_at || s.startedAt || Date.now()), timezone),
        shift_number: Number(s.shift_number ?? s.shiftNumber ?? 1) || 1,
        operator_id: s.operator_id ?? s.operatorId ?? "",
        operator_name: s.operator_name ?? s.operatorName ?? "POS Operator",
        operator_code: s.operator_code ?? s.operatorCode ?? undefined,
        operator_role: s.operator_role ?? s.operatorRole ?? "staff",
        terminal_number: Number(s.terminal_number ?? s.terminalNumber ?? 1) || 1,
        status,
        started_at: s.started_at ?? s.startedAt ?? null,
        ended_at: s.ended_at ?? s.endedAt ?? null,
        duration_minutes: Number(s.duration_minutes ?? s.durationMinutes ?? 0) || 0,
        opening_cash: openingCash,
        invoice_count: invoiceCount,
        gross_sales: grossSales,
        discount_total: Number(s.discount_total ?? s.totalDiscounts ?? 0) || 0,
        net_sales: netSales,
        cash_sales: Number(s.cash_sales ?? s.cashSales ?? 0) || 0,
        card_sales: Number(s.card_sales ?? s.cardSales ?? 0) || 0,
        wallet_sales: Number(s.wallet_sales ?? s.walletSales ?? 0) || 0,
        credit_sales: Number(s.credit_sales ?? s.creditSales ?? 0) || 0,
        return_count: returnCount,
        return_total: returnTotal,
        cash_refunds: cashRefunds,
        purchase_count: purchaseCount,
        total_purchase_value: totalPurchaseValue,
        purchase_return_total: Number(s.purchase_return_total ?? s.purchaseReturnsValue ?? 0) || 0,
        khata_collection_count: khataCollectionCount,
        khata_collection_total: khataCollectionTotal,
        khata_cash_collected: khataCashCollected,
        supplier_payment_count: supplierPaymentCount,
        supplier_payment_total: supplierPaymentTotal,
        supplier_cash_paid: supplierCashPaid,
        expense_count: expenseCount,
        total_expenses: totalExpenses,
        cash_expenses: cashExpenses,
        expected_cash: expectedCash,
        counted_cash: countedCash,
        cash_variance: cashVariance,
        close_reason: s.close_reason ?? s.closeReason ?? null,
        closed_by_name: s.closed_by_name ?? s.closedByName ?? null,
        closing_note: s.closing_note ?? s.closingNote ?? null,
        is_empty: Boolean(s.is_empty ?? s.isEmpty ?? false),
        owner_review: cashReviewsMap.get(sessionId) || null,
      };
    };

    const shiftSessions: any[] = Array.from(rawShiftsMap.values())
      .map(normalizeShift)
      .sort(
        (a: any, b: any) =>
          new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()
      );
    const todayLocalStr = formatLocalDate(new Date(), timezone);
    const nonEmptyShifts = shiftSessions.filter((s: any) => !s.is_empty);
    const todayShifts = nonEmptyShifts.filter((s: any) => s.business_date === todayLocalStr);
    const openShiftsCount = shiftSessions.filter((s: any) => s.status === "active").length;
    const closedTodayShiftsCount = todayShifts.filter((s: any) => s.status !== "active").length;
    const shiftsSummary = {
      total_shifts: nonEmptyShifts.length,
      all_shifts_including_empty: shiftSessions.length,
      today_shifts: todayShifts.length,
      open_shifts: openShiftsCount,
      closed_today_shifts: closedTodayShiftsCount,
      variance_alerts_count: nonEmptyShifts.filter(
        (s: any) => s.cash_variance !== null && s.cash_variance !== undefined && Math.abs(Number(s.cash_variance)) >= 1
      ).length,
      today_net_sales: Math.round(
        todayShifts.reduce((acc: number, s: any) => acc + (Number(s.net_sales) || 0), 0) * 100
      ) / 100,
      today_expected_cash: Math.round(
        todayShifts.reduce((acc: number, s: any) => acc + (Number(s.expected_cash) || 0), 0) * 100
      ) / 100,
      last_synced_at: portalState?.captured_at ? new Date(portalState.captured_at).toISOString() : null,
    };

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
        const amt = Number(p.netSales ?? p.net_sales ?? p.grossSales ?? p.gross_sales ?? p.total ?? 0);
        const m = (p.paymentMethod || p.payment_method || "cash").toLowerCase();
        day.total_sales += amt;
        if (m === "cash") day.cash_sales += amt;
        else if (m === "card") day.card_sales += amt;
        else if (m === "wallet" || m === "bank") day.wallet_sales += amt;
        else if (m === "credit" || m === "khata") day.credit_sales += amt;
      } else if (ev.type === "sale.returned") {
        const amt = Number(p.returnAmount ?? p.return_amount ?? p.total ?? 0);
        day.returns_total += amt;
        const rm = (p.refundMethod || p.refund_method || p.refund || "cash").toLowerCase();
        if (rm === "cash") day.cash_returns += amt;
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
      shift_sessions: shiftSessions,
      shifts_summary: shiftsSummary,
      daily_closings: dailyClosings,
      recent_expenses: recentExpenses,
    });
  } catch (e: any) {
    console.error("Portal cash supervision error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

