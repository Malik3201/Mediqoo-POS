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
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowUpRight,
  ShieldAlert,
  Wifi,
  WifiOff,
  Terminal,
  PackageSearch,
  BarChart3,
  BellRing,
  CloudUpload,
  LayoutDashboard,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import { PortalPageHeader } from "@/components/portal/PortalUI";

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

const QUICK_MODULES = [
  { href: "/portal/inventory", label: "Inventory", icon: PackageSearch },
  { href: "/portal/cash", label: "Cash & Closing", icon: Wallet },
  { href: "/portal/khata", label: "Customer Khata", icon: Users },
  { href: "/portal/reports", label: "Reports", icon: BarChart3 },
  { href: "/portal/alerts", label: "Owner Alerts", icon: BellRing },
  { href: "/portal/returns", label: "Returns", icon: RotateCcw },
  { href: "/portal/backups", label: "Backups", icon: CloudUpload },
];

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
        if (json?.pharmacy?.name && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("aivrasol:pharmacy-meta", {
              detail: { name: String(json.pharmacy.name) },
            })
          );
        }
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

  const maxTopProductRevenue = Math.max(
    1,
    ...topProducts.map((tp: any) => Number(tp.revenue || 0))
  );

  return (
    <div className="space-y-5">
      {/* Executive Header & Period Selector */}
      <PortalPageHeader
        icon={<LayoutDashboard className="w-5 h-5" />}
        title="Pharmacy Business Pulse"
        subtitle="Real-time sales, profit, drawer cash & store supervision — tap any card to drill down"
        badge={
          opStatus.pos_status ? (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${statusTone}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  opStatus.pos_status === "online"
                    ? "bg-emerald-500 animate-pulse"
                    : opStatus.pos_status === "recent"
                    ? "bg-blue-500"
                    : opStatus.pos_status === "stale"
                    ? "bg-amber-500"
                    : "bg-slate-400"
                }`}
              />
              <span>{opStatus.pos_status === "online" ? "POS Live" : opStatus.pos_status_label || "POS Sync"}</span>
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex bg-white p-1 rounded-lg border border-slate-300 shadow-2xs">
              {(["today", "7d", "30d"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 sm:px-3.5 sm:py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                    period === p
                      ? "bg-[#0F172B] text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
                </button>
              ))}
            </div>
            <button
              onClick={() => void loadOverview(period, true)}
              disabled={refreshing || loading}
              className="h-9 w-9 sm:w-auto sm:px-3.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50 shadow-2xs inline-flex items-center justify-center gap-1.5 text-xs font-bold"
              title="Refresh overview"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-emerald-600" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {/* Mobile & Tablet One-Tap Quick Navigation Strip */}
      <div className="lg:hidden -mx-3.5 px-3.5 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 pb-1">
          {QUICK_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link
                key={mod.href}
                href={mod.href}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-300/90 text-xs font-bold text-[#0F172B] hover:border-slate-400 shrink-0 shadow-2xs active:scale-95 transition-all"
              >
                <Icon className="w-3.5 h-3.5 text-emerald-600" />
                <span>{mod.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm font-medium flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary 4 KPI Cards — Executive Ledger Cards */}
      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, idx) => (
            <div
              key={idx}
              className="h-32 rounded-xl bg-white border border-slate-300/90 p-4 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* 1. Net Sales */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-xl border border-slate-300/90 border-t-[3px] border-t-[#059669] hover:border-emerald-600/80 p-3.5 sm:p-4.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-md transition-all group flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 leading-tight">
                  {period === "today" ? "Today's Net Sales" : `${PERIOD_LABELS[period]} Sales`}
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200/80 text-[#059669] flex items-center justify-center group-hover:bg-[#059669] group-hover:text-white transition-colors shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-extrabold text-[#0F172B] tabular-nums tracking-tight truncate">
                  {formatPKR(kpis.net_sales ?? 0)}
                </p>
                <div className="flex items-center justify-between gap-1 mt-1 text-[10.5px] sm:text-xs text-slate-500">
                  <span className="truncate">Gross: {formatPKR(kpis.gross_sales ?? 0)}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                </div>
              </div>
            </Link>

            {/* 2. Total Invoices & Avg Bill */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-xl border border-slate-300/90 border-t-[3px] border-t-slate-700 hover:border-slate-500 p-3.5 sm:p-4.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-md transition-all group flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 leading-tight">
                  Finalized Bills
                </span>
                <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center group-hover:bg-[#0F172B] group-hover:text-white transition-colors shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-extrabold text-[#0F172B] tabular-nums tracking-tight">
                  {(kpis.invoice_count ?? 0).toLocaleString("en-PK")}
                </p>
                <div className="flex items-center justify-between gap-1 mt-1 text-[10.5px] sm:text-xs text-slate-500">
                  <span className="truncate">Avg: {formatPKR(kpis.average_bill ?? 0)}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                </div>
              </div>
            </Link>

            {/* 3. Expected Cash in Drawer */}
            <Link
              href="/portal/cash"
              className="bg-white rounded-xl border border-slate-300/90 border-t-[3px] border-t-sky-600 hover:border-sky-500 p-3.5 sm:p-4.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-md transition-all group flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 leading-tight">
                  Drawer Cash
                </span>
                <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center group-hover:bg-sky-700 group-hover:text-white transition-colors shrink-0">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-extrabold text-[#0F172B] tabular-nums tracking-tight truncate">
                  {formatPKR(livePos.expected_drawer_cash ?? 0)}
                </p>
                <div className="flex items-center justify-between gap-1 mt-1 text-[10.5px] sm:text-xs text-slate-500">
                  <span className="truncate">Cash Sales: {formatPKR(kpis.cash_sales ?? 0)}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                </div>
              </div>
            </Link>

            {/* 4. Customer Outstanding (Khata) */}
            <Link
              href="/portal/khata?status=due"
              className="bg-white rounded-xl border border-slate-300/90 border-t-[3px] border-t-amber-500 hover:border-amber-500 p-3.5 sm:p-4.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-md transition-all group flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 leading-tight">
                  Khata Due
                </span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors shrink-0">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-extrabold text-[#0F172B] tabular-nums tracking-tight truncate">
                  {formatPKR(livePos.customer_outstanding_total ?? 0)}
                </p>
                <div className="flex items-center justify-between gap-1 mt-1 text-[10.5px] sm:text-xs text-slate-500">
                  <span className="truncate">
                    {livePos.customer_outstanding_count ?? 0} accounts
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                </div>
              </div>
            </Link>
          </div>

          {/* Mobile Progressive Disclosure Toggle */}
          <div className="md:hidden">
            <button
              onClick={() => setShowAllKpisMobile((v) => !v)}
              className="w-full py-2.5 px-4 rounded-xl bg-white border border-slate-300/90 text-xs font-bold text-[#0F172B] flex items-center justify-center gap-1.5 shadow-2xs active:scale-[0.99] transition-transform"
            >
              {showAllKpisMobile ? (
                <>
                  <span>Hide Profit, Purchases, Suppliers &amp; Stock</span>
                  <ChevronUp className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Show Profit, Purchases, Suppliers &amp; Stock</span>
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Secondary 6 KPIs */}
          <div
            className={`${
              showAllKpisMobile ? "grid" : "hidden md:grid"
            } grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3`}
          >
            {/* 5. Gross Profit */}
            <Link
              href={`/portal/sales?period=${period}`}
              className="bg-white rounded-xl border border-slate-300/90 hover:border-emerald-600 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">Gross Profit</span>
              {kpis.has_reliable_costs ? (
                <>
                  <p className="text-base font-extrabold text-[#047857] mt-1 tabular-nums truncate">
                    {formatPKR(kpis.gross_profit ?? 0)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {kpis.gross_margin_pct !== null
                      ? `${kpis.gross_margin_pct}% margin`
                      : "COGS verified"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-bold text-slate-700 mt-1.5">Cost Review Needed</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Missing item costs</p>
                </>
              )}
            </Link>

            {/* 6. Credit Sales */}
            <Link
              href={`/portal/sales?period=${period}&payment=credit`}
              className="bg-white rounded-xl border border-slate-300/90 hover:border-slate-400 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block truncate">
                Credit Sales
              </span>
              <p className="text-base font-extrabold text-[#0F172B] mt-1 tabular-nums truncate">
                {formatPKR(kpis.credit_sales ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{PERIOD_LABELS[period]} →</p>
            </Link>

            {/* 7. Supplier Verified Payable */}
            <Link
              href="/portal/purchases?tab=suppliers"
              className="bg-white rounded-xl border border-slate-300/90 hover:border-slate-400 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block truncate">
                Supplier Payable
              </span>
              <p className="text-base font-extrabold text-[#0F172B] mt-1 tabular-nums truncate">
                {formatPKR(livePos.supplier_verified_payable_total ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {livePos.unverified_historical_suppliers_count > 0
                  ? `${livePos.unverified_historical_suppliers_count} legacy excluded`
                  : `${livePos.supplier_payable_count ?? 0} suppliers`}
              </p>
            </Link>

            {/* 8. Returns & Refunds */}
            <Link
              href={`/portal/returns?period=${period}`}
              className="bg-white rounded-xl border border-slate-300/90 hover:border-rose-400 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">Sales Returns</span>
              <p className="text-base font-extrabold text-rose-700 mt-1 tabular-nums truncate">
                {formatPKR(kpis.sales_returns ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {kpis.return_count ?? 0} return{(kpis.return_count ?? 0) === 1 ? "" : "s"} →
              </p>
            </Link>

            {/* 9. Purchases */}
            <Link
              href={`/portal/purchases?period=${period}`}
              className="bg-white rounded-xl border border-slate-300/90 hover:border-slate-400 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">Stock Purchased</span>
              <p className="text-base font-extrabold text-[#0F172B] mt-1 tabular-nums truncate">
                {formatPKR(kpis.purchases ?? 0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {kpis.purchase_count ?? 0} GRN{(kpis.purchase_count ?? 0) === 1 ? "" : "s"} →
              </p>
            </Link>

            {/* 10. Inventory Value */}
            <Link
              href="/portal/inventory"
              className="bg-white rounded-xl border border-slate-300/90 hover:border-slate-400 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">Stock Value</span>
              <p className="text-base font-extrabold text-[#0F172B] mt-1 tabular-nums truncate">
                {formatPKR(livePos.inventory?.stock_value ?? 0)}
              </p>
              <p className="text-[11px] text-amber-700 font-semibold mt-0.5 truncate">
                {(livePos.inventory?.low_stock_count ?? 0) +
                  (livePos.inventory?.out_of_stock_count ?? 0)}{" "}
                low · {livePos.inventory?.expiring_soon_count ?? 0} exp
              </p>
            </Link>
          </div>
        </div>
      )}

      {/* Owner Daily Brief — Executive Control Panel */}
      {data?.daily_brief && (
        <div className="bg-[#0F172B] text-white rounded-xl p-4 sm:p-5 shadow-sm border border-slate-800 border-t-[3px] border-t-emerald-500 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-800">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[10.5px] font-extrabold uppercase tracking-wider text-emerald-400">
                Executive Daily Brief
              </span>
              <span className="text-xs sm:text-sm font-bold text-white">
                Today: <span className="text-emerald-400">{formatPKR(data.daily_brief.net_sales_today || 0)}</span> across{" "}
                {data.daily_brief.invoices_today || 0} bill(s)
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/portal/alerts"
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 transition-colors"
              >
                Alerts →
              </Link>
              <Link
                href="/portal/inventory"
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
              >
                Inventory →
              </Link>
              <Link
                href="/portal/reports"
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
              >
                Reports →
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <Link
              href="/portal/cash"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Cash Status
              </span>
              <span className="font-bold text-white text-xs sm:text-sm mt-1 block truncate">
                {data.daily_brief.verified_cash_status}
              </span>
            </Link>
            <Link
              href="/portal/sales?supervision=high_discount"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Discounts Today
              </span>
              <span className="font-bold text-amber-300 text-xs sm:text-sm mt-1 block tabular-nums truncate">
                {formatPKR(data.daily_brief.major_discounts_today || 0)}
              </span>
            </Link>
            <Link
              href="/portal/khata"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Khata Collected
              </span>
              <span className="font-bold text-emerald-400 text-xs sm:text-sm mt-1 block tabular-nums truncate">
                {formatPKR(data.daily_brief.credit_collections_today || 0)}
              </span>
            </Link>
            <Link
              href="/portal/inventory?filter=low_stock"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Low / Out Stock
              </span>
              <span className="font-bold text-white text-xs sm:text-sm mt-1 block">
                {data.daily_brief.low_stock_issues || 0} item(s)
              </span>
            </Link>
            <Link
              href="/portal/inventory?filter=expiring_soon"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Expiry Watch
              </span>
              <span className="font-bold text-amber-300 text-xs sm:text-sm mt-1 block">
                {data.daily_brief.expiry_concerns || 0} batch(es)
              </span>
            </Link>
            <Link
              href="/portal/purchases"
              className="rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 p-3 transition-colors"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Cost Jumps
              </span>
              <span className="font-bold text-rose-300 text-xs sm:text-sm mt-1 block">
                {data.daily_brief.supplier_price_increases_count || 0} item(s)
              </span>
            </Link>
          </div>

          {Array.isArray(data.daily_brief.top_three_actions) &&
            data.daily_brief.top_three_actions.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="text-[10.5px] font-extrabold uppercase tracking-wider text-emerald-400">
                  Priority Actions Right Now
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {data.daily_brief.top_three_actions.map((act: any, i: number) => (
                    <Link
                      key={act.id}
                      href={act.href}
                      className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg bg-slate-800/75 hover:bg-slate-800 border border-slate-700/80 text-xs transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-extrabold text-emerald-400">
                            #{i + 1}
                          </span>
                          <span className="font-bold text-white truncate">{act.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 truncate mt-0.5">
                          {act.description}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}

      {/* Live Counter & Terminal Telemetry Strip */}
      <div className="bg-white rounded-xl border border-slate-300/90 p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* POS Sync & Freshness */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/90 border border-slate-200/60">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${statusTone}`}
            >
              {opStatus.pos_status === "online" || opStatus.pos_status === "recent" ? (
                <Wifi className="w-4 h-4" />
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  POS Sync
                </span>
              </div>
              <p className="text-xs font-extrabold text-slate-900 truncate mt-0.5">
                {opStatus.pos_status_label || "Checking sync status…"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                Updated: {formatDateTime(opStatus.last_sync_at, data?.timezone)}
              </p>
            </div>
          </div>

          {/* Current Cash Drawer */}
          <Link
            href="/portal/cash"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/90 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-[#009A4D] flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                    Drawer
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-extrabold uppercase ${
                      opStatus.current_drawer?.status === "open"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {opStatus.current_drawer?.status || "Closed"}
                  </span>
                </div>
                <p className="text-xs font-extrabold text-slate-900 truncate mt-0.5 tabular-nums">
                  {formatPKR(livePos.expected_drawer_cash || 0)}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {opStatus.current_drawer?.opened_by
                    ? `Operator: ${opStatus.current_drawer.opened_by}`
                    : "Tap to check cash"}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#009A4D] shrink-0" />
          </Link>

          {/* Last Z-Closing */}
          <Link
            href="/portal/cash?tab=closings"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/90 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 block">
                  Last Z-Closing
                </span>
                <p className="text-xs font-extrabold text-slate-900 truncate mt-0.5">
                  {opStatus.last_daily_closing?.business_date
                    ? `Closed: ${opStatus.last_daily_closing.business_date}`
                    : "No closing locked yet"}
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

          {/* POS Terminals & Plan */}
          <Link
            href="/portal/billing"
            className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/90 hover:bg-emerald-50/50 border border-slate-200/60 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 block">
                  POS Terminals
                </span>
                <p className="text-xs font-extrabold text-slate-900 truncate mt-0.5">
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

      {/* Action-Required Supervision Triage */}
      <div className="bg-white rounded-xl border border-slate-300/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-[#F8FAFC] border-b border-slate-200/90 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0" />
            <h2 className="text-sm font-extrabold text-[#0F172B] truncate">
              Action Required &amp; Supervision
            </h2>
            {actionRequired.length > 0 && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                {actionRequired.length}
              </span>
            )}
          </div>
          <Link
            href="/portal/alerts"
            className="text-xs font-bold text-[#047857] hover:underline shrink-0"
          >
            All Alerts →
          </Link>
        </div>

        {actionRequired.length === 0 ? (
          <div className="p-7 text-center flex flex-col items-center gap-2">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#009A4D]">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-800">
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
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/90 transition-colors group"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                        item.severity === "critical"
                          ? "bg-red-500"
                          : item.severity === "warning"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
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
                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pl-5 sm:pl-0">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeStyle}`}
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

      {/* Recent Counter Invoices & Top Selling Products */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recent Invoices */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-300/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
          <div className="px-4 sm:px-5 py-3 bg-[#F8FAFC] border-b border-slate-200/90 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-[#0F172B]">
                Recent Counter Invoices
              </h2>
              <p className="text-[11px] text-slate-500">
                Tap any bill to inspect medicines &amp; profit or print PDF
              </p>
            </div>
            <Link
              href="/portal/sales"
              className="text-xs font-bold text-[#047857] hover:underline inline-flex items-center gap-0.5 shrink-0"
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
                  className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-emerald-50/40 active:bg-emerald-50 transition-colors group space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs sm:text-sm font-extrabold text-slate-900 group-hover:text-[#009A4D] font-mono">
                        #{inv.invoice_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          inv.payment_method === "credit"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : inv.payment_method === "card"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {inv.payment_method}
                      </span>
                      {inv.discount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">
                          Disc {formatPKR(inv.discount)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">
                      {inv.customer_name} · {inv.cashier} ·{" "}
                      {formatDateTime(inv.occurred_at, data?.timezone)}
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

        {/* Top Products & Stock Watchlist */}
        <div className="lg:col-span-5 space-y-5">
          {/* Top Selling Medicines */}
          <div className="bg-white rounded-xl border border-slate-300/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="px-4 sm:px-5 py-3 bg-[#F8FAFC] border-b border-slate-200/90 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-[#0F172B]">
                  Top Products ({PERIOD_LABELS[period]})
                </h2>
                <p className="text-[11px] text-slate-500">Ranked by net revenue</p>
              </div>
              <Link
                href={`/portal/sales?period=${period}`}
                className="text-xs font-bold text-[#047857] hover:underline shrink-0"
              >
                Explore Sales →
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
                      className="block px-4 sm:px-5 py-3 hover:bg-slate-50 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-[#009A4D] text-[11px] font-extrabold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                              {p.product_name}
                            </p>
                            <p className="text-[11px] text-slate-500">Qty sold: {p.qty}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs sm:text-sm font-extrabold text-slate-900 tabular-nums">
                            {formatPKR(p.revenue)}
                          </p>
                          {p.gross_profit > 0 && (
                            <p className="text-[10.5px] text-[#009A4D] font-bold tabular-nums">
                              GP: {formatPKR(p.gross_profit)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/75 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Inventory Expiry & Low Stock Watchlist */}
          <div
            id="inventory-alerts"
            className="bg-white rounded-xl border border-slate-300/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden"
          >
            <div className="px-4 sm:px-5 py-3 bg-[#F8FAFC] border-b border-slate-200/90 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600 shrink-0" />
                <h2 className="text-sm font-extrabold text-[#0F172B]">
                  Stock &amp; Expiry Watchlist
                </h2>
              </div>
              <Link
                href="/portal/inventory"
                className="text-xs font-bold text-[#047857] hover:underline shrink-0"
              >
                Inventory →
              </Link>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Link
                  href="/portal/inventory?filter=low_stock"
                  className="p-2.5 sm:p-3 rounded-xl bg-amber-50/50 hover:bg-amber-50 border border-amber-200/70 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-amber-800">Low Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-amber-700 mt-0.5 tabular-nums">
                    {livePos.inventory?.low_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=out_of_stock"
                  className="p-2.5 sm:p-3 rounded-xl bg-red-50/50 hover:bg-red-50 border border-red-200/70 transition-colors"
                >
                  <p className="text-[10px] font-bold uppercase text-red-800">Out Stock</p>
                  <p className="text-base sm:text-lg font-extrabold text-red-600 mt-0.5 tabular-nums">
                    {livePos.inventory?.out_of_stock_count ?? 0}
                  </p>
                </Link>
                <Link
                  href="/portal/inventory?filter=expiring_soon"
                  className="p-2.5 sm:p-3 rounded-xl bg-orange-50/50 hover:bg-orange-50 border border-orange-200/70 transition-colors"
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
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-amber-50/50 border border-amber-200/60"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate">{b.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          Batch {b.batch_no || "N/A"} · Exp: {b.expiry} · Qty: {b.qty}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold shrink-0 ${
                          b.days_left <= 0
                            ? "bg-red-100 text-red-700"
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
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-xl bg-slate-50 border border-slate-200/70"
                    >
                      <span className="font-bold text-slate-800 truncate">{item.name}</span>
                      <span className="text-[11px] font-bold text-red-600 shrink-0 tabular-nums">
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

      {/* Clickable Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}
