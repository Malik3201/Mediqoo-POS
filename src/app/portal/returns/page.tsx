"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RotateCcw,
  Search,
  ChevronRight,
  Receipt,
  ShoppingBag,
  ArrowUpRight,
  X,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
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

function ReturnsContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"sales" | "purchases">("sales");
  const [period, setPeriod] = useState(searchParams.get("period") || "30d");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get("q") || "");
  const [refundFilter] = useState("all");

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
      <PortalPageHeader
        icon={<RotateCcw className="w-5 h-5" />}
        title="Sales & Purchase Returns"
        subtitle="Inspect returned medicines, refund methods, staff reasons & linked original bills"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex bg-white p-1 rounded-2xl border border-slate-200/90 shadow-2xs">
              <button
                onClick={() => setActiveTab("sales")}
                className={`px-3 py-1.5 sm:px-3.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                  activeTab === "sales"
                    ? "bg-[#009A4D] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sales ({summary.sales_returns_count ?? salesReturns.length})
              </button>
              <button
                onClick={() => setActiveTab("purchases")}
                className={`px-3 py-1.5 sm:px-3.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                  activeTab === "purchases"
                    ? "bg-[#009A4D] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Supplier ({summary.purchase_returns_count ?? purchaseReturns.length})
              </button>
            </div>
            <PortalRefreshButton loading={loading} onClick={() => void fetchReturns()} />
          </div>
        }
      />

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <PortalKpiCard
          label="Sales Returns Value"
          value={formatPKR(summary.sales_returns_amount ?? 0)}
          tone="rose"
        />
        <PortalKpiCard
          label="Customer Returns"
          value={summary.sales_returns_count ?? 0}
        />
        <PortalKpiCard
          label="Supplier Returns Value"
          value={formatPKR(summary.purchase_returns_amount ?? 0)}
        />
        <PortalKpiCard
          label="GRN Return Slips"
          value={summary.purchase_returns_count ?? 0}
        />
      </div>

      {/* Search & Period Filter */}
      <div className="bg-white rounded-2xl border border-slate-200/85 p-3.5 sm:p-4 shadow-2xs flex flex-col lg:flex-row gap-2.5 sm:gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search return #, original invoice/GRN #, customer/supplier, or product…"
            className="w-full h-10 pl-9 pr-8 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#009A4D]/20 focus:border-[#009A4D]"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: "today", label: "Today" },
            { id: "7d", label: "7 Days" },
            { id: "30d", label: "30 Days" },
            { id: "all", label: "All Time" },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
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

      {/* Returns Table (Desktop) + Cards (Mobile) */}
      <div className="bg-white rounded-2xl border border-slate-200/85 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : activeTab === "sales" ? (
          salesReturns.length === 0 ? (
            <PortalEmptyState
              icon={<RotateCcw className="w-6 h-6" />}
              title="No Sales Returns Found"
              description="Try expanding the date window or clearing your search query."
            />
          ) : (
            <>
              {/* Desktop Sales Returns Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">Return #</th>
                      <th className="py-3.5 px-3">Date &amp; Time</th>
                      <th className="py-3.5 px-3">Customer / Cashier</th>
                      <th className="py-3.5 px-3">Linked Bill</th>
                      <th className="py-3.5 px-3">Refund Method</th>
                      <th className="py-3.5 px-3 text-center">Items</th>
                      <th className="py-3.5 px-3 text-right">Return Amount</th>
                      <th className="py-3.5 px-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesReturns.map((ret) => (
                      <tr
                        key={ret.event_id || ret.id}
                        onClick={() => setSelectedReturn({ ...ret, kind: "sale" })}
                        className="hover:bg-red-50/30 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 px-4 font-extrabold text-slate-900 font-mono">
                          #{ret.return_number}
                        </td>
                        <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap">
                          {formatDateTime(ret.occurred_at)}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-bold text-slate-900">{ret.customer_name}</div>
                          <div className="text-[11px] text-slate-400">Cashier: {ret.cashier}</div>
                        </td>
                        <td className="py-3.5 px-3">
                          {ret.invoice_number ? (
                            <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                              Inv #{ret.invoice_number}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              Loose Return
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
                            {ret.refund_method}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-center text-slate-600">
                          {ret.items_count}
                        </td>
                        <td className="py-3.5 px-3 text-right font-extrabold text-red-600 tabular-nums">
                          - {formatPKR(ret.return_amount)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-red-500 inline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Sales Returns Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {salesReturns.map((ret) => (
                  <button
                    key={ret.event_id || ret.id}
                    onClick={() => setSelectedReturn({ ...ret, kind: "sale" })}
                    className="w-full text-left p-4 hover:bg-red-50/20 active:bg-red-50/40 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-xs font-extrabold text-slate-900 font-mono">
                          #{ret.return_number}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
                          {ret.refund_method}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-sm font-extrabold text-red-600 tabular-nums">
                          - {formatPKR(ret.return_amount)}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ret.invoice_number ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                          Against Inv #{ret.invoice_number}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Loose Return
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">{ret.items_count} item(s)</span>
                    </div>

                    <p className="text-xs text-slate-600 truncate">
                      {ret.customer_name} · {ret.cashier} · {formatDateTime(ret.occurred_at)}
                    </p>
                    {ret.reason && (
                      <p className="text-[11px] text-slate-400 truncate">Reason: {ret.reason}</p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )
        ) : purchaseReturns.length === 0 ? (
          <PortalEmptyState
            icon={<ShoppingBag className="w-6 h-6" />}
            title="No Supplier Purchase Returns Found"
            description="Returns made to distributors and wholesalers appear here automatically."
          />
        ) : (
          <>
            {/* Desktop Purchase Returns Table */}
            <div className="hidden md:block overflow-x-auto portal-scroll">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3.5 px-4">Return #</th>
                    <th className="py-3.5 px-3">Date &amp; Time</th>
                    <th className="py-3.5 px-3">Supplier</th>
                    <th className="py-3.5 px-3">Source GRN</th>
                    <th className="py-3.5 px-3 text-right">Return Value</th>
                    <th className="py-3.5 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseReturns.map((ret) => (
                    <tr
                      key={ret.id}
                      onClick={() => setSelectedReturn({ ...ret, kind: "purchase" })}
                      className="hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4 font-extrabold text-slate-900 font-mono">
                        #{ret.return_number}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap">
                        {formatDateTime(ret.occurred_at)}
                      </td>
                      <td className="py-3.5 px-3 font-bold text-slate-900">{ret.supplier_name}</td>
                      <td className="py-3.5 px-3">
                        {ret.purchase_number ? (
                          <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-slate-100 text-slate-700 font-mono">
                            GRN #{ret.purchase_number}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(ret.return_total)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D] inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Purchase Returns Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {purchaseReturns.map((ret) => (
                <button
                  key={ret.id}
                  onClick={() => setSelectedReturn({ ...ret, kind: "purchase" })}
                  className="w-full text-left p-4 hover:bg-slate-50 active:bg-slate-100/60 transition-colors space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs font-extrabold text-slate-900 font-mono">
                        #{ret.return_number}
                      </span>
                      {ret.purchase_number && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 font-mono">
                          GRN #{ret.purchase_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(ret.return_total)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                  <p className="text-xs font-bold text-slate-800 truncate">{ret.supplier_name}</p>
                  <p className="text-[11px] text-slate-500">{formatDateTime(ret.occurred_at)}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Return Detail Slide-Over */}
      <PortalSlideOver
        open={Boolean(selectedReturn)}
        onClose={() => setSelectedReturn(null)}
        eyebrow={selectedReturn?.kind === "sale" ? "Customer Sales Return" : "Supplier Return"}
        title={selectedReturn ? `Return #${selectedReturn.return_number}` : "Return Details"}
        subtitle={selectedReturn ? formatDateTime(selectedReturn.occurred_at) : undefined}
        maxWidthClass="max-w-lg"
        zIndexClass="z-40"
      >
        {selectedReturn && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  {selectedReturn.kind === "sale" ? "Customer" : "Supplier"}
                </span>
                <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">
                  {selectedReturn.customer_name || selectedReturn.supplier_name}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-red-50/70 border border-red-200">
                <span className="text-[10px] font-bold uppercase text-red-700">
                  Total Return Value
                </span>
                <p className="text-base font-extrabold text-red-700 mt-0.5 tabular-nums">
                  {formatPKR(selectedReturn.return_amount ?? selectedReturn.return_total)}
                </p>
              </div>
            </div>

            {selectedReturn.kind === "sale" &&
              (selectedReturn.invoice_id || selectedReturn.invoice_number) && (
                <button
                  onClick={() => {
                    const invTarget =
                      selectedReturn.invoice_id || selectedReturn.invoice_number;
                    setSelectedReturn(null);
                    setSelectedInvoiceId(invTarget);
                  }}
                  className="w-full p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 flex items-center justify-between text-xs font-bold text-[#009A4D] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 shrink-0" />
                    <span>
                      Inspect Original Invoice #
                      {selectedReturn.invoice_number || selectedReturn.invoice_id}
                    </span>
                  </div>
                  <ArrowUpRight className="w-4 h-4 shrink-0" />
                </button>
              )}

            {selectedReturn.reason && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <strong>Reason:</strong> {selectedReturn.reason}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Returned Line Items ({selectedReturn.items?.length || 0})
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(selectedReturn.items || []).map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">
                        {item.product_name || item.name}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        Qty: {item.qty} {item.unit || "unit"} ×{" "}
                        {formatPKR(item.unit_price ?? item.cost ?? 0)}
                      </p>
                    </div>
                    <span className="font-extrabold text-slate-900 tabular-nums shrink-0">
                      {formatPKR(item.line_total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </PortalSlideOver>

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
