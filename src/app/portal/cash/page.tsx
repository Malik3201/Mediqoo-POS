"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Wallet,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  CreditCard,
  Receipt,
  Terminal,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  Users,
  ShieldAlert,
} from "lucide-react";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalSectionCard,
  PortalStatusBadge,
  PortalSlideOver,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

function formatPKR(n: number | null | undefined): string {
  return `Rs ${Math.round(Number(n) || 0).toLocaleString("en-PK")}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso: string | null | undefined): string {
  if (!iso) return "Live";
  try {
    return new Date(iso).toLocaleTimeString("en-PK", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatDuration(mins: number | undefined): string {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

function CashSupervisionContent() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const tabParam = searchParams.get("tab");
  const initialTab: "operator-shifts" | "closings" | "shifts" =
    tabParam === "shifts" || Boolean(sessionParam)
      ? "shifts"
      : tabParam === "closings"
      ? "closings"
      : "operator-shifts";

  const [activeTab, setActiveTab] = useState<"operator-shifts" | "closings" | "shifts">(initialTab);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [selectedOperatorShift, setSelectedOperatorShift] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Operator Shifts filters
  const [shiftDateFilter, setShiftDateFilter] = useState<string>("all");
  const [shiftStaffFilter, setShiftStaffFilter] = useState<string>("all");
  const [hideEmptyShifts, setHideEmptyShifts] = useState<boolean>(true);

  const loadCashData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/cash");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (sessionParam && json?.drawer_sessions) {
          const found = json.drawer_sessions.find((s: any) => s.id === sessionParam);
          if (found) {
            setSelectedSession(found);
            setReviewNote(found.owner_review?.note || "");
          }
        }
        // If no operator shifts exist yet and user didn't explicitly request operator-shifts, default cleanly to closings
        if (!tabParam && !sessionParam && (!json?.shift_sessions || json.shift_sessions.length === 0)) {
          setActiveTab("closings");
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionParam, tabParam]);

  useEffect(() => {
    void loadCashData();
  }, [loadCashData]);

  const handleSubmitCashReview = async (
    sessionId: string,
    businessDate: string | undefined,
    status: "reviewed" | "flagged_for_audit"
  ) => {
    setSubmittingReview(true);
    try {
      const res = await fetch("/api/portal/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_cash_discrepancy",
          session_id: sessionId,
          business_date: businessDate,
          status,
          note: reviewNote,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (selectedSession && selectedSession.id === sessionId) {
          setSelectedSession({
            ...selectedSession,
            owner_review: json.cash_review,
          });
        }
        if (
          selectedOperatorShift &&
          (selectedOperatorShift.session_id === sessionId || selectedOperatorShift.id === sessionId)
        ) {
          setSelectedOperatorShift({
            ...selectedOperatorShift,
            owner_review: json.cash_review,
          });
        }
        await loadCashData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const drawer = data?.current_drawer || {};
  const tenders = data?.today_tenders || {};
  const drawerSessions: any[] = data?.drawer_sessions || [];
  const dailyClosings: any[] = data?.daily_closings || [];
  const allOperatorShifts: any[] = data?.shift_sessions || [];
  const shiftsSummary = data?.shifts_summary || {
    total_shifts: 0,
    today_shifts: 0,
    open_shifts: 0,
    variance_alerts_count: 0,
    today_net_sales: 0,
  };

  const shiftDates = useMemo(() => {
    const set = new Set<string>();
    for (const s of allOperatorShifts) {
      if (s.business_date) set.add(s.business_date);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allOperatorShifts]);

  const shiftStaffNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of allOperatorShifts) {
      if (s.operator_name) set.add(s.operator_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allOperatorShifts]);

  const emptyOperatorShiftsCount = useMemo(
    () => allOperatorShifts.filter((s) => Boolean(s.is_empty)).length,
    [allOperatorShifts]
  );

  const visibleOperatorShifts = useMemo(() => {
    return allOperatorShifts.filter((s) => {
      if (hideEmptyShifts && s.is_empty) return false;
      if (shiftDateFilter !== "all" && s.business_date !== shiftDateFilter) return false;
      if (shiftStaffFilter !== "all" && s.operator_name !== shiftStaffFilter) return false;
      return true;
    });
  }, [allOperatorShifts, hideEmptyShifts, shiftDateFilter, shiftStaffFilter]);

  const drawerVariance = Number(drawer.variance ?? 0);

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<Wallet className="w-5 h-5" />}
        title="Cash, Shifts & Day Close Supervision"
        subtitle="Monitor live operator shifts, shift-by-shift sales & cash handovers, drawer balances, and daily Z-Report closings."
        actions={
          <PortalRefreshButton loading={loading} onClick={() => void loadCashData()} />
        }
      />

      {/* Current Cash Drawer Supervision Hero Card */}
      <PortalSectionCard className="overflow-hidden border-t-[3px] border-t-emerald-600">
        <div className="px-4 sm:px-6 py-4 bg-[#0F172B] border-b border-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold text-white">
                  {drawer.drawer_name || "Main Counter Cash Drawer"}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                    drawer.status === "open"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-slate-800 text-slate-300 border border-slate-700"
                  }`}
                >
                  {drawer.status === "open" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {drawer.status || "Closed"}
                </span>
                {shiftsSummary.open_shifts > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-sky-500/20 text-sky-300 border border-sky-400/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    {shiftsSummary.open_shifts} Live Shift
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {drawer.opened_by ? `Operator: ${drawer.opened_by}` : "Counter Supervision"} ·
                Date: {drawer.business_date || "Today"}
                {drawer.last_reconciled_at
                  ? ` · Synced ${formatDateTime(drawer.last_reconciled_at)}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="sm:text-right bg-slate-800/75 sm:bg-transparent border border-slate-700/80 sm:border-0 rounded-lg px-4 py-3 sm:p-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
              Expected Physical Cash
            </span>
            <p className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums mt-0.5">
              {formatPKR(drawer.expected_cash ?? 0)}
            </p>
          </div>
        </div>

        {/* Reconciliation Formula Grid */}
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 bg-white">
          <div className="p-3 rounded-lg bg-[#F8FAFC] border border-slate-300/80">
            <span className="text-[10px] font-bold uppercase text-slate-500 block">
              Opening Float
            </span>
            <span className="text-sm sm:text-base font-extrabold text-[#0F172B] mt-1 block tabular-nums">
              {formatPKR(drawer.opening_float ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
            <span className="text-[10px] font-bold uppercase text-emerald-800 block">
              + Cash Sales
            </span>
            <span className="text-sm sm:text-base font-extrabold text-emerald-700 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_sales ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
            <span className="text-[10px] font-bold uppercase text-emerald-700 block">
              + Credit Receipts
            </span>
            <span className="text-sm sm:text-base font-extrabold text-emerald-700 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_receipts ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-rose-50/70 border border-rose-200/80">
            <span className="text-[10px] font-bold uppercase text-rose-700 block">
              - Cash Refunds
            </span>
            <span className="text-sm sm:text-base font-extrabold text-rose-700 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_refunds ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-rose-50/70 border border-rose-200/80">
            <span className="text-[10px] font-bold uppercase text-rose-700 block">
              - Cash Expenses
            </span>
            <span className="text-sm sm:text-base font-extrabold text-rose-700 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_expenses ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-sky-50/70 border border-sky-200/80">
            <span className="text-[10px] font-bold uppercase text-sky-700 block">
              + Manual Cash In
            </span>
            <span className="text-sm sm:text-base font-extrabold text-sky-700 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_in ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80">
            <span className="text-[10px] font-bold uppercase text-amber-800 block">
              - Manual Cash Out
            </span>
            <span className="text-sm sm:text-base font-extrabold text-amber-800 mt-1 block tabular-nums">
              {formatPKR(drawer.cash_out ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/90">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">
              Counted / Variance
            </span>
            {drawer.counted_cash !== null && drawer.counted_cash !== undefined ? (
              <>
                <span className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 block tabular-nums">
                  {formatPKR(drawer.counted_cash)}
                </span>
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    drawerVariance < 0
                      ? "text-rose-600"
                      : drawerVariance > 0
                      ? "text-sky-600"
                      : "text-emerald-700"
                  }`}
                >
                  Var: {formatPKR(drawerVariance)}
                </span>
              </>
            ) : (
              <span className="text-xs font-bold text-slate-400 mt-1.5 block">
                Pending Shift Close
              </span>
            )}
          </div>
        </div>

        {/* Non-Cash Tenders Strip */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50/90 border-t border-slate-200/80 flex flex-wrap items-center gap-3 sm:gap-6 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600">
            <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
            <span>
              Card Sales: <strong className="text-slate-900 tabular-nums">{formatPKR(tenders.card_sales)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600">
            <Terminal className="w-3.5 h-3.5 text-sky-600" />
            <span>
              Mobile / Wallet:{" "}
              <strong className="text-slate-900 tabular-nums">{formatPKR(tenders.wallet_sales)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600">
            <Receipt className="w-3.5 h-3.5 text-amber-600" />
            <span>
              Credit (Khata) Sales:{" "}
              <strong className="text-amber-700 tabular-nums">{formatPKR(tenders.credit_sales)}</strong>
            </span>
          </div>
        </div>
      </PortalSectionCard>

      {/* Segmented Switcher: Operator Shifts | Daily Closings | Drawer Sessions */}
      <div className="flex items-center bg-slate-100/90 border border-slate-200/80 rounded-2xl p-1 w-full sm:w-fit overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("operator-shifts")}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap inline-flex items-center justify-center gap-1.5 ${
            activeTab === "operator-shifts"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>Operator Shifts ({visibleOperatorShifts.length})</span>
          {shiftsSummary.open_shifts > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
              {shiftsSummary.open_shifts} Live
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("closings")}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === "closings"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Daily Closings ({dailyClosings.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("shifts")}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === "shifts"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Drawer Sessions ({drawerSessions.length})
        </button>
      </div>

      {/* TAB 1: Operator Shift Summaries (Synced from POS Multi-User Shifts) */}
      {activeTab === "operator-shifts" && (
        <div className="space-y-4">
          {/* Quick KPI Row for Operator Shifts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white border border-slate-200/90 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Today&apos;s Shifts
              </span>
              <p className="text-xl font-extrabold text-slate-900 tabular-nums mt-1">
                {shiftsSummary.today_shifts}
              </p>
              <span className="text-[11px] text-slate-500">
                {shiftsSummary.open_shifts > 0 ? `${shiftsSummary.open_shifts} currently open` : "All closed"}
              </span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200/90 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Today Shift Sales
              </span>
              <p className="text-xl font-extrabold text-[#009A4D] tabular-nums mt-1">
                {formatPKR(shiftsSummary.today_net_sales)}
              </p>
              <span className="text-[11px] text-slate-500">Combined across shifts</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200/90 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Synced Shifts
              </span>
              <p className="text-xl font-extrabold text-slate-900 tabular-nums mt-1">
                {shiftsSummary.total_shifts}
              </p>
              <span className="text-[11px] text-slate-500">Latest 60 recorded shifts</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200/90 p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Cash Variance Alerts
              </span>
              <p
                className={`text-xl font-extrabold tabular-nums mt-1 ${
                  shiftsSummary.variance_alerts_count > 0 ? "text-rose-600" : "text-emerald-700"
                }`}
              >
                {shiftsSummary.variance_alerts_count}
              </p>
              <span className="text-[11px] text-slate-500">Shifts with cash diff</span>
            </div>
          </div>

          <PortalSectionCard
            title="Staff Shift-by-Shift Audit"
            subtitle="Separate record for every cashier, pharmacist, and manager shift — tap any shift to inspect full breakdown"
            icon={<Users className="w-4 h-4" />}
            headerRight={
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={shiftDateFilter}
                  onChange={(e) => setShiftDateFilter(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">All Dates</option>
                  {shiftDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  value={shiftStaffFilter}
                  onChange={(e) => setShiftStaffFilter(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">All Staff</option>
                  {shiftStaffNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {emptyOperatorShiftsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setHideEmptyShifts((v) => !v)}
                    className={`h-8 px-2.5 rounded-lg border text-[11px] font-bold transition-colors ${
                      hideEmptyShifts
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {hideEmptyShifts
                      ? `${emptyOperatorShiftsCount} Empty Hidden`
                      : `Showing ${emptyOperatorShiftsCount} Empty`}
                  </button>
                )}
              </div>
            }
          >
            {visibleOperatorShifts.length === 0 ? (
              <PortalEmptyState
                icon={<Clock className="w-6 h-6" />}
                title="No Operator Shifts Synced Yet"
                description="Once staff start or close shifts on the POS counter under Multi-User Mode, each shift's full sales, returns, purchases, credit collections, expenses, and cash count will appear here automatically."
              />
            ) : (
              <>
                {/* Mobile Operator Shift Cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {visibleOperatorShifts.map((sh: any) => {
                    const isOpen = sh.status === "active";
                    const isHandover = sh.close_reason === "admin_takeover";
                    const hasVar =
                      sh.cash_variance !== null &&
                      sh.cash_variance !== undefined &&
                      Math.abs(Number(sh.cash_variance)) >= 1;
                    return (
                      <button
                        key={sh.session_id || sh.id}
                        type="button"
                        onClick={() => {
                          setSelectedOperatorShift(sh);
                          setReviewNote(sh.owner_review?.note || "");
                        }}
                        className="w-full text-left p-4 active:bg-emerald-50/40 transition-colors space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-extrabold text-slate-900">
                              #{sh.shift_number} · {sh.operator_name}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {sh.business_date} · {formatTimeOnly(sh.started_at)} – {formatTimeOnly(sh.ended_at)} (
                              {formatDuration(sh.duration_minutes)})
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                              {isOpen ? (
                                <PortalStatusBadge tone="emerald">LIVE OPEN</PortalStatusBadge>
                              ) : isHandover ? (
                                <PortalStatusBadge tone="amber">Admin Handover</PortalStatusBadge>
                              ) : (
                                <PortalStatusBadge tone="slate">Closed</PortalStatusBadge>
                              )}
                              {hasVar && (
                                <PortalStatusBadge tone={Number(sh.cash_variance) < 0 ? "rose" : "amber"}>
                                  Diff: {Number(sh.cash_variance) > 0 ? "+" : ""}
                                  {formatPKR(sh.cash_variance)}
                                </PortalStatusBadge>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">
                              Net Sales ({sh.invoice_count || 0})
                            </span>
                            <span className="text-sm font-extrabold text-[#009A4D] tabular-nums">
                              {formatPKR(sh.net_sales)}
                            </span>
                            <span className="text-[11px] font-bold text-slate-700 block tabular-nums">
                              Exp Cash: {formatPKR(sh.expected_cash)}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-slate-50 border border-slate-100 p-2 text-[10.5px]">
                          <div>
                            <span className="text-slate-400 block">Start Bal</span>
                            <strong className="text-slate-800 tabular-nums">{formatPKR(sh.opening_cash)}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Khata In</span>
                            <strong className="text-emerald-700 tabular-nums">
                              +{formatPKR(sh.khata_collection_total)}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Returns</span>
                            <strong className="text-rose-600 tabular-nums">
                              -{formatPKR(sh.return_total)}
                            </strong>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-400 block">Expenses</span>
                            <strong className="text-rose-600 tabular-nums">
                              -{formatPKR(sh.total_expenses)}
                            </strong>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Desktop Operator Shifts Table */}
                <div className="hidden md:block overflow-x-auto portal-scroll">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="py-3 pl-5 pr-3">Shift &amp; Staff</th>
                        <th className="py-3 px-3">Date &amp; Time</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Start Bal.</th>
                        <th className="py-3 px-3 text-right">Net Sales</th>
                        <th className="py-3 px-3 text-right">Returns</th>
                        <th className="py-3 px-3 text-right">Khata / Paid</th>
                        <th className="py-3 px-3 text-right">Expenses</th>
                        <th className="py-3 pl-3 pr-5 text-right">Expected / Counted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleOperatorShifts.map((sh: any) => {
                        const isOpen = sh.status === "active";
                        const isHandover = sh.close_reason === "admin_takeover";
                        const hasVar =
                          sh.cash_variance !== null &&
                          sh.cash_variance !== undefined &&
                          Math.abs(Number(sh.cash_variance)) >= 1;
                        return (
                          <tr
                            key={sh.session_id || sh.id}
                            onClick={() => {
                              setSelectedOperatorShift(sh);
                              setReviewNote(sh.owner_review?.note || "");
                            }}
                            className={`hover:bg-emerald-50/40 cursor-pointer transition-colors group ${
                              isOpen ? "bg-emerald-50/25" : ""
                            }`}
                          >
                            <td className="py-3.5 pl-5 pr-3">
                              <div className="flex items-center gap-2.5">
                                <span
                                  className={`w-7 h-7 rounded-lg font-mono text-[11px] font-extrabold flex items-center justify-center shrink-0 ${
                                    isOpen
                                      ? "bg-emerald-600 text-white"
                                      : "bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  #{sh.shift_number}
                                </span>
                                <div>
                                  <p className="font-extrabold text-slate-900 group-hover:text-[#009A4D]">
                                    {sh.operator_name}
                                  </p>
                                  <p className="text-[10.5px] uppercase text-slate-500">
                                    {sh.operator_role}
                                    {sh.operator_code ? ` · #${sh.operator_code}` : ""}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-3 whitespace-nowrap">
                              <p className="font-semibold text-slate-800">{sh.business_date}</p>
                              <p className="text-[11px] text-slate-500">
                                {formatTimeOnly(sh.started_at)} – {formatTimeOnly(sh.ended_at)} (
                                {formatDuration(sh.duration_minutes)})
                              </p>
                            </td>
                            <td className="py-3.5 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isOpen ? (
                                  <PortalStatusBadge tone="emerald">LIVE OPEN</PortalStatusBadge>
                                ) : isHandover ? (
                                  <PortalStatusBadge tone="amber">Admin Handover</PortalStatusBadge>
                                ) : (
                                  <PortalStatusBadge tone="slate">Closed</PortalStatusBadge>
                                )}
                                {hasVar && (
                                  <PortalStatusBadge tone={Number(sh.cash_variance) < 0 ? "rose" : "amber"}>
                                    Diff: {Number(sh.cash_variance) > 0 ? "+" : ""}
                                    {formatPKR(sh.cash_variance)}
                                  </PortalStatusBadge>
                                )}
                                {sh.owner_review && (
                                  <PortalStatusBadge
                                    tone={sh.owner_review.status === "reviewed" ? "sky" : "amber"}
                                  >
                                    {sh.owner_review.status === "reviewed" ? "Reviewed" : "Flagged"}
                                  </PortalStatusBadge>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-3 text-right font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                              {formatPKR(sh.opening_cash)}
                            </td>
                            <td className="py-3.5 px-3 text-right whitespace-nowrap">
                              <p className="font-extrabold text-slate-900 tabular-nums">
                                {formatPKR(sh.net_sales)}
                              </p>
                              <p className="text-[10.5px] text-slate-500">
                                {sh.invoice_count || 0} bills
                              </p>
                            </td>
                            <td className="py-3.5 px-3 text-right text-rose-600 font-semibold tabular-nums whitespace-nowrap">
                              {Number(sh.return_total) > 0 ? `-${formatPKR(sh.return_total)}` : formatPKR(0)}
                            </td>
                            <td className="py-3.5 px-3 text-right tabular-nums whitespace-nowrap">
                              <span className="text-emerald-700 font-semibold block">
                                +{formatPKR(sh.khata_collection_total)}
                              </span>
                              <span className="text-[10.5px] text-rose-600">
                                Sup: -{formatPKR(sh.supplier_payment_total)}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 text-right text-rose-600 font-semibold tabular-nums whitespace-nowrap">
                              {Number(sh.total_expenses) > 0 ? `-${formatPKR(sh.total_expenses)}` : formatPKR(0)}
                            </td>
                            <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <div>
                                  <p className="font-extrabold text-[#009A4D] tabular-nums">
                                    Exp: {formatPKR(sh.expected_cash)}
                                  </p>
                                  {sh.counted_cash !== null && sh.counted_cash !== undefined ? (
                                    <p className="text-[11px] font-semibold text-slate-700 tabular-nums">
                                      Cnt: {formatPKR(sh.counted_cash)}
                                    </p>
                                  ) : (
                                    <p className="text-[10.5px] text-slate-400">
                                      {isOpen ? "Active" : "Not counted"}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </PortalSectionCard>
        </div>
      )}

      {/* TAB 2: Daily Closing History */}
      {activeTab === "closings" && (
        <PortalSectionCard
          title="Daily End-of-Day Reconciliations"
          subtitle="Locked business day summaries synced from your counter terminal"
          icon={<CheckCircle2 className="w-4 h-4" />}
        >
          {dailyClosings.length === 0 ? (
            <PortalEmptyState
              icon={<Clock className="w-6 h-6" />}
              title="No Daily Closing History Yet"
              description="Daily closing records will appear here once POS shifts are reconciled and synced."
            />
          ) : (
            <>
              {/* Mobile Closing Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {dailyClosings.map((c: any) => (
                  <div key={c.id || c.business_date} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900">{c.business_date}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {c.is_formal_closing ? (
                            <PortalStatusBadge tone="emerald">
                              Locked (Rev {c.revision || 1})
                            </PortalStatusBadge>
                          ) : (
                            <PortalStatusBadge tone="slate">Live Day Rollup</PortalStatusBadge>
                          )}
                          {c.variance !== null &&
                            c.variance !== undefined &&
                            Math.abs(Number(c.variance)) >= 1 && (
                              <PortalStatusBadge tone="rose">
                                Var: {formatPKR(c.variance)}
                              </PortalStatusBadge>
                            )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Expected Cash
                        </span>
                        <span className="text-sm font-extrabold text-[#009A4D] tabular-nums">
                          {formatPKR(c.expected_cash)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50/90 border border-slate-100 p-2.5 text-[11px]">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Net Sales
                        </span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {formatPKR(c.total_sales)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Cash / Credit
                        </span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {formatPKR(c.cash_sales)}
                        </span>
                        <span className="text-[10px] text-amber-700 block">
                          Cr: {formatPKR(c.credit_sales)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Collect / Ret
                        </span>
                        <span className="font-bold text-emerald-700 tabular-nums">
                          {formatPKR(c.verified_collections)}
                        </span>
                        <span className="text-[10px] text-rose-600 block">
                          Ret: {formatPKR(c.returns_total)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Closings Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 pl-5 pr-3">Business Date</th>
                      <th className="py-3 px-3">Closing Status</th>
                      <th className="py-3 px-3 text-right">Net Sales</th>
                      <th className="py-3 px-3 text-right">Cash Sales</th>
                      <th className="py-3 px-3 text-right">Credit / Coll.</th>
                      <th className="py-3 px-3 text-right">Returns</th>
                      <th className="py-3 pl-3 pr-5 text-right">Expected Cash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dailyClosings.map((c: any) => (
                      <tr key={c.id || c.business_date} className="hover:bg-slate-50/70">
                        <td className="py-3.5 pl-5 pr-3 font-extrabold text-slate-900 whitespace-nowrap">
                          {c.business_date}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {c.is_formal_closing ? (
                              <PortalStatusBadge tone="emerald">
                                Locked (Rev {c.revision || 1})
                              </PortalStatusBadge>
                            ) : (
                              <PortalStatusBadge tone="slate">Live Rollup</PortalStatusBadge>
                            )}
                            {c.variance !== null &&
                              c.variance !== undefined &&
                              Math.abs(Number(c.variance)) >= 1 && (
                                <PortalStatusBadge tone="rose">
                                  Variance: {formatPKR(c.variance)}
                                </PortalStatusBadge>
                              )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                          {formatPKR(c.total_sales)}
                        </td>
                        <td className="py-3.5 px-3 text-right font-semibold text-slate-700 tabular-nums">
                          {formatPKR(c.cash_sales)}
                        </td>
                        <td className="py-3.5 px-3 text-right tabular-nums">
                          <span className="text-amber-700 font-semibold block">
                            {formatPKR(c.credit_sales)}
                          </span>
                          <span className="text-[10px] text-emerald-700">
                            Coll: {formatPKR(c.verified_collections)}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right text-rose-600 font-semibold tabular-nums">
                          {formatPKR(c.returns_total)}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right font-extrabold text-[#009A4D] text-sm tabular-nums whitespace-nowrap">
                          {formatPKR(c.expected_cash)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </PortalSectionCard>
      )}

      {/* TAB 3: Drawer Shift Sessions */}
      {activeTab === "shifts" && (
        <PortalSectionCard
          title="Counter Drawer Sessions"
          subtitle="Tap any drawer session to inspect cash variance notes, non-operating movements, and submit owner audit reviews"
          icon={<Terminal className="w-4 h-4" />}
        >
          {drawerSessions.length === 0 ? (
            <PortalEmptyState
              icon={<Wallet className="w-6 h-6" />}
              title="No Drawer Sessions Recorded"
              description="Drawer sessions will appear here once counter cashiers open and close cash drawers."
            />
          ) : (
            <>
              {/* Mobile Shift Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {drawerSessions.map((s: any) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedSession(s);
                      setReviewNote(s.owner_review?.note || "");
                    }}
                    className="w-full text-left p-4 active:bg-emerald-50/40 transition-colors space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-extrabold text-slate-900">
                          {s.drawer_name || "Counter Drawer"} · {s.business_date}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <PortalStatusBadge tone={s.status === "open" ? "emerald" : "slate"}>
                            {s.status}
                          </PortalStatusBadge>
                          {s.variance !== undefined &&
                            s.variance !== null &&
                            Math.abs(Number(s.variance)) >= 1 && (
                              <PortalStatusBadge tone="rose">
                                Diff: {formatPKR(s.variance)}
                              </PortalStatusBadge>
                            )}
                          {s.owner_review && (
                            <PortalStatusBadge
                              tone={s.owner_review.status === "reviewed" ? "sky" : "amber"}
                            >
                              {s.owner_review.status === "reviewed"
                                ? "Reviewed"
                                : "Flagged"}
                            </PortalStatusBadge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-extrabold text-slate-900 tabular-nums">
                          Exp: {formatPKR(s.expected_cash ?? s.opening_cash)}
                        </p>
                        {s.counted_cash !== undefined && s.counted_cash !== null && (
                          <p className="text-[11px] font-bold text-[#009A4D] tabular-nums mt-0.5">
                            Count: {formatPKR(s.counted_cash)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="truncate">
                        <span>Opened by {s.opened_by}</span>
                        {s.closed_by ? ` · Closed by ${s.closed_by}` : ""}
                        <span> · {s.movements?.length || 0} moves</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop Shift Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 pl-5 pr-3">Drawer &amp; Business Date</th>
                      <th className="py-3 px-3">Operators</th>
                      <th className="py-3 px-3">Status &amp; Audit</th>
                      <th className="py-3 px-3 text-right">Opening Float</th>
                      <th className="py-3 pl-3 pr-5 text-right">Expected / Counted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drawerSessions.map((s: any) => (
                      <tr
                        key={s.id}
                        onClick={() => {
                          setSelectedSession(s);
                          setReviewNote(s.owner_review?.note || "");
                        }}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <p className="font-extrabold text-slate-900 group-hover:text-[#009A4D]">
                            {s.drawer_name || "Counter Drawer"}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {s.business_date} · {s.movements?.length || 0} movement(s)
                          </p>
                        </td>
                        <td className="py-3.5 px-3 text-slate-600">
                          <p>In: {s.opened_by} ({formatDateTime(s.opened_at)})</p>
                          {s.closed_by && (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Out: {s.closed_by}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <PortalStatusBadge tone={s.status === "open" ? "emerald" : "slate"}>
                              {s.status}
                            </PortalStatusBadge>
                            {s.variance !== undefined &&
                              s.variance !== null &&
                              Math.abs(Number(s.variance)) >= 1 && (
                                <PortalStatusBadge tone="rose">
                                  Diff: {formatPKR(s.variance)}
                                </PortalStatusBadge>
                              )}
                            {s.owner_review && (
                              <PortalStatusBadge
                                tone={s.owner_review.status === "reviewed" ? "sky" : "amber"}
                              >
                                {s.owner_review.status === "reviewed"
                                  ? "Reviewed"
                                  : "Flagged for Audit"}
                              </PortalStatusBadge>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-semibold text-slate-700 tabular-nums">
                          {formatPKR(s.opening_cash)}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <div>
                              <p className="font-extrabold text-slate-900 tabular-nums">
                                Exp: {formatPKR(s.expected_cash ?? s.opening_cash)}
                              </p>
                              {s.counted_cash !== undefined && s.counted_cash !== null && (
                                <p className="text-[11px] font-bold text-[#009A4D] tabular-nums">
                                  Count: {formatPKR(s.counted_cash)}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </PortalSectionCard>
      )}

      {/* Operator Shift Detail & Audit Slide-Over */}
      <PortalSlideOver
        open={Boolean(selectedOperatorShift)}
        onClose={() => setSelectedOperatorShift(null)}
        eyebrow="Operator Shift Summary"
        title={
          selectedOperatorShift
            ? `Shift #${selectedOperatorShift.shift_number} · ${selectedOperatorShift.operator_name}`
            : "Shift Details"
        }
        subtitle={
          selectedOperatorShift
            ? `${selectedOperatorShift.business_date} · ${formatTimeOnly(
                selectedOperatorShift.started_at
              )} – ${formatTimeOnly(selectedOperatorShift.ended_at)} (${formatDuration(
                selectedOperatorShift.duration_minutes
              )})`
            : undefined
        }
      >
        {selectedOperatorShift && (
          <div className="space-y-4">
            {/* Status + Handover Banner */}
            <div className="flex items-center gap-2 flex-wrap">
              <PortalStatusBadge
                tone={
                  selectedOperatorShift.status === "active"
                    ? "emerald"
                    : selectedOperatorShift.close_reason === "admin_takeover"
                    ? "amber"
                    : "slate"
                }
              >
                {selectedOperatorShift.status === "active"
                  ? "LIVE OPEN SHIFT"
                  : selectedOperatorShift.close_reason === "admin_takeover"
                  ? `Closed by Admin (${selectedOperatorShift.closed_by_name || "Admin"})`
                  : "Closed"}
              </PortalStatusBadge>
              <PortalStatusBadge tone="slate">
                {String(selectedOperatorShift.operator_role || "staff").toUpperCase()}
              </PortalStatusBadge>
              {selectedOperatorShift.terminal_number && (
                <PortalStatusBadge tone="slate">
                  Counter #{selectedOperatorShift.terminal_number}
                </PortalStatusBadge>
              )}
            </div>

            {/* Key Cash Reconciliation Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">Starting Balance</span>
                <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                  {formatPKR(selectedOperatorShift.opening_cash)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <span className="text-[10px] font-bold uppercase text-emerald-800">Expected Cash</span>
                <p className="text-base font-extrabold text-emerald-800 mt-0.5 tabular-nums">
                  {formatPKR(selectedOperatorShift.expected_cash)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] font-bold uppercase text-slate-400">Counted Cash</span>
                <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                  {selectedOperatorShift.counted_cash !== null &&
                  selectedOperatorShift.counted_cash !== undefined
                    ? formatPKR(selectedOperatorShift.counted_cash)
                    : selectedOperatorShift.status === "active"
                    ? "Shift Running"
                    : "Not Counted"}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] font-bold uppercase text-slate-400">Variance / Diff</span>
                <p
                  className={`text-base font-extrabold mt-0.5 tabular-nums ${
                    selectedOperatorShift.cash_variance === null ||
                    selectedOperatorShift.cash_variance === undefined
                      ? "text-slate-400"
                      : Math.abs(Number(selectedOperatorShift.cash_variance)) < 1
                      ? "text-emerald-700"
                      : Number(selectedOperatorShift.cash_variance) < 0
                      ? "text-rose-600"
                      : "text-amber-700"
                  }`}
                >
                  {selectedOperatorShift.cash_variance !== null &&
                  selectedOperatorShift.cash_variance !== undefined
                    ? `${Number(selectedOperatorShift.cash_variance) > 0 ? "+" : ""}${formatPKR(
                        selectedOperatorShift.cash_variance
                      )}`
                    : "—"}
                </p>
              </div>
            </div>

            {/* Complete Financial Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
              <div className="px-4 py-2.5 bg-slate-50 font-extrabold uppercase tracking-wider text-[10.5px] text-slate-600">
                Sales &amp; Payment Breakdown ({selectedOperatorShift.invoice_count || 0} Invoices)
              </div>
              <div className="px-4 py-2.5 flex justify-between">
                <span className="text-slate-600">Net Sales</span>
                <strong className="text-slate-900 tabular-nums">{formatPKR(selectedOperatorShift.net_sales)}</strong>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Cash Sales</span>
                <span className="font-semibold text-slate-800 tabular-nums">{formatPKR(selectedOperatorShift.cash_sales)}</span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Card / Bank / Wallet</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {formatPKR((selectedOperatorShift.card_sales || 0) + (selectedOperatorShift.wallet_sales || 0))}
                </span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Credit (Khata) Sales</span>
                <span className="font-semibold text-amber-700 tabular-nums">{formatPKR(selectedOperatorShift.credit_sales)}</span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Sales Returns ({selectedOperatorShift.return_count || 0})</span>
                <span className="font-semibold text-rose-600 tabular-nums">-{formatPKR(selectedOperatorShift.return_total)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
              <div className="px-4 py-2.5 bg-slate-50 font-extrabold uppercase tracking-wider text-[10.5px] text-slate-600">
                Collections, Purchases &amp; Outflows
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Credit (Khata) Collected ({selectedOperatorShift.khata_collection_count || 0})</span>
                <span className="font-bold text-emerald-700 tabular-nums">
                  +{formatPKR(selectedOperatorShift.khata_collection_total)}
                </span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Purchases Received ({selectedOperatorShift.purchase_count || 0} GRNs)</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {formatPKR(selectedOperatorShift.total_purchase_value)}
                </span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Supplier Payments ({selectedOperatorShift.supplier_payment_count || 0})</span>
                <span className="font-bold text-rose-600 tabular-nums">
                  -{formatPKR(selectedOperatorShift.supplier_payment_total)}
                </span>
              </div>
              <div className="px-4 py-2 flex justify-between text-slate-600">
                <span>Operating Expenses ({selectedOperatorShift.expense_count || 0})</span>
                <span className="font-bold text-rose-600 tabular-nums">
                  -{formatPKR(selectedOperatorShift.total_expenses)}
                </span>
              </div>
              {(selectedOperatorShift.cash_handover_to_safe !== null &&
                selectedOperatorShift.cash_handover_to_safe !== undefined) ||
              (selectedOperatorShift.closing_float_carried !== null &&
                selectedOperatorShift.closing_float_carried !== undefined) ? (
                <div className="px-4 py-2.5 bg-slate-50/70 flex justify-between">
                  <span className="text-slate-600">Safe Handover / Next Float</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatPKR(selectedOperatorShift.cash_handover_to_safe)} /{" "}
                    {formatPKR(selectedOperatorShift.closing_float_carried)}
                  </span>
                </div>
              ) : null}
            </div>

            {selectedOperatorShift.closing_note && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong>Closing Note:</strong> {selectedOperatorShift.closing_note}
                </div>
              </div>
            )}

            {/* Owner Audit Review Workflow */}
            <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#009A4D]" />
                  Owner Shift Audit Review
                </span>
                {selectedOperatorShift.owner_review && (
                  <PortalStatusBadge
                    tone={selectedOperatorShift.owner_review.status === "reviewed" ? "emerald" : "amber"}
                  >
                    {selectedOperatorShift.owner_review.status === "reviewed"
                      ? "Reviewed"
                      : "Flagged for Audit"}
                  </PortalStatusBadge>
                )}
              </div>
              <textarea
                rows={2}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add an owner review or shift verification note…"
                className="w-full p-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#009A4D]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submittingReview}
                  onClick={() =>
                    void handleSubmitCashReview(
                      selectedOperatorShift.session_id || selectedOperatorShift.id,
                      selectedOperatorShift.business_date,
                      "reviewed"
                    )
                  }
                  className="flex-1 min-h-[38px] py-2 px-3 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Mark Reviewed
                </button>
                <button
                  type="button"
                  disabled={submittingReview}
                  onClick={() =>
                    void handleSubmitCashReview(
                      selectedOperatorShift.session_id || selectedOperatorShift.id,
                      selectedOperatorShift.business_date,
                      "flagged_for_audit"
                    )
                  }
                  className="flex-1 min-h-[38px] py-2 px-3 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold hover:bg-amber-200 disabled:opacity-50"
                >
                  Flag for Audit
                </button>
              </div>
            </div>
          </div>
        )}
      </PortalSlideOver>

      {/* Drawer Shift Detail & Owner Audit Supervision Slide-Over */}
      <PortalSlideOver
        open={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        eyebrow="Drawer Cash Supervision"
        title={
          selectedSession
            ? `${selectedSession.drawer_name || "Drawer Shift"} · ${selectedSession.business_date}`
            : "Drawer Shift Details"
        }
        subtitle={
          selectedSession
            ? `Opened by ${selectedSession.opened_by}${
                selectedSession.closed_by ? ` · Closed by ${selectedSession.closed_by}` : ""
              }`
            : undefined
        }
      >
        {selectedSession && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Opening Float
                </span>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(selectedSession.opening_cash)}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Expected Cash
                </span>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(selectedSession.expected_cash ?? selectedSession.opening_cash)}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase text-emerald-700">
                  Counted Cash
                </span>
                <p className="text-sm sm:text-base font-extrabold text-emerald-800 mt-1 tabular-nums">
                  {selectedSession.counted_cash !== undefined
                    ? formatPKR(selectedSession.counted_cash)
                    : "Shift Open"}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-200/80">
                <span className="text-[10px] font-bold uppercase text-rose-700">
                  Variance
                </span>
                <p className="text-sm sm:text-base font-extrabold text-rose-700 mt-1 tabular-nums">
                  {selectedSession.variance !== undefined
                    ? formatPKR(selectedSession.variance)
                    : "—"}
                </p>
              </div>
            </div>

            {selectedSession.variance_reason && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong>Cashier Variance Note:</strong> {selectedSession.variance_reason}
                </div>
              </div>
            )}

            {/* Owner Cash Discrepancy Review Workflow */}
            <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200/90 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#009A4D]" />
                  Owner Supervision &amp; Variance Review
                </span>
                {selectedSession.owner_review && (
                  <PortalStatusBadge
                    tone={selectedSession.owner_review.status === "reviewed" ? "emerald" : "amber"}
                  >
                    {selectedSession.owner_review.status === "reviewed"
                      ? "Reviewed"
                      : "Flagged for Audit"}
                  </PortalStatusBadge>
                )}
              </div>

              {selectedSession.owner_review && (
                <p className="text-[11px] text-slate-500">
                  Last updated by {selectedSession.owner_review.reviewed_by} on{" "}
                  {formatDateTime(selectedSession.owner_review.reviewed_at)}
                </p>
              )}

              <textarea
                rows={2}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add an owner supervision or variance audit note (stored safely in cloud without altering POS cash ledger)…"
                className="w-full p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#009A4D]"
              />

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  type="button"
                  disabled={submittingReview}
                  onClick={() =>
                    void handleSubmitCashReview(
                      selectedSession.id,
                      selectedSession.business_date,
                      "reviewed"
                    )
                  }
                  className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  Mark Shift Reviewed
                </button>
                <button
                  type="button"
                  disabled={submittingReview}
                  onClick={() =>
                    void handleSubmitCashReview(
                      selectedSession.id,
                      selectedSession.business_date,
                      "flagged_for_audit"
                    )
                  }
                  className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold hover:bg-amber-200 disabled:opacity-50 transition-colors"
                >
                  Flag for Audit
                </button>
              </div>
            </div>

            {/* Non-Operating Cash Movements */}
            <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-white">
              <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Non-Operating Cash Movements ({selectedSession.movements?.length || 0})
                </h3>
              </div>

              {selectedSession.movements && selectedSession.movements.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {selectedSession.movements.map((m: any) => (
                    <div
                      key={m.id}
                      className="px-4 py-3 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            m.type === "cash_in"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-600"
                          }`}
                        >
                          {m.type === "cash_in" ? (
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span
                            className={`font-extrabold ${
                              m.type === "cash_in" ? "text-emerald-700" : "text-rose-600"
                            }`}
                          >
                            {m.type === "cash_in" ? "Cash In" : "Cash Out"} ·{" "}
                            {String(m.category).replace("_", " ")}
                          </span>
                          <p className="text-slate-700 mt-0.5">{m.reason}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {formatDateTime(m.timestamp)} · {m.operator_name}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`font-extrabold tabular-nums shrink-0 ${
                          m.type === "cash_in" ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {m.type === "cash_in" ? "+" : "-"}
                        {formatPKR(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-6 text-xs text-slate-400 text-center">
                  No manual cash in/out movements recorded during this shift.
                </p>
              )}
            </div>
          </div>
        )}
      </PortalSlideOver>
    </div>
  );
}

export default function PortalCashPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          Loading Cash Supervision…
        </div>
      }
    >
      <CashSupervisionContent />
    </Suspense>
  );
}
