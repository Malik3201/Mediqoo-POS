"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Wallet,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  X,
  CreditCard,
  Receipt,
  Terminal,
} from "lucide-react";

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Cash Drawer & Daily Closing Supervision
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor physical counter cash, drawer shifts, cash in/out movements, and end-of-day reconciliations
          </p>
        </div>

        <button
          onClick={() => void loadCashData()}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Current Cash Drawer Supervision Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-6 py-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-[#009A4D] flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  {drawer.drawer_name || "Main Counter Cash Drawer"}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    drawer.status === "open"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {drawer.status || "Closed"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {drawer.opened_by ? `Operator: ${drawer.opened_by}` : "Counter Supervision"} ·
                Business Date: {drawer.business_date || "Today"}
                {drawer.last_reconciled_at
                  ? ` · Last Reconciled: ${formatDateTime(drawer.last_reconciled_at)}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Expected Physical Cash in Drawer
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-[#009A4D] tabular-nums">
              {formatPKR(drawer.expected_cash ?? 0)}
            </p>
          </div>
        </div>

        {/* Physical Cash Formula Breakdown */}
        <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase text-slate-400">Opening Float</span>
            <p className="text-sm font-bold text-slate-900 mt-1 tabular-nums">
              {formatPKR(drawer.opening_float ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/70">
            <span className="text-[10px] font-bold uppercase text-emerald-700">+ Cash Sales</span>
            <p className="text-sm font-bold text-emerald-800 mt-1 tabular-nums">
              {formatPKR(drawer.cash_sales ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/70">
            <span className="text-[10px] font-bold uppercase text-emerald-700">
              + Cash Receipts
            </span>
            <p className="text-sm font-bold text-emerald-800 mt-1 tabular-nums">
              {formatPKR(drawer.cash_receipts ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-red-50/50 border border-red-200/70">
            <span className="text-[10px] font-bold uppercase text-red-700">- Cash Refunds</span>
            <p className="text-sm font-bold text-red-700 mt-1 tabular-nums">
              {formatPKR(drawer.cash_refunds ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-red-50/50 border border-red-200/70">
            <span className="text-[10px] font-bold uppercase text-red-700">- Cash Expenses</span>
            <p className="text-sm font-bold text-red-700 mt-1 tabular-nums">
              {formatPKR(drawer.cash_expenses ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase text-slate-400">
              + Cash In / Top-Up
            </span>
            <p className="text-sm font-bold text-slate-900 mt-1 tabular-nums">
              {formatPKR(drawer.cash_in ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-[10px] font-bold uppercase text-slate-400">
              - Safe Drop / Out
            </span>
            <p className="text-sm font-bold text-slate-900 mt-1 tabular-nums">
              {formatPKR(drawer.cash_out ?? 0)}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 text-white">
            <span className="text-[10px] font-bold uppercase text-slate-300">
              Counted / Variance
            </span>
            {drawer.counted_cash !== null && drawer.counted_cash !== undefined ? (
              <div>
                <p className="text-sm font-bold mt-1 tabular-nums">
                  {formatPKR(drawer.counted_cash)}
                </p>
                <p
                  className={`text-[10px] font-semibold ${
                    Number(drawer.variance) < 0
                      ? "text-red-300"
                      : Number(drawer.variance) > 0
                      ? "text-amber-300"
                      : "text-emerald-300"
                  }`}
                >
                  Var: {formatPKR(drawer.variance ?? 0)}
                </p>
              </div>
            ) : (
              <p className="text-xs font-medium text-slate-300 mt-1">Pending Close Count</p>
            )}
          </div>
        </div>

        {/* Today's Non-Cash Tenders Bar */}
        <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Today&apos;s Non-Drawer Tenders:</span>
          <div className="flex items-center gap-4 flex-wrap">
            <span>
              Card Sales: <strong className="text-slate-900">{formatPKR(tenders.card_sales)}</strong>
            </span>
            <span>
              Wallet / Online:{" "}
              <strong className="text-slate-900">{formatPKR(tenders.wallet_sales)}</strong>
            </span>
            <span>
              Credit (Khata):{" "}
              <strong className="text-amber-700">{formatPKR(tenders.credit_sales)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* History Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab("closings")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === "closings"
              ? "bg-[#009A4D] text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Daily Closing History ({dailyClosings.length})
        </button>
        <button
          onClick={() => setActiveTab("shifts")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === "shifts"
              ? "bg-[#009A4D] text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Drawer Shift History ({drawerSessions.length})
        </button>
      </div>

      {/* TAB 1: Daily Closing History */}
      {activeTab === "closings" && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {dailyClosings.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No daily closing or daily cash activity records found yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dailyClosings.map((c: any) => (
                <div
                  key={c.id || c.business_date}
                  className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-extrabold text-slate-900 font-mono">
                        {c.business_date}
                      </span>
                      {c.is_formal_closing ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Locked Daily Closing (Rev {c.revision || 1})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          Daily Cash Summary
                        </span>
                      )}
                      {c.variance !== null &&
                        c.variance !== undefined &&
                        Math.abs(Number(c.variance)) >= 1 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            Variance: {formatPKR(c.variance)}
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      <span>Net Sales: {formatPKR(c.total_sales)}</span>
                      <span>Cash Sales: {formatPKR(c.cash_sales)}</span>
                      <span>Credit: {formatPKR(c.credit_sales)}</span>
                      <span>Collections: {formatPKR(c.verified_collections)}</span>
                      <span>Returns: {formatPKR(c.returns_total)}</span>
                      <span>Expenses: {formatPKR(c.expenses_total)}</span>
                    </div>
                    {c.closed_by && (
                      <p className="text-[11px] text-slate-400">
                        Closed by {c.closed_by} at {formatDateTime(c.closed_at)}
                      </p>
                    )}
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Expected Drawer Cash
                    </span>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatPKR(c.expected_cash)}
                    </p>
                    {c.counted_cash !== null && c.counted_cash !== undefined && (
                      <p className="text-[11px] text-emerald-700 font-semibold tabular-nums">
                        Counted: {formatPKR(c.counted_cash)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Drawer Shift History */}
      {activeTab === "shifts" && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {drawerSessions.length === 0 ? (
            <div className="p-10 text-center space-y-1.5">
              <Clock className="w-7 h-7 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Drawer Shift Sessions Synced Yet</p>
              <p className="text-xs text-slate-500">
                When operators open and close cash drawer shifts in AivraSol POS, full shift
                reconciliations and cash movements appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {drawerSessions.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedSession(s);
                    setReviewNote(s.owner_review?.note || "");
                  }}
                  className="w-full text-left p-4 sm:px-6 hover:bg-emerald-50/40 transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 group-hover:text-[#009A4D]">
                        {s.drawer_name || "Counter Drawer"} ({s.business_date})
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          s.status === "open"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        {s.status}
                      </span>
                      {s.variance !== undefined &&
                        s.variance !== null &&
                        Math.abs(Number(s.variance)) >= 1 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            Diff: {formatPKR(s.variance)}
                          </span>
                        )}
                      {s.owner_review && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            s.owner_review.status === "reviewed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {s.owner_review.status === "reviewed"
                            ? "Owner Reviewed"
                            : "Flagged for Audit"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Opened by {s.opened_by} ({formatDateTime(s.opened_at)})
                      {s.closed_by ? ` · Closed by ${s.closed_by}` : ""}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Opening Float: {formatPKR(s.opening_cash)} ·{" "}
                      {s.movements?.length || 0} non-operating cash movement(s)
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                        Exp: {formatPKR(s.expected_cash ?? s.opening_cash)}
                      </p>
                      {s.counted_cash !== undefined && s.counted_cash !== null && (
                        <p className="text-xs text-emerald-700 font-semibold tabular-nums">
                          Counted: {formatPKR(s.counted_cash)}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shift Movements Drawer */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-[2px]">
          <div className="fixed inset-0" onClick={() => setSelectedSession(null)} />
          <div className="relative z-10 w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {selectedSession.drawer_name || "Drawer Shift"} · {selectedSession.business_date}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Opened by {selectedSession.opened_by}
                </p>
              </div>
              <button
                onClick={() => setSelectedSession(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Opening Float
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                    {formatPKR(selectedSession.opening_cash)}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Expected at Close
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                    {formatPKR(selectedSession.expected_cash ?? selectedSession.opening_cash)}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Counted Cash
                  </span>
                  <p className="text-sm font-bold text-emerald-700 mt-0.5 tabular-nums">
                    {selectedSession.counted_cash !== undefined
                      ? formatPKR(selectedSession.counted_cash)
                      : "Open Shift"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Variance</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                    {selectedSession.variance !== undefined
                      ? formatPKR(selectedSession.variance)
                      : "—"}
                  </p>
                </div>
              </div>

              {selectedSession.variance_reason && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>Cashier Variance Note:</strong> {selectedSession.variance_reason}
                </div>
              )}

              {/* Owner Cash Discrepancy Review Workflow */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Owner Supervision &amp; Variance Review
                  </span>
                  {selectedSession.owner_review && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        selectedSession.owner_review.status === "reviewed"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {selectedSession.owner_review.status === "reviewed"
                        ? "Reviewed"
                        : "Flagged for Audit"}
                    </span>
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
                  className="w-full p-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#009A4D]"
                />

                <div className="flex items-center gap-2">
                  <button
                    disabled={submittingReview}
                    onClick={() =>
                      void handleSubmitCashReview(
                        selectedSession.id,
                        selectedSession.business_date,
                        "reviewed"
                      )
                    }
                    className="flex-1 py-2 px-3 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-[#008040] disabled:opacity-50"
                  >
                    Mark Shift Reviewed
                  </button>
                  <button
                    disabled={submittingReview}
                    onClick={() =>
                      void handleSubmitCashReview(
                        selectedSession.id,
                        selectedSession.business_date,
                        "flagged_for_audit"
                      )
                    }
                    className="flex-1 py-2 px-3 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold hover:bg-amber-200 disabled:opacity-50"
                  >
                    Flag for Audit
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Non-Operating Cash Movements ({selectedSession.movements?.length || 0})
                  </h3>
                </div>
                {selectedSession.movements && selectedSession.movements.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {selectedSession.movements.map((m: any) => (
                      <div
                        key={m.id}
                        className="p-3.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <span
                            className={`font-bold uppercase ${
                              m.type === "cash_in" ? "text-emerald-700" : "text-red-600"
                            }`}
                          >
                            {m.type === "cash_in" ? "Cash In" : "Cash Out"} ·{" "}
                            {String(m.category).replace("_", " ")}
                          </span>
                          <p className="text-slate-600 mt-0.5">{m.reason}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {formatDateTime(m.timestamp)} · {m.operator_name}
                          </p>
                        </div>
                        <span
                          className={`font-bold tabular-nums ${
                            m.type === "cash_in" ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {m.type === "cash_in" ? "+" : "-"}
                          {formatPKR(m.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No manual cash drops or top-ups recorded during this shift.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalCashPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">Loading Cash Supervision…</div>
      }
    >
      <CashSupervisionContent />
    </Suspense>
  );
}

