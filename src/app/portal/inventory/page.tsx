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
  TrendingDown,
  Clock,
  Layers,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShoppingBag,
  Receipt,
  CheckCircle2,
  Info,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

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

function movementBadge(status?: string) {
  switch (status) {
    case "fast_moving":
      return {
        label: "Fast Moving",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "slow_moving":
      return {
        label: "Slow Moving",
        cls: "bg-amber-50 text-amber-700 border-amber-200",
      };
    case "dead_stock":
      return {
        label: "Dead Stock (90d)",
        cls: "bg-rose-50 text-rose-700 border-rose-200",
      };
    case "out_of_stock":
      return {
        label: "Out of Stock",
        cls: "bg-red-100 text-red-800 border-red-300",
      };
    default:
      return {
        label: "Active",
        cls: "bg-slate-100 text-slate-700 border-slate-200",
      };
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

  const summary = data?.summary || {};
  const items: any[] = data?.items || [];
  const priceChanges: any[] = data?.supplier_price_changes || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <PackageSearch className="w-5 h-5 text-[#009A4D]" />
            <span>Inventory Intelligence &amp; Product Insights</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Stock valuation, verified WAC margins, movement velocity, supplier cost changes &amp; reorder watchlist.
          </p>
        </div>
        <button
          onClick={() => void loadInventory()}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Data Coverage Banner */}
      {data?.data_coverage?.coverage_notice && (
        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 px-3.5 py-2.5 text-xs text-emerald-900 flex items-start sm:items-center justify-between gap-2 flex-col sm:flex-row">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[#009A4D] shrink-0" />
            <span>{data.data_coverage.coverage_notice}</span>
          </div>
          {data.data_coverage.last_synced_at && (
            <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
              Snapshot: {formatDate(data.data_coverage.last_synced_at)}
            </span>
          )}
        </div>
      )}

      {/* Compact Clickable KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button
          onClick={() => {
            setFilter("all");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "all"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white border-slate-200 hover:border-emerald-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Stock Value (WAC)
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {formatPKR(summary.stock_value)}
          </span>
          <span className="text-[11px] opacity-75">
            {summary.total_tracked_skus || 0} tracked SKUs
          </span>
        </button>

        <button
          onClick={() => {
            setFilter("low_stock");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "low_stock"
              ? "bg-amber-600 text-white border-amber-600"
              : "bg-white border-slate-200 hover:border-amber-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Low / Out of Stock
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {(summary.low_stock_count || 0) + (summary.out_of_stock_count || 0)}
          </span>
          <span className="text-[11px] opacity-75">
            {summary.out_of_stock_count || 0} zero stock
          </span>
        </button>

        <button
          onClick={() => {
            setFilter("expiring_soon");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "expiring_soon"
              ? "bg-rose-600 text-white border-rose-600"
              : "bg-white border-slate-200 hover:border-rose-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Expiring (≤60d)
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {summary.expiring_soon_count || 0}
          </span>
          <span className="text-[11px] opacity-75">
            {summary.unverified_expiry_count || 0} need review
          </span>
        </button>

        <button
          onClick={() => {
            setFilter("slow_moving");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "slow_moving" || filter === "dead_stock"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white border-slate-200 hover:border-indigo-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Slow / Dead Stock
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {(summary.slow_moving_count || 0) + (summary.dead_stock_count || 0)}
          </span>
          <span className="text-[11px] opacity-75">
            {summary.dead_stock_count || 0} zero 90d sales
          </span>
        </button>

        <button
          onClick={() => {
            setFilter("price_increased");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "price_increased"
              ? "bg-orange-600 text-white border-orange-600"
              : "bg-white border-slate-200 hover:border-orange-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Supplier Cost Up
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {summary.price_increased_count || 0}
          </span>
          <span className="text-[11px] opacity-75">
            {summary.negative_margin_count || 0} neg. margin
          </span>
        </button>

        <button
          onClick={() => {
            setFilter("watchlist");
            setPage(1);
          }}
          className={`text-left p-3 rounded-2xl border transition-all ${
            filter === "watchlist"
              ? "bg-[#009A4D] text-white border-[#009A4D]"
              : "bg-white border-slate-200 hover:border-emerald-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Reorder Watchlist
          </span>
          <span className="text-sm sm:text-base font-extrabold tabular-nums mt-0.5 block">
            {summary.watchlist_count || 0}
          </span>
          <span className="text-[11px] opacity-75">Owner flagged</span>
        </button>
      </div>

      {/* Search, Category & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search medicine name, code, generic formula, or manufacturer…"
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#009A4D]"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium bg-white text-slate-700"
          >
            <option value="all">All Categories</option>
            {(data?.categories || []).map((c: string) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setFilter(t.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filter === t.id
                  ? "bg-[#009A4D] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Intelligence Table / Mobile Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500 animate-pulse">
            Loading product intelligence…
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <PackageSearch className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              No products match the selected filter.
            </p>
            <p className="text-[11px] text-slate-500">
              Try switching to &ldquo;All Tracked&rdquo; or clearing the search query.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4 text-left">Product / Generic / Mfg</th>
                    <th className="py-3 px-3 text-right">Stock</th>
                    <th className="py-3 px-3 text-right">Sale / WAC</th>
                    <th className="py-3 px-3 text-right">Margin</th>
                    <th className="py-3 px-3 text-right">30d / 90d Sold</th>
                    <th className="py-3 px-3 text-center">Movement</th>
                    <th className="py-3 px-3 text-left">Expiry / Cost Watch</th>
                    <th className="py-3 px-4 text-right">Watchlist</th>
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
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                            {p.code && (
                              <span className="font-mono bg-slate-100 px-1.5 py-0.2 rounded">
                                {p.code}
                              </span>
                            )}
                            {p.generic_name && <span>{p.generic_name}</span>}
                            {p.category && <span>• {p.category}</span>}
                            {p.manufacturer && <span>• {p.manufacturer}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <span
                            className={`font-bold ${
                              p.current_stock <= 0
                                ? "text-red-600"
                                : isLow
                                ? "text-amber-600"
                                : "text-slate-900"
                            }`}
                          >
                            {p.current_stock}
                          </span>
                          {p.reorder_level > 0 && (
                            <div className="text-[10px] text-slate-400">
                              Min: {p.reorder_level}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {formatPKR(p.sale_price)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            WAC: {formatPKR(p.cost_wac)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <span
                            className={`font-bold ${
                              p.is_negative_margin
                                ? "text-red-600"
                                : p.margin_pct > 0 && p.margin_pct < 8
                                ? "text-amber-600"
                                : "text-emerald-700"
                            }`}
                          >
                            {p.margin_pct ? `${p.margin_pct}%` : "—"}
                          </span>
                          <div className="text-[10px] text-slate-400">
                            Val: {formatPKR(p.stock_value)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <div className="font-bold text-slate-900">
                            {p.sold_qty_30d || 0} units
                          </div>
                          <div className="text-[10px] text-slate-500">
                            90d: {p.sold_qty_90d ?? p.sold_qty_30d ?? 0} •{" "}
                            {formatPKR(p.sold_revenue_30d)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${mv.cls}`}
                          >
                            {mv.label}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1">
                            {p.has_unverified_expiry && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded w-fit">
                                Expiry Needs Review
                              </span>
                            )}
                            {p.days_to_expiry !== null &&
                              p.days_to_expiry !== undefined && (
                                <span
                                  className={`text-[11px] font-semibold ${
                                    p.days_to_expiry <= 30
                                      ? "text-red-600"
                                      : "text-slate-600"
                                  }`}
                                >
                                  Exp: {p.nearest_expiry} ({p.days_to_expiry}d)
                                </span>
                              )}
                            {Number(p.cost_change_pct || 0) >= 3 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded w-fit">
                                <TrendingUp className="w-3 h-3" /> Cost +
                                {p.cost_change_pct}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="py-3 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              void toggleWatchlist(p, Boolean(p.in_watchlist))
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                              p.in_watchlist
                                ? "bg-emerald-50 text-[#009A4D] border-emerald-300"
                                : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {items.map((p) => {
                const mv = movementBadge(p.movement_status);
                return (
                  <div
                    key={p.product_id}
                    onClick={() => setSelectedProductId(p.product_id)}
                    className="p-3.5 space-y-2 active:bg-slate-50 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {p.name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {[p.generic_name, p.category, p.manufacturer]
                            .filter(Boolean)
                            .join(" • ") || "General"}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${mv.cls}`}
                      >
                        {mv.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-50 rounded-xl p-2">
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          Stock / Min
                        </span>
                        <span className="font-bold text-slate-900">
                          {p.current_stock} / {p.reorder_level || 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          Sale / WAC
                        </span>
                        <span className="font-bold text-slate-900">
                          {formatPKR(p.sale_price)} / {formatPKR(p.cost_wac)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          30d Sold
                        </span>
                        <span className="font-bold text-[#009A4D]">
                          {p.sold_qty_30d || 0} ({formatPKR(p.sold_revenue_30d)})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.has_unverified_expiry && (
                          <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">
                            Expiry Needs Review
                          </span>
                        )}
                        {Number(p.cost_change_pct || 0) >= 3 && (
                          <span className="text-[10px] font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded">
                            Cost +{p.cost_change_pct}%
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleWatchlist(p, Boolean(p.in_watchlist));
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                          p.in_watchlist
                            ? "bg-emerald-50 text-[#009A4D] border-emerald-300"
                            : "bg-white text-slate-600 border-slate-200"
                        }`}
                      >
                        {p.in_watchlist ? "Watching" : "+ Reorder Watch"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {data?.pagination && data.pagination.total_pages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  Page {data.pagination.page} of {data.pagination.total_pages} (
                  {data.pagination.total} items)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={page >= data.pagination.total_pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Supplier Cost Increase Watchlist Section */}
      {priceChanges.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-rose-600" />
              Recent Verified Supplier Cost Increases (Unit-Normalized)
            </h2>
            <span className="text-[11px] text-slate-500">
              {priceChanges.length} detected
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {priceChanges.slice(0, 6).map((sc: any) => (
              <div
                key={sc.id}
                onClick={() => setSelectedProductId(sc.product_id)}
                className="p-3 rounded-xl border border-slate-200 hover:border-rose-300 bg-slate-50/60 cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {sc.product_name}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold shrink-0">
                    +{sc.change_pct}%
                  </span>
                </div>
                <p className="text-[11px] text-slate-600">
                  {formatPKR(sc.old_cost)} →{" "}
                  <strong className="text-rose-700">
                    {formatPKR(sc.new_cost)}
                  </strong>{" "}
                  per {sc.unit_type || "Unit"}
                </p>
                <p className="text-[10px] text-slate-500 truncate">
                  {sc.supplier_name} • {sc.grn_number} • {formatDate(sc.date)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product Intelligence Slide-over Drawer */}
      {selectedProductId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                  Product Intelligence &amp; Supplier Comparison
                </span>
                <h3 className="text-sm sm:text-base font-bold truncate">
                  {productDetail?.product?.name || selectedProductId}
                </h3>
              </div>
              <button
                onClick={() => setSelectedProductId(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {detailLoading ? (
                <div className="py-16 text-center text-xs text-slate-500 animate-pulse">
                  Loading product history &amp; supplier comparisons…
                </div>
              ) : !productDetail?.product ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  Product details not found in recent cloud snapshot.
                </div>
              ) : (
                <>
                  {/* Product Summary Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase block">
                        Current Stock
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        {productDetail.product.current_stock}{" "}
                        <span className="text-[11px] font-normal text-slate-500">
                          (Min {productDetail.product.reorder_level || 0})
                        </span>
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase block">
                        Selling / WAC
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        {formatPKR(productDetail.product.sale_price)} /{" "}
                        {formatPKR(productDetail.product.cost_wac)}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase block">
                        Stock Valuation
                      </span>
                      <span className="text-sm font-extrabold text-[#009A4D]">
                        {formatPKR(productDetail.product.stock_value)}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] text-slate-500 uppercase block">
                        30d / 90d Sold
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        {productDetail.product.sold_qty_30d || 0} /{" "}
                        {productDetail.product.sold_qty_90d ??
                          productDetail.product.sold_qty_30d ??
                          0}
                      </span>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="rounded-xl border border-slate-200 p-3.5 text-xs grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Generic Formula:</span>{" "}
                      <strong className="text-slate-800">
                        {productDetail.product.generic_name || "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Category:</span>{" "}
                      <strong className="text-slate-800">
                        {productDetail.product.category || "General"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Manufacturer:</span>{" "}
                      <strong className="text-slate-800">
                        {productDetail.product.manufacturer || "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Nearest Expiry:</span>{" "}
                      <strong className="text-slate-800">
                        {productDetail.product.has_unverified_expiry
                          ? "Expiry Needs Review (Migrated)"
                          : productDetail.product.nearest_expiry || "—"}
                      </strong>
                    </div>
                  </div>

                  {/* Owner Reorder Watchlist Action Box */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                        <BookmarkCheck className="w-4 h-4 text-[#009A4D]" />
                        Owner Reorder Watchlist (Cloud Planning Note)
                      </span>
                      {productDetail.product.in_watchlist && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Active on Watchlist
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                          Target Order Qty
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={targetOrderQty}
                          onChange={(e) =>
                            setTargetOrderQty(Number(e.target.value) || 1)
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                          Owner Purchasing Note
                        </label>
                        <input
                          type="text"
                          value={watchNote}
                          onChange={(e) => setWatchNote(e.target.value)}
                          placeholder="e.g., Check bonus scheme with distributor…"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={watchSaving}
                        onClick={() =>
                          void toggleWatchlist(productDetail.product, false)
                        }
                        className="px-3 py-1.5 rounded-lg bg-[#009A4D] text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {productDetail.product.in_watchlist
                          ? "Update Watchlist Item"
                          : "Add to Reorder Watchlist"}
                      </button>
                      {productDetail.product.in_watchlist && (
                        <button
                          disabled={watchSaving}
                          onClick={() =>
                            void toggleWatchlist(productDetail.product, true)
                          }
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Supplier Comparison (Unit-Normalized) */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      Supplier Cost Comparison (Unit-Normalized)
                    </h4>
                    {productDetail.supplier_comparisons?.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        No recent purchase deliveries in the 35-day cloud detail window.
                      </p>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                            <tr>
                              <th className="py-2 px-3 text-left">Supplier</th>
                              <th className="py-2 px-3 text-left">Unit</th>
                              <th className="py-2 px-3 text-right">Latest Cost</th>
                              <th className="py-2 px-3 text-right">Min / Max</th>
                              <th className="py-2 px-3 text-right">Deliveries</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {productDetail.supplier_comparisons.map(
                              (sc: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="py-2 px-3 font-semibold text-slate-900">
                                    {sc.supplier_name}
                                  </td>
                                  <td className="py-2 px-3 text-slate-500">
                                    {sc.unit_type}
                                  </td>
                                  <td className="py-2 px-3 text-right font-bold text-[#009A4D]">
                                    {formatPKR(sc.latest_cost)}
                                  </td>
                                  <td className="py-2 px-3 text-right text-slate-600">
                                    {formatPKR(sc.min_cost)} –{" "}
                                    {formatPKR(sc.max_cost)}
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    {sc.deliveries_count} ({sc.total_qty} units)
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Recent Purchase History */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      Recent Purchase History (GRNs)
                    </h4>
                    {productDetail.purchase_history?.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        No recent purchase line items found in the 35-day detail window.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {productDetail.purchase_history.map(
                          (ph: any, idx: number) => (
                            <Link
                              key={idx}
                              href={`/portal/purchases?grn=${encodeURIComponent(
                                ph.purchase_id
                              )}`}
                              className="block p-3 rounded-xl border border-slate-200 hover:border-emerald-300 bg-slate-50/50 text-xs"
                            >
                              <div className="flex justify-between font-bold text-slate-900">
                                <span>
                                  {ph.grn_number} • {ph.supplier_name}
                                </span>
                                <span>{formatPKR(ph.cost_price)} / unit</span>
                              </div>
                              <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                                <span>
                                  Qty: {ph.qty}
                                  {ph.bonus_qty > 0
                                    ? ` (+${ph.bonus_qty} Bonus)`
                                    : ""}{" "}
                                  • Batch: {ph.batch_number || "N/A"}
                                </span>
                                <span>{formatDate(ph.occurred_at)}</span>
                              </div>
                            </Link>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {/* Recent Sales Invoices */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      Recent Sales Invoices
                    </h4>
                    {productDetail.recent_sales?.length === 0 ? (
                      <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        No recent sales line items in the 35-day detail window.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {productDetail.recent_sales.map((rs: any, idx: number) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedInvoiceId(rs.invoice_id)}
                            className="w-full text-left p-2.5 rounded-xl border border-slate-200 hover:border-emerald-300 flex items-center justify-between text-xs"
                          >
                            <div>
                              <span className="font-bold text-slate-900">
                                {rs.invoice_number}
                              </span>
                              <span className="text-slate-500 ml-2">
                                Qty {rs.qty} @ {formatPKR(rs.unit_price)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-[#009A4D]">
                                {formatPKR(rs.line_total)}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {formatDate(rs.occurred_at)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Drawer */}
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
        <div className="p-8 text-center text-xs text-slate-500">
          Loading Inventory Intelligence…
        </div>
      }
    >
      <InventoryPageInner />
    </Suspense>
  );
}
