"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
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

const OWNER_SHORTCUTS = [
  { href: "/portal/sales", label: "Sales & Bills", sub: "Invoices & discounts", icon: Receipt, color: "bg-teal-50 text-teal-700 border-teal-200/70" },
  { href: "/portal/purchases", label: "Purchases & GRNs", sub: "Suppliers & stock-in", icon: ShoppingBag, color: "bg-indigo-50 text-indigo-700 border-indigo-200/70" },
  { href: "/portal/khata", label: "Customer Khata", sub: "Credit & recovery", icon: Users, color: "bg-amber-50 text-amber-700 border-amber-200/70" },
  { href: "/portal/inventory", label: "Inventory", sub: "Stock, low & expiry", icon: PackageSearch, color: "bg-sky-50 text-sky-700 border-sky-200/70" },
  { href: "/portal/cash", label: "Cash & Closing", sub: "Drawer & Z-closings", icon: Wallet, color: "bg-cyan-50 text-cyan-700 border-cyan-200/70" },
  { href: "/portal/returns", label: "Returns", sub: "Sales & GRN returns", icon: RotateCcw, color: "bg-rose-50 text-rose-700 border-rose-200/70" },
  { href: "/portal/reports", label: "Reports", sub: "P&L & analytics", icon: BarChart3, color: "bg-violet-50 text-violet-700 border-violet-200/70" },
  { href: "/portal/alerts", label: "Owner Alerts", sub: "Checks & anomalies", icon: BellRing, color: "bg-orange-50 text-orange-700 border-orange-200/70" },
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
    async (selectedPeriod: Period, silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError("");

      const daysForTrend: 7 | 30 = selectedPeriod === "30d" ? 30 : 7;
      if (!silent) setTrendLoading(true);

      try {
        const [ovRes, trRes] = await Promise.all([
          fetch(`/api/portal/overview?period=${selectedPeriod}`),
          fetch(`/api/portal/dashboard/trends?days=${daysForTrend}`).catch(() => null),
        ]);

        if (ovRes.status === 401) {
          router.replace("/portal/login");
          return;
        }
        if (!ovRes.ok) {
          throw new Error("Failed to load pharmacy overview");
        }

        const json = await ovRes.json();
        setData(json);

        if (trRes && trRes.ok) {
          const trJson = await trRes.json().catch(() => null);
          if (Array.isArray(trJson?.trend)) {
            setTrend(trJson.trend);
          }
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
        setError(err.message || "Unable to load overview data");
      } finally {
        setLoading(false);
        setTrendLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadOverview(period);
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
    <div className="space-y-5">
      {/* Executive Royal Indigo-Teal Curved Hero Banner (Distinct from Emerald Mobile POS) */}
      <section className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#121938] via-[#1B2B5E] to-[#0E435A] text-white shadow-[0_14px_38px_-10px_rgba(18,25,56,0.45)] border border-white/10">
        {/* Subtle decorative ambient orbs */}
        <div className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 w-60 h-60 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative p-4 sm:p-6 space-y-5">
          {/* Top Bar: Pharmacy Identity + Period Switcher + Refresh */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-sm flex items-center justify-center text-teal-300 shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-white truncate">
                    {data?.pharmacy?.name || "Pharmacy Business Pulse"}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                      isLiveOnline
                        ? "bg-teal-400/15 border-teal-300/35 text-teal-200"
                        : "bg-amber-400/15 border-amber-300/35 text-amber-200"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        opStatus.pos_status === "online"
                          ? "bg-teal-300 animate-pulse"
                          : isLiveOnline
                          ? "bg-sky-300"
                          : "bg-amber-300"
                      }`}
                    />
                    <span>
                      {opStatus.pos_status === "online"
                        ? "POS Live"
                        : opStatus.pos_status_label || "Cloud Sync"}
                    </span>
                  </span>
                </div>
                <p className="text-[11.5px] sm:text-xs text-indigo-200/80 mt-0.5 truncate">
                  Executive Owner Overview · Last sync: {formatDateTime(opStatus.last_sync_at, data?.timezone)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex bg-white/10 backdrop-blur-sm p-1 rounded-xl border border-white/15">
                {(["today", "7d", "30d"] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                      period === p
                        ? "bg-teal-400 text-[#0F172B] shadow-xs"
                        : "text-indigo-100 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void loadOverview(period, true)}
                disabled={refreshing || loading}
                className="h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-teal-200 transition-all disabled:opacity-50 inline-flex items-center justify-center shrink-0 active:scale-95"
                title="Refresh overview"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Primary Headline Figure + 3 Crystal-Clear Sub-Tiles */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <Link
              href={`/portal/sales?period=${period}`}
              className="lg:col-span-5 group block rounded-2xl bg-white/[0.07] hover:bg-white/[0.11] border border-white/12 p-4 transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-300">
                  {period === "today" ? "Today's Net Sales" : `${PERIOD_LABELS[period]} Net Sales`}
                </span>
                <ArrowUpRight className="w-4 h-4 text-teal-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
              <p className="text-3xl sm:text-4xl font-black tracking-tight tabular-nums text-white mt-1.5">
                {loading && !data ? "—" : formatPKR(kpis.net_sales ?? 0)}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-indigo-200/85 flex-wrap">
                <span>Billed: {formatPKR(kpis.gross_sales ?? 0)}</span>
                <span className="text-white/25">•</span>
                <span>Discounts: {formatPKR(kpis.discount_total ?? 0)}</span>
              </div>
            </Link>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Link
                href={`/portal/sales?period=${period}`}
                className="rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 p-3.5 transition-all"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/80 block">
                  Bills Made
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-white tabular-nums mt-1">
                  {(kpis.invoice_count ?? 0).toLocaleString("en-PK")}
                </p>
                <p className="text-[10.5px] text-teal-300/90 mt-0.5 truncate">
                  Avg {formatPKR(kpis.average_bill ?? 0)}
                </p>
              </Link>

              <Link
                href={`/portal/reports?period=${period}`}
                className="rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 p-3.5 transition-all"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/80 block">
                  Gross Profit
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-teal-300 tabular-nums mt-1 truncate">
                  {formatPKR(kpis.gross_profit ?? 0)}
                </p>
                <p className="text-[10.5px] text-indigo-200/80 mt-0.5 truncate">
                  {kpis.gross_margin_pct !== null && kpis.gross_margin_pct !== undefined
                    ? `${kpis.gross_margin_pct}% margin`
                    : "COGS verified"}
                </p>
              </Link>

              <Link
                href={`/portal/purchases?period=${period}`}
                className="rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 p-3.5 transition-all"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/80 block">
                  Stock Bought
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-white tabular-nums mt-1 truncate">
                  {formatPKR(kpis.purchases ?? 0)}
                </p>
                <p className="text-[10.5px] text-indigo-200/80 mt-0.5 truncate">
                  {kpis.purchase_count ?? 0} GRN{(kpis.purchase_count ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>

              <Link
                href={`/portal/returns?period=${period}`}
                className="rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 p-3.5 transition-all"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/80 block">
                  Returns
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-rose-300 tabular-nums mt-1 truncate">
                  {formatPKR(kpis.sales_returns ?? 0)}
                </p>
                <p className="text-[10.5px] text-indigo-200/80 mt-0.5 truncate">
                  {kpis.return_count ?? 0} return{(kpis.return_count ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-semibold flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4 Core Live Money & Asset Position Cards (Effortless Owner Clarity) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link
          href="/portal/cash"
          className="bg-white rounded-2xl border border-indigo-950/[0.08] hover:border-teal-400 p-4 shadow-[0_4px_18px_-6px_rgba(19,27,58,0.07)] hover:shadow-md hover:-translate-y-0.5 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Cash in Drawer
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-200/70 text-teal-700 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#131B3A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.expected_drawer_cash ?? 0)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 truncate">
              Cash sales: {formatPKR(kpis.cash_sales ?? 0)}
            </p>
          </div>
        </Link>

        <Link
          href="/portal/khata?status=due"
          className="bg-white rounded-2xl border border-indigo-950/[0.08] hover:border-amber-400 p-4 shadow-[0_4px_18px_-6px_rgba(19,27,58,0.07)] hover:shadow-md hover:-translate-y-0.5 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Customer Khata
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#131B3A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.customer_outstanding_total ?? 0)}
            </p>
            <p className="text-[11px] text-amber-700 font-semibold mt-1 truncate">
              {livePos.customer_outstanding_count ?? 0} credit accounts →
            </p>
          </div>
        </Link>

        <Link
          href="/portal/purchases?tab=suppliers"
          className="bg-white rounded-2xl border border-indigo-950/[0.08] hover:border-indigo-400 p-4 shadow-[0_4px_18px_-6px_rgba(19,27,58,0.07)] hover:shadow-md hover:-translate-y-0.5 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Supplier Payable
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-700 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#131B3A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.supplier_verified_payable_total ?? 0)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 truncate">
              {livePos.supplier_payable_count ?? 0} active suppliers →
            </p>
          </div>
        </Link>

        <Link
          href="/portal/inventory"
          className="bg-white rounded-2xl border border-indigo-950/[0.08] hover:border-sky-400 p-4 shadow-[0_4px_18px_-6px_rgba(19,27,58,0.07)] hover:shadow-md hover:-translate-y-0.5 transition-all group flex flex-col justify-between gap-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Stock Value
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200/70 text-sky-700 flex items-center justify-center group-hover:bg-sky-600 group-hover:text-white transition-colors shrink-0">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-extrabold text-[#131B3A] tabular-nums tracking-tight truncate">
              {formatPKR(livePos.inventory?.stock_value ?? 0)}
            </p>
            <p className="text-[11px] text-amber-700 font-semibold mt-1 truncate">
              {(livePos.inventory?.low_stock_count ?? 0) + (livePos.inventory?.out_of_stock_count ?? 0)} low ·{" "}
              {livePos.inventory?.expiring_soon_count ?? 0} exp
            </p>
          </div>
        </Link>
      </div>

      {/* Interactive Analytics Charts Row (Sales/Profit Trend + Store Health & Payment Mix) */}
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

      {/* One-Tap Quick Navigation Grid (Effortless App-Style Access on Mobile & Desktop) */}
      <div className="bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.07)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
            Quick Sections
          </h2>
          <span className="text-[11px] text-slate-400">Tap to open</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {OWNER_SHORTCUTS.map((sc) => {
            const Icon = sc.icon;
            return (
              <Link
                key={sc.href}
                href={sc.href}
                className="flex items-center gap-3 p-3 rounded-xl bg-[#F7F9FD] hover:bg-indigo-50/70 border border-indigo-950/[0.06] hover:border-indigo-200 transition-all active:scale-[0.98] group"
              >
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${sc.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-[#131B3A] truncate group-hover:text-indigo-800">
                    {sc.label}
                  </p>
                  <p className="text-[10.5px] text-slate-500 truncate">{sc.sub}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Priority Attention & Supervision */}
      <div className="bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.07)] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#F7F9FD] to-white border-b border-indigo-950/[0.06] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-teal-600 shrink-0" />
            <h2 className="text-sm font-extrabold text-[#131B3A] truncate">
              Attention &amp; Supervision
            </h2>
            {actionRequired.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                {actionRequired.length}
              </span>
            )}
          </div>
          <Link
            href="/portal/alerts"
            className="text-xs font-bold text-teal-700 hover:underline shrink-0"
          >
            All Alerts →
          </Link>
        </div>

        {actionRequired.length === 0 ? (
          <div className="p-7 text-center flex flex-col items-center gap-2">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-extrabold text-[#131B3A]">
              Everything Looks Healthy
            </p>
            <p className="text-xs text-slate-500 max-w-md">
              No cash drawer discrepancies, unusual discounts, or critical credit/stock issues for {PERIOD_LABELS[period]}.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {actionRequired.map((item) => {
              const badgeStyle =
                item.severity === "critical"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : item.severity === "warning"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-indigo-50 text-indigo-700 border-indigo-200";
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-[#F7F9FD] transition-colors group"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                        item.severity === "critical"
                          ? "bg-rose-500"
                          : item.severity === "warning"
                          ? "bg-amber-500"
                          : "bg-teal-500"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          {item.category}
                        </span>
                        <p className="text-xs sm:text-sm font-bold text-[#131B3A] group-hover:text-teal-700 transition-colors">
                          {item.title}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pl-5 sm:pl-0">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeStyle}`}>
                      {item.badge}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600" />
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
        <div className="lg:col-span-7 bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.07)] overflow-hidden flex flex-col">
          <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#F7F9FD] to-white border-b border-indigo-950/[0.06] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-[#131B3A]">
                Recent Counter Invoices
              </h2>
              <p className="text-[11px] text-slate-500">
                Tap any bill to view items, profit &amp; print PDF
              </p>
            </div>
            <Link
              href="/portal/sales"
              className="text-xs font-bold text-teal-700 hover:underline inline-flex items-center gap-0.5 shrink-0"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentSales.length === 0 ? (
            <div className="p-10 text-center text-xs sm:text-sm text-slate-500">
              No synced sales invoices found right now.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentSales.map((inv) => (
                <button
                  key={inv.event_id || inv.id}
                  onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                  className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-teal-50/40 active:bg-teal-50 transition-colors group space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs sm:text-sm font-extrabold text-[#131B3A] group-hover:text-teal-700 font-mono">
                        #{inv.invoice_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          inv.payment_method === "credit"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : inv.payment_method === "card"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : "bg-teal-50 text-teal-700 border-teal-200"
                        }`}
                      >
                        {inv.payment_method}
                      </span>
                      {inv.discount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold">
                          Disc {formatPKR(inv.discount)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-extrabold text-[#131B3A] tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-600" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">
                      {inv.customer_name} · {inv.cashier} · {formatDateTime(inv.occurred_at, data?.timezone)}
                    </span>
                    {inv.items_count > 0 && (
                      <span className="shrink-0 font-semibold text-slate-400">
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
          <div className="bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.07)] overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#F7F9FD] to-white border-b border-indigo-950/[0.06] flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-[#131B3A]">
                  Top Selling Items ({PERIOD_LABELS[period]})
                </h2>
                <p className="text-[11px] text-slate-500">Ranked by net revenue</p>
              </div>
              <Link
                href={`/portal/sales?period=${period}`}
                className="text-xs font-bold text-teal-700 hover:underline shrink-0"
              >
                All Sales →
              </Link>
            </div>
            {topProducts.length === 0 ? (
              <div className="p-8 text-center text-xs sm:text-sm text-slate-500">
                No product sales recorded in {PERIOD_LABELS[period]}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {topProducts.map((p, idx) => {
                  const pct = Math.max(
                    6,
                    Math.round((Number(p.revenue || 0) / maxTopProductRevenue) * 100)
                  );
                  return (
                    <Link
                      key={p.product_id || idx}
                      href={`/portal/sales?period=${period}&q=${encodeURIComponent(p.product_name)}`}
                      className="block px-4 sm:px-5 py-3 hover:bg-[#F7F9FD] transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200/70 text-indigo-700 text-[11px] font-extrabold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-[#131B3A] truncate">
                              {p.product_name}
                            </p>
                            <p className="text-[11px] text-slate-500">Sold: {p.qty} units</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs sm:text-sm font-extrabold text-[#131B3A] tabular-nums">
                            {formatPKR(p.revenue)}
                          </p>
                          {p.gross_profit > 0 && (
                            <p className="text-[10.5px] text-teal-700 font-bold tabular-nums">
                              GP {formatPKR(p.gross_profit)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-teal-400 rounded-full"
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
            className="bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.07)] overflow-hidden"
          >
            <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#F7F9FD] to-white border-b border-indigo-950/[0.06] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600 shrink-0" />
                <h2 className="text-sm font-extrabold text-[#131B3A]">
                  Stock &amp; Expiry Watch
                </h2>
              </div>
              <Link
                href="/portal/inventory"
                className="text-xs font-bold text-teal-700 hover:underline shrink-0"
              >
                Inventory →
              </Link>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Link
                  href="/portal/inventory?filter=low_stock"
                  className="p-2.5 sm:p-3 rounded-xl bg-amber-50/70 hover:bg-amber-50 border border-amber-200/70 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-amber-800">Low Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-amber-700 mt-0.5 tabular-nums">
                    {livePos.inventory?.low_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=out_of_stock"
                  className="p-2.5 sm:p-3 rounded-xl bg-rose-50/70 hover:bg-rose-50 border border-rose-200/70 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-rose-800">Out Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-rose-600 mt-0.5 tabular-nums">
                    {livePos.inventory?.out_of_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=expiring_soon"
                  className="p-2.5 sm:p-3 rounded-xl bg-orange-50/70 hover:bg-orange-50 border border-orange-200/70 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-orange-800">Exp ≤60d</p>
                  <p className="text-base sm:text-lg font-extrabold text-orange-600 mt-0.5 tabular-nums">
                    {livePos.inventory?.expiring_soon_count ?? 0}
                  </p>
                </Link>
              </div>

              {invAlerts.expiring_items?.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                    Near-Expiry Batches
                  </p>
                  {invAlerts.expiring_items.slice(0, 4).map((b: any, i: number) => (
                    <div
                      key={`${b.product_id}-${b.batch_no}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-amber-50/60 border border-amber-200/60"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#131B3A] truncate">{b.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          Batch {b.batch_no || "N/A"} · Exp: {b.expiry} · Qty: {b.qty}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0 ${
                          b.days_left <= 0
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-800"
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
                  <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                    Critical Reorder Items
                  </p>
                  {invAlerts.low_stock_items.slice(0, 4).map((item: any, i: number) => (
                    <div
                      key={`${item.product_id}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-[#F7F9FD] border border-indigo-950/[0.06]"
                    >
                      <span className="font-bold text-[#131B3A] truncate">{item.name}</span>
                      <span className="text-[11px] font-bold text-rose-600 shrink-0 tabular-nums">
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
      <div className="bg-white rounded-2xl border border-indigo-950/[0.08] p-4 shadow-[0_4px_18px_-6px_rgba(19,27,58,0.06)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F7F9FD] border border-indigo-950/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200/70 text-teal-700 flex items-center justify-center shrink-0">
              {isLiveOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">POS Sync</span>
              <p className="text-xs font-extrabold text-[#131B3A] truncate">
                {opStatus.pos_status_label || "Connected"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {formatDateTime(opStatus.last_sync_at, data?.timezone)}
              </p>
            </div>
          </div>

          <Link
            href="/portal/cash"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F7F9FD] hover:bg-indigo-50/60 border border-indigo-950/[0.06] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-700 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Drawer · {opStatus.current_drawer?.status || "Closed"}
                </span>
                <p className="text-xs font-extrabold text-[#131B3A] truncate tabular-nums">
                  {formatPKR(livePos.expected_drawer_cash || 0)}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {opStatus.current_drawer?.opened_by ? `By ${opStatus.current_drawer.opened_by}` : "Tap to inspect"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600 shrink-0" />
          </Link>

          <Link
            href="/portal/cash?tab=closings"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F7F9FD] hover:bg-indigo-50/60 border border-indigo-950/[0.06] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200/70 text-violet-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last Z-Closing</span>
                <p className="text-xs font-extrabold text-[#131B3A] truncate">
                  {opStatus.last_daily_closing?.business_date || "No closing yet"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {opStatus.last_daily_closing?.closed_by ? `By ${opStatus.last_daily_closing.closed_by}` : "Daily cash log"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600 shrink-0" />
          </Link>

          <Link
            href="/portal/billing"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F7F9FD] hover:bg-indigo-50/60 border border-indigo-950/[0.06] transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200/70 text-sky-700 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">POS Terminals</span>
                <p className="text-xs font-extrabold text-[#131B3A] truncate">
                  {opStatus.active_terminals || 1} Active Counter{(opStatus.active_terminals || 1) === 1 ? "" : "s"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {data?.pharmacy?.plan_name || "Standard POS"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600 shrink-0" />
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
