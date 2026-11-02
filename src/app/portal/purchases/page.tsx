"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShoppingBag,
  Building2,
  Search,
  RefreshCw,
  ChevronRight,
  X,
  FileText,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  AlertCircle,
  Info,
  RotateCcw,
  Wallet,
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
    });
  } catch {
    return iso;
  }
}

function PurchasesContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "suppliers" ? "suppliers" : "grns";

  const [activeTab, setActiveTab] = useState<"grns" | "suppliers">(initialTab);
  const [period, setPeriod] = useState(searchParams.get("period") || "30d");
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get("q") || "");
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get("supplier") || "all");
  const [supplierStatusFilter, setSupplierStatusFilter] = useState(
    searchParams.get("filter") || "all"
  );

  const [purchases, setPurchases] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Detail drawers
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [purchaseDetail, setPurchaseDetail] = useState<any | null>(null);
  const [loadingPurchaseDetail, setLoadingPurchaseDetail] = useState(false);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<any | null>(null);
  const [loadingSupplierDetail, setLoadingSupplierDetail] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPurchasesData = useCallback(
    async (cursorToken: string | null = null) => {
      if (cursorToken) setLoadingMore(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("period", period);
        if (debouncedQuery) params.set("q", debouncedQuery);
        if (supplierFilter !== "all") params.set("supplier", supplierFilter);
        if (supplierStatusFilter !== "all") params.set("filter", supplierStatusFilter);
        if (cursorToken) params.set("cursor", cursorToken);
        params.set("limit", "25");

        const res = await fetch(`/api/portal/purchases?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load purchases");
        const json = await res.json();

        if (cursorToken) {
          setPurchases((prev) => [...prev, ...(json.purchases || [])]);
        } else {
          setPurchases(json.purchases || []);
          setSuppliers(json.suppliers || []);
          setSummary(json.summary || {});
        }
        setNextCursor(json.next_cursor || null);
        setHasMore(Boolean(json.has_more));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [period, debouncedQuery, supplierFilter, supplierStatusFilter]
  );

  useEffect(() => {
    void fetchPurchasesData(null);
  }, [fetchPurchasesData]);

  // Load specific Purchase / GRN detail
  useEffect(() => {
    if (!selectedPurchaseId) {
      setPurchaseDetail(null);
      return;
    }
    setLoadingPurchaseDetail(true);
    fetch(`/api/portal/purchases?id=${encodeURIComponent(selectedPurchaseId)}`)
      .then((res) => res.json())
      .then((json) => setPurchaseDetail(json.purchase || null))
      .catch(console.error)
      .finally(() => setLoadingPurchaseDetail(false));
  }, [selectedPurchaseId]);

  // Load specific Supplier detail
  useEffect(() => {
    if (!selectedSupplierId) {
      setSupplierDetail(null);
      return;
    }
    setLoadingSupplierDetail(true);
    fetch(`/api/portal/suppliers/${encodeURIComponent(selectedSupplierId)}`)
      .then((res) => res.json())
      .then((json) => setSupplierDetail(json || null))
      .catch(console.error)
      .finally(() => setLoadingSupplierDetail(false));
  }, [selectedSupplierId]);

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Purchases & Suppliers
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect GRN stock receipts, supplier directories, verified payables, and legacy balance audit
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
            <button
              onClick={() => setActiveTab("grns")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === "grns"
                  ? "bg-[#009A4D] text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              GRN History ({summary.purchases_count ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("suppliers")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === "suppliers"
                  ? "bg-[#009A4D] text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Suppliers ({summary.suppliers_count ?? suppliers.length})
            </button>
          </div>
          <button
            onClick={() => void fetchPurchasesData(null)}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Top KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Period GRN Total</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {formatPKR(summary.purchases_amount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {summary.purchases_count ?? 0} stock receipts
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Verified Supplier Payable</span>
          <p className="text-base sm:text-lg font-extrabold text-emerald-700 mt-1 tabular-nums">
            {formatPKR(summary.total_verified_payable ?? 0)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Confirmed live payables</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Active Suppliers</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {summary.suppliers_count ?? suppliers.length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Click supplier for ledger</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Legacy Audit Status</span>
          <p className="text-sm font-extrabold text-slate-900 mt-1">
            {(summary.unverified_suppliers_count ?? 0) > 0
              ? `${summary.unverified_suppliers_count} Historical Excluded`
              : "100% Verified"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Zero fabricated supplier debt
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                activeTab === "grns"
                  ? "Search by GRN number, supplier name, or medicine…"
                  : "Search supplier by name or phone…"
              }
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#009A4D]"
            />
          </div>

          {activeTab === "grns" ? (
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
          ) : (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: "all", label: "All Suppliers" },
                { id: "payable", label: "With Verified Payable" },
                { id: "unverified", label: "Legacy Historical Review" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSupplierStatusFilter(f.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
                    supplierStatusFilter === f.id
                      ? "bg-[#009A4D] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TAB 1: GRN History */}
      {activeTab === "grns" && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : purchases.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Purchase GRNs Found</p>
              <p className="text-xs text-slate-500">
                Try switching the period filter to &ldquo;All Time&rdquo; or clearing your search.
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-100">
                {purchases.map((pur) => (
                  <button
                    key={pur.event_id || pur.id}
                    onClick={() => setSelectedPurchaseId(pur.id || pur.grn)}
                    className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-emerald-50/40 transition-colors flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-slate-900 group-hover:text-[#009A4D] font-mono">
                          GRN #{pur.grn}
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          · {pur.supplier_name}
                        </span>
                        {pur.payment_verification_status === "historical_unverified" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            Historical Procurement (Excluded from Payable)
                          </span>
                        ) : pur.payment_verification_status === "paid" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Paid
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            Supplier Credit
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(pur.occurred_at)}
                        {pur.lines_count > 0 ? ` · ${pur.lines_count} product lines` : ""}
                        {pur.operator_name ? ` · Received by ${pur.operator_name}` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                          {formatPKR(pur.purchase_total)}
                        </p>
                        {pur.discount > 0 && (
                          <p className="text-[10px] text-emerald-700">
                            Disc: {formatPKR(pur.discount)}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                    </div>
                  </button>
                ))}
              </div>

              {hasMore && nextCursor && (
                <div className="p-4 border-t border-slate-100 text-center">
                  <button
                    onClick={() => void fetchPurchasesData(nextCursor)}
                    disabled={loadingMore}
                    className="px-5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-[#009A4D] hover:bg-emerald-50"
                  >
                    {loadingMore ? "Loading…" : "Load More Purchases"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: Supplier Directory */}
      {activeTab === "suppliers" && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          {suppliers.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Suppliers Found</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {suppliers.map((sup) => (
                <button
                  key={sup.id}
                  onClick={() => setSelectedSupplierId(sup.id)}
                  className="w-full text-left px-4 sm:px-5 py-4 hover:bg-emerald-50/40 transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 group-hover:text-[#009A4D]">
                        {sup.name}
                      </span>
                      {sup.legacy_balance_status === "historical_unverified" ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Legacy Historical Purchases Excluded
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Verified Ledger
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      {sup.phone && <span>Tel: {sup.phone}</span>}
                      <span>{sup.total_purchases_count} GRNs</span>
                      <span>Volume: {formatPKR(sup.total_purchases_amount)}</span>
                      {sup.last_purchase_at && (
                        <span>Last GRN: {formatDateTime(sup.last_purchase_at)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">
                        Verified Payable
                      </span>
                      <p
                        className={`text-sm font-extrabold tabular-nums ${
                          sup.verified_payable > 0 ? "text-amber-700" : "text-slate-900"
                        }`}
                      >
                        {formatPKR(sup.verified_payable)}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Purchase / GRN Detail Drawer */}
      {selectedPurchaseId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-[2px]">
          <div className="fixed inset-0" onClick={() => setSelectedPurchaseId(null)} />
          <div className="relative z-10 w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {purchaseDetail ? `Purchase GRN #${purchaseDetail.grn}` : "Purchase Details"}
                </h2>
                {purchaseDetail && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Supplier: {purchaseDetail.supplier_name} ·{" "}
                    {formatDateTime(purchaseDetail.occurred_at)}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedPurchaseId(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingPurchaseDetail && (
                <div className="space-y-3">
                  <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
                  <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
                </div>
              )}

              {purchaseDetail && !loadingPurchaseDetail && (
                <>
                  {purchaseDetail.payment_verification_status === "historical_unverified" && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
                      <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Historical Imported Purchase (Excluded from Payable)</p>
                        <p className="mt-0.5 text-amber-800">
                          This GRN was recovered from a legacy backup where supplier payment settlement
                          vouchers were not stored. It is preserved for procurement and cost history
                          without inflating your verified supplier payable balance.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] text-slate-500">Supplier</span>
                      <p className="text-sm font-bold text-slate-900 mt-0.5">
                        {purchaseDetail.supplier_name}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] text-slate-500">GRN Total</span>
                      <p className="text-sm font-extrabold text-emerald-700 mt-0.5 tabular-nums">
                        {formatPKR(purchaseDetail.purchase_total)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 col-span-2 sm:col-span-1">
                      <span className="text-[11px] text-slate-500">Payment Status</span>
                      <p className="text-xs font-bold uppercase text-slate-800 mt-1">
                        {purchaseDetail.payment_verification_status.replace("_", " ")}
                      </p>
                    </div>
                  </div>

                  {/* Product Lines */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Received Stock Lines ({purchaseDetail.lines?.length || 0})
                      </h3>
                    </div>

                    {purchaseDetail.lines && purchaseDetail.lines.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {purchaseDetail.lines.map((line: any) => (
                          <div
                            key={`${line.product_id}-${line.index}`}
                            className="p-3.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">
                                {line.name}
                              </p>
                              <div className="flex items-center gap-2.5 mt-1 text-xs text-slate-500 flex-wrap">
                                <span>
                                  Qty: {line.qty} {line.unit}
                                  {line.free_qty > 0 ? ` (+${line.free_qty} Bonus)` : ""}
                                </span>
                                <span>Cost: {formatPKR(line.cost)}</span>
                                {line.discount_pct > 0 && <span>Disc: {line.discount_pct}%</span>}
                                {line.batch_no && <span>Batch: {line.batch_no}</span>}
                                {line.expiry && <span>Exp: {line.expiry}</span>}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-slate-900 tabular-nums">
                                {formatPKR(line.line_total)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Summary GRN record (synced before line-item enrichment or older than 30-day
                        cloud detail retention window). Full GRN lines remain in your POS database.
                      </div>
                    )}
                  </div>

                  {/* Subtotal / Discount / Tax / Total */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-semibold tabular-nums">
                        {formatPKR(purchaseDetail.subtotal)}
                      </span>
                    </div>
                    {purchaseDetail.discount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount</span>
                        <span className="tabular-nums">- {formatPKR(purchaseDetail.discount)}</span>
                      </div>
                    )}
                    {purchaseDetail.tax_amount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Tax</span>
                        <span className="tabular-nums">+ {formatPKR(purchaseDetail.tax_amount)}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-extrabold text-slate-900">
                      <span>Total GRN Value</span>
                      <span className="tabular-nums">{formatPKR(purchaseDetail.purchase_total)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Supplier Detail Drawer */}
      {selectedSupplierId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-[2px]">
          <div className="fixed inset-0" onClick={() => setSelectedSupplierId(null)} />
          <div className="relative z-10 w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {supplierDetail?.supplier?.name || "Supplier Profile & Ledger"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified payable balance, GRN history, and supplier payments
                </p>
              </div>
              <button
                onClick={() => setSelectedSupplierId(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingSupplierDetail && (
                <div className="space-y-3">
                  <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
                  <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
                </div>
              )}

              {supplierDetail?.supplier && !loadingSupplierDetail && (
                <>
                  {/* Legacy Balance Review Banner */}
                  <div
                    className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                      supplierDetail.supplier.legacy_balance_status === "historical_unverified"
                        ? "bg-amber-50 border-amber-200 text-amber-900"
                        : "bg-emerald-50 border-emerald-200 text-emerald-900"
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">
                        {supplierDetail.supplier.legacy_balance_status === "historical_unverified"
                          ? `Legacy Balance Protection Active (${supplierDetail.supplier.unverified_historical_purchases_count} Historical GRNs Excluded)`
                          : "Verified Supplier Accounting Balance"}
                      </p>
                      <p className="mt-0.5 opacity-90">
                        {supplierDetail.supplier.legacy_balance_explanation}
                      </p>
                    </div>
                  </div>

                  {/* Balance Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500">
                        Verified Payable
                      </span>
                      <p className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                        {formatPKR(supplierDetail.supplier.verified_payable)}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500">
                        Total Purchase Volume
                      </span>
                      <p className="text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                        {formatPKR(supplierDetail.supplier.total_purchases_amount)}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 col-span-2 sm:col-span-1">
                      <span className="text-[11px] font-semibold text-slate-500">
                        Verified Payments Sent
                      </span>
                      <p className="text-lg font-extrabold text-emerald-700 mt-1 tabular-nums">
                        {formatPKR(supplierDetail.supplier.total_payments_amount)}
                      </p>
                    </div>
                  </div>

                  {/* Verified Supplier Payments */}
                  {supplierDetail.payments && supplierDetail.payments.length > 0 && (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Verified Payments to Supplier ({supplierDetail.payments.length})
                        </h3>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {supplierDetail.payments.map((pay: any) => (
                          <div
                            key={pay.id}
                            className="px-4 py-2.5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <span className="font-bold text-slate-900 uppercase">
                                {pay.method}
                              </span>
                              <span className="text-slate-500 ml-2">
                                {formatDateTime(pay.date)}
                              </span>
                              {pay.reference && (
                                <span className="text-slate-400 ml-2">Ref: {pay.reference}</span>
                              )}
                            </div>
                            <span className="font-bold text-emerald-700 tabular-nums">
                              {formatPKR(pay.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Linked GRNs */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Purchase GRNs ({supplierDetail.purchases?.length || 0})
                      </h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {(supplierDetail.purchases || []).map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedSupplierId(null);
                            setSelectedPurchaseId(p.id || p.grn);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900 font-mono">
                              GRN #{p.grn}
                            </span>
                            <span className="text-slate-500 ml-2">
                              {formatDateTime(p.occurred_at)}
                            </span>
                            {p.payment_verification_status === "historical_unverified" && (
                              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                Historical Imported
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 tabular-nums">
                              {formatPKR(p.purchase_total)}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalPurchasesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">
          Loading Purchases & Suppliers…
        </div>
      }
    >
      <PurchasesContent />
    </Suspense>
  );
}

