"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw,
  Banknote,
  TrendingUp,
  TrendingDown,
  Package,
  ShoppingCart,
  Receipt,
  CreditCard,
  AlertTriangle,
  Clock,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Building2,
  Phone,
  Mail,
  MapPin,
  Globe,
  User,
  LineChart
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  gross_sales: number;
  sales_returns: number;
  net_sales: number;
  sale_cogs: number;
  returned_cogs: number;
  net_cogs: number;
  gross_profit: number;
  purchases: number;
  cash_sales: number;
  credit_sales: number;
  expenses: number;
  net_profit: number;
}

interface InventoryTotals {
  stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  expiring_soon_count: number;
}

interface TrendPoint {
  date: string;
  gross_sales: number;
  net_sales: number;
  gross_profit: number;
  net_profit: number;
  expenses: number;
}

interface Product {
  product_id: string;
  product_name: string;
  qty: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
}

interface Installation {
  id: string;
  label: string;
  status: string;
}

interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  client_id: string;
  client?: {
    name: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    address?: string;
    timezone?: string;
  } | null;
}

type Period = "today" | "7d" | "30d";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function pkr(n: number): string {
  return `Rs. ${fmt(n)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon: Icon,
  trend,
  color = "emerald",
}: {
  title: string;
  value: string;
  icon: any;
  trend?: { label: string; positive: boolean };
  color?: "emerald" | "amber" | "red" | "blue" | "violet" | "slate";
}) {
  const colorStyles = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    red: "bg-red-50 text-red-600 border-red-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    violet: "bg-violet-50 text-violet-600 border-violet-100",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        <div className={`p-2 rounded-lg border ${colorStyles[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
        {trend && (
          <div className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${trend.positive ? "text-emerald-600" : "text-red-600"}`}>
            {trend.positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {trend.label}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="w-24 h-4 bg-slate-200 rounded" />
        <div className="w-8 h-8 bg-slate-100 rounded-lg" />
      </div>
      <div className="w-32 h-8 bg-slate-200 rounded mt-2" />
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [selectedLicense, setSelectedLicense] = useState<string>("");
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [user, setUser] = useState<PortalUser | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [inventory, setInventory] = useState<InventoryTotals | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [topQty, setTopQty] = useState<Product[]>([]);
  const [topProfit, setTopProfit] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState<string>("Asia/Karachi");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Pagination states
  const [recentSalesPage, setRecentSalesPage] = useState(1);
  const [topProductsPage, setTopProductsPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    fetch("/api/portal/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d?.user) setUser(d.user); })
      .catch(() => {});

    fetch("/api/portal/installations")
      .then((r) => r.json())
      .then((d) => setInstallations(d.installations ?? []))
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setRecentSalesPage(1);
    setTopProductsPage(1);
    
    try {
      const lic = selectedLicense ? `&license_id=${selectedLicense}` : "";
      const trendDays = period === "today" ? "7" : period === "7d" ? "7" : "30";

      const [summaryRes, inventoryRes, trendsRes, topRes] = await Promise.all([
        fetch(`/api/portal/dashboard/summary?period=${period}${lic}`).then((r) => r.json()),
        fetch(`/api/portal/dashboard/inventory${lic ? `?license_id=${selectedLicense}` : ""}`).then((r) => r.json()),
        fetch(`/api/portal/dashboard/trends?days=${trendDays}${lic}`).then((r) => r.json()),
        fetch(`/api/portal/dashboard/top?period=${period}${lic}`).then((r) => r.json()),
      ]);

      if (summaryRes.ok) {
        setSummary(summaryRes.summary);
        setTimezone(summaryRes.timezone ?? "Asia/Karachi");
        setLastSyncAt(summaryRes.last_sync_at ?? null);
      }
      if (inventoryRes.ok) setInventory(inventoryRes.totals);
      if (trendsRes.ok) setTrends(trendsRes.trend ?? []);
      if (topRes.ok) {
        setTopQty(topRes.top_by_qty ?? []);
        setTopProfit(topRes.top_by_profit ?? []);
        setRecentSales(topRes.recent_sales ?? []);
      }
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [period, selectedLicense]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Derived state for pagination
  const paginatedSales = recentSales.slice((recentSalesPage - 1) * PAGE_SIZE, recentSalesPage * PAGE_SIZE);
  const paginatedTopQty = topQty.slice((topProductsPage - 1) * PAGE_SIZE, topProductsPage * PAGE_SIZE);

  return (
    <div className="space-y-8 pb-12">
      
      {/* ── HEADER & FILTERS ── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Business Overview</h1>
          <div className="flex items-center gap-2 mt-1.5 text-sm text-slate-500">
            {lastSyncAt ? (
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-500" />
                Last synced {formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true })}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Clock className="w-4 h-4" /> Waiting for sync...
              </span>
            )}
            <span className="text-slate-300">•</span>
            <span>{timezone}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Native SaaS Date Toggles */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            {(["today", "7d", "30d"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  period === p
                    ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>

          {installations.length > 0 && (
            <select
              value={selectedLicense}
              onChange={(e) => setSelectedLicense(e.target.value)}
              className="bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm"
            >
              <option value="">All Locations</option>
              {installations.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.label}</option>
              ))}
            </select>
          )}

          <button
            onClick={fetchAll}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:text-emerald-700 hover:border-emerald-200 hover:bg-emerald-50 text-sm font-medium rounded-lg px-4 py-2 shadow-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-600" : ""}`} />
            <span className="hidden sm:inline">Refresh Data</span>
          </button>
        </div>
      </div>

      {/* ── BUSINESS PROFILE CARD ── */}
      {user?.client && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-300">
              <Building2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{user.client.name}</h2>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-500">
                {user.client.contact_name && (
                  <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> {user.client.contact_name}</span>
                )}
                {user.client.contact_phone && (
                  <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {user.client.contact_phone}</span>
                )}
                {user.client.contact_email && (
                  <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" /> {user.client.contact_email}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 md:border-l border-slate-100 md:pl-6 text-sm">
             <div className="flex flex-col">
                <span className="text-slate-500 mb-1 flex items-center gap-1.5"><Globe className="w-4 h-4" /> Timezone</span>
                <span className="font-medium text-slate-900">{user.client.timezone ?? "Asia/Karachi"}</span>
             </div>
             <div className="flex flex-col">
                <span className="text-slate-500 mb-1 flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Address</span>
                <span className="font-medium text-slate-900 max-w-[200px] truncate" title={user.client.address}>{user.client.address || "Not specified"}</span>
             </div>
          </div>
        </div>
      )}

      {/* ── FINANCIAL KPIs ── */}
      <section id="sales">
        <SectionHeader title="Financial Summary" description={`Performance for ${period === 'today' ? 'today' : `the last ${period === '7d' ? '7' : '30'} days`}`} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array(4).fill(0).map((_, i) => <SkeletonCard key={i} />)
          ) : summary ? (
            <>
              <KpiCard title="Gross Sales" value={pkr(summary.gross_sales)} icon={Banknote} color="blue" />
              <KpiCard title="Net Sales" value={pkr(summary.net_sales)} icon={TrendingUp} color="emerald" />
              <KpiCard title="Gross Profit" value={pkr(summary.gross_profit)} icon={TrendingUp} color="violet" />
              <KpiCard title="Net Profit" value={pkr(summary.net_profit)} icon={summary.net_profit >= 0 ? TrendingUp : TrendingDown} color={summary.net_profit >= 0 ? "emerald" : "red"} />
            </>
          ) : (
            <div className="col-span-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500">
              No financial data available for this period.
            </div>
          )}
        </div>
        
        {/* Secondary KPIs */}
        {!loading && summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
             <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
               <span className="text-sm text-slate-500 flex items-center gap-2"><CreditCard className="w-4 h-4 text-slate-400"/> Expenses</span>
               <span className="font-semibold text-slate-900">{pkr(summary.expenses)}</span>
             </div>
             <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
               <span className="text-sm text-slate-500 flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-slate-400"/> Purchases</span>
               <span className="font-semibold text-slate-900">{pkr(summary.purchases)}</span>
             </div>
             <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
               <span className="text-sm text-slate-500 flex items-center gap-2"><ArrowRight className="w-4 h-4 text-red-400"/> Returns</span>
               <span className="font-semibold text-red-600">{pkr(summary.sales_returns)}</span>
             </div>
             <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
               <span className="text-sm text-slate-500 flex items-center gap-2"><Package className="w-4 h-4 text-amber-500"/> COGS</span>
               <span className="font-semibold text-amber-600">{pkr(summary.net_cogs)}</span>
             </div>
          </div>
        )}
      </section>

      {/* ── CHARTS & INVENTORY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* TRENDS CHART */}
        <section className="lg:col-span-2">
          <SectionHeader title="Sales & Profit Trend" />
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm h-[340px]">
            {loading ? (
              <div className="w-full h-full animate-pulse bg-slate-50 rounded-xl" />
            ) : trends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} dy={10} />
                  <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    labelStyle={{ color: "#64748b", fontWeight: 500, marginBottom: 4 }}
                    formatter={(v: any) => [`Rs. ${Number(v).toLocaleString()}`, ""]}
                  />
                  <Area type="monotone" dataKey="net_sales" name="Net Sales" stroke="#10b981" fill="url(#colorSales)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 6, strokeWidth: 0, fill: "#10b981" }} />
                  <Area type="monotone" dataKey="gross_profit" name="Gross Profit" stroke="#8b5cf6" fill="url(#colorProfit)" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0, fill: "#8b5cf6" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <LineChart className="w-8 h-8 text-slate-300 mb-2" />
                <p>No trend data available.</p>
              </div>
            )}
          </div>
        </section>

        {/* INVENTORY HEALTH */}
        <section id="inventory">
          <SectionHeader title="Inventory Health" />
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm h-[340px] flex flex-col">
            {loading ? (
              <div className="flex-1 space-y-4">
                {Array(4).fill(0).map((_, i) => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}
              </div>
            ) : inventory ? (
              <div className="flex-1 flex flex-col justify-between">
                <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-100 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Total Stock Value</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">{pkr(inventory.stock_value)}</p>
                  </div>
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                    <Package className="w-6 h-6" />
                  </div>
                </div>

                <div className="space-y-3 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-slate-700">Low Stock</span>
                    </div>
                    <span className="font-bold text-slate-900">{inventory.low_stock_count}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-red-100 bg-red-50">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="text-sm font-medium text-red-800">Out of Stock</span>
                    </div>
                    <span className="font-bold text-red-700">{inventory.out_of_stock_count}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-sm font-medium text-slate-700">Expiring Soon</span>
                    </div>
                    <span className="font-bold text-slate-900">{inventory.expiring_soon_count}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center px-4">
                <Package className="w-8 h-8 text-slate-300 mb-2" />
                <p>No inventory snapshot available.</p>
                <p className="text-xs mt-1 text-slate-400">Snapshot will appear after POS syncs.</p>
              </div>
            )}
          </div>
        </section>

      </div>

      {/* ── TABLES ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* TOP PRODUCTS */}
        <section>
          <SectionHeader title="Top Selling Products" description="By quantity sold in this period." />
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="text-left px-5 py-3 font-medium">Product Name</th>
                    <th className="text-right px-5 py-3 font-medium">Qty</th>
                    <th className="text-right px-5 py-3 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-5 py-4"><div className="w-32 h-4 bg-slate-100 rounded animate-pulse" /></td>
                        <td className="px-5 py-4"><div className="w-8 h-4 bg-slate-100 rounded animate-pulse ml-auto" /></td>
                        <td className="px-5 py-4"><div className="w-16 h-4 bg-slate-100 rounded animate-pulse ml-auto" /></td>
                      </tr>
                    ))
                  ) : paginatedTopQty.length > 0 ? (
                    paginatedTopQty.map((p, i) => (
                      <tr key={p.product_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          <span className="text-slate-400 font-normal mr-2">{(topProductsPage - 1) * PAGE_SIZE + i + 1}.</span>
                          {p.product_name}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-700">{p.qty}</td>
                        <td className="px-5 py-3 text-right text-emerald-600 font-semibold">{pkr(p.revenue)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-5 py-8 text-center text-slate-500">
                        No product sales data available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {topQty.length > PAGE_SIZE && (
              <div className="border-t border-slate-200 p-3 flex items-center justify-between bg-slate-50 text-sm">
                <span className="text-slate-500 px-2">Showing {(topProductsPage - 1) * PAGE_SIZE + 1} - {Math.min(topProductsPage * PAGE_SIZE, topQty.length)} of {topQty.length}</span>
                <div className="flex gap-1">
                  <button onClick={() => setTopProductsPage(p => Math.max(1, p - 1))} disabled={topProductsPage === 1} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100"><ChevronLeft className="w-4 h-4"/></button>
                  <button onClick={() => setTopProductsPage(p => p * PAGE_SIZE < topQty.length ? p + 1 : p)} disabled={topProductsPage * PAGE_SIZE >= topQty.length} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100"><ChevronRight className="w-4 h-4"/></button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RECENT SALES */}
        <section>
          <SectionHeader title="Recent Sales" description="Latest synchronized POS transactions." />
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="text-left px-5 py-3 font-medium">Invoice</th>
                    <th className="text-left px-5 py-3 font-medium">Time</th>
                    <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Customer</th>
                    <th className="text-right px-5 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-5 py-4"><div className="w-16 h-4 bg-slate-100 rounded animate-pulse" /></td>
                        <td className="px-5 py-4"><div className="w-20 h-4 bg-slate-100 rounded animate-pulse" /></td>
                        <td className="px-5 py-4 hidden sm:table-cell"><div className="w-24 h-4 bg-slate-100 rounded animate-pulse" /></td>
                        <td className="px-5 py-4"><div className="w-16 h-4 bg-slate-100 rounded animate-pulse ml-auto" /></td>
                      </tr>
                    ))
                  ) : paginatedSales.length > 0 ? (
                    paginatedSales.map((s, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-slate-600 bg-slate-50/50">{s.invoice_number ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {new Date(s.occurred_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-5 py-3 text-slate-900 font-medium hidden sm:table-cell">{s.customer_name ?? "Walk-in"}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="font-semibold text-emerald-600">{pkr(s.net_sales ?? 0)}</div>
                          <div className={`text-[10px] uppercase font-bold mt-0.5 ${s.payment_method === "cash" ? "text-emerald-500" : "text-blue-500"}`}>
                            {s.payment_method ?? "—"}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                        No recent sales found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {recentSales.length > PAGE_SIZE && (
              <div className="border-t border-slate-200 p-3 flex items-center justify-between bg-slate-50 text-sm">
                <span className="text-slate-500 px-2">Showing {(recentSalesPage - 1) * PAGE_SIZE + 1} - {Math.min(recentSalesPage * PAGE_SIZE, recentSales.length)} of {recentSales.length}</span>
                <div className="flex gap-1">
                  <button onClick={() => setRecentSalesPage(p => Math.max(1, p - 1))} disabled={recentSalesPage === 1} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100"><ChevronLeft className="w-4 h-4"/></button>
                  <button onClick={() => setRecentSalesPage(p => p * PAGE_SIZE < recentSales.length ? p + 1 : p)} disabled={recentSalesPage * PAGE_SIZE >= recentSales.length} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100"><ChevronRight className="w-4 h-4"/></button>
                </div>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
