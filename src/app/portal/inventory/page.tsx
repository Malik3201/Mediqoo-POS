"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PackageSearch,
  Search,
  AlertTriangle,
  BookmarkPlus,
  BookmarkCheck,
  TrendingUp,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Receipt,
  Info,
  X,
  SlidersHorizontal,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
  PortalSectionCard,
  PortalStatusBadge,
  PortalSlideOver,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

function formatPKR(n: number | undefined | null): string {
  const val = Number(n || 0);
  return `Rs ${Math.round(val).toLocaleString("en-PK")}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
}

const FILTER_TABS = [
  { id: "all", label: "All Tracked" },
  { id: "low_stock", label: "Low Stock" },
  { id: "out_of_stock", label: "Out of Stock" },
  { id: "expiring_soon", label: "Expiring (60d)" },
  { id: "unverified_expiry", label: "Expiry Needs Review" },
  { id: "slow_moving", label: "Slow Moving" },
  { id: "dead_stock", label: "Dead Stock" },
  { id: "overstock", label: "Overstock" },
  { id: "negative_margin", label: "Negative Margin" },
  { id: "price_increased", label: "Cost Increased" },
  { id: "watchlist", label: "Reorder Watchlist" },
];

function movementBadge(status?: string): {
  label: string;
  tone: "emerald" | "amber" | "rose" | "slate";
} {
  switch (status) {
    case "fast_moving":
      return { label: "Fast Moving", tone: "emerald" };
    case "slow_moving":
      return { label: "Slow Moving", tone: "amber" };
    case "dead_stock":
      return { label: "Dead Stock (90d)", tone: "rose" };
    case "out_of_stock":
      return { label: "Out of Stock", tone: "rose" };
    default:
      return { label: "Active", tone: "slate" };
  }
}

function InventoryPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialFilter = searchParams.get("filter") || "all";
  const initialProduct = searchParams.get("product") || null;

  const [filter, setFilter] = useState(initialFilter);
  const [category, setCategory] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Product Detail Drawer state
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    initialProduct
  );
  const [productDetail, setProductDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Watchlist form inside drawer
  const [targetOrderQty, setTargetOrderQty] = useState<number>(12);
  const [watchNote, setWatchNote] = useState<string>("");
  const [watchSaving, setWatchSaving] = useState(false);

  // Invoice detail drawer for clicking sales history
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(searchInput);
      setPage(1);
    }, 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        filter,
        category,
        page: String(page),
        limit: "25",
      });
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await fetch(`/api/portal/inventory?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load inventory intelligence");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Error loading inventory");
    } finally {
      setLoading(false);
    }
  }, [filter, category, page, debouncedQ]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const loadProductDetail = useCallback(async (pid: string) => {
    setDetailLoading(true);
    setProductDetail(null);
    try {
      const res = await fetch(
        `/api/portal/inventory?product_id=${encodeURIComponent(pid)}`
      );
      if (res.ok) {
        const json = await res.json();
        setProductDetail(json);
        if (json.product?.watchlist_item) {
          setTargetOrderQty(json.product.watchlist_item.target_order_qty || 12);
          setWatchNote(json.product.watchlist_item.note || "");
        } else {
          setTargetOrderQty(
            Math.max(10, (json.product?.reorder_level || 10) * 2)
          );
          setWatchNote("");
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      void loadProductDetail(selectedProductId);
    }
  }, [selectedProductId, loadProductDetail]);

  const toggleWatchlist = async (prod: any, remove = false) => {
    setWatchSaving(true);
    try {
      const res = await fetch("/api/portal/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: remove ? "remove_watchlist" : "add_watchlist",
          product_id: prod.product_id,
          code: prod.code,
          name: prod.name,
          category: prod.category,
          supplier_name: prod.last_supplier_name || prod.manufacturer,
          current_stock: prod.current_stock,
          reorder_level: prod.reorder_level,
          target_order_qty: targetOrderQty,
          last_cost: prod.last_purchase_cost || prod.cost_wac,
          note: watchNote,
        }),
      });
      if (res.ok) {
        await loadInventory();
        if (selectedProductId === prod.product_id) {
          await loadProductDetail(prod.product_id);
        }
      }
    } finally {
      setWatchSaving(false);
    }
  };

  const selectFilterTab = (tabId: string) => {
    setFilter(tabId);
    setPage(1);
    router.replace(tabId === "all" ? "/portal/inventory" : `/portal/inventory?filter=${tabId}`, {
      scroll: false,
    });
  };

  const summary = data?.summary || {};
  const items: any[] = data?.items || [];
  const priceChanges: any[] = data?.supplier_price_changes || [];

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<PackageSearch className="w-5 h-5" />}
        title="Inventory Intelligence & Insights"
        subtitle="Stock valuation, verified WAC margins, movement velocity, supplier cost spikes & reorder watchlist."
        actions={
          <PortalRefreshButton loading={loading} onClick={() => void loadInventory()} />
        }
      />

      {/* Data Coverage Banner */}
      {data?.data_coverage?.coverage_notice && (
        <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/80 px-4 py-3 text-xs text-emerald-900 flex items-start sm:items-center justify-between gap-2 flex-col sm:flex-row">
          <div className="flex items-start sm:items-center gap-2">
            <Info className="w-4 h-4 text-[#009A4D] shrink-0 mt-0.5 sm:mt-0" />
            <span className="leading-relaxed">{data.data_coverage.coverage_notice}</span>
          </div>
          {data.data_coverage.last_synced_at && (
            <span className="text-[11px] font-bold text-emerald-700 shrink-0 bg-white/80 px-2.5 py-1 rounded-lg border border-emerald-200/60">
              Snapshot: {formatDate(data.data_coverage.last_synced_at)}
            </span>
          )}
        </div>
      )}

      {/* Clickable KPI Intelligence Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        <PortalKpiCard
          label="Stock Value"
          value={formatPKR(summary.stock_value)}
          subtext={`${summary.total_tracked_skus || 0} tracked SKUs`}
          icon={<Layers className="w-4 h-4" />}
          tone="emerald"
          active={filter === "all"}
          onClick={() => selectFilterTab("all")}
        />
        <PortalKpiCard
          label="Low & Out Stock"
          value={String((summary.low_stock_count || 0) + (summary.out_of_stock_count || 0))}
          subtext={`${summary.out_of_stock_count || 0} zero stock`}
          icon={<AlertTriangle className="w-4 h-4" />}
          tone="amber"
          active={filter === "low_stock" || filter === "out_of_stock"}
          onClick={() => selectFilterTab("low_stock")}
        />
        <PortalKpiCard
          label="Expiring (60d)"
          value={String(summary.expiring_soon_count || 0)}
          subtext={`${summary.unverified_expiry_count || 0} need review`}
          icon={<Clock className="w-4 h-4" />}
          tone="rose"
          active={filter === "expiring_soon" || filter === "unverified_expiry"}
          onClick={() => selectFilterTab("expiring_soon")}
        />
        <PortalKpiCard
          label="Slow / Dead"
          value={String((summary.slow_moving_count || 0) + (summary.dead_stock_count || 0))}
          subtext={`${summary.dead_stock_count || 0} zero 90d sales`}
          icon={<SlidersHorizontal className="w-4 h-4" />}
          tone="default"
          active={filter === "slow_moving" || filter === "dead_stock"}
          onClick={() => selectFilterTab("slow_moving")}
        />
        <PortalKpiCard
          label="Cost Spikes"
          value={String(summary.price_increased_count || 0)}
          subtext={`${summary.negative_margin_count || 0} neg. margin`}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="indigo"
          active={filter === "price_increased" || filter === "negative_margin"}
          onClick={() => selectFilterTab("price_increased")}
        />
        <PortalKpiCard
          label="Watchlist"
          value={String(summary.watchlist_count || 0)}
          subtext="Owner planned reorders"
          icon={<BookmarkCheck className="w-4 h-4" />}
          tone="sky"
          active={filter === "watchlist"}
          onClick={() => selectFilterTab("watchlist")}
        />
      </div>

      {/* Search + Category + Filter Pills */}
      <PortalSectionCard className="p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search medicine name, barcode, generic formula, or manufacturer…"
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

          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200/90 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:border-[#009A4D] sm:max-w-[220px]"
          >
            <option value="all">All Categories</option>
            {(data?.categories || []).map((c: string) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Swipeable Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectFilterTab(t.id)}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                filter === t.id
                  ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PortalSectionCard>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Inventory Items List */}
      <PortalSectionCard
        title="Tracked Inventory Catalog"
        subtitle="Tap any product to compare supplier prices, inspect purchase batches, and manage reorder watchlists"
        icon={<PackageSearch className="w-4 h-4" />}
        headerRight={
          data?.pagination ? (
            <span className="text-[11px] font-bold text-slate-400">
              {data.pagination.total} items
            </span>
          ) : undefined
        }
      >
        {loading ? (
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <PortalEmptyState
            icon={<PackageSearch className="w-6 h-6" />}
            title="No Products Match Current Filter"
            description="Try clearing your search query or switching to All Tracked SKUs."
            action={
              (filter !== "all" || category !== "all" || searchInput) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setCategory("all");
                    selectFilterTab("all");
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                >
                  Reset Inventory Filters
                </button>
              )
            }
          />
        ) : (
          <>
            {/* Mobile Structured Inventory Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {items.map((p) => {
                const mv = movementBadge(p.movement_status);
                const isLow =
                  p.current_stock <= 0 ||
                  (p.reorder_level > 0 && p.current_stock <= p.reorder_level);

                return (
                  <div
                    key={p.product_id}
                    onClick={() => setSelectedProductId(p.product_id)}
                    className="p-4 active:bg-emerald-50/40 cursor-pointer space-y-3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 leading-snug">
                          {p.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                          {p.code && (
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-700">
                              {p.code}
                            </span>
                          )}
                          {p.generic_name && <span className="truncate">{p.generic_name}</span>}
                        </div>
                        {(p.category || p.manufacturer) && (
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {[p.category, p.manufacturer].filter(Boolean).join(" • ")}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-extrabold tabular-nums ${
                            p.current_stock <= 0
                              ? "bg-rose-100 text-rose-800"
                              : isLow
                              ? "bg-amber-100 text-amber-900"
                              : "bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          Stock: {p.current_stock}
                        </span>
                        {p.reorder_level > 0 && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Min: {p.reorder_level}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50/90 border border-slate-100 p-2.5 text-[11px]">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Sale / WAC
                        </span>
                        <span className="font-extrabold text-slate-900 tabular-nums">
                          {formatPKR(p.sale_price)}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          WAC {formatPKR(p.cost_wac)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Margin &amp; Val
                        </span>
                        <span
                          className={`font-extrabold tabular-nums ${
                            p.is_negative_margin
                              ? "text-rose-700"
                              : p.margin_pct > 0 && p.margin_pct < 8
                              ? "text-amber-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {p.margin_pct ? `${p.margin_pct}%` : "—"}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {formatPKR(p.stock_value)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          30d / 90d Sold
                        </span>
                        <span className="font-extrabold text-slate-900 tabular-nums">
                          {p.sold_qty_30d || 0} u
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          90d: {p.sold_qty_90d ?? p.sold_qty_30d ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <PortalStatusBadge tone={mv.tone}>{mv.label}</PortalStatusBadge>
                        {p.has_unverified_expiry ? (
                          <PortalStatusBadge tone="amber">Expiry Review</PortalStatusBadge>
                        ) : (
                          p.nearest_expiry &&
                          p.days_to_expiry !== null &&
                          p.days_to_expiry <= 60 && (
                            <PortalStatusBadge tone={p.days_to_expiry <= 30 ? "rose" : "amber"}>
                              Exp {p.days_to_expiry}d
                            </PortalStatusBadge>
                          )
                        )}
                        {Number(p.cost_change_pct || 0) >= 3 && (
                          <PortalStatusBadge tone="rose">
                            Cost +{p.cost_change_pct}%
                          </PortalStatusBadge>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleWatchlist(p, Boolean(p.in_watchlist));
                        }}
                        className={`inline-flex items-center gap-1 min-h-[34px] px-3 py-1 rounded-xl text-[11px] font-bold border transition-colors ${
                          p.in_watchlist
                            ? "bg-emerald-50 text-[#009A4D] border-emerald-300"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {p.in_watchlist ? (
                          <>
                            <BookmarkCheck className="w-3.5 h-3.5" />
                            Watching
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="w-3.5 h-3.5" />
                            Watch
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Full Intelligence Table */}
            <div className="hidden md:block overflow-x-auto portal-scroll">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 pl-5 pr-3">Medicine &amp; Formula</th>
                    <th className="py-3 px-3">Stock / Min</th>
                    <th className="py-3 px-3">Sale / WAC &amp; Margin</th>
                    <th className="py-3 px-3">Velocity &amp; 30d Sales</th>
                    <th className="py-3 px-3">Expiry &amp; Alerts</th>
                    <th className="py-3 pl-3 pr-5 text-right">Watchlist</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p) => {
                    const mv = movementBadge(p.movement_status);
                    const isLow =
                      p.current_stock <= 0 ||
                      (p.reorder_level > 0 && p.current_stock <= p.reorder_level);

                    return (
                      <tr
                        key={p.product_id}
                        onClick={() => setSelectedProductId(p.product_id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-5 pr-3 max-w-[260px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 group-hover:text-[#009A4D]">
                              {p.name}
                            </span>
                            {p.code && (
                              <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                                {p.code}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {[p.generic_name, p.category, p.manufacturer]
                              .filter(Boolean)
                              .join(" • ") || "General Inventory"}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-lg font-extrabold tabular-nums ${
                              p.current_stock <= 0
                                ? "bg-rose-100 text-rose-800"
                                : isLow
                                ? "bg-amber-100 text-amber-900"
                                : "bg-emerald-50 text-emerald-800"
                            }`}
                          >
                            {p.current_stock} / {p.reorder_level || 0}
                          </span>
                          <p className="text-[10px] text-slate-400 mt-1">
                            Val: {formatPKR(p.stock_value)}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <p className="font-bold text-slate-900 tabular-nums">
                            {formatPKR(p.sale_price)}{" "}
                            <span className="text-slate-400 font-normal">
                              / {formatPKR(p.cost_wac)}
                            </span>
                          </p>
                          <p
                            className={`text-[11px] font-bold mt-0.5 ${
                              p.is_negative_margin
                                ? "text-rose-700"
                                : p.margin_pct > 0 && p.margin_pct < 8
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            Margin: {p.margin_pct ? `${p.margin_pct}%` : "—"}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <PortalStatusBadge tone={mv.tone}>{mv.label}</PortalStatusBadge>
                          <p className="text-[11px] text-slate-600 mt-1 tabular-nums">
                            30d: {p.sold_qty_30d || 0} ({formatPKR(p.sold_revenue_30d)})
                          </p>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {p.has_unverified_expiry ? (
                              <PortalStatusBadge tone="amber">
                                Unverified Expiry
                              </PortalStatusBadge>
                            ) : p.nearest_expiry && p.days_to_expiry !== null ? (
                              <PortalStatusBadge
                                tone={
                                  p.days_to_expiry <= 30
                                    ? "rose"
                                    : p.days_to_expiry <= 60
                                    ? "amber"
                                    : "slate"
                                }
                              >
                                {p.nearest_expiry} ({p.days_to_expiry}d)
                              </PortalStatusBadge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            {Number(p.cost_change_pct || 0) >= 3 && (
                              <PortalStatusBadge tone="rose">
                                Cost +{p.cost_change_pct}%
                              </PortalStatusBadge>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleWatchlist(p, Boolean(p.in_watchlist));
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                              p.in_watchlist
                                ? "bg-emerald-50 text-[#009A4D] border-emerald-300"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {p.in_watchlist ? (
                              <>
                                <BookmarkCheck className="w-3.5 h-3.5" />
                                Watching
                              </>
                            ) : (
                              <>
                                <BookmarkPlus className="w-3.5 h-3.5" />
                                + Watch
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {data?.pagination && data.pagination.total_pages > 1 && (
              <div className="px-4 sm:px-5 py-3.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-500 font-medium">
                  Page <strong className="text-slate-800">{data.pagination.page}</strong> of{" "}
                  <strong className="text-slate-800">{data.pagination.total_pages}</strong> (
                  {data.pagination.total} items)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= data.pagination.total_pages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </PortalSectionCard>

      {/* Supplier Cost Increase Watchlist Section */}
      {priceChanges.length > 0 && (
        <PortalSectionCard
          title="Recent Verified Supplier Cost Increases"
          subtitle="Unit-normalized GRN cost comparisons highlighting recent supplier rate hikes"
          icon={<TrendingUp className="w-4 h-4 text-rose-600" />}
          headerRight={
            <PortalStatusBadge tone="rose">
              {priceChanges.length} detected
            </PortalStatusBadge>
          }
        >
          <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {priceChanges.slice(0, 6).map((sc: any) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setSelectedProductId(sc.product_id)}
                className="text-left p-3.5 rounded-2xl border border-slate-200/90 hover:border-rose-300 bg-slate-50/60 hover:bg-rose-50/30 transition-all space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-900 truncate">
                    {sc.product_name}
                  </span>
                  <PortalStatusBadge tone="rose">+{sc.change_pct}%</PortalStatusBadge>
                </div>
                <p className="text-xs text-slate-600">
                  {formatPKR(sc.old_cost)} →{" "}
                  <strong className="text-rose-700 tabular-nums">
                    {formatPKR(sc.new_cost)}
                  </strong>{" "}
                  <span className="text-[11px] text-slate-400">per {sc.unit_type || "Unit"}</span>
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {sc.supplier_name} • {sc.grn_number} • {formatDate(sc.date)}
                </p>
              </button>
            ))}
          </div>
        </PortalSectionCard>
      )}

      {/* Product Intelligence Slide-over Drawer */}
      <PortalSlideOver
        open={Boolean(selectedProductId)}
        onClose={() => setSelectedProductId(null)}
        maxWidthClass="max-w-2xl"
        darkHeader
        eyebrow="Product Intelligence & Supplier Comparison"
        title={productDetail?.product?.name || selectedProductId || "Product Details"}
        subtitle={
          productDetail?.product
            ? [
                productDetail.product.code && `SKU: ${productDetail.product.code}`,
                productDetail.product.generic_name,
                productDetail.product.category,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Loading cloud snapshot…"
        }
      >
        {detailLoading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="h-44 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        ) : !productDetail?.product ? (
          <PortalEmptyState
            icon={<PackageSearch className="w-6 h-6" />}
            title="Product Details Unavailable"
            description="Product details were not found in the recent cloud snapshot."
          />
        ) : (
          <div className="space-y-4">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Current Stock
                </span>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {productDetail.product.current_stock}{" "}
                  <span className="text-[11px] font-normal text-slate-500">
                    (Min {productDetail.product.reorder_level || 0})
                  </span>
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase text-emerald-700">
                  Sale / WAC
                </span>
                <p className="text-xs sm:text-sm font-extrabold text-emerald-900 mt-1 tabular-nums">
                  {formatPKR(productDetail.product.sale_price)} /{" "}
                  {formatPKR(productDetail.product.cost_wac)}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Stock Value
                </span>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(productDetail.product.stock_value)}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Sold 30d / 90d
                </span>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {productDetail.product.sold_qty_30d || 0} /{" "}
                  {productDetail.product.sold_qty_90d ??
                    productDetail.product.sold_qty_30d ??
                    0}
                </p>
              </div>
            </div>

            {/* Metadata Attributes */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200/80 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Generic Formula
                </span>
                <span className="font-semibold text-slate-800">
                  {productDetail.product.generic_name || "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Category
                </span>
                <span className="font-semibold text-slate-800">
                  {productDetail.product.category || "General"}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Manufacturer
                </span>
                <span className="font-semibold text-slate-800">
                  {productDetail.product.manufacturer || "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Nearest Expiry
                </span>
                <span className="font-semibold text-slate-800">
                  {productDetail.product.has_unverified_expiry
                    ? "Needs Verification"
                    : productDetail.product.nearest_expiry || "—"}
                </span>
              </div>
            </div>

            {/* Owner Reorder Watchlist Action Box */}
            <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                  <BookmarkCheck className="w-4 h-4 text-[#009A4D]" />
                  Owner Reorder Watchlist (Cloud Planning Note)
                </span>
                {productDetail.product.in_watchlist && (
                  <PortalStatusBadge tone="emerald">Active on Watchlist</PortalStatusBadge>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Target Order Qty
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={targetOrderQty}
                    onChange={(e) => setTargetOrderQty(Number(e.target.value) || 1)}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Owner Purchasing Note
                  </label>
                  <input
                    type="text"
                    value={watchNote}
                    onChange={(e) => setWatchNote(e.target.value)}
                    placeholder="e.g., Check bonus scheme with distributor…"
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={watchSaving}
                  onClick={() => void toggleWatchlist(productDetail.product, false)}
                  className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {productDetail.product.in_watchlist
                    ? "Update Watchlist Item"
                    : "Add to Reorder Watchlist"}
                </button>
                {productDetail.product.in_watchlist && (
                  <button
                    type="button"
                    disabled={watchSaving}
                    onClick={() => void toggleWatchlist(productDetail.product, true)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-100"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Supplier Cost Comparison */}
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Supplier Cost Comparison (Unit-Normalized)
              </h4>
              {productDetail.supplier_comparisons?.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  No recent purchase deliveries in the 35-day cloud detail window.
                </p>
              ) : (
                <>
                  {/* Mobile comparison cards */}
                  <div className="sm:hidden space-y-2">
                    {productDetail.supplier_comparisons.map((sc: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-slate-200 bg-white text-xs flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{sc.supplier_name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {sc.unit_type} · {sc.deliveries_count} del ({sc.total_qty} units)
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-extrabold text-[#009A4D] tabular-nums">
                            {formatPKR(sc.latest_cost)}
                          </p>
                          <p className="text-[10px] text-slate-400 tabular-nums">
                            {formatPKR(sc.min_cost)} – {formatPKR(sc.max_cost)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop comparison table */}
                  <div className="hidden sm:block border border-slate-200 rounded-2xl overflow-hidden bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="py-2.5 px-3 text-left">Supplier</th>
                          <th className="py-2.5 px-3 text-left">Unit</th>
                          <th className="py-2.5 px-3 text-right">Latest Cost</th>
                          <th className="py-2.5 px-3 text-right">Min / Max</th>
                          <th className="py-2.5 px-3 text-right">Deliveries</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {productDetail.supplier_comparisons.map((sc: any, idx: number) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {sc.supplier_name}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">{sc.unit_type}</td>
                            <td className="py-2.5 px-3 text-right font-extrabold text-[#009A4D] tabular-nums">
                              {formatPKR(sc.latest_cost)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                              {formatPKR(sc.min_cost)} – {formatPKR(sc.max_cost)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sc.deliveries_count} ({sc.total_qty} u)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Recent Purchase History */}
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-[#009A4D]" />
                Recent Purchase History (GRNs)
              </h4>
              {productDetail.purchase_history?.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  No recent purchase line items found in the 35-day detail window.
                </p>
              ) : (
                <div className="space-y-2">
                  {productDetail.purchase_history.map((ph: any, idx: number) => (
                    <Link
                      key={idx}
                      href={`/portal/purchases?grn=${encodeURIComponent(ph.purchase_id)}`}
                      className="block p-3.5 rounded-2xl border border-slate-200 hover:border-emerald-300 bg-slate-50/50 hover:bg-emerald-50/30 text-xs transition-colors"
                    >
                      <div className="flex justify-between gap-2 font-bold text-slate-900">
                        <span className="truncate">
                          {ph.grn_number} • {ph.supplier_name}
                        </span>
                        <span className="shrink-0 tabular-nums text-[#009A4D]">
                          {formatPKR(ph.cost_price)} / u
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 text-[11px] text-slate-500 mt-1">
                        <span>
                          Qty: {ph.qty}
                          {ph.bonus_qty > 0 ? ` (+${ph.bonus_qty} Bonus)` : ""} • Batch:{" "}
                          {ph.batch_number || "N/A"}
                        </span>
                        <span className="shrink-0">{formatDate(ph.occurred_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Sales Invoices */}
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-[#009A4D]" />
                Recent Sales Invoices
              </h4>
              {productDetail.recent_sales?.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  No recent sales line items in the 35-day detail window.
                </p>
              ) : (
                <div className="space-y-2">
                  {productDetail.recent_sales.map((rs: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedInvoiceId(rs.invoice_id)}
                      className="w-full text-left p-3.5 rounded-2xl border border-slate-200 hover:border-emerald-300 bg-white hover:bg-emerald-50/30 text-xs flex items-center justify-between gap-2 transition-colors"
                    >
                      <div>
                        <span className="font-extrabold text-slate-900 font-mono">
                          {rs.invoice_number}
                        </span>
                        <span className="text-slate-500 ml-2">
                          Qty {rs.qty} @ {formatPKR(rs.unit_price)}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-extrabold text-[#009A4D] block tabular-nums">
                          {formatPKR(rs.line_total)}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatDate(rs.occurred_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </PortalSlideOver>

      {/* Linked Invoice Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

export default function InventoryIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          Loading Inventory Intelligence…
        </div>
      }
    >
      <InventoryPageInner />
    </Suspense>
  );
}
