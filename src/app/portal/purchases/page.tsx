"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShoppingBag,
  Building2,
  Search,
  ChevronRight,
  X,
  FileText,
  Phone,
  ShieldCheck,
  AlertCircle,
  Info,
  Wallet,
  Calendar,
  Package,
  UserCheck,
  Receipt,
} from "lucide-react";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
  PortalSectionCard,
  PortalStatusBadge,
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

  // Selected drawer states
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(
    searchParams.get("id") || searchParams.get("grn") || null
  );
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

  const periodLabel =
    period === "today"
      ? "Today"
      : period === "7d"
      ? "7 Days"
      : period === "all"
      ? "All Time"
      : "30 Days";

  const renderPaymentBadge = (status: string) => {
    if (status === "historical_unverified") {
      return (
        <PortalStatusBadge tone="slate">
          Historical (Excluded)
        </PortalStatusBadge>
      );
    }
    if (status === "paid") {
      return (
        <PortalStatusBadge tone="emerald" dot>
          Paid
        </PortalStatusBadge>
      );
    }
    return (
      <PortalStatusBadge tone="amber" dot>
        Supplier Credit
      </PortalStatusBadge>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<ShoppingBag className="w-5 h-5" />}
        title="Purchases & Suppliers"
        subtitle="Inspect GRN stock receipts, supplier directories, verified payables, and legacy balance audits."
        actions={
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <div className="flex items-center bg-slate-100/90 border border-slate-200/80 rounded-xl p-1 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => setActiveTab("grns")}
                className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[34px] ${
                  activeTab === "grns"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-[#009A4D]" />
                <span>GRNs</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-extrabold tabular-nums">
                  {summary.purchases_count ?? 0}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("suppliers")}
                className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[34px] ${
                  activeTab === "suppliers"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-[#009A4D]" />
                <span>Suppliers</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-extrabold tabular-nums">
                  {summary.suppliers_count ?? suppliers.length}
                </span>
              </button>
            </div>

            <PortalRefreshButton
              loading={loading}
              onClick={() => void fetchPurchasesData(null)}
            />
          </div>
        }
      />

      {/* Executive KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PortalKpiCard
          label={`Purchases (${periodLabel})`}
          value={formatPKR(summary.purchases_amount ?? 0)}
          subtext={`${summary.purchases_count ?? 0} verified stock receipts`}
          icon={<ShoppingBag className="w-4 h-4" />}
          tone="emerald"
          active={activeTab === "grns"}
          onClick={() => setActiveTab("grns")}
        />
        <PortalKpiCard
          label="Verified Payables"
          value={formatPKR(summary.total_verified_payable ?? 0)}
          subtext="Protected from unverified legacy GRNs"
          icon={<Wallet className="w-4 h-4" />}
          tone={(summary.total_verified_payable ?? 0) > 0 ? "amber" : "default"}
          active={activeTab === "suppliers" && supplierStatusFilter === "payable"}
          onClick={() => {
            setActiveTab("suppliers");
            setSupplierStatusFilter("payable");
          }}
        />
        <PortalKpiCard
          label="Active Suppliers"
          value={String(summary.suppliers_count ?? suppliers.length)}
          subtext={
            (summary.unverified_suppliers_count ?? 0) > 0
              ? `${summary.unverified_suppliers_count} legacy historical excluded`
              : "All accounts audited"
          }
          icon={<Building2 className="w-4 h-4" />}
          tone="indigo"
          active={activeTab === "suppliers" && supplierStatusFilter === "all"}
          onClick={() => {
            setActiveTab("suppliers");
            setSupplierStatusFilter("all");
          }}
        />
      </div>

      {/* Filter & Search Bar */}
      <PortalSectionCard className="p-3.5 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                activeTab === "grns"
                  ? "Search by GRN #, supplier name, medicine, or phone…"
                  : "Search suppliers by name or phone number…"
              }
              className="w-full min-h-[42px] pl-10 pr-9 py-2 rounded-xl border border-slate-200/90 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {activeTab === "grns" ? (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0">
              {suppliers.length > 0 && (
                <select
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#009A4D] shrink-0 max-w-[190px]"
                >
                  <option value="all">All Suppliers</option>
                  {suppliers.map((sup) => (
                    <option key={sup.id || sup.name} value={sup.name}>
                      {sup.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-1.5 shrink-0">
                {[
                  { id: "today", label: "Today" },
                  { id: "7d", label: "7 Days" },
                  { id: "30d", label: "30 Days" },
                  { id: "all", label: "All Time" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriod(p.id)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      period === p.id
                        ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0">
              {[
                { id: "all", label: "All Suppliers" },
                { id: "payable", label: "With Verified Payable" },
                { id: "unverified", label: "Legacy Historical Review" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSupplierStatusFilter(f.id)}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    supplierStatusFilter === f.id
                      ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </PortalSectionCard>

      {/* TAB 1: GRN History */}
      {activeTab === "grns" && (
        <PortalSectionCard
          title="Goods Received Notes (GRNs)"
          subtitle="Tap any receipt to inspect item lines, bonus units, batches, and payment status"
          icon={<Receipt className="w-4 h-4" />}
          headerRight={
            supplierFilter !== "all" ? (
              <button
                type="button"
                onClick={() => setSupplierFilter("all")}
                className="text-[11px] font-bold text-[#009A4D] hover:underline flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Clear Supplier Filter
              </button>
            ) : undefined
          }
        >
          {loading ? (
            <div className="p-4 sm:p-5 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : purchases.length === 0 ? (
            <PortalEmptyState
              icon={<ShoppingBag className="w-6 h-6" />}
              title="No Purchase GRNs Found"
              description='Try switching the period filter to "All Time" or clearing your search.'
              action={
                (period !== "all" || searchInput || supplierFilter !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setPeriod("all");
                      setSearchInput("");
                      setSupplierFilter("all");
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                  >
                    Show All GRNs
                  </button>
                )
              }
            />
          ) : (
            <>
              {/* Mobile Structured GRN Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {purchases.map((pur) => (
                  <button
                    key={pur.event_id || pur.id}
                    type="button"
                    onClick={() => setSelectedPurchaseId(pur.id || pur.grn)}
                    className="w-full text-left p-4 active:bg-emerald-50/50 transition-colors space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-slate-900 font-mono bg-slate-100 px-2 py-0.5 rounded-md">
                            GRN #{pur.grn}
                          </span>
                          {renderPaymentBadge(pur.payment_verification_status)}
                        </div>
                        <p className="text-sm font-bold text-slate-900 truncate mt-1.5">
                          {pur.supplier_name}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                          {formatPKR(pur.purchase_total)}
                        </p>
                        {pur.discount > 0 && (
                          <p className="text-[10px] font-semibold text-emerald-700">
                            Disc: {formatPKR(pur.discount)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {formatDateTime(pur.occurred_at)}
                        </span>
                        {pur.lines_count > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                            <Package className="w-3 h-3 text-slate-400" />
                            {pur.lines_count} lines
                          </span>
                        )}
                        {pur.operator_name && (
                          <span className="inline-flex items-center gap-1 truncate">
                            <UserCheck className="w-3 h-3 text-slate-400" />
                            {pur.operator_name}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop Refined Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 pl-5 pr-3">GRN #</th>
                      <th className="py-3 px-3">Supplier</th>
                      <th className="py-3 px-3">Received Date</th>
                      <th className="py-3 px-3">Lines / Operator</th>
                      <th className="py-3 px-3">Verification</th>
                      <th className="py-3 pl-3 pr-5 text-right">GRN Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {purchases.map((pur) => (
                      <tr
                        key={pur.event_id || pur.id}
                        onClick={() => setSelectedPurchaseId(pur.id || pur.grn)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-5 pr-3 whitespace-nowrap">
                          <span className="font-extrabold font-mono text-slate-900 group-hover:text-[#009A4D]">
                            GRN #{pur.grn}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-bold text-slate-800 max-w-[220px] truncate">
                          {pur.supplier_name}
                        </td>
                        <td className="py-3.5 px-3 text-slate-500 whitespace-nowrap">
                          {formatDateTime(pur.occurred_at)}
                        </td>
                        <td className="py-3.5 px-3 text-slate-600">
                          <span>{pur.lines_count > 0 ? `${pur.lines_count} lines` : "—"}</span>
                          {pur.operator_name && (
                            <span className="text-slate-400"> · {pur.operator_name}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {renderPaymentBadge(pur.payment_verification_status)}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <div>
                              <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                                {formatPKR(pur.purchase_total)}
                              </p>
                              {pur.discount > 0 && (
                                <p className="text-[10px] font-semibold text-emerald-700">
                                  Disc: {formatPKR(pur.discount)}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMore && nextCursor && (
                <div className="p-4 border-t border-slate-100 text-center bg-slate-50/40">
                  <button
                    type="button"
                    onClick={() => void fetchPurchasesData(nextCursor)}
                    disabled={loadingMore}
                    className="min-h-[40px] px-5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-xs font-bold text-slate-700 disabled:opacity-50 shadow-2xs transition-all"
                  >
                    {loadingMore ? "Loading More GRNs…" : "Load More Purchases"}
                  </button>
                </div>
              )}
            </>
          )}
        </PortalSectionCard>
      )}

      {/* TAB 2: Suppliers Directory & Verified Balances */}
      {activeTab === "suppliers" && (
        <PortalSectionCard
          title="Supplier Directory & Payables"
          subtitle="Tap any supplier to review verified payments, historical audit status, and linked GRNs"
          icon={<Building2 className="w-4 h-4" />}
        >
          {loading ? (
            <div className="p-4 sm:p-5 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : suppliers.length === 0 ? (
            <PortalEmptyState
              icon={<Building2 className="w-6 h-6" />}
              title="No Suppliers Found"
              description="Try clearing your search or status filter."
              action={
                (supplierStatusFilter !== "all" || searchInput) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSupplierStatusFilter("all");
                      setSearchInput("");
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                  >
                    Reset Filters
                  </button>
                )
              }
            />
          ) : (
            <>
              {/* Mobile Supplier Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {suppliers.map((sup) => (
                  <button
                    key={sup.id}
                    type="button"
                    onClick={() => setSelectedSupplierId(sup.id)}
                    className="w-full text-left p-4 active:bg-emerald-50/50 transition-colors space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-extrabold text-slate-900 truncate">
                          {sup.name}
                        </p>
                        {sup.legacy_balance_status === "historical_unverified" ? (
                          <PortalStatusBadge tone="amber">
                            <AlertCircle className="w-3 h-3" />
                            Legacy Historical Guard
                          </PortalStatusBadge>
                        ) : (
                          <PortalStatusBadge tone="emerald">
                            <ShieldCheck className="w-3 h-3" />
                            Verified Ledger
                          </PortalStatusBadge>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Payable
                        </span>
                        <p
                          className={`text-sm font-extrabold tabular-nums ${
                            sup.verified_payable > 0 ? "text-amber-700" : "text-slate-900"
                          }`}
                        >
                          {formatPKR(sup.verified_payable)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {sup.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {sup.phone}
                          </span>
                        )}
                        <span className="font-semibold text-slate-700">
                          {sup.total_purchases_count} GRNs
                        </span>
                        <span>Vol: {formatPKR(sup.total_purchases_amount)}</span>
                        {sup.last_purchase_at && (
                          <span>Last: {formatDateTime(sup.last_purchase_at)}</span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop Supplier Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 pl-5 pr-3">Supplier</th>
                      <th className="py-3 px-3">Audit Status</th>
                      <th className="py-3 px-3">GRNs &amp; Volume</th>
                      <th className="py-3 px-3">Last GRN</th>
                      <th className="py-3 pl-3 pr-5 text-right">Verified Payable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {suppliers.map((sup) => (
                      <tr
                        key={sup.id}
                        onClick={() => setSelectedSupplierId(sup.id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <p className="text-sm font-bold text-slate-900 group-hover:text-[#009A4D]">
                            {sup.name}
                          </p>
                          {sup.phone && (
                            <p className="text-[11px] text-slate-400 mt-0.5">Tel: {sup.phone}</p>
                          )}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {sup.legacy_balance_status === "historical_unverified" ? (
                            <PortalStatusBadge tone="amber">
                              <AlertCircle className="w-3 h-3" />
                              Legacy Balance Excluded
                            </PortalStatusBadge>
                          ) : (
                            <PortalStatusBadge tone="emerald">
                              <ShieldCheck className="w-3 h-3" />
                              Verified Ledger
                            </PortalStatusBadge>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-slate-600">
                          <span className="font-bold text-slate-800">{sup.total_purchases_count} GRNs</span>
                          <span className="text-slate-400">
                            {" "}
                            · {formatPKR(sup.total_purchases_amount)}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-slate-500 whitespace-nowrap">
                          {sup.last_purchase_at ? formatDateTime(sup.last_purchase_at) : "—"}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span
                              className={`text-sm font-extrabold tabular-nums ${
                                sup.verified_payable > 0 ? "text-amber-700" : "text-slate-900"
                              }`}
                            >
                              {formatPKR(sup.verified_payable)}
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </PortalSectionCard>
      )}

      {/* Drawer 1: GRN / Purchase Detail */}
      <PortalSlideOver
        open={Boolean(selectedPurchaseId)}
        onClose={() => setSelectedPurchaseId(null)}
        eyebrow="Stock Receipt Voucher"
        title={purchaseDetail ? `Purchase GRN #${purchaseDetail.grn}` : "Purchase Details"}
        subtitle={
          purchaseDetail
            ? `${purchaseDetail.supplier_name} · ${formatDateTime(purchaseDetail.occurred_at)}`
            : "Loading stock receipt…"
        }
      >
        {loadingPurchaseDetail && (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        )}

        {purchaseDetail && !loadingPurchaseDetail && (
          <div className="space-y-4">
            {purchaseDetail.payment_verification_status === "historical_unverified" && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200/90 text-xs text-amber-900 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Historical Imported Purchase (Excluded from Payable)</p>
                  <p className="mt-1 text-amber-800 leading-relaxed">
                    This GRN was recovered from a legacy backup where supplier payment settlement
                    vouchers were not stored. It is preserved for procurement and cost history without
                    inflating your verified supplier payable balance.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Supplier
                </span>
                <p className="text-sm font-bold text-slate-900 mt-1 truncate">
                  {purchaseDetail.supplier_name}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  GRN Total
                </span>
                <p className="text-base font-extrabold text-emerald-800 mt-0.5 tabular-nums">
                  {formatPKR(purchaseDetail.purchase_total)}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 col-span-2 sm:col-span-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Payment Status
                </span>
                <div className="mt-1.5">
                  {renderPaymentBadge(purchaseDetail.payment_verification_status)}
                </div>
              </div>
            </div>

            {/* Product Lines */}
            <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-white">
              <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Received Stock Lines ({purchaseDetail.lines?.length || 0})
                </h3>
              </div>

              {purchaseDetail.lines && purchaseDetail.lines.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {purchaseDetail.lines.map((line: any) => (
                    <div
                      key={`${line.product_id}-${line.index}`}
                      className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50/60"
                    >
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-slate-900">{line.name}</p>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">
                            Qty: {line.qty} {line.unit}
                            {line.free_qty > 0 ? ` (+${line.free_qty} Bonus)` : ""}
                          </span>
                          <span>Cost: {formatPKR(line.cost)}</span>
                          {line.discount_pct > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              Disc: {line.discount_pct}%
                            </span>
                          )}
                          {line.batch_no && (
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-700">
                              Batch: {line.batch_no}
                            </span>
                          )}
                          {line.expiry && <span>Exp: {line.expiry}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs sm:text-sm font-extrabold text-slate-900 tabular-nums">
                          {formatPKR(line.line_total)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-6 text-xs text-slate-400 text-center">
                  Itemized stock lines not included in this summary event.
                </p>
              )}
            </div>

            {/* Totals Breakdown */}
            <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-bold tabular-nums">{formatPKR(purchaseDetail.subtotal)}</span>
              </div>
              {purchaseDetail.discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Purchase Discount</span>
                  <span className="font-bold tabular-nums">
                    - {formatPKR(purchaseDetail.discount)}
                  </span>
                </div>
              )}
              {purchaseDetail.tax_amount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span className="font-bold tabular-nums">
                    + {formatPKR(purchaseDetail.tax_amount)}
                  </span>
                </div>
              )}
              <div className="pt-2.5 border-t border-slate-200 flex justify-between text-sm font-extrabold text-slate-900">
                <span>GRN Net Total</span>
                <span className="tabular-nums text-emerald-700">
                  {formatPKR(purchaseDetail.purchase_total)}
                </span>
              </div>
            </div>
          </div>
        )}
      </PortalSlideOver>

      {/* Drawer 2: Supplier Profile & Ledger */}
      <PortalSlideOver
        open={Boolean(selectedSupplierId)}
        onClose={() => setSelectedSupplierId(null)}
        eyebrow="Supplier Ledger & Audit"
        title={supplierDetail?.supplier?.name || "Supplier Profile & Ledger"}
        subtitle={
          supplierDetail?.supplier?.phone
            ? `Phone: ${supplierDetail.supplier.phone}`
            : "Account & verified settlement summary"
        }
      >
        {loadingSupplierDetail && (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        )}

        {supplierDetail?.supplier && !loadingSupplierDetail && (
          <div className="space-y-4">
            {/* Balance Protection Notice */}
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
                supplierDetail.supplier.legacy_balance_status === "historical_unverified"
                  ? "bg-amber-50 border-amber-200/90 text-amber-900"
                  : "bg-emerald-50 border-emerald-200/90 text-emerald-900"
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  {supplierDetail.supplier.legacy_balance_status === "historical_unverified"
                    ? `Legacy Balance Protection Active (${supplierDetail.supplier.unverified_historical_purchases_count} Historical GRNs Excluded)`
                    : "Verified Supplier Payable Ledger"}
                </p>
                <p className="mt-1 opacity-90 leading-relaxed">
                  {supplierDetail.supplier.legacy_balance_explanation}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Verified Payable
                </span>
                <p className="text-base font-extrabold text-amber-800 mt-0.5 tabular-nums">
                  {formatPKR(supplierDetail.supplier.verified_payable)}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Total Purchased
                </span>
                <p className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums">
                  {formatPKR(supplierDetail.supplier.total_purchases_amount)}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Verified Paid
                </span>
                <p className="text-base font-extrabold text-emerald-700 mt-0.5 tabular-nums">
                  {formatPKR(supplierDetail.supplier.total_payments_amount)}
                </p>
              </div>
            </div>

            {/* Verified Payments */}
            {supplierDetail.payments && supplierDetail.payments.length > 0 && (
              <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-white">
                <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                    Verified Payments to Supplier ({supplierDetail.payments.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {supplierDetail.payments.map((pay: any) => (
                    <div key={pay.id} className="px-4 py-3 flex items-center justify-between text-xs">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-800 capitalize">{pay.method}</span>
                        <span className="text-slate-400 ml-2">{formatDateTime(pay.date)}</span>
                        {pay.reference && (
                          <span className="text-slate-400 ml-2">Ref: {pay.reference}</span>
                        )}
                      </div>
                      <span className="font-extrabold text-emerald-700 tabular-nums shrink-0">
                        {formatPKR(pay.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Supplier Purchases */}
            <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-white">
              <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Purchase GRNs ({supplierDetail.purchases?.length || 0})
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(supplierDetail.purchases || []).map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedSupplierId(null);
                      setSelectedPurchaseId(p.id || p.grn);
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-emerald-50/40 flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <div className="min-w-0 flex items-center flex-wrap gap-2">
                      <span className="font-extrabold text-slate-900 font-mono">GRN #{p.grn}</span>
                      <span className="text-slate-500">{formatDateTime(p.occurred_at)}</span>
                      {p.payment_verification_status === "historical_unverified" && (
                        <PortalStatusBadge tone="slate">Historical Excluded</PortalStatusBadge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-extrabold text-slate-900 tabular-nums">
                        {formatPKR(p.purchase_total)}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </PortalSlideOver>
    </div>
  );
}

export default function PortalPurchasesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          Loading Purchases &amp; Suppliers…
        </div>
      }
    >
      <PurchasesContent />
    </Suspense>
  );
}
