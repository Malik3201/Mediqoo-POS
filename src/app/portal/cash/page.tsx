"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalSectionCard,
  PortalStatusBadge,
  PortalSlideOver,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

function formatPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
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

function CashSupervisionContent() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const initialTab =
    searchParams.get("tab") === "shifts" || Boolean(sessionParam) ? "shifts" : "closings";

  const [activeTab, setActiveTab] = useState<"closings" | "shifts">(initialTab);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

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
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionParam]);

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

  const drawerVariance = Number(drawer.variance ?? 0);

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<Wallet className="w-5 h-5" />}
        title="Cash Drawer & Closing Supervision"
        subtitle="Monitor physical counter cash, drawer shifts, non-operating movements, and daily reconciliations."
        actions={
          <PortalRefreshButton loading={loading} onClick={() => void loadCashData()} />
        }
      />

      {/* Current Cash Drawer Supervision Hero Card */}
      <PortalSectionCard className="overflow-hidden">
        <div className="px-4 sm:px-6 py-4 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold text-white">
                  {drawer.drawer_name || "Main Counter Cash Drawer"}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    drawer.status === "open"
                      ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400/40"
                      : "bg-white/10 text-slate-300 border border-white/15"
                  }`}
                >
                  {drawer.status === "open" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {drawer.status || "Closed"}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {drawer.opened_by ? `Operator: ${drawer.opened_by}` : "Counter Supervision"} ·
                Date: {drawer.business_date || "Today"}
                {drawer.last_reconciled_at
                  ? ` · Reconciled ${formatDateTime(drawer.last_reconciled_at)}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="sm:text-right bg-white/5 sm:bg-transparent border border-white/10 sm:border-0 rounded-2xl px-4 py-3 sm:p-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 block">
              Expected Physical Cash
            </span>
            <p className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums mt-0.5">
              {formatPKR(drawer.expected_cash ?? 0)}
            </p>
          </div>
        </div>

        {/* Reconciliation Formula Grid */}
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 bg-white">
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">
              Opening Float
            </span>
            <span className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 block tabular-nums">
              {formatPKR(drawer.opening_float ?? 0)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
            <span className="text-[10px] font-bold uppercase text-emerald-700 block">
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

      {/* Segmented Switcher for Closings vs Shifts */}
      <div className="flex items-center bg-slate-100/90 border border-slate-200/80 rounded-2xl p-1 w-full sm:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("closings")}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
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
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "shifts"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Drawer Shifts ({drawerSessions.length})
        </button>
      </div>

      {/* TAB 1: Daily Closing History */}
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

      {/* TAB 2: Drawer Shift Sessions */}
      {activeTab === "shifts" && (
        <PortalSectionCard
          title="Counter Drawer Shift Sessions"
          subtitle="Tap any shift to inspect cash variance notes, non-operating movements, and submit owner audit reviews"
          icon={<Terminal className="w-4 h-4" />}
        >
          {drawerSessions.length === 0 ? (
            <PortalEmptyState
              icon={<Wallet className="w-6 h-6" />}
              title="No Drawer Shift Sessions Recorded"
              description="Shift sessions will appear here once counter cashiers open and close register shifts."
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

      {/* Drawer Shift Detail & Owner Audit Supervision Slide-Over */}
      <PortalSlideOver
        open={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        eyebrow="Shift Cash Supervision"
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
