"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Receipt,
  Wallet,
  Users,
  RotateCcw,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  ShieldAlert,
  Wifi,
  WifiOff,
  Terminal,
  PackageSearch,
  BarChart3,
  BellRing,
  ShoppingBag,
  Building2,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  SalesTrendCard,
  BusinessHealthCard,
  type TrendPoint,
} from "@/components/portal/OwnerPulseCharts";
import { fetchPortalCached, getPortalCached } from "@/lib/portal-cache";

type Period = "today" | "7d" | "30d";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;

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

function formatShiftTime(iso: string | null | undefined, tz = "Asia/Karachi"): string {
  if (!iso) return "Live";
  try {
    return new Date(iso).toLocaleTimeString("en-PK", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

const OWNER_SHORTCUTS = [
  { href: "/portal/cash?tab=operator-shifts", label: "Daily Shifts", sub: "Staff shifts & cash", icon: Clock, color: "bg-teal-50 text-[#0F766E] border-teal-200" },
  { href: "/portal/sales", label: "Sales & Bills", sub: "Invoices & discounts", icon: Receipt, color: "bg-slate-100 text-[#0F172A] border-slate-300" },
  { href: "/portal/purchases", label: "Purchases & GRNs", sub: "Suppliers & stock-in", icon: ShoppingBag, color: "bg-sky-50 text-sky-800 border-sky-200" },
  { href: "/portal/khata", label: "Customer Khata", sub: "Credit & recovery", icon: Users, color: "bg-amber-50 text-amber-800 border-amber-200" },
  { href: "/portal/inventory", label: "Inventory", sub: "Stock, low & expiry", icon: PackageSearch, color: "bg-teal-50 text-[#0F766E] border-teal-200" },
  { href: "/portal/returns", label: "Returns", sub: "Sales & GRN returns", icon: RotateCcw, color: "bg-rose-50 text-rose-700 border-rose-200" },
  { href: "/portal/reports", label: "Reports", sub: "P&L & analytics", icon: BarChart3, color: "bg-slate-100 text-[#0F172A] border-slate-300" },
  { href: "/portal/alerts", label: "Owner Alerts", sub: "Checks & anomalies", icon: BellRing, color: "bg-amber-50 text-amber-800 border-amber-200" },
];

export default function PortalOverviewPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<any | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const trendDays: 7 | 30 = period === "30d" ? 30 : 7;

  const loadOverview = useCallback(
    async (selectedPeriod: Period, forceRefresh = false) => {
      const daysForTrend: 7 | 30 = selectedPeriod === "30d" ? 30 : 7;
      const ovUrl = `/api/portal/overview?period=${selectedPeriod}`;
      const trUrl = `/api/portal/dashboard/trends?days=${daysForTrend}`;

      // 0ms SWR hydration from client cache when navigating back
      const cachedOv = getPortalCached<any>(ovUrl, 45_000);
      const cachedTr = getPortalCached<any>(trUrl, 60_000);

      if (cachedOv) {
        setData(cachedOv.data);
        setLoading(false);
      } else if (!forceRefresh) {
        setLoading(true);
      }

      if (cachedTr && Array.isArray(cachedTr.data?.trend)) {
        setTrend(cachedTr.data.trend);
        setTrendLoading(false);
      } else if (!forceRefresh) {
        setTrendLoading(true);
      }

      if (!forceRefresh && cachedOv?.isFresh && cachedTr?.isFresh) {
        return;
      }

      setRefreshing(true);
      setError("");

      try {
        const [ovRes, trRes] = await Promise.all([
          fetchPortalCached<any>(ovUrl, { ttlMs: 45_000, forceRefresh }),
          fetchPortalCached<any>(trUrl, { ttlMs: 60_000, forceRefresh }).catch(() => null),
        ]);

        const json = ovRes.data;
        setData(json);

        if (trRes && Array.isArray(trRes.data?.trend)) {
          setTrend(trRes.data.trend);
        }

        if (json?.pharmacy?.name && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("aivrasol:pharmacy-meta", {
              detail: {
                name: String(json.pharmacy.name),
                logo: json.pharmacy.logo ? String(json.pharmacy.logo) : null,
              },
            })
          );
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
        if (err?.status === 401) {
          // Confirm session is genuinely expired before redirecting (avoid transient redirects)
          try {
            const meCheck = await fetch("/api/portal/auth/me", {
              cache: "no-store",
              credentials: "include",
            });
            if (meCheck.status === 401 || meCheck.status === 403) {
              window.location.replace("/portal/login");
              return;
            }
          } catch {
            // Keep current page on network hiccup
          }
        }
        if (!cachedOv) {
          setError(err?.message || "Unable to load overview data");
        }
      } finally {
        setLoading(false);
        setTrendLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadOverview(period, false);
  }, [period, loadOverview]);

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
  const dailyShifts = data?.daily_shifts || {
    today_count: 0,
    active_count: 0,
    closed_today_count: 0,
    total_synced_count: 0,
    today_net_sales: 0,
    today_expected_cash: 0,
    variance_alerts_count: 0,
    latest_shifts: [],
  };
  const actionRequired: any[] = data?.action_required || [];
  const recentSales: any[] = data?.recent_sales || [];
  const topProducts: any[] = data?.top_products || [];
  const invAlerts = data?.inventory_alerts || { expiring_items: [], low_stock_items: [] };

  const maxTopProductRevenue = Math.max(
    1,
    ...topProducts.map((tp: any) => Number(tp.revenue || 0))
  );

  const isLiveOnline = opStatus.pos_status === "online" || opStatus.pos_status === "recent";

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Solid High-Contrast Clinical-Executive Hero Banner */}
      <section className="rounded-2xl overflow-hidden bg-[#0F172A] text-white border border-slate-800 shadow-sm">
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* Top Bar: Pharmacy Identity + Period Switcher + Refresh */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#0F766E] border border-teal-500/40 flex items-center justify-center text-white shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-white truncate">
                    {data?.pharmacy?.name || "Pharmacy Business Pulse"}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                      isLiveOnline
                        ? "bg-teal-950 border-teal-500/50 text-teal-300"
                        : "bg-amber-950 border-amber-500/50 text-amber-300"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        opStatus.pos_status === "online"
                          ? "bg-teal-400 animate-pulse"
                          : isLiveOnline
                          ? "bg-sky-400"
                          : "bg-amber-400"
                      }`}
                    />
                    <span>
                      {opStatus.pos_status === "online"
                        ? "POS Live"
                        : opStatus.pos_status_label || "Cloud Sync"}
                    </span>
                  </span>
                </div>
                <p className="text-[11.5px] sm:text-xs text-slate-300 mt-0.5 truncate">
                  Last sync: {formatDateTime(opStatus.last_sync_at, data?.timezone)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex bg-slate-800 p-1 rounded-xl border border-slate-700 flex-1 sm:flex-initial">
                {(["today", "7d", "30d"] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-allow-rapid-click="true"
                    onClick={() => setPeriod(p)}
                    className={`flex-1 sm:flex-initial min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                      period === p
                        ? "bg-[#0F766E] text-white"
                        : "text-slate-300 hover:text-white hover:bg-slate-700"
                    }`}
                  >
                    {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void loadOverview(period, true)}
                disabled={refreshing || loading}
                className="h-10 w-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-teal-300 transition-all disabled:opacity-50 inline-flex items-center justify-center shrink-0 cursor-pointer"
                title="Refresh overview"
                aria-label="Refresh overview"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Primary Headline Figure + 4 Crisp Sub-Tiles */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
            <Link
              href={`/portal/sales?period=${period}`}
              prefetch={true}
              className="lg:col-span-5 group block rounded-2xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700 p-4 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400">
                  {period === "today" ? "Today's Net Sales" : `${PERIOD_LABELS[period]} Net Sales`}
                </span>
                <ArrowUpRight className="w-4 h-4 text-teal-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
              <p className="text-3xl sm:text-4xl font-black tracking-tight tabular-nums text-white mt-1.5">
                {loading && !data ? "—" : formatPKR(kpis.net_sales ?? 0)}
              </p>
              <div className="flex items-center gap-2.5 mt-2 text-xs text-slate-300 flex-wrap">
                <span>Billed: {formatPKR(kpis.gross_sales ?? 0)}</span>
                <span className="text-slate-600">•</span>
                <span>Discounts: {formatPKR(kpis.discount_total ?? 0)}</span>
              </div>
            </Link>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Link
                href={`/portal/sales?period=${period}`}
                prefetch={true}
                className="rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 p-3.5 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Bills Made
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-white tabular-nums mt-1">
                  {(kpis.invoice_count ?? 0).toLocaleString("en-PK")}
                </p>
                <p className="text-[10.5px] text-teal-400 mt-0.5 truncate">
                  Avg {formatPKR(kpis.average_bill ?? 0)}
                </p>
              </Link>

              <Link
                href={`/portal/reports?period=${period}`}
                prefetch={true}
                className="rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 p-3.5 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Gross Profit
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-teal-400 tabular-nums mt-1 truncate">
                  {formatPKR(kpis.gross_profit ?? 0)}
                </p>
                <p className="text-[10.5px] text-slate-300 mt-0.5 truncate">
                  {kpis.gross_margin_pct !== null && kpis.gross_margin_pct !== undefined
                    ? `${kpis.gross_margin_pct}% margin`
                    : "COGS verified"}
                </p>
              </Link>

              <Link
                href={`/portal/purchases?period=${period}`}
                prefetch={true}
                className="rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 p-3.5 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Stock Bought
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-white tabular-nums mt-1 truncate">
                  {formatPKR(kpis.purchases ?? 0)}
                </p>
                <p className="text-[10.5px] text-slate-300 mt-0.5 truncate">
                  {kpis.purchase_count ?? 0} GRN{(kpis.purchase_count ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>

              <Link
                href={`/portal/returns?period=${period}`}
                prefetch={true}
                className="rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 p-3.5 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Returns
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-rose-400 tabular-nums mt-1 truncate">
                  {formatPKR(kpis.sales_returns ?? 0)}
                </p>
                <p className="text-[10.5px] text-slate-300 mt-0.5 truncate">
                  {kpis.return_count ?? 0} return{(kpis.return_count ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-800 text-xs sm:text-sm font-semibold flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* DEDICATED DAILY SHIFTS QUICK-ACCESS WIDGET (1-Click Access to Operator Shifts!) */}
      <section className="bg-white rounded-2xl border border-[#D8E0EA] border-l-4 border-l-[#0F766E] overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-[15px] font-extrabold text-[#0F172A]">
                  Daily Operator Shifts
                </h2>
                {dailyShifts.active_count > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-100 text-[#0F766E] border border-teal-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0F766E] animate-pulse" />
                    {dailyShifts.active_count} Live Now
                  </span>
                )}
                {dailyShifts.variance_alerts_count > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-300">
                    {dailyShifts.variance_alerts_count} Variance Alert{dailyShifts.variance_alerts_count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Shift-by-shift staff sales, returns, expenses &amp; cash handovers
              </p>
            </div>
          </div>

          <Link
            href="/portal/cash?tab=operator-shifts"
            prefetch={true}
            className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 py-2 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-extrabold transition-colors shrink-0"
          >
            <span>View All Shifts</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5">
          {/* 4 Summary Metrics for Daily Shifts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                Today&apos;s Shifts
              </span>
              <p className="text-lg sm:text-xl font-extrabold text-[#0F172A] tabular-nums mt-0.5">
                {dailyShifts.today_count ?? 0}
              </p>
              <span className="text-[11px] text-slate-600">
                {dailyShifts.active_count ?? 0} live · {dailyShifts.closed_today_count ?? 0} closed
              </span>
            </div>

            <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 block">
                Combined Shift Sales
              </span>
              <p className="text-lg sm:text-xl font-extrabold text-[#0F766E] tabular-nums mt-0.5 truncate">
                {formatPKR(dailyShifts.today_net_sales ?? 0)}
              </p>
              <span className="text-[11px] text-teal-800">Today&apos;s staff total</span>
            </div>

            <div className="p-3 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                Expected Shift Cash
              </span>
              <p className="text-lg sm:text-xl font-extrabold text-[#0F172A] tabular-nums mt-0.5 truncate">
                {formatPKR(dailyShifts.today_expected_cash ?? 0)}
              </p>
              <span className="text-[11px] text-slate-600">Across today&apos;s shifts</span>
            </div>

            <div className="p-3 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                Total Synced Shifts
              </span>
              <p className="text-lg sm:text-xl font-extrabold text-[#0F172A] tabular-nums mt-0.5">
                {dailyShifts.total_synced_count ?? 0}
              </p>
              <span className="text-[11px] text-slate-600">
                {dailyShifts.total_synced_count > 0 ? "Ready to audit" : "Waiting on POS sync"}
              </span>
            </div>
          </div>

          {/* Latest Shifts Preview Strip */}
          {Array.isArray(dailyShifts.latest_shifts) && dailyShifts.latest_shifts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {dailyShifts.latest_shifts.map((sh: any) => {
                const isLive = sh.status === "active";
                const hasVar =
                  sh.cash_variance !== null &&
                  sh.cash_variance !== undefined &&
                  Math.abs(Number(sh.cash_variance)) >= 1;
                return (
                  <Link
                    key={sh.session_id}
                    href="/portal/cash?tab=operator-shifts"
                    prefetch={true}
                    className="flex items-center justify-between gap-2.5 p-3 rounded-xl bg-white hover:bg-[#F3F5F8] border border-[#D8E0EA] hover:border-[#0F766E] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-extrabold text-[#0F172A] truncate">
                          #{sh.shift_number} · {sh.operator_name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase ${
                            isLive
                              ? "bg-teal-100 text-[#0F766E]"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {isLive ? "Live" : "Closed"}
                        </span>
                        {hasVar && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-extrabold bg-rose-100 text-rose-700">
                            Var {formatPKR(sh.cash_variance)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 truncate">
                        {sh.business_date} · {formatShiftTime(sh.started_at, data?.timezone)} –{" "}
                        {formatShiftTime(sh.ended_at, data?.timezone)} · {sh.invoice_count || 0} bills
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-extrabold text-[#0F766E] tabular-nums">
                        {formatPKR(sh.net_sales)}
                      </p>
                      <p className="text-[10.5px] font-semibold text-slate-600 tabular-nums">
                        Cash: {formatPKR(sh.expected_cash)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-[#F3F5F8] border border-dashed border-[#CBD5E1] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                No operator shifts synced for today yet. Start or close a staff shift in POS Multi-User Mode and it will appear here automatically.
              </span>
              <Link
                href="/portal/cash?tab=operator-shifts"
                prefetch={true}
                className="font-extrabold text-[#0F766E] hover:underline shrink-0"
              >
                Open Shifts &amp; Cash →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* 4 Core Live Money & Asset Position Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link
          href="/portal/cash"
          prefetch={true}
          className="bg-white rounded-2xl border border-[#D8E0EA] hover:border-[#0F766E] p-3.5 sm:p-4 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Cash in Drawer
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] flex items-center justify-center group-hover:bg-[#0F766E] group-hover:text-white transition-colors shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#0F172A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.expected_drawer_cash ?? 0)}
            </p>
            <p className="text-[11px] text-slate-600 mt-1 truncate">
              Cash sales: {formatPKR(kpis.cash_sales ?? 0)}
            </p>
          </div>
        </Link>

        <Link
          href="/portal/khata?status=due"
          prefetch={true}
          className="bg-white rounded-2xl border border-[#D8E0EA] hover:border-amber-500 p-3.5 sm:p-4 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Customer Khata
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#0F172A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.customer_outstanding_total ?? 0)}
            </p>
            <p className="text-[11px] text-amber-800 font-semibold mt-1 truncate">
              {livePos.customer_outstanding_count ?? 0} credit accounts →
            </p>
          </div>
        </Link>

        <Link
          href="/portal/purchases?tab=suppliers"
          prefetch={true}
          className="bg-white rounded-2xl border border-[#D8E0EA] hover:border-[#0F172A] p-3.5 sm:p-4 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Supplier Payable
            </span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-300 text-[#0F172A] flex items-center justify-center group-hover:bg-[#0F172A] group-hover:text-white transition-colors shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#0F172A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.supplier_verified_payable_total ?? 0)}
            </p>
            <p className="text-[11px] text-slate-600 mt-1 truncate">
              {livePos.supplier_payable_count ?? 0} active suppliers →
            </p>
          </div>
        </Link>

        <Link
          href="/portal/inventory"
          prefetch={true}
          className="bg-white rounded-2xl border border-[#D8E0EA] hover:border-sky-500 p-3.5 sm:p-4 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Stock Value
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center group-hover:bg-sky-700 group-hover:text-white transition-colors shrink-0">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#0F172A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.inventory?.stock_value ?? 0)}
            </p>
            <p className="text-[11px] text-amber-800 font-semibold mt-1 truncate">
              {(livePos.inventory?.low_stock_count ?? 0) + (livePos.inventory?.out_of_stock_count ?? 0)} low ·{" "}
              {livePos.inventory?.expiring_soon_count ?? 0} exp
            </p>
          </div>
        </Link>
      </div>

      {/* Interactive Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div className="lg:col-span-7">
          <SalesTrendCard trend={trend} days={trendDays} loading={trendLoading} />
        </div>
        <div className="lg:col-span-5">
          <BusinessHealthCard
            kpis={kpis}
            livePos={livePos}
            opStatus={opStatus}
            periodLabel={PERIOD_LABELS[period]}
          />
        </div>
      </div>

      {/* One-Tap Quick Navigation Grid */}
      <div className="bg-white rounded-2xl border border-[#D8E0EA] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
            Quick Sections
          </h2>
          <span className="text-[11px] text-slate-500">Tap to open</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {OWNER_SHORTCUTS.map((sc) => {
            const Icon = sc.icon;
            return (
              <Link
                key={sc.href}
                href={sc.href}
                prefetch={true}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-[#F3F5F8] hover:bg-teal-50/70 border border-[#D8E0EA] hover:border-[#0F766E] transition-colors group min-h-[56px]"
              >
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${sc.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-[#0F172A] truncate group-hover:text-[#0F766E]">
                    {sc.label}
                  </p>
                  <p className="text-[10.5px] text-slate-600 truncate">{sc.sub}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Priority Attention & Supervision */}
      <div className="bg-white rounded-2xl border border-[#D8E0EA] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-[#0F766E] shrink-0" />
            <h2 className="text-sm font-extrabold text-[#0F172A] truncate">
              Attention &amp; Supervision
            </h2>
            {actionRequired.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-extrabold bg-amber-50 text-amber-900 border border-amber-300">
                {actionRequired.length}
              </span>
            )}
          </div>
          <Link
            href="/portal/alerts"
            prefetch={true}
            className="text-xs font-bold text-[#0F766E] hover:underline shrink-0"
          >
            All Alerts →
          </Link>
        </div>

        {actionRequired.length === 0 ? (
          <div className="p-7 text-center flex flex-col items-center gap-2">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-[#0F766E]">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-extrabold text-[#0F172A]">
              Everything Looks Healthy
            </p>
            <p className="text-xs text-slate-600 max-w-md">
              No cash drawer discrepancies, unusual discounts, or critical credit/stock issues for {PERIOD_LABELS[period]}.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E6ECF2]">
            {actionRequired.map((item) => {
              const badgeStyle =
                item.severity === "critical"
                  ? "bg-rose-50 text-rose-800 border-rose-300"
                  : item.severity === "warning"
                  ? "bg-amber-50 text-amber-900 border-amber-300"
                  : "bg-slate-100 text-[#0F172A] border-slate-300";
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  prefetch={true}
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-[#F3F5F8] transition-colors group"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                        item.severity === "critical"
                          ? "bg-rose-600"
                          : item.severity === "warning"
                          ? "bg-amber-500"
                          : "bg-[#0F766E]"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                          {item.category}
                        </span>
                        <p className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#0F766E] transition-colors">
                          {item.title}
                        </p>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pl-5 sm:pl-0">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeStyle}`}>
                      {item.badge}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#0F766E]" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Counter Invoices & Top Selling Products + Stock Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recent Invoices */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#D8E0EA] overflow-hidden flex flex-col">
          <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-[#0F172A]">
                Recent Counter Invoices
              </h2>
              <p className="text-[11px] text-slate-600">
                Tap any bill to view items, profit &amp; print PDF
              </p>
            </div>
            <Link
              href="/portal/sales"
              prefetch={true}
              className="text-xs font-bold text-[#0F766E] hover:underline inline-flex items-center gap-0.5 shrink-0"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentSales.length === 0 ? (
            <div className="p-10 text-center text-xs sm:text-sm text-slate-600">
              No synced sales invoices found right now.
            </div>
          ) : (
            <div className="divide-y divide-[#E6ECF2]">
              {recentSales.map((inv) => (
                <button
                  key={inv.event_id || inv.id}
                  type="button"
                  onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                  className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-[#F3F5F8] transition-colors group space-y-1.5 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs sm:text-sm font-extrabold text-[#0F172A] group-hover:text-[#0F766E] font-mono">
                        #{inv.invoice_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          inv.payment_method === "credit"
                            ? "bg-amber-50 text-amber-900 border-amber-300"
                            : inv.payment_method === "card"
                            ? "bg-sky-50 text-sky-800 border-sky-300"
                            : "bg-teal-50 text-[#0F766E] border-teal-300"
                        }`}
                      >
                        {inv.payment_method}
                      </span>
                      {inv.discount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-bold">
                          Disc {formatPKR(inv.discount)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-extrabold text-[#0F172A] tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#0F766E]" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span className="truncate">
                      {inv.customer_name} · {inv.cashier} · {formatDateTime(inv.occurred_at, data?.timezone)}
                    </span>
                    {inv.items_count > 0 && (
                      <span className="shrink-0 font-semibold text-slate-500">
                        {inv.items_count} item{inv.items_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top Selling Products & Stock Watchlist */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-2xl border border-[#D8E0EA] overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-[#0F172A]">
                  Top Selling Items ({PERIOD_LABELS[period]})
                </h2>
                <p className="text-[11px] text-slate-600">Ranked by net revenue</p>
              </div>
              <Link
                href={`/portal/sales?period=${period}`}
                prefetch={true}
                className="text-xs font-bold text-[#0F766E] hover:underline shrink-0"
              >
                All Sales →
              </Link>
            </div>
            {topProducts.length === 0 ? (
              <div className="p-8 text-center text-xs sm:text-sm text-slate-600">
                No product sales recorded in {PERIOD_LABELS[period]}.
              </div>
            ) : (
              <div className="divide-y divide-[#E6ECF2]">
                {topProducts.map((p, idx) => {
                  const pct = Math.max(
                    6,
                    Math.round((Number(p.revenue || 0) / maxTopProductRevenue) * 100)
                  );
                  return (
                    <Link
                      key={p.product_id || idx}
                      href={`/portal/sales?period=${period}&q=${encodeURIComponent(p.product_name)}`}
                      prefetch={true}
                      className="block px-4 sm:px-5 py-3 hover:bg-[#F3F5F8] transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-lg bg-[#0F172A] text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-[#0F172A] truncate">
                              {p.product_name}
                            </p>
                            <p className="text-[11px] text-slate-600">Sold: {p.qty} units</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs sm:text-sm font-extrabold text-[#0F172A] tabular-nums">
                            {formatPKR(p.revenue)}
                          </p>
                          {p.gross_profit > 0 && (
                            <p className="text-[10.5px] text-[#0F766E] font-bold tabular-nums">
                              GP {formatPKR(p.gross_profit)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0F766E] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Inventory Watchlist */}
          <div
            id="inventory-alerts"
            className="bg-white rounded-2xl border border-[#D8E0EA] overflow-hidden"
          >
            <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600 shrink-0" />
                <h2 className="text-sm font-extrabold text-[#0F172A]">
                  Stock &amp; Expiry Watch
                </h2>
              </div>
              <Link
                href="/portal/inventory"
                prefetch={true}
                className="text-xs font-bold text-[#0F766E] hover:underline shrink-0"
              >
                Inventory →
              </Link>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Link
                  href="/portal/inventory?filter=low_stock"
                  prefetch={true}
                  className="p-2.5 sm:p-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-amber-900">Low Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-amber-800 mt-0.5 tabular-nums">
                    {livePos.inventory?.low_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=out_of_stock"
                  prefetch={true}
                  className="p-2.5 sm:p-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-rose-900">Out Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-rose-700 mt-0.5 tabular-nums">
                    {livePos.inventory?.out_of_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=expiring_soon"
                  prefetch={true}
                  className="p-2.5 sm:p-3 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-orange-900">Exp ≤60d</p>
                  <p className="text-base sm:text-lg font-extrabold text-orange-700 mt-0.5 tabular-nums">
                    {livePos.inventory?.expiring_soon_count ?? 0}
                  </p>
                </Link>
              </div>

              {invAlerts.expiring_items?.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500">
                    Near-Expiry Batches
                  </p>
                  {invAlerts.expiring_items.slice(0, 4).map((b: any, i: number) => (
                    <div
                      key={`${b.product_id}-${b.batch_no}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-amber-50 border border-amber-200"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#0F172A] truncate">{b.name}</p>
                        <p className="text-[11px] text-slate-600 truncate">
                          Batch {b.batch_no || "N/A"} · Exp: {b.expiry} · Qty: {b.qty}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0 ${
                          b.days_left <= 0
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {b.days_left <= 0 ? "Expired" : `${b.days_left}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {invAlerts.low_stock_items?.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500">
                    Critical Reorder Items
                  </p>
                  {invAlerts.low_stock_items.slice(0, 4).map((item: any, i: number) => (
                    <div
                      key={`${item.product_id}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA]"
                    >
                      <span className="font-bold text-[#0F172A] truncate">{item.name}</span>
                      <span className="text-[11px] font-bold text-rose-700 shrink-0 tabular-nums">
                        {item.current_stock} left (Min {item.reorder_level})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Live Counter & Terminal Status Strip */}
      <div className="bg-white rounded-2xl border border-[#D8E0EA] p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA]">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] flex items-center justify-center shrink-0">
              {isLiveOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">POS Sync</span>
              <p className="text-xs font-extrabold text-[#0F172A] truncate">
                {opStatus.pos_status_label || "Connected"}
              </p>
              <p className="text-[11px] text-slate-600 truncate">
                {formatDateTime(opStatus.last_sync_at, data?.timezone)}
              </p>
            </div>
          </div>

          <Link
            href="/portal/cash?tab=operator-shifts"
            prefetch={true}
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F3F5F8] hover:bg-teal-50/60 border border-[#D8E0EA] hover:border-[#0F766E] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Drawer · {opStatus.current_drawer?.status || "Closed"}
                </span>
                <p className="text-xs font-extrabold text-[#0F172A] truncate tabular-nums">
                  {formatPKR(livePos.expected_drawer_cash || 0)}
                </p>
                <p className="text-[11px] text-slate-600 truncate">
                  {opStatus.current_drawer?.opened_by ? `By ${opStatus.current_drawer.opened_by}` : "Tap to inspect"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#0F766E] shrink-0" />
          </Link>

          <Link
            href="/portal/cash?tab=closings"
            prefetch={true}
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F3F5F8] hover:bg-teal-50/60 border border-[#D8E0EA] hover:border-[#0F766E] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-200 border border-slate-300 text-[#0F172A] flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last Z-Closing</span>
                <p className="text-xs font-extrabold text-[#0F172A] truncate">
                  {opStatus.last_daily_closing?.business_date || "No closing yet"}
                </p>
                <p className="text-[11px] text-slate-600 truncate">
                  {opStatus.last_daily_closing?.closed_by ? `By ${opStatus.last_daily_closing.closed_by}` : "Daily cash log"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#0F766E] shrink-0" />
          </Link>

          <Link
            href="/portal/billing"
            prefetch={true}
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F3F5F8] hover:bg-teal-50/60 border border-[#D8E0EA] hover:border-[#0F766E] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">POS Terminals</span>
                <p className="text-xs font-extrabold text-[#0F172A] truncate">
                  {opStatus.active_terminals || 1} Active Counter{(opStatus.active_terminals || 1) === 1 ? "" : "s"}
                </p>
                <p className="text-[11px] text-slate-600 truncate">
                  {data?.pharmacy?.plan_name || "Standard POS"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#0F766E] shrink-0" />
          </Link>
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
