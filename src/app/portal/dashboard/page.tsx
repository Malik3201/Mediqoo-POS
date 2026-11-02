"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Receipt,
  Wallet,
  Users,
  ShoppingBag,
  RotateCcw,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowUpRight,
  ShieldAlert,
  Sparkles,
  Wifi,
  WifiOff,
  Terminal,
  CreditCard,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

type Period = "today" | "7d" | "30d";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
};

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in active tab only

function formatPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
}

function formatDateTime(iso: string | null | undefined, tz = "Asia/Karachi"): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-PK", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function PortalOverviewPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showAllKpisMobile, setShowAllKpisMobile] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (selectedPeriod: Period, silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError("");

      try {
        const res = await fetch(`/api/portal/overview?period=${selectedPeriod}`);
        if (res.status === 401) {
          router.replace("/portal/login");
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load pharmacy overview");
        }
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || "Unable to load overview data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadOverview(period);
  }, [period, loadOverview]);

  // 5-minute active-tab polling (suspended in hidden tabs)
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadOverview(period, true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [period, loadOverview]);

  const kpis = data?.kpis_by_period?.[period] || data?.kpis || {};
  const livePos = data?.live_positions || {};
  const opStatus = data?.operational_status || {};
  const actionRequired: any[] = data?.action_required || [];
  const recentSales: any[] = data?.recent_sales || [];
  const topProducts: any[] = data?.top_products || [];
  const invAlerts = data?.inventory_alerts || { expiring_items: [], low_stock_items: [] };

  const statusTone =
    opStatus.pos_status === "online"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : opStatus.pos_status === "recent"
      ? "bg-blue-50 border-blue-200 text-blue-800"
      : opStatus.pos_status === "stale"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-slate-100 border-slate-300 text-slate-700";

  return (
    <div className="space-y-5">
      {/* Top Header & Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Pharmacy Overview
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time operational supervision · Tap any metric to inspect underlying records
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200 shadow-xs">
            {(["today", "7d", "30d"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  period === p
                    ? "bg-[#009A4D] text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            onClick={() => void loadOverview(period, true)}
            disabled={refreshing || loading}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Refresh overview"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-[#009A4D]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Operational Status Bar (Part C) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 sm:p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* POS Sync & Freshness */}
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/60">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${statusTone}`}
            >
              {opStatus.pos_status === "online" || opStatus.pos_status === "recent" ? (
                <Wifi className="w-4 h-4" />
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    opStatus.pos_status === "online"
                      ? "bg-emerald-500 animate-pulse"
                      : opStatus.pos_status === "recent"
                      ? "bg-blue-500"
                      : opStatus.pos_status === "stale"
                      ? "bg-amber-500"
                      : "bg-slate-400"
                  }`}
                />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  POS Connection
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                {opStatus.pos_status_label || "Checking sync status…"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                Last sync: {formatDateTime(opStatus.last_sync_at, data?.timezone)}
              </p>
            </div>
          </div>

          {/* Current Cash Drawer Status */}
          <Link
            href="/portal/cash"
            className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50/80 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-[#009A4D] flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Cash Drawer
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                      opStatus.current_drawer?.status === "open"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {opStatus.current_drawer?.status || "Closed"}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-900 truncate mt-0.5 tabular-nums">
                  Expected: {formatPKR(livePos.expected_drawer_cash || 0)}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {opStatus.current_drawer?.opened_by
                    ? `Operator: ${opStatus.current_drawer.opened_by}`
                    : "Tap to supervise cash"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#009A4D] shrink-0" />
          </Link>

          {/* Last Daily Closing */}
          <Link
            href="/portal/cash?tab=closings"
            className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50/80 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  Last Daily Closing
                </span>
                <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                  {opStatus.last_daily_closing?.business_date
                    ? `Closed: ${opStatus.last_daily_closing.business_date}`
                    : "No formal closing locked yet"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {opStatus.last_daily_closing?.closed_by
                    ? `By ${opStatus.last_daily_closing.closed_by}`
                    : "View daily cash history"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#009A4D] shrink-0" />
          </Link>

          {/* Active Terminals & Subscription */}
          <Link
            href="/portal/billing"
            className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50/80 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  POS Terminals
                </span>
                <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                  {opStatus.active_terminals || 1} Active Counter
                  {(opStatus.active_terminals || 1) === 1 ? "" : "s"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  Plan: {data?.pharmacy?.plan_name || "Standard POS"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#009A4D] shrink-0" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Owner Daily Brief (Prompt 2 Section 4) */}
      {data?.daily_brief && (
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3.5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded-md bg-[#009A4D] text-[10px] font-extrabold uppercase tracking-wider text-white">
                Owner Daily Brief
              </span>
              <span className="text-xs sm:text-sm font-bold text-white">
                Today: {formatPKR(data.daily_brief.net_sales_today || 0)} across{" "}
                {data.daily_brief.invoices_today || 0} invoice(s)
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/portal/alerts"
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-300 transition-colors"
              >
                Alert Center →
              </Link>
              <Link
                href="/portal/inventory"
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                Inventory Intelligence →
              </Link>
              <Link
                href="/portal/reports"
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                Reports Center →
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3.5 text-xs">
            <Link
              href="/portal/cash"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Verified Cash
              </span>
              <span className="font-bold text-white text-xs mt-0.5 block truncate">
                {data.daily_brief.verified_cash_status}
              </span>
            </Link>
            <Link
              href="/portal/sales?supervision=high_discount"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Discounts Today
              </span>
              <span className="font-bold text-amber-300 text-xs mt-0.5 block tabular-nums">
                {formatPKR(data.daily_brief.major_discounts_today || 0)}
              </span>
            </Link>
            <Link
              href="/portal/khata"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Khata Collected (24h)
              </span>
              <span className="font-bold text-emerald-300 text-xs mt-0.5 block tabular-nums">
                {formatPKR(data.daily_brief.credit_collections_today || 0)}
              </span>
            </Link>
            <Link
              href="/portal/inventory?filter=low_stock"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Low / Out of Stock
              </span>
              <span className="font-bold text-white text-xs mt-0.5 block">
                {data.daily_brief.low_stock_issues || 0} item(s)
              </span>
            </Link>
            <Link
              href="/portal/inventory?filter=expiring_soon"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Expiry Watch (60d)
              </span>
              <span className="font-bold text-amber-300 text-xs mt-0.5 block">
                {data.daily_brief.expiry_concerns || 0} batch(es)
              </span>
            </Link>
            <Link
              href="/portal/purchases"
              className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 transition-colors"
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                Supplier Cost Increases
              </span>
              <span className="font-bold text-rose-300 text-xs mt-0.5 block">
                {data.daily_brief.supplier_price_increases_count || 0} item(s)
              </span>
            </Link>
          </div>

          {Array.isArray(data.daily_brief.top_three_actions) &&
            data.daily_brief.top_three_actions.length > 0 && (
              <div className="mt-3.5 pt-3 border-t border-white/10">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">
                  Top 3 Priority Actions Right Now
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {data.daily_brief.top_three_actions.map((act: any, i: number) => (
                    <Link
                      key={act.id}
                      href={act.href}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="text-[10px] font-extrabold text-emerald-300 mr-1.5">
                          #{i + 1}
                        </span>
                        <span className="font-semibold text-white truncate">
                          {act.title}
                        </span>
                        <p className="text-[11px] text-slate-300 truncate mt-0.5">
                          {act.description}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-emerald-300 shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}

      {/* Clickable KPI Cards (Progressive Disclosure on Mobile) */}
      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, idx) => (
            <div
              key={idx}
              className="h-28 rounded-2xl bg-white border border-slate-200 p-4 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Primary 4 KPIs (Always visible on mobile & desktop) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Net Sales */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-4 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {period === "today" ? "Today's Net Sales" : `${PERIOD_LABELS[period]} Sales`}
                </span>
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#009A4D] flex items-center justify-center group-hover:bg-[#009A4D] group-hover:text-white transition-colors">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-lg sm:text-2xl font-extrabold text-slate-900 tabular-nums">
                  {formatPKR(kpis.net_sales ?? 0)}
                </p>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>Gross: {formatPKR(kpis.gross_sales ?? 0)}</span>
                  <span className="text-[#009A4D] font-semibold inline-flex items-center gap-0.5">
                    Inspect <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </Link>

            {/* 2. Total Invoices & Avg Bill */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-4 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Total Invoices</span>
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-lg sm:text-2xl font-extrabold text-slate-900 tabular-nums">
                  {(kpis.invoice_count ?? 0).toLocaleString("en-PK")}
                </p>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>Avg Bill: {formatPKR(kpis.average_bill ?? 0)}</span>
                  <span className="text-blue-600 font-semibold inline-flex items-center gap-0.5">
                    Bills <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </Link>

            {/* 3. Expected Cash in Drawer */}
            <Link
              href="/portal/cash"
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-4 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Expected Drawer Cash</span>
                <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center group-hover:bg-teal-700 group-hover:text-white transition-colors">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-lg sm:text-2xl font-extrabold text-slate-900 tabular-nums">
                  {formatPKR(livePos.expected_drawer_cash ?? 0)}
                </p>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>Cash Sales: {formatPKR(kpis.cash_sales ?? 0)}</span>
                  <span className="text-teal-700 font-semibold inline-flex items-center gap-0.5">
                    Drawer <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </Link>

            {/* 4. Customer Outstanding (Khata) */}
            <Link
              href="/portal/khata?status=due"
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-4 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Customer Khata Due</span>
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-lg sm:text-2xl font-extrabold text-slate-900 tabular-nums">
                  {formatPKR(livePos.customer_outstanding_total ?? 0)}
                </p>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>{livePos.customer_outstanding_count ?? 0} active accounts</span>
                  <span className="text-amber-700 font-semibold inline-flex items-center gap-0.5">
                    Ledger <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* Mobile Progressive Disclosure Toggle */}
          <div className="md:hidden">
            <button
              onClick={() => setShowAllKpisMobile((v) => !v)}
              className="w-full py-2 px-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs"
            >
              {showAllKpisMobile ? (
                <>
                  <span>Hide Secondary Financial Metrics</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Show Profit, Credit Sales, Suppliers, Returns & Inventory (6 more)</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {/* Secondary 6 KPIs (Visible on md+ or when expanded on mobile) */}
          <div
            className={`${
              showAllKpisMobile ? "grid" : "hidden md:grid"
            } grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3`}
          >
            {/* 5. Gross Profit */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">Gross Profit</span>
              {kpis.has_reliable_costs ? (
                <>
                  <p className="text-base font-extrabold text-emerald-700 mt-1.5 tabular-nums">
                    {formatPKR(kpis.gross_profit ?? 0)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {kpis.gross_margin_pct !== null ? `${kpis.gross_margin_pct}% margin` : "COGS verified"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-bold text-slate-600 mt-1.5">Cost Review Needed</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Some items lack purchase cost</p>
                </>
              )}
            </Link>

            {/* 6. Credit Sales (Period) */}
            <Link
              href={`/portal/sales?period=${period}&payment=credit`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">
                Credit Sales ({PERIOD_LABELS[period]})
              </span>
              <p className="text-base font-extrabold text-slate-900 mt-1.5 tabular-nums">
                {formatPKR(kpis.credit_sales ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">View credit invoices →</p>
            </Link>

            {/* 7. Supplier Verified Payable */}
            <Link
              href="/portal/purchases?tab=suppliers"
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">
                Supplier Payable
              </span>
              <p className="text-base font-extrabold text-slate-900 mt-1.5 tabular-nums">
                {formatPKR(livePos.supplier_verified_payable_total ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {livePos.unverified_historical_suppliers_count > 0
                  ? `${livePos.unverified_historical_suppliers_count} legacy excluded`
                  : `${livePos.supplier_payable_count ?? 0} verified suppliers`}
              </p>
            </Link>

            {/* 8. Returns & Refunds */}
            <Link
              href={`/portal/returns?period=${period}`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">
                Sales Returns
              </span>
              <p className="text-base font-extrabold text-red-600 mt-1.5 tabular-nums">
                {formatPKR(kpis.sales_returns ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {kpis.return_count ?? 0} return record{(kpis.return_count ?? 0) === 1 ? "" : "s"} →
              </p>
            </Link>

            {/* 9. Purchases (GRNs) */}
            <Link
              href={`/portal/purchases?period=${period}`}
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">
                Stock Purchased
              </span>
              <p className="text-base font-extrabold text-slate-900 mt-1.5 tabular-nums">
                {formatPKR(kpis.purchases ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {kpis.purchase_count ?? 0} GRN{(kpis.purchase_count ?? 0) === 1 ? "" : "s"} received →
              </p>
            </Link>

            {/* 10. Inventory Value */}
            <a
              href="#inventory-alerts"
              className="bg-white rounded-2xl border border-slate-200/90 hover:border-[#009A4D] p-3.5 shadow-xs transition-all group"
            >
              <span className="text-[11px] font-semibold text-slate-500 block">
                Inventory Value
              </span>
              <p className="text-base font-extrabold text-slate-900 mt-1.5 tabular-nums">
                {formatPKR(livePos.inventory?.stock_value ?? 0)}
              </p>
              <p className="text-[11px] text-amber-700 font-medium mt-0.5 truncate">
                {(livePos.inventory?.low_stock_count ?? 0) +
                  (livePos.inventory?.out_of_stock_count ?? 0)}{" "}
                low/out · {livePos.inventory?.expiring_soon_count ?? 0} exp
              </p>
            </a>
          </div>
        </div>
      )}

      {/* Action-Required Section (Part C) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#009A4D]" />
            <h2 className="text-sm font-bold text-slate-900">Action Required & Supervision</h2>
            {actionRequired.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                {actionRequired.length}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Click any alert to open source records
          </span>
        </div>

        {actionRequired.length === 0 ? (
          <div className="p-6 text-center flex flex-col items-center gap-1.5">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            <p className="text-xs font-bold text-slate-800">
              All Supervised Controls Look Healthy
            </p>
            <p className="text-xs text-slate-500 max-w-md">
              No cash drawer discrepancies, unusual discounts, or critical credit/stock anomalies
              detected for {PERIOD_LABELS[period]}.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {actionRequired.map((item) => {
              const badgeStyle =
                item.severity === "critical"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : item.severity === "warning"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-slate-100 text-slate-700 border-slate-200";
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/90 transition-colors group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        item.severity === "critical"
                          ? "bg-red-500"
                          : item.severity === "warning"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {item.category}
                        </span>
                        <p className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#009A4D] transition-colors">
                          {item.title}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${badgeStyle}`}
                    >
                      {item.badge}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#009A4D]" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Two-Column Grid: Recent Invoices (Clickable) & Top Selling Products */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recent Invoices */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Recent Counter Invoices</h2>
              <p className="text-[11px] text-slate-500">
                Tap any invoice to inspect line items, cashier, or print PDF
              </p>
            </div>
            <Link
              href="/portal/sales"
              className="text-xs font-bold text-[#009A4D] hover:underline inline-flex items-center gap-1"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentSales.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No synced sales invoices found yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentSales.map((inv) => (
                <button
                  key={inv.event_id || inv.id}
                  onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                  className="w-full text-left px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-emerald-50/40 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 group-hover:text-[#009A4D] font-mono">
                        #{inv.invoice_number}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          inv.payment_method === "credit"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : inv.payment_method === "card"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {inv.payment_method}
                      </span>
                      {inv.discount > 0 && (
                        <span className="text-[10px] text-amber-700 font-medium">
                          Disc: {formatPKR(inv.discount)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {inv.customer_name} · {inv.cashier} ·{" "}
                      {formatDateTime(inv.occurred_at, data?.timezone)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <p className="text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </p>
                      {inv.items_count > 0 && (
                        <p className="text-[10px] text-slate-400">
                          {inv.items_count} item{inv.items_count === 1 ? "" : "s"}
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

        {/* Top Products & Inventory Alerts */}
        <div className="lg:col-span-5 space-y-5">
          {/* Top Selling Medicines */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Top Products ({PERIOD_LABELS[period]})
                </h2>
                <p className="text-[11px] text-slate-500">Ranked by net revenue</p>
              </div>
              <Link
                href={`/portal/sales?period=${period}`}
                className="text-xs font-bold text-[#009A4D] hover:underline"
              >
                Explore Sales
              </Link>
            </div>
            {topProducts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No product sales recorded in {PERIOD_LABELS[period]}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {topProducts.map((p, idx) => (
                  <Link
                    key={p.product_id || idx}
                    href={`/portal/sales?period=${period}&q=${encodeURIComponent(p.product_name)}`}
                    className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#009A4D] text-[11px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {p.product_name}
                        </p>
                        <p className="text-[11px] text-slate-500">Qty sold: {p.qty}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-slate-900 tabular-nums">
                        {formatPKR(p.revenue)}
                      </p>
                      {p.gross_profit > 0 && (
                        <p className="text-[10px] text-emerald-600 tabular-nums">
                          GP: {formatPKR(p.gross_profit)}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Inventory Expiry & Low Stock Watchlist */}
          <div
            id="inventory-alerts"
            className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden"
          >
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600" />
                <h2 className="text-sm font-bold text-slate-900">Stock & Expiry Watchlist</h2>
              </div>
              <Link
                href="/portal/purchases"
                className="text-xs font-bold text-[#009A4D] hover:underline"
              >
                Purchases →
              </Link>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Low Stock</p>
                  <p className="text-base font-extrabold text-amber-700 mt-0.5 tabular-nums">
                    {livePos.inventory?.low_stock_count ?? 0}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Out of Stock</p>
                  <p className="text-base font-extrabold text-red-600 mt-0.5 tabular-nums">
                    {livePos.inventory?.out_of_stock_count ?? 0}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                    Expiring ≤60d
                  </p>
                  <p className="text-base font-extrabold text-orange-600 mt-0.5 tabular-nums">
                    {livePos.inventory?.expiring_soon_count ?? 0}
                  </p>
                </div>
              </div>

              {invAlerts.expiring_items?.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Near-Expiry Batches
                  </p>
                  {invAlerts.expiring_items.slice(0, 4).map((b: any, i: number) => (
                    <div
                      key={`${b.product_id}-${b.batch_no}-${i}`}
                      className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-amber-50/50 border border-amber-200/60"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{b.name}</p>
                        <p className="text-[10px] text-slate-500">
                          Batch {b.batch_no || "N/A"} · Exp: {b.expiry} · Qty: {b.qty}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          b.days_left <= 0
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {b.days_left <= 0 ? "Expired" : `${b.days_left}d left`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {invAlerts.low_stock_items?.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Critical Reorder Items
                  </p>
                  {invAlerts.low_stock_items.slice(0, 4).map((item: any, i: number) => (
                    <div
                      key={`${item.product_id}-${i}`}
                      className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-slate-50 border border-slate-200/70"
                    >
                      <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                      <span className="text-[11px] font-bold text-red-600 shrink-0 tabular-nums">
                        Stock: {item.current_stock} (Min {item.reorder_level})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Clickable Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}
