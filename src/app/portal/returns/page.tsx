"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RotateCcw,
  Search,
  RefreshCw,
  ChevronRight,
  X,
  Receipt,
  ShoppingBag,
  ArrowUpRight,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

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

function ReturnsContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"sales" | "purchases">("sales");
  const [period, setPeriod] = useState(searchParams.get("period") || "30d");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get("q") || "");
  const [refundFilter, setRefundFilter] = useState("all");

  const [salesReturns, setSalesReturns] = useState<any[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const [selectedReturn, setSelectedReturn] = useState<any | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("period", period);
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (refundFilter !== "all") params.set("refund", refundFilter);

      const res = await fetch(`/api/portal/returns?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setSalesReturns(json.sales_returns || []);
        setPurchaseReturns(json.purchase_returns || []);
        setSummary(json.summary || {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [period, debouncedQuery, refundFilter]);

  useEffect(() => {
    void fetchReturns();
  }, [fetchReturns]);

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Sales & Purchase Returns
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect returned items, refund methods, operator reasons, and linked original invoices/GRNs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveTab("sales")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === "sales"
                  ? "bg-[#009A4D] text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sales Returns ({summary.sales_returns_count ?? salesReturns.length})
            </button>
            <button
              onClick={() => setActiveTab("purchases")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === "purchases"
                  ? "bg-[#009A4D] text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Supplier Returns ({summary.purchase_returns_count ?? purchaseReturns.length})
            </button>
          </div>
          <button
            onClick={() => void fetchReturns()}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Sales Returns Total</span>
          <p className="text-base sm:text-lg font-extrabold text-red-600 mt-1 tabular-nums">
            {formatPKR(summary.sales_returns_amount ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Sales Return Count</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {summary.sales_returns_count ?? 0}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Purchase Returns Total</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {formatPKR(summary.purchase_returns_amount ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Purchase Return Count</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {summary.purchase_returns_count ?? 0}
          </p>
        </div>
      </div>

      {/* Search & Period Filter */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search return #, original invoice/GRN #, customer/supplier, or product…"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#009A4D]"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: "today", label: "Today" },
            { id: "7d", label: "7 Days" },
            { id: "30d", label: "30 Days" },
            { id: "all", label: "All Time" },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
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

      {/* Returns List */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : activeTab === "sales" ? (
          salesReturns.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <RotateCcw className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Sales Returns Found</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {salesReturns.map((ret) => (
                <button
                  key={ret.event_id || ret.id}
                  onClick={() => setSelectedReturn({ ...ret, kind: "sale" })}
                  className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-slate-900 font-mono">
                        #{ret.return_number}
                      </span>
                      {ret.invoice_number ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          Against Invoice #{ret.invoice_number}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Loose Return
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
                        Refund: {ret.refund_method}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">
                      {ret.customer_name} · {ret.cashier} · {formatDateTime(ret.occurred_at)}
                    </p>
                    {ret.reason && (
                      <p className="text-[11px] text-slate-400 truncate">Reason: {ret.reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-extrabold text-red-600 tabular-nums">
                        - {formatPKR(ret.return_amount)}
                      </p>
                      <p className="text-[10px] text-slate-400">{ret.items_count} items</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          )
        ) : purchaseReturns.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-800">No Supplier Purchase Returns Found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {purchaseReturns.map((ret) => (
              <button
                key={ret.id}
                onClick={() => setSelectedReturn({ ...ret, kind: "purchase" })}
                className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-extrabold text-slate-900 font-mono">
                      #{ret.return_number}
                    </span>
                    <span className="text-xs font-bold text-slate-800">· {ret.supplier_name}</span>
                    {ret.purchase_number && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        GRN #{ret.purchase_number}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTime(ret.occurred_at)}</p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {formatPKR(ret.return_total)}
                  </p>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Return Detail Drawer */}
      {selectedReturn && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/50 backdrop-blur-[2px]">
          <div className="fixed inset-0" onClick={() => setSelectedReturn(null)} />
          <div className="relative z-10 w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Return #{selectedReturn.return_number}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDateTime(selectedReturn.occurred_at)}
                </p>
              </div>
              <button
                onClick={() => setSelectedReturn(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    {selectedReturn.kind === "sale" ? "Customer" : "Supplier"}
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">
                    {selectedReturn.customer_name || selectedReturn.supplier_name}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-red-50/60 border border-red-200">
                  <span className="text-[10px] font-bold uppercase text-red-700">
                    Total Return Value
                  </span>
                  <p className="text-base font-extrabold text-red-700 mt-0.5 tabular-nums">
                    {formatPKR(selectedReturn.return_amount ?? selectedReturn.return_total)}
                  </p>
                </div>
              </div>

              {/* Bidirectional Link to Original Invoice */}
              {selectedReturn.kind === "sale" &&
                (selectedReturn.invoice_id || selectedReturn.invoice_number) && (
                  <button
                    onClick={() => {
                      const invTarget =
                        selectedReturn.invoice_id || selectedReturn.invoice_number;
                      setSelectedReturn(null);
                      setSelectedInvoiceId(invTarget);
                    }}
                    className="w-full p-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 flex items-center justify-between text-xs font-bold text-[#009A4D] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4" />
                      <span>
                        Inspect Original Invoice #
                        {selectedReturn.invoice_number || selectedReturn.invoice_id}
                      </span>
                    </div>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                )}

              {selectedReturn.reason && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <strong>Reason:</strong> {selectedReturn.reason}
                </div>
              )}

              {/* Returned Items */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Returned Line Items ({selectedReturn.items?.length || 0})
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(selectedReturn.items || []).map((item: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {item.product_name || item.name}
                        </p>
                        <p className="text-slate-500 mt-0.5">
                          Qty: {item.qty} {item.unit || "unit"} ×{" "}
                          {formatPKR(item.unit_price ?? item.cost ?? 0)}
                        </p>
                      </div>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatPKR(item.line_total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Linked Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

export default function PortalReturnsPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-xs text-slate-500">Loading Returns…</div>}
    >
      <ReturnsContent />
    </Suspense>
  );
}

