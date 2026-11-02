"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  Receipt,
  Calendar,
  CreditCard,
  User,
  RotateCcw,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Info,
  Percent,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Sales & Invoice Explorer
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Search, filter, and inspect every finalized POS invoice, discount, tender, and return
          </p>
        </div>

        <button
          onClick={() => void fetchSales(null)}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        {/* Top Row: Search + Period Pills */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by invoice #, customer name/phone, or medicine name…"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009A4D]/20 focus:border-[#009A4D]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
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
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                  period === p.id
                    ? "bg-[#009A4D] text-white"
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
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">From:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">To:</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-900"
              />
            </div>
          </div>
        )}

        {/* Second Row: Payment Method, Cashier, and Supervision Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Payment Tender
            </label>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
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
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
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
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#009A4D]"
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
        <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>{retentionPolicy.notice}</span>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="bg-white rounded-xl border border-slate-200/90 p-3">
          <span className="text-[11px] font-medium text-slate-500">Matching Bills</span>
          <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
            {(summary.total_count ?? 0).toLocaleString("en-PK")}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-3">
          <span className="text-[11px] font-medium text-slate-500">Gross Subtotal</span>
          <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
            {formatPKR(summary.gross_sales ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-3">
          <span className="text-[11px] font-medium text-slate-500">Discounts Given</span>
          <p className="text-base font-extrabold text-amber-700 mt-0.5 tabular-nums">
            {formatPKR(summary.discount_total ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-3">
          <span className="text-[11px] font-medium text-slate-500">Net Sales</span>
          <p className="text-base font-extrabold text-[#009A4D] mt-0.5 tabular-nums">
            {formatPKR(summary.net_sales ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 p-3 col-span-2 sm:col-span-1">
          <span className="text-[11px] font-medium text-slate-500">Credit (Khata)</span>
          <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
            {formatPKR(summary.credit_sales ?? 0)}
          </p>
        </div>
      </div>

      {/* Invoice List (Mobile Cards + Desktop Table) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-red-600 flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-800">No Matching Invoices Found</p>
            <p className="text-xs text-slate-500">
              Try adjusting your date range, search query, or payment filter.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Cashier</th>
                    <th className="py-3 px-4">Tender</th>
                    <th className="py-3 px-4 text-right">Subtotal</th>
                    <th className="py-3 px-4 text-right">Discount</th>
                    <th className="py-3 px-4 text-right">Net Total</th>
                    <th className="py-3 px-4 text-center">Items</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.event_id || inv.id}
                      onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                      className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                    >
                      <td className="py-3 px-4 font-bold text-slate-900 group-hover:text-[#009A4D] font-mono">
                        #{inv.invoice_number}
                        {inv.return_count > 0 && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                            Returned
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatDateTime(inv.occurred_at)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{inv.customer_name}</div>
                        {inv.customer_phone && (
                          <div className="text-[11px] text-slate-400">{inv.customer_phone}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {inv.cashier}
                        <span className="text-[10px] text-slate-400 ml-1">
                          (T{inv.terminal_number || 1})
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            inv.payment_method === "credit"
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : inv.payment_method === "card"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {inv.payment_method}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 tabular-nums">
                        {formatPKR(inv.gross_sales)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {inv.discount > 0 ? (
                          <span className="text-amber-700 font-semibold">
                            -{formatPKR(inv.discount)}{" "}
                            <span className="text-[10px]">({inv.discount_pct}%)</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500">
                        {inv.items_count > 0 ? inv.items_count : inv.items_archived ? "Arch." : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D] inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-slate-100">
              {invoices.map((inv) => (
                <button
                  key={inv.event_id || inv.id}
                  onClick={() => setSelectedInvoiceId(inv.id || inv.invoice_number)}
                  className="w-full text-left p-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-slate-900 font-mono">
                        #{inv.invoice_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          inv.payment_method === "credit"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {inv.payment_method}
                      </span>
                      {inv.discount > 0 && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                          Disc: {formatPKR(inv.discount)} ({inv.discount_pct}%)
                        </span>
                      )}
                      {inv.return_count > 0 && (
                        <span className="text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                          Returned: {formatPKR(inv.returned_amount)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-700 truncate">
                      {inv.customer_name} · {inv.cashier}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatDateTime(inv.occurred_at)} · {inv.items_count} items
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(inv.net_sales)}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
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
                  className="px-5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-[#009A4D] hover:bg-emerald-50 transition-colors shadow-2xs disabled:opacity-50"
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

