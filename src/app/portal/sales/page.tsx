"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  Receipt,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

function formatPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
}

function formatDateTime(iso: string): string {
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

function SalesExplorerContent() {
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState(searchParams.get("period") || "30d");
  const [fromDate, setFromDate] = useState(searchParams.get("from") || "");
  const [toDate, setToDate] = useState(searchParams.get("to") || "");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get("q") || "");
  const [payment, setPayment] = useState(searchParams.get("payment") || "all");
  const [cashier, setCashier] = useState(searchParams.get("cashier") || "all");
  const [supervisionFilter, setSupervisionFilter] = useState(searchParams.get("filter") || "all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [invoices, setInvoices] = useState<any[]>([]);
  const [cashiers, setCashiers] = useState<string[]>([]);
  const [summary, setSummary] = useState<any>({
    total_count: 0,
    gross_sales: 0,
    discount_total: 0,
    net_sales: 0,
    credit_sales: 0,
  });
  const [retentionPolicy, setRetentionPolicy] = useState<any>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    searchParams.get("invoice") || null
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchSales = useCallback(
    async (cursorToken: string | null = null) => {
      if (cursorToken) setLoadingMore(true);
      else setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        params.set("period", period);
        if (period === "custom") {
          if (fromDate) params.set("from", fromDate);
          if (toDate) params.set("to", toDate);
        }
        if (debouncedQuery) params.set("q", debouncedQuery);
        if (payment !== "all") params.set("payment", payment);
        if (cashier !== "all") params.set("cashier", cashier);
        if (supervisionFilter !== "all") params.set("filter", supervisionFilter);
        if (cursorToken) params.set("cursor", cursorToken);
        params.set("limit", "25");

        const res = await fetch(`/api/portal/sales?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load sales invoices");
        const json = await res.json();

        if (cursorToken) {
          setInvoices((prev) => [...prev, ...(json.invoices || [])]);
        } else {
          setInvoices(json.invoices || []);
          setSummary(json.summary || {});
          if (Array.isArray(json.cashiers)) setCashiers(json.cashiers);
          setRetentionPolicy(json.retention_policy || null);
        }
        setNextCursor(json.next_cursor || null);
        setHasMore(Boolean(json.has_more));
      } catch (err: any) {
        setError(err.message || "Error loading invoices");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [period, fromDate, toDate, debouncedQuery, payment, cashier, supervisionFilter]
  );

  useEffect(() => {
    void fetchSales(null);
  }, [fetchSales]);

  const activeAdvancedCount =
    (payment !== "all" ? 1 : 0) +
    (cashier !== "all" ? 1 : 0) +
    (supervisionFilter !== "all" ? 1 : 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <PortalPageHeader
        icon={<Receipt className="w-5 h-5" />}
        title="Sales & Invoice Explorer"
        subtitle="Search, filter & inspect every finalized counter invoice, discount, tender & return"
        actions={<PortalRefreshButton loading={loading} onClick={() => void fetchSales(null)} />}
      />

      {/* Search, Period & Smart Collapsible Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/85 p-3.5 sm:p-4 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row gap-2.5 sm:gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoice #, customer name/phone, or medicine…"
              className="w-full h-10 pl-9 pr-9 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009A4D]/20 focus:border-[#009A4D]"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0">
            {[
              { id: "today", label: "Today" },
              { id: "7d", label: "7 Days" },
              { id: "30d", label: "30 Days" },
              { id: "all", label: "All Synced" },
              { id: "custom", label: "Custom" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                  period === p.id
                    ? "bg-[#009A4D] text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {period === "custom" && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 pt-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <label className="text-[11px] font-bold text-slate-500">From:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 bg-white"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <label className="text-[11px] font-bold text-slate-500">To:</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 bg-white"
              />
            </div>
          </div>
        )}

        {/* Mobile Filters Toggle Button */}
        <div className="flex sm:hidden items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-700"
          >
            <Filter className="w-3.5 h-3.5 text-[#009A4D]" />
            <span>More Filters</span>
            {activeAdvancedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#009A4D] text-white text-[10px]">
                {activeAdvancedCount}
              </span>
            )}
            {mobileFiltersOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {activeAdvancedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setPayment("all");
                setCashier("all");
                setSupervisionFilter("all");
              }}
              className="text-xs font-bold text-rose-600 hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Payment Method, Cashier & Supervision Selectors */}
        <div
          className={`${
            mobileFiltersOpen ? "grid" : "hidden sm:grid"
          } grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1`}
        >
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Payment Tender
            </label>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
            >
              <option value="all">All Payment Methods</option>
              <option value="cash">Cash Counter Sales</option>
              <option value="card">Card / POS Machine</option>
              <option value="wallet">Mobile Wallet / Online</option>
              <option value="credit">Customer Credit (Khata)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Cashier / Operator
            </label>
            <select
              value={cashier}
              onChange={(e) => setCashier(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
            >
              <option value="all">All Cashiers</option>
              {cashiers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Owner Supervision Filter
            </label>
            <select
              value={supervisionFilter}
              onChange={(e) => setSupervisionFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
            >
              <option value="all">All Finalized Invoices</option>
              <option value="high_discount">High Discounts (≥15% or ≥Rs 500)</option>
              <option value="has_returns">Invoices with Sales Returns</option>
              <option value="credit">Credit / Khata Bills Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Retention Policy Notice Banner */}
      {retentionPolicy?.notice && (
        <div className="p-3.5 rounded-2xl bg-sky-50/80 border border-sky-200 text-xs text-sky-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
          <span>{retentionPolicy.notice}</span>
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        <PortalKpiCard
          label="Matching Bills"
          value={(summary.total_count ?? 0).toLocaleString("en-PK")}
        />
        <PortalKpiCard label="Gross Subtotal" value={formatPKR(summary.gross_sales ?? 0)} />
        <PortalKpiCard
          label="Discounts Given"
          value={formatPKR(summary.discount_total ?? 0)}
          tone="amber"
        />
        <PortalKpiCard
          label="Net Sales"
          value={formatPKR(summary.net_sales ?? 0)}
          tone="emerald"
        />
        <PortalKpiCard
          label="Credit (Khata)"
          value={formatPKR(summary.credit_sales ?? 0)}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Invoices List (Mobile Cards + Desktop Table) */}
      <div className="bg-white rounded-2xl border border-slate-200/85 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-red-600 flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        ) : invoices.length === 0 ? (
          <PortalEmptyState
            icon={<Receipt className="w-6 h-6" />}
            title="No Matching Invoices Found"
            description="Try adjusting your date range, search query, or tender filter."
          />
        ) : (
          <>
            {/* Desktop Executive Table */}
            <div className="hidden md:block overflow-x-auto portal-scroll">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3.5 px-4">Invoice #</th>
                    <th className="py-3.5 px-3">Date &amp; Time</th>
                    <th className="py-3.5 px-3">Customer</th>
                    <th className="py-3.5 px-3">Cashier</th>
                    <th className="py-3.5 px-3">Tender</th>
                    <th className="py-3.5 px-3 text-right">Subtotal</th>
                    <th className="py-3.5 px-3 text-right">Discount</th>
                    <th className="py-3.5 px-3 text-right">Net Total</th>
                    <th className="py-3.5 px-3 text-center">Items</th>
                    <th className="py-3.5 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.event_id || inv.id}
                      onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                      className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4 font-extrabold text-slate-900 group-hover:text-[#009A4D] font-mono">
                        #{inv.invoice_number}
                        {inv.return_count > 0 && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            Returned
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap">
                        {formatDateTime(inv.occurred_at)}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-slate-900">{inv.customer_name}</div>
                        {inv.customer_phone && (
                          <div className="text-[11px] text-slate-400 font-mono">
                            {inv.customer_phone}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600">
                        {inv.cashier}
                        <span className="text-[10px] text-slate-400 ml-1">
                          (T{inv.terminal_number || 1})
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
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
                      </td>
                      <td className="py-3.5 px-3 text-right text-slate-600 tabular-nums">
                        {formatPKR(inv.gross_sales)}
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums">
                        {inv.discount > 0 ? (
                          <span className="text-amber-700 font-semibold">
                            -{formatPKR(inv.discount)}{" "}
                            <span className="text-[10px]">({inv.discount_pct}%)</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </td>
                      <td className="py-3.5 px-3 text-center text-slate-500">
                        {inv.items_count > 0 ? inv.items_count : inv.items_archived ? "Arch." : "—"}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D] inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List — Multi-tier Zero-Squish Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {invoices.map((inv) => (
                <button
                  key={inv.event_id || inv.id}
                  onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                  className="w-full text-left p-4 hover:bg-slate-50 active:bg-emerald-50/40 transition-colors space-y-2"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs font-extrabold text-slate-900 font-mono">
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
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>

                  <p className="text-xs font-semibold text-slate-700 truncate">
                    {inv.customer_name} · {inv.cashier}
                  </p>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="truncate">
                      {formatDateTime(inv.occurred_at)} · {inv.items_count || 0} items
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {inv.discount > 0 && (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200/70 px-1.5 py-0.5 rounded">
                          Disc {formatPKR(inv.discount)}
                        </span>
                      )}
                      {inv.return_count > 0 && (
                        <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200/70 px-1.5 py-0.5 rounded">
                          Ret {formatPKR(inv.returned_amount)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Cursor Pagination Footer */}
            {hasMore && nextCursor && (
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 text-center">
                <button
                  onClick={() => void fetchSales(nextCursor)}
                  disabled={loadingMore}
                  className="px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-[#009A4D] hover:bg-emerald-50 transition-colors shadow-2xs disabled:opacity-50"
                >
                  {loadingMore ? "Loading more invoices…" : "Load More Invoices"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Clickable Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

export default function PortalSalesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">Loading Sales Explorer…</div>
      }
    >
      <SalesExplorerContent />
    </Suspense>
  );
}
