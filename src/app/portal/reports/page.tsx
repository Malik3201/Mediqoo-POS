"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FileSpreadsheet,
  Printer,
  RefreshCw,
  BookmarkCheck,
  TrendingUp,
  ShoppingBag,
  Users,
  Boxes,
  Landmark,
  Search,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  Download,
  BarChart3,
  X,
} from "lucide-react";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalStatusBadge,
} from "@/components/portal/PortalUI";

type ReportCategory = "sales" | "purchases" | "customers" | "inventory" | "financial";
type ReportPeriod = "today" | "7d" | "30d" | "90d";

function formatPKR(n: number | null | undefined): string {
  return `Rs ${Math.round(Number(n || 0)).toLocaleString("en-PK")}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-PK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ReportsCenterContent() {
  const searchParams = useSearchParams();
  const initialCat = (searchParams.get("category") as ReportCategory) || "sales";
  const initialPeriod = (searchParams.get("period") as ReportPeriod) || "30d";

  const [category, setCategory] = useState<ReportCategory>(
    ["sales", "purchases", "customers", "inventory", "financial"].includes(initialCat)
      ? initialCat
      : "sales"
  );
  const [period, setPeriod] = useState<ReportPeriod>(
    ["today", "7d", "30d", "90d"].includes(initialPeriod) ? initialPeriod : "30d"
  );
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSavedMsg, setPrefsSavedMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [prefsApplied, setPrefsApplied] = useState(false);

  const fetchReport = useCallback(
    async (cat: ReportCategory, per: ReportPeriod) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/portal/reports?category=${encodeURIComponent(cat)}&period=${encodeURIComponent(per)}`
        );
        if (res.ok) {
          const json = await res.json();
          setData(json);
          if (
            !prefsApplied &&
            !searchParams.get("category") &&
            !searchParams.get("period") &&
            json.saved_prefs?.default_category
          ) {
            setPrefsApplied(true);
            const savedCat = json.saved_prefs.default_category as ReportCategory;
            const savedPer = (json.saved_prefs.default_period as ReportPeriod) || per;
            if (savedCat !== cat || savedPer !== per) {
              setCategory(savedCat);
              setPeriod(savedPer);
            }
          } else {
            setPrefsApplied(true);
          }
        }
      } catch (err) {
        console.error("Failed to load report:", err);
      } finally {
        setLoading(false);
      }
    },
    [prefsApplied, searchParams]
  );

  useEffect(() => {
    void fetchReport(category, period);
  }, [category, period, fetchReport]);

  const handleSaveDefaultPrefs = async () => {
    setSavingPrefs(true);
    setPrefsSavedMsg(null);
    try {
      const res = await fetch("/api/portal/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_category: category,
          default_period: period,
        }),
      });
      if (res.ok) {
        setPrefsSavedMsg("Default report view saved");
        setTimeout(() => setPrefsSavedMsg(null), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (category === "sales") {
      const products = data.sales_report?.top_products || [];
      downloadCsv(
        `aivrasol-sales-report-${period}-${dateStamp}.csv`,
        [
          "Product Code",
          "Product Name",
          "Category",
          "Qty Sold",
          "Gross Revenue (PKR)",
          "Discount (PKR)",
          "Net Revenue (PKR)",
          "Verified COGS (PKR)",
          "Gross Profit (PKR)",
        ],
        products.map((p: any) => [
          p.code || p.product_id,
          p.name,
          p.category || "General",
          p.qty_sold,
          Math.round(p.gross_revenue || 0),
          Math.round(p.discount || 0),
          Math.round(p.net_revenue || 0),
          Math.round(p.cogs || 0),
          Math.round(p.gross_profit || 0),
        ])
      );
    } else if (category === "purchases") {
      const suppliers = data.purchase_report?.suppliers_directory || [];
      downloadCsv(
        `aivrasol-supplier-purchases-${period}-${dateStamp}.csv`,
        [
          "Supplier Name",
          "Phone",
          "Verified Payable (PKR)",
          "Total Purchases (PKR)",
          "GRN Count",
          "Historical Unverified Purchases (PKR)",
          "Balance Status",
        ],
        suppliers.map((s: any) => [
          s.name,
          s.phone || "",
          Math.round(s.verified_payable || 0),
          Math.round(s.total_purchases_amount || 0),
          s.total_purchases_count || 0,
          Math.round(s.unverified_historical_amount || 0),
          s.legacy_balance_status || "verified",
        ])
      );
    } else if (category === "customers") {
      const custs = data.customer_report?.top_credit_customers || [];
      downloadCsv(
        `aivrasol-customer-khata-aging-${dateStamp}.csv`,
        [
          "Customer Name",
          "Phone",
          "Verified Credit Balance (PKR)",
          "Aging Bucket",
          "Days Since Last Purchase",
          "Follow-up Status",
          "Owner Note",
        ],
        custs.map((c: any) => [
          c.name,
          c.phone || "",
          Math.round(c.credit_balance || 0),
          c.aging_bucket,
          c.days_since_purchase || 0,
          c.follow_up_status || "none",
          c.owner_note || "",
        ])
      );
    } else if (category === "inventory") {
      const low = data.inventory_report?.low_stock_items || [];
      const exp = data.inventory_report?.expiring_items || [];
      downloadCsv(
        `aivrasol-inventory-risk-${dateStamp}.csv`,
        ["Risk Type", "Product Name", "Batch", "Current Stock / Qty", "Reorder / Expiry", "Value (PKR)"],
        [
          ...low.map((i: any) => [
            "Low Stock",
            i.name,
            "—",
            i.current_stock ?? 0,
            `Reorder: ${i.reorder_level ?? 0}`,
            Math.round((i.current_stock || 0) * (i.cost || 0)),
          ]),
          ...exp.map((e: any) => [
            "Expiring Soon",
            e.name,
            e.batch_no || "—",
            e.qty ?? 0,
            `Exp: ${e.expiry || "—"} (${e.days_left ?? 0}d)`,
            Math.round(e.value || 0),
          ]),
        ]
      );
    } else if (category === "financial") {
      const fin = data.financial_report?.summary || {};
      downloadCsv(
        `aivrasol-financial-summary-${period}-${dateStamp}.csv`,
        ["Line Item", "Amount (PKR)"],
        [
          ["Gross Revenue", Math.round(fin.gross_revenue || 0)],
          ["Sales Returns", Math.round(fin.sales_returns || 0)],
          ["Discounts Given", Math.round(fin.discounts_given || 0)],
          ["Net Sales (Returns-Adjusted)", Math.round(fin.net_sales || 0)],
          ["Verified COGS (WAC)", Math.round(fin.verified_cogs || 0)],
          ["Gross Profit", Math.round(fin.gross_profit || 0)],
          ["Verified Cloud Expenses", Math.round(fin.verified_expenses || 0)],
          [
            "Operating Surplus (After Verified Expenses)",
            Math.round(fin.operating_surplus_after_verified_expenses || 0),
          ],
          ["Verified Customer Receivables (Khata)", Math.round(fin.customer_receivables || 0)],
          ["Verified Supplier Payables", Math.round(fin.verified_supplier_payables || 0)],
          [
            "Unverified Historical Purchases (Excluded from Payable)",
            Math.round(fin.unverified_historical_purchases || 0),
          ],
          ["Current Inventory Valuation", Math.round(fin.inventory_valuation || 0)],
        ]
      );
    }
  };

  const qLower = searchQuery.trim().toLowerCase();

  const salesSummary = data?.sales_report?.summary || {};
  const paymentMethods = data?.sales_report?.payment_methods || {};
  const dailySeries: any[] = data?.sales_report?.daily_series || [];
  const topProducts = useMemo(() => {
    const list: any[] = data?.sales_report?.top_products || [];
    if (!qLower) return list;
    return list.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(qLower) ||
        (p.code || "").toLowerCase().includes(qLower) ||
        (p.category || "").toLowerCase().includes(qLower)
    );
  }, [data, qLower]);

  const maxDailyNetSales = useMemo(() => {
    if (dailySeries.length === 0) return 1;
    return Math.max(1, ...dailySeries.map((d) => Number(d.net_sales || 0)));
  }, [dailySeries]);

  return (
    <div className="space-y-4 sm:space-y-5 print:space-y-4 animate-portal-in">
      {/* Header & Actions */}
      <PortalPageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        title="Advanced Report Center"
        subtitle="Reconciled Sales, Purchase, Khata Aging, Inventory Risk & P&L Statements with direct record drill-down."
        badge={
          <PortalStatusBadge tone="emerald">
            {data?.pharmacy_name || "AivraSol Pharmacy"}
          </PortalStatusBadge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {prefsSavedMsg && (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-xl">
                {prefsSavedMsg}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSaveDefaultPrefs()}
              disabled={savingPrefs}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-2 rounded-xl bg-white border border-slate-200/90 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
              title="Save current category and date period as your default report view"
            >
              <BookmarkCheck className="w-3.5 h-3.5 text-[#009A4D]" />
              <span className="hidden sm:inline">
                {savingPrefs ? "Saving…" : "Save Default View"}
              </span>
              <span className="sm:hidden">{savingPrefs ? "…" : "Save Default"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!data || loading}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-2 rounded-xl bg-white border border-slate-200/90 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-[#009A4D]" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Print / PDF</span>
              <span className="sm:hidden">Print</span>
            </button>

            <PortalRefreshButton
              loading={loading}
              onClick={() => void fetchReport(category, period)}
            />
          </div>
        }
      />

      {/* Category Tabs & Period Selector */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0">
          {[
            { id: "sales", label: "Sales & Margin", icon: TrendingUp },
            { id: "purchases", label: "Purchases & Suppliers", icon: ShoppingBag },
            { id: "customers", label: "Customer Khata & Aging", icon: Users },
            { id: "inventory", label: "Inventory & Expiry", icon: Boxes },
            { id: "financial", label: "Financial & P&L", icon: Landmark },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id as ReportCategory)}
                className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {(
            [
              { id: "today", label: "Today" },
              { id: "7d", label: "7 Days" },
              { id: "30d", label: "30 Days" },
              { id: "90d", label: "90 Days" },
            ] as { id: ReportPeriod; label: string }[]
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                period === p.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Search Bar */}
      {(category === "sales" || category === "purchases" || category === "customers") && (
        <div className="relative print:hidden">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              category === "sales"
                ? "Filter products, categories or cashiers in this report…"
                : category === "purchases"
                ? "Filter suppliers, GRNs or purchased medicines…"
                : "Filter credit customers by name or phone…"
            }
            className="w-full min-h-[42px] pl-10 pr-9 py-2.5 bg-white rounded-xl border border-slate-200/90 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-500">
          Compiling reconciled pharmacy report…
        </div>
      ) : (
        <>
          {/* ================================================================= */}
          {/* 1. SALES & MARGIN REPORT                                          */}
          {/* ================================================================= */}
          {category === "sales" && (
            <div className="space-y-5">
              {/* KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-slate-200/90">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Gross Sales ({salesSummary.invoices_count || 0} bills)
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                    {formatPKR(salesSummary.gross_revenue)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200/90">
                  <span className="text-[10px] font-bold uppercase text-amber-600">
                    Discounts Given
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-amber-700 mt-1 tabular-nums">
                    {formatPKR(salesSummary.discounts_given)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200/90">
                  <span className="text-[10px] font-bold uppercase text-red-600">
                    Sales Returns ({salesSummary.returns_count || 0})
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-red-600 mt-1 tabular-nums">
                    {formatPKR(salesSummary.returns_total)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-emerald-200 bg-emerald-50/30">
                  <span className="text-[10px] font-bold uppercase text-[#009A4D]">
                    Net Sales (Reconciled)
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-[#009A4D] mt-1 tabular-nums">
                    {formatPKR(salesSummary.net_sales)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200/90">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Verified COGS (WAC)
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                    {formatPKR(salesSummary.cogs)}
                  </p>
                </div>

                <div className="bg-slate-900 text-white p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-300">
                    Gross Profit ({salesSummary.gross_margin_pct || 0}%)
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-emerald-400 mt-1 tabular-nums">
                    {formatPKR(salesSummary.gross_profit)}
                  </p>
                </div>
              </div>

              {/* Payment Method Split & Daily Trend */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Payment Methods */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      Tender / Payment Method Split
                    </h2>
                    <Link
                      href="/portal/sales"
                      className="text-xs font-semibold text-[#009A4D] hover:underline inline-flex items-center gap-0.5"
                    >
                      <span>Open Invoices</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    {[
                      {
                        key: "cash",
                        label: "Cash Counter Sales",
                        data: paymentMethods.cash,
                        href: "/portal/sales?payment=cash",
                      },
                      {
                        key: "card",
                        label: "Card / POS Machine",
                        data: paymentMethods.card,
                        href: "/portal/sales?payment=card",
                      },
                      {
                        key: "wallet",
                        label: "Online / Bank / Wallet",
                        data: paymentMethods.wallet,
                        href: "/portal/sales?payment=wallet",
                      },
                      {
                        key: "credit",
                        label: "Customer Credit (Khata)",
                        data: paymentMethods.credit,
                        href: "/portal/sales?payment=credit",
                      },
                    ].map((pm) => (
                      <Link
                        key={pm.key}
                        href={pm.href}
                        className="p-3 rounded-xl bg-slate-50 hover:bg-emerald-50/50 border border-slate-200/80 flex items-center justify-between transition-colors"
                      >
                        <div>
                          <p className="font-bold text-slate-800">{pm.label}</p>
                          <p className="text-[11px] text-slate-500">
                            {pm.data?.count || 0} invoice(s)
                          </p>
                        </div>
                        <span className="font-extrabold text-slate-900 tabular-nums">
                          {formatPKR(pm.data?.amount)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Daily Sales & Profit Breakdown */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      Daily Sales, Returns & Gross Profit Trend
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      Avg Bill: <strong>{formatPKR(salesSummary.avg_bill_value)}</strong>
                    </span>
                  </div>

                  {dailySeries.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No daily sales activity recorded in this period.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 pr-1">
                      {dailySeries
                        .slice()
                        .reverse()
                        .map((d: any) => {
                          const pct = Math.min(
                            100,
                            Math.max(4, Math.round((Number(d.net_sales || 0) / maxDailyNetSales) * 100))
                          );
                          return (
                            <div key={d.date} className="py-2.5 space-y-1 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-900 font-mono">
                                  {d.date}
                                </span>
                                <div className="flex items-center gap-3 tabular-nums">
                                  <span className="text-slate-500">{d.invoices} bills</span>
                                  {d.discounts > 0 && (
                                    <span className="text-amber-700">
                                      Disc: {formatPKR(d.discounts)}
                                    </span>
                                  )}
                                  {d.returns > 0 && (
                                    <span className="text-red-600">
                                      Ret: {formatPKR(d.returns)}
                                    </span>
                                  )}
                                  <span className="font-extrabold text-slate-900">
                                    Net: {formatPKR(d.net_sales)}
                                  </span>
                                  <span className="font-bold text-[#009A4D]">
                                    GP: {formatPKR(d.gross_profit)}
                                  </span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#009A4D] rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>

              {/* Product-Wise Sales Table */}
              <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Product-Wise Sales & Profitability ({topProducts.length})
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Click any medicine to inspect stock velocity, batches, and supplier cost history
                    </p>
                  </div>
                </div>

                {topProducts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No product line-item sales found for the selected filter.
                  </div>
                ) : (
                  <>
                    {/* Mobile Top Products Cards */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {topProducts.map((p: any) => (
                        <div key={p.product_id} className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="min-w-0">
                              <Link
                                href={`/portal/inventory?product=${encodeURIComponent(p.product_id)}`}
                                className="text-sm font-extrabold text-slate-900 hover:text-[#009A4D] block truncate"
                              >
                                {p.name}
                              </Link>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {p.category || "General"}
                                {p.code ? ` · ${p.code}` : ""}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-extrabold text-[#009A4D] tabular-nums">
                                {p.has_reliable_cost ? formatPKR(p.gross_profit) : "—"}
                              </p>
                              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                                Gross Profit
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50/90 border border-slate-100 p-2.5 text-[11px]">
                            <div>
                              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                                Qty / Disc
                              </span>
                              <span className="font-bold text-slate-900 tabular-nums">
                                {p.qty_sold} u
                              </span>
                              <span className="text-[10px] text-amber-700 block tabular-nums">
                                -{formatPKR(p.discount)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                                Net Rev
                              </span>
                              <span className="font-bold text-slate-900 tabular-nums">
                                {formatPKR(p.net_revenue)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                                COGS
                              </span>
                              <span className="font-semibold text-slate-700 tabular-nums">
                                {p.has_reliable_cost ? formatPKR(p.cogs) : "Unverified"}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop Top Products Table */}
                    <div className="hidden md:block overflow-x-auto portal-scroll">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                            <th className="py-3 px-4">Medicine / SKU</th>
                            <th className="py-3 px-3">Category</th>
                            <th className="py-3 px-3 text-right">Qty Sold</th>
                            <th className="py-3 px-3 text-right">Discount</th>
                            <th className="py-3 px-3 text-right">Net Revenue</th>
                            <th className="py-3 px-3 text-right">Verified COGS</th>
                            <th className="py-3 px-4 text-right">Gross Profit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {topProducts.map((p: any) => (
                            <tr key={p.product_id} className="hover:bg-slate-50/80">
                              <td className="py-3 px-4 font-bold text-slate-900">
                                <Link
                                  href={`/portal/inventory?product=${encodeURIComponent(p.product_id)}`}
                                  className="hover:text-[#009A4D] hover:underline"
                                >
                                  {p.name}
                                </Link>
                                {p.code && (
                                  <span className="block text-[10px] text-slate-400 font-mono">
                                    {p.code}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-slate-600">{p.category || "General"}</td>
                              <td className="py-3 px-3 text-right font-bold tabular-nums">
                                {p.qty_sold}
                              </td>
                              <td className="py-3 px-3 text-right text-amber-700 tabular-nums">
                                {formatPKR(p.discount)}
                              </td>
                              <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                                {formatPKR(p.net_revenue)}
                              </td>
                              <td className="py-3 px-3 text-right text-slate-600 tabular-nums">
                                {p.has_reliable_cost ? formatPKR(p.cogs) : "Unverified"}
                              </td>
                              <td className="py-3 px-4 text-right font-extrabold text-[#009A4D] tabular-nums">
                                {p.has_reliable_cost ? formatPKR(p.gross_profit) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {/* Category, Manufacturer & Cashier Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Category Sales */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Category-Wise Revenue</h3>
                  <div className="divide-y divide-slate-100 text-xs max-h-64 overflow-y-auto">
                    {(data?.sales_report?.category_sales || []).length === 0 ? (
                      <p className="text-slate-500 py-4 text-center">No category breakdown yet.</p>
                    ) : (
                      (data?.sales_report?.category_sales || []).map((c: any) => (
                        <div
                          key={c.category}
                          className="py-2.5 flex items-center justify-between gap-2"
                        >
                          <div>
                            <p className="font-bold text-slate-800">{c.category}</p>
                            <p className="text-[10px] text-slate-400">
                              {c.qty_sold || c.sold_qty_30d || 0} units sold
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="font-bold text-slate-900">
                              {formatPKR(c.net_revenue ?? c.revenue_30d)}
                            </p>
                            <p className="text-[10px] text-[#009A4D] font-semibold">
                              GP: {formatPKR(c.gross_profit ?? c.profit_30d)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Manufacturer Sales */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Manufacturer Breakdown</h3>
                  <div className="divide-y divide-slate-100 text-xs max-h-64 overflow-y-auto">
                    {(data?.sales_report?.manufacturer_sales || []).length === 0 ? (
                      <p className="text-slate-500 py-4 text-center">
                        Manufacturer breakdown populates automatically from POS product catalog.
                      </p>
                    ) : (
                      (data?.sales_report?.manufacturer_sales || []).map((m: any) => (
                        <div
                          key={m.manufacturer}
                          className="py-2.5 flex items-center justify-between gap-2"
                        >
                          <div>
                            <p className="font-bold text-slate-800">{m.manufacturer}</p>
                            <p className="text-[10px] text-slate-400">
                              {m.sku_count || 0} SKUs • {m.sold_qty_30d || 0} sold
                            </p>
                          </div>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {formatPKR(m.revenue_30d)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Cashier Performance */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Sales by Cashier / Operator</h3>
                  <div className="divide-y divide-slate-100 text-xs max-h-64 overflow-y-auto">
                    {(data?.sales_report?.cashier_sales || []).length === 0 ? (
                      <p className="text-slate-500 py-4 text-center">No cashier records in range.</p>
                    ) : (
                      (data?.sales_report?.cashier_sales || []).map((cs: any) => (
                        <Link
                          key={cs.cashier_name}
                          href={`/portal/sales?cashier=${encodeURIComponent(cs.cashier_name)}`}
                          className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 px-1 rounded-lg"
                        >
                          <div>
                            <p className="font-bold text-slate-900">{cs.cashier_name}</p>
                            <p className="text-[10px] text-slate-500">
                              {cs.invoices_count} bills • Disc: {formatPKR(cs.discounts)} • Ret:{" "}
                              {cs.returns_count || 0}
                            </p>
                          </div>
                          <span className="font-extrabold text-[#009A4D] tabular-nums">
                            {formatPKR(cs.net_sales)}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* 2. PURCHASES & SUPPLIERS REPORT                                   */}
          {/* ================================================================= */}
          {category === "purchases" && (
            <div className="space-y-5">
              {/* Supplier Price Increases Watch */}
              {(data?.purchase_report?.price_changes || []).length > 0 && (
                <div className="bg-amber-50/70 rounded-2xl border border-amber-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      <h2 className="text-sm font-bold text-amber-950">
                        Supplier Purchase Price Increases Detected (
                        {data.purchase_report.price_changes.length})
                      </h2>
                    </div>
                    <Link
                      href="/portal/inventory?filter=price_increased"
                      className="text-xs font-bold text-amber-900 underline"
                    >
                      Inspect All
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                    {data.purchase_report.price_changes.slice(0, 9).map((pc: any, idx: number) => (
                      <Link
                        key={pc.id || idx}
                        href={`/portal/purchases?id=${encodeURIComponent(
                          pc.purchase_id || pc.grn_number
                        )}`}
                        className="p-3 rounded-xl bg-white border border-amber-200/90 hover:border-amber-400 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{pc.product_name}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {pc.supplier_name} • {pc.grn_number}
                          </p>
                        </div>
                        <div className="text-right shrink-0 tabular-nums">
                          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[10px]">
                            +{pc.change_pct}%
                          </span>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            {formatPKR(pc.old_cost)} → <strong>{formatPKR(pc.new_cost)}</strong>
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Suppliers Directory & Verified vs Historical Payables */}
              <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Supplier Payables & Purchase Volume Directory
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Strictly separates verified live supplier payables from historical migrated
                      unverified purchases
                    </p>
                  </div>
                  <Link
                    href="/portal/purchases"
                    className="text-xs font-bold text-[#009A4D] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Open GRN Explorer</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Mobile Suppliers Directory Cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {(data?.purchase_report?.suppliers_directory || [])
                    .filter(
                      (s: any) =>
                        !qLower ||
                        (s.name || "").toLowerCase().includes(qLower) ||
                        (s.phone || "").toLowerCase().includes(qLower)
                    )
                    .map((s: any) => (
                      <div key={s.id} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <Link
                              href={`/portal/purchases?supplier=${encodeURIComponent(s.name)}`}
                              className="text-sm font-extrabold text-slate-900 hover:text-[#009A4D] block truncate"
                            >
                              {s.name}
                            </Link>
                            {s.phone && (
                              <span className="text-[11px] text-slate-500 block">{s.phone}</span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">
                              Payable
                            </span>
                            <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                              {formatPKR(s.verified_payable)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 text-[11px] text-slate-600">
                          <span>
                            {s.total_purchases_count || 0} GRNs ·{" "}
                            <strong className="text-slate-900 tabular-nums">
                              {formatPKR(s.total_purchases_amount)}
                            </strong>
                          </span>
                          {s.legacy_balance_status === "historical_unverified" ? (
                            <PortalStatusBadge tone="amber">Historical Guard</PortalStatusBadge>
                          ) : s.verified_payable > 0 ? (
                            <PortalStatusBadge tone="emerald">Payable Due</PortalStatusBadge>
                          ) : (
                            <PortalStatusBadge tone="slate">Settled</PortalStatusBadge>
                          )}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Desktop Suppliers Directory Table */}
                <div className="hidden md:block overflow-x-auto portal-scroll">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                        <th className="py-3 px-4">Supplier</th>
                        <th className="py-3 px-3 text-right">GRNs</th>
                        <th className="py-3 px-3 text-right">Verified Purchases</th>
                        <th className="py-3 px-3 text-right">Verified Payable</th>
                        <th className="py-3 px-3 text-right">Historical Unverified</th>
                        <th className="py-3 px-4">Ledger Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data?.purchase_report?.suppliers_directory || [])
                        .filter(
                          (s: any) =>
                            !qLower ||
                            (s.name || "").toLowerCase().includes(qLower) ||
                            (s.phone || "").toLowerCase().includes(qLower)
                        )
                        .map((s: any) => (
                          <tr key={s.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-bold text-slate-900">
                              <Link
                                href={`/portal/purchases?supplier=${encodeURIComponent(s.name)}`}
                                className="hover:text-[#009A4D] hover:underline"
                              >
                                {s.name}
                              </Link>
                              {s.phone && (
                                <span className="block text-[10px] text-slate-400">{s.phone}</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {s.total_purchases_count || 0}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold tabular-nums">
                              {formatPKR(s.total_purchases_amount)}
                            </td>
                            <td className="py-3 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                              {formatPKR(s.verified_payable)}
                            </td>
                            <td className="py-3 px-3 text-right text-slate-500 tabular-nums">
                              {s.unverified_historical_amount > 0
                                ? `${formatPKR(s.unverified_historical_amount)} (${
                                    s.unverified_historical_count || 0
                                  })`
                                : "—"}
                            </td>
                            <td className="py-3 px-4">
                              {s.legacy_balance_status === "historical_unverified" ? (
                                <PortalStatusBadge tone="amber">
                                  Historical Unverified (Excluded from Payable)
                                </PortalStatusBadge>
                              ) : s.verified_payable > 0 ? (
                                <PortalStatusBadge tone="emerald">
                                  Verified Payable Due
                                </PortalStatusBadge>
                              ) : (
                                <PortalStatusBadge tone="slate">
                                  Settled / Clear
                                </PortalStatusBadge>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Product-wise Purchase Lines */}
              <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    Recent Product-Wise Purchases & Bonus Quantities
                  </h2>
                </div>
                {/* Mobile Product-Wise Purchase Cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {(data?.purchase_report?.product_purchases || [])
                    .filter(
                      (pp: any) =>
                        !qLower ||
                        (pp.name || "").toLowerCase().includes(qLower) ||
                        (pp.supplier_name || "").toLowerCase().includes(qLower) ||
                        (pp.grn_number || "").toLowerCase().includes(qLower)
                    )
                    .map((pp: any, idx: number) => (
                      <div key={`${pp.purchase_id}_${pp.product_id}_${idx}`} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <Link
                              href={`/portal/inventory?product=${encodeURIComponent(pp.product_id)}`}
                              className="text-sm font-extrabold text-slate-900 hover:underline block truncate"
                            >
                              {pp.name}
                            </Link>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                              <Link
                                href={`/portal/purchases?id=${encodeURIComponent(pp.purchase_id)}`}
                                className="font-bold text-[#009A4D] font-mono hover:underline"
                              >
                                {pp.grn_number}
                              </Link>
                              <span>·</span>
                              <span className="truncate">{pp.supplier_name}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                              {formatPKR(pp.line_total)}
                            </p>
                            <span className="text-[10px] text-slate-400">
                              {formatDate(pp.date)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[11px] bg-slate-50/90 border border-slate-100 rounded-xl px-3 py-2">
                          <span>
                            Qty: <strong>{pp.qty}</strong>
                            {pp.bonus_qty > 0 && (
                              <span className="text-emerald-700 font-bold ml-1">
                                +{pp.bonus_qty} free
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums text-slate-600">
                            Cost: <strong>{formatPKR(pp.cost_price)}</strong>
                            {pp.sale_price > 0 ? ` · Sale: ${formatPKR(pp.sale_price)}` : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Desktop Product-Wise Purchase Table */}
                <div className="hidden md:block overflow-x-auto portal-scroll">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                        <th className="py-3 px-4">Date / GRN</th>
                        <th className="py-3 px-3">Medicine</th>
                        <th className="py-3 px-3">Supplier</th>
                        <th className="py-3 px-3 text-right">Qty + Bonus</th>
                        <th className="py-3 px-3 text-right">Unit Cost</th>
                        <th className="py-3 px-3 text-right">Sale Price</th>
                        <th className="py-3 px-4 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data?.purchase_report?.product_purchases || [])
                        .filter(
                          (pp: any) =>
                            !qLower ||
                            (pp.name || "").toLowerCase().includes(qLower) ||
                            (pp.supplier_name || "").toLowerCase().includes(qLower) ||
                            (pp.grn_number || "").toLowerCase().includes(qLower)
                        )
                        .map((pp: any, idx: number) => (
                          <tr key={`${pp.purchase_id}_${pp.product_id}_${idx}`} className="hover:bg-slate-50">
                            <td className="py-3 px-4">
                              <Link
                                href={`/portal/purchases?id=${encodeURIComponent(pp.purchase_id)}`}
                                className="font-bold text-[#009A4D] hover:underline font-mono"
                              >
                                {pp.grn_number}
                              </Link>
                              <span className="block text-[10px] text-slate-400">
                                {formatDate(pp.date)}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-900">
                              <Link
                                href={`/portal/inventory?product=${encodeURIComponent(pp.product_id)}`}
                                className="hover:underline"
                              >
                                {pp.name}
                              </Link>
                            </td>
                            <td className="py-3 px-3 text-slate-600">{pp.supplier_name}</td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              <strong>{pp.qty}</strong>
                              {pp.bonus_qty > 0 && (
                                <span className="ml-1 text-emerald-700 font-bold">
                                  +{pp.bonus_qty} free
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {formatPKR(pp.cost_price)}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums">
                              {pp.sale_price > 0 ? formatPKR(pp.sale_price) : "—"}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 tabular-nums">
                              {formatPKR(pp.line_total)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* 3. CUSTOMER KHATA & AGING REPORT                                  */}
          {/* ================================================================= */}
          {category === "customers" && (
            <div className="space-y-5">
              {/* Aging Summary Buckets */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-slate-900 text-white p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-300">
                    Verified Receivables ({data?.customer_report?.summary?.total_credit_customers || 0})
                  </span>
                  <p className="text-lg font-extrabold text-amber-300 mt-1 tabular-nums">
                    {formatPKR(data?.customer_report?.summary?.verified_outstanding_balance)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-emerald-700">
                    0–7 Days (Current)
                  </span>
                  <p className="text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                    {formatPKR(data?.customer_report?.summary?.aging?.bucket_0_7d)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">
                    8–30 Days Active
                  </span>
                  <p className="text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                    {formatPKR(data?.customer_report?.summary?.aging?.bucket_8_30d)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-amber-200">
                  <span className="text-[10px] font-bold uppercase text-amber-700">
                    31–60 Days Overdue
                  </span>
                  <p className="text-base font-extrabold text-amber-800 mt-1 tabular-nums">
                    {formatPKR(data?.customer_report?.summary?.aging?.bucket_31_60d)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-red-200">
                  <span className="text-[10px] font-bold uppercase text-red-700">
                    60+ Days Critical
                  </span>
                  <p className="text-base font-extrabold text-red-700 mt-1 tabular-nums">
                    {formatPKR(data?.customer_report?.summary?.aging?.bucket_60d_plus)}
                  </p>
                </div>
              </div>

              {/* Customer Credit Aging Table */}
              <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Customer Khata Receivables & Collection Follow-Up
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Click any customer to open their Khata ledger, WhatsApp reminder, or collection
                      notes
                    </p>
                  </div>
                  <Link
                    href="/portal/khata"
                    className="text-xs font-bold text-[#009A4D] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Open Khata Control</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Mobile Credit Customer Cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {(data?.customer_report?.top_credit_customers || [])
                    .filter(
                      (c: any) =>
                        !qLower ||
                        (c.name || "").toLowerCase().includes(qLower) ||
                        (c.phone || "").toLowerCase().includes(qLower)
                    )
                    .map((c: any) => (
                      <div key={c.id} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <Link
                              href={`/portal/khata?customer=${encodeURIComponent(c.id)}`}
                              className="text-sm font-extrabold text-slate-900 hover:text-[#009A4D] block truncate"
                            >
                              {c.name}
                            </Link>
                            {c.phone && (
                              <span className="text-[11px] text-slate-500 block">{c.phone}</span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-extrabold text-amber-800 tabular-nums">
                              {formatPKR(c.credit_balance)}
                            </span>
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">
                              Balance Due
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <PortalStatusBadge
                            tone={
                              c.aging_bucket === "60d_plus"
                                ? "rose"
                                : c.aging_bucket === "31_60d"
                                ? "amber"
                                : "slate"
                            }
                          >
                            {c.aging_bucket} ({c.days_since_purchase || 0}d)
                          </PortalStatusBadge>
                          <span className="text-[11px] capitalize font-semibold text-slate-600">
                            {String(c.follow_up_status || "none").replace(/_/g, " ")}
                          </span>
                        </div>

                        {c.owner_note && (
                          <p className="text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100 truncate">
                            {c.owner_note}
                          </p>
                        )}
                      </div>
                    ))}
                </div>

                {/* Desktop Credit Customers Table */}
                <div className="hidden md:block overflow-x-auto portal-scroll">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-3">Aging Bucket</th>
                        <th className="py-3 px-3">Follow-Up Status</th>
                        <th className="py-3 px-3">Owner Note</th>
                        <th className="py-3 px-4 text-right">Verified Balance Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data?.customer_report?.top_credit_customers || [])
                        .filter(
                          (c: any) =>
                            !qLower ||
                            (c.name || "").toLowerCase().includes(qLower) ||
                            (c.phone || "").toLowerCase().includes(qLower)
                        )
                        .map((c: any) => (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-bold text-slate-900">
                              <Link
                                href={`/portal/khata?customer=${encodeURIComponent(c.id)}`}
                                className="hover:text-[#009A4D] hover:underline"
                              >
                                {c.name}
                              </Link>
                              {c.phone && (
                                <span className="block text-[10px] text-slate-400">{c.phone}</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <PortalStatusBadge
                                tone={
                                  c.aging_bucket === "60d_plus"
                                    ? "rose"
                                    : c.aging_bucket === "31_60d"
                                    ? "amber"
                                    : "slate"
                                }
                              >
                                {c.aging_bucket} ({c.days_since_purchase || 0}d)
                              </PortalStatusBadge>
                            </td>
                            <td className="py-3 px-3 capitalize font-semibold text-slate-700">
                              {String(c.follow_up_status || "none").replace(/_/g, " ")}
                            </td>
                            <td className="py-3 px-3 text-slate-500 max-w-xs truncate">
                              {c.owner_note || "—"}
                            </td>
                            <td className="py-3 px-4 text-right font-extrabold text-amber-800 tabular-nums">
                              {formatPKR(c.credit_balance)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* 4. INVENTORY & EXPIRY RISK REPORT                                 */}
          {/* ================================================================= */}
          {category === "inventory" && (
            <div className="space-y-5">
              {/* Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-900 text-white p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-300">
                    Inventory Valuation
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-emerald-400 mt-1 tabular-nums">
                    {formatPKR(data?.inventory_report?.stock_value)}
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-amber-200">
                  <span className="text-[10px] font-bold uppercase text-amber-700">Low Stock</span>
                  <p className="text-base sm:text-lg font-extrabold text-amber-800 mt-1 tabular-nums">
                    {data?.inventory_report?.low_stock_count || 0} SKUs
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-red-200">
                  <span className="text-[10px] font-bold uppercase text-red-700">Out of Stock</span>
                  <p className="text-base sm:text-lg font-extrabold text-red-700 mt-1 tabular-nums">
                    {data?.inventory_report?.out_of_stock_count || 0} SKUs
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-red-200">
                  <span className="text-[10px] font-bold uppercase text-red-700">
                    Verified Expiring Soon
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-red-700 mt-1 tabular-nums">
                    {data?.inventory_report?.expiring_soon_count || 0} Batches
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-sky-200">
                  <span className="text-[10px] font-bold uppercase text-sky-700">
                    Expiry Needs Review
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-sky-800 mt-1 tabular-nums">
                    {data?.inventory_report?.unverified_expiry_count || 0} Migrated
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">
                    Slow / Dead Stock
                  </span>
                  <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                    {(data?.inventory_report?.slow_moving_items || []).length} SKUs
                  </p>
                </div>
              </div>

              {/* Expiring Soon vs Unverified Legacy Expiry Review */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      Verified Near-Expiry Batches
                    </h2>
                    <Link
                      href="/portal/inventory?filter=expiring_soon"
                      className="text-xs font-bold text-[#009A4D] hover:underline"
                    >
                      Open in Inventory
                    </Link>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs max-h-80 overflow-y-auto">
                    {(data?.inventory_report?.expiring_items || []).length === 0 ? (
                      <p className="text-slate-500 py-6 text-center">
                        No verified batches expiring soon.
                      </p>
                    ) : (
                      (data?.inventory_report?.expiring_items || []).map((e: any, i: number) => (
                        <Link
                          key={`${e.product_id}_${i}`}
                          href={`/portal/inventory?product=${encodeURIComponent(e.product_id)}`}
                          className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 px-1 rounded-lg"
                        >
                          <div>
                            <p className="font-bold text-slate-900">{e.name}</p>
                            <p className="text-[11px] text-slate-500">
                              Batch: {e.batch_no || "N/A"} • Exp: {e.expiry} ({e.days_left}d)
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="font-bold text-red-700">{e.qty} units</p>
                            <p className="text-[10px] text-slate-500">{formatPKR(e.value)}</p>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-sky-200/90 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Migrated Batches — Expiry Needs Review
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Legacy batches without verified source expiry dates (never falsely marked
                        expired)
                      </p>
                    </div>
                    <Link
                      href="/portal/inventory?filter=unverified_expiry"
                      className="text-xs font-bold text-sky-700 hover:underline"
                    >
                      Review All
                    </Link>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs max-h-80 overflow-y-auto">
                    {(data?.inventory_report?.unverified_expiry_items || []).length === 0 ? (
                      <p className="text-slate-500 py-6 text-center">
                        All batch expiry dates are verified.
                      </p>
                    ) : (
                      (data?.inventory_report?.unverified_expiry_items || []).map(
                        (u: any, i: number) => (
                          <Link
                            key={`${u.product_id}_${i}`}
                            href={`/portal/inventory?filter=unverified_expiry&product=${encodeURIComponent(
                              u.product_id
                            )}`}
                            className="py-2.5 flex items-center justify-between gap-2 hover:bg-sky-50/50 px-1 rounded-lg"
                          >
                            <div>
                              <p className="font-bold text-slate-900">{u.name}</p>
                              <p className="text-[11px] text-sky-800">
                                Batch: {u.batch_no || "Legacy"} • Expiry Needs Physical Verification
                              </p>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                              {u.qty} units
                            </span>
                          </Link>
                        )
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* 5. FINANCIAL & P&L REPORT                                         */}
          {/* ================================================================= */}
          {category === "financial" && (
            <div className="space-y-5">
              {/* Accounting Integrity Notice */}
              <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex items-start gap-3 text-xs text-emerald-950">
                <Info className="w-4 h-4 text-[#009A4D] shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Reconciled Pharmacy Financial Statement</p>
                  <p className="text-emerald-900 mt-0.5">
                    {data?.financial_report?.profit_disclaimer}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* P&L Waterfall Statement */}
                <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                  <div className="px-5 py-4 bg-slate-900 text-white">
                    <h2 className="text-sm font-bold">
                      Income &amp; Gross Margin Statement ({period.toUpperCase()})
                    </h2>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Consistent with POS Overview &amp; Sales Explorer
                    </p>
                  </div>

                  <div className="p-4 sm:p-5 divide-y divide-slate-100 text-xs">
                    <div className="py-3 flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-700">
                        Gross Sales Revenue (Before Returns &amp; Discounts)
                      </span>
                      <span className="font-bold text-slate-900 tabular-nums shrink-0">
                        {formatPKR(data?.financial_report?.summary?.gross_revenue)}
                      </span>
                    </div>

                    <div className="py-3 flex items-center justify-between gap-3 text-amber-800">
                      <span>Less: Invoice Discounts Granted</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        - {formatPKR(data?.financial_report?.summary?.discounts_given)}
                      </span>
                    </div>

                    <div className="py-3 flex items-center justify-between gap-3 text-rose-600">
                      <span>Less: Sales Returns &amp; Refunds</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        - {formatPKR(data?.financial_report?.summary?.sales_returns)}
                      </span>
                    </div>

                    <div className="py-3.5 flex items-center justify-between gap-3 bg-slate-50 px-3 rounded-xl font-extrabold text-slate-900">
                      <span>= Returns-Adjusted Net Sales</span>
                      <span className="text-sm tabular-nums shrink-0">
                        {formatPKR(data?.financial_report?.summary?.net_sales)}
                      </span>
                    </div>

                    <div className="py-3 flex items-center justify-between gap-3 text-slate-700">
                      <span>Less: Verified Cost of Goods Sold (WAC COGS)</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        - {formatPKR(data?.financial_report?.summary?.verified_cogs)}
                      </span>
                    </div>

                    <div className="py-3.5 flex items-center justify-between gap-3 bg-emerald-50/70 px-3 rounded-xl font-extrabold text-[#009A4D]">
                      <span>
                        = Verified Gross Profit (
                        {data?.financial_report?.summary?.gross_margin_pct || 0}% Margin)
                      </span>
                      <span className="text-sm tabular-nums shrink-0">
                        {formatPKR(data?.financial_report?.summary?.gross_profit)}
                      </span>
                    </div>

                    <div className="py-3 flex items-center justify-between gap-3 text-slate-700">
                      <span>Less: Cloud-Synced Operating Expenses</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        - {formatPKR(data?.financial_report?.summary?.verified_expenses)}
                      </span>
                    </div>

                    <div className="py-4 flex items-center justify-between gap-3 bg-slate-900 text-white px-4 rounded-xl font-extrabold">
                      <span>= Operating Surplus (After Verified Expenses)</span>
                      <span className="text-base text-emerald-400 tabular-nums shrink-0">
                        {formatPKR(
                          data?.financial_report?.summary?.operating_surplus_after_verified_expenses
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Working Capital & Payables Integrity */}
                <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h2 className="text-sm font-bold text-slate-900">
                      Working Capital, Receivables &amp; Payables Position
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Live balance sheet indicators synced from AivraSol POS
                    </p>
                  </div>

                  <div className="p-5 space-y-3 text-xs">
                    <Link
                      href="/portal/inventory"
                      className="p-4 rounded-xl bg-slate-50 hover:bg-emerald-50/50 border border-slate-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-900">Current Inventory Valuation</p>
                        <p className="text-[11px] text-slate-500">
                          Positive stock valued at verified Weighted Average Cost
                        </p>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(data?.financial_report?.summary?.inventory_valuation)}
                      </span>
                    </Link>

                    <Link
                      href="/portal/khata"
                      className="p-4 rounded-xl bg-amber-50/50 hover:bg-amber-50 border border-amber-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-amber-950">
                          Verified Customer Khata Receivables
                        </p>
                        <p className="text-[11px] text-amber-800">
                          Outstanding customer credit balances owed to the pharmacy
                        </p>
                      </div>
                      <span className="text-sm font-extrabold text-amber-900 tabular-nums">
                        {formatPKR(data?.financial_report?.summary?.customer_receivables)}
                      </span>
                    </Link>

                    <Link
                      href="/portal/purchases?filter=payable"
                      className="p-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-900">Verified Supplier Payables</p>
                        <p className="text-[11px] text-slate-500">
                          Confirmed unpaid GRN balances owed to suppliers
                        </p>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(data?.financial_report?.summary?.verified_supplier_payables)}
                      </span>
                    </Link>

                    <Link
                      href="/portal/purchases?filter=unverified"
                      className="p-4 rounded-xl bg-slate-50/70 border border-dashed border-slate-300 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-700">
                          Historical Unverified Purchases (Excluded)
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Migrated historical GRNs without source payment ledger proof — kept
                          separate so supplier payables are never inflated
                        </p>
                      </div>
                      <span className="text-sm font-bold text-slate-600 tabular-nums">
                        {formatPKR(data?.financial_report?.summary?.unverified_historical_purchases)}
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PortalReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">
          Loading Advanced Report Center…
        </div>
      }
    >
      <ReportsCenterContent />
    </Suspense>
  );
}

