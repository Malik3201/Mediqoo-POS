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
  BarChart,
  Bar,
  Legend,
} from "recharts";

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
  gross_profit: number;
}

interface Installation {
  id: string;
  label: string;
  status: string;
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

function KpiCard({ label, value, sub, color = "emerald", isNegative = false }: {
  label: string; value: string; sub?: string; color?: string; isNegative?: boolean;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    violet: "bg-violet-500/10 border-violet-500/20 text-violet-400",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    red: "bg-red-500/10 border-red-500/20 text-red-400",
    slate: "bg-slate-700/30 border-slate-700 text-slate-400",
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-xs font-medium opacity-75 mb-1">{label}</p>
      <p className={`text-xl font-bold tracking-tight ${isNegative && value !== "Rs. 0" ? "text-red-400" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h2>
  );
}

function Skeleton() {
  return <div className="animate-pulse bg-slate-800 rounded-xl h-20" />;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [selectedLicense, setSelectedLicense] = useState<string>("");
  const [installations, setInstallations] = useState<Installation[]>([]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [inventory, setInventory] = useState<InventoryTotals | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [topQty, setTopQty] = useState<Product[]>([]);
  const [topProfit, setTopProfit] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState<string>("Asia/Karachi");

  // Fetch installations on mount
  useEffect(() => {
    fetch("/api/portal/installations")
      .then((r) => r.json())
      .then((d) => setInstallations(d.installations ?? []))
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Timezone: <span className="text-slate-400">{timezone}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Period filter */}
          <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
            {(["today", "7d", "30d"] as Period[]).map((p) => (
              <button
                key={p}
                id={`period-${p}`}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  period === p
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>
          {/* Installation filter */}
          {installations.length > 0 && (
            <select
              id="installation-filter"
              value={selectedLicense}
              onChange={(e) => setSelectedLicense(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">All Installations</option>
              {installations.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={fetchAll}
            id="refresh-btn"
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── TODAY Financial KPIs ── */}
      <section>
        <SectionHeader title="Financial Summary" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {loading ? (
            Array(10).fill(0).map((_, i) => <Skeleton key={i} />)
          ) : summary ? (
            <>
              <KpiCard label="Gross Sales" value={pkr(summary.gross_sales)} color="emerald" />
              <KpiCard label="Sales Returns" value={pkr(summary.sales_returns)} color="red" />
              <KpiCard label="Net Sales" value={pkr(summary.net_sales)} color="emerald" />
              <KpiCard label="COGS" value={pkr(summary.net_cogs)} color="amber" />
              <KpiCard label="Gross Profit" value={pkr(summary.gross_profit)} color="blue" />
              <KpiCard label="Expenses" value={pkr(summary.expenses)} color="amber" />
              <KpiCard label="Net Profit" value={pkr(summary.net_profit)} color={summary.net_profit >= 0 ? "violet" : "red"} />
              <KpiCard label="Purchases" value={pkr(summary.purchases)} color="slate" />
              <KpiCard label="Cash Sales" value={pkr(summary.cash_sales)} color="emerald" />
              <KpiCard label="Credit Sales" value={pkr(summary.credit_sales)} color="blue" />
            </>
          ) : (
            <p className="col-span-5 text-slate-500 text-sm">No data available.</p>
          )}
        </div>
      </section>

      {/* ── INVENTORY ── */}
      <section>
        <SectionHeader title="Inventory" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {loading ? (
            Array(4).fill(0).map((_, i) => <Skeleton key={i} />)
          ) : inventory ? (
            <>
              <KpiCard label="Stock Value" value={pkr(inventory.stock_value)} color="emerald" />
              <KpiCard label="Low Stock Items" value={inventory.low_stock_count.toString()} color="amber" />
              <KpiCard label="Out of Stock" value={inventory.out_of_stock_count.toString()} color="red" />
              <KpiCard label="Expiring Soon" value={inventory.expiring_soon_count.toString()} color="amber" />
            </>
          ) : (
            <p className="col-span-4 text-slate-500 text-sm">No inventory snapshot available. Snapshot will appear after POS syncs.</p>
          )}
        </div>
      </section>

      {/* ── TRENDS ── */}
      <section>
        <SectionHeader title={`Sales Trend (${period === "30d" ? "30" : "7"} Days)`} />
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          {loading ? (
            <div className="h-48 animate-pulse bg-slate-800 rounded-lg" />
          ) : trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trends} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(v: any) => [`Rs. ${fmt(Number(v))}`, ""]}
                />
                <Area type="monotone" dataKey="net_sales" name="Net Sales" stroke="#10b981" fill="url(#colorSales)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="gross_profit" name="Gross Profit" stroke="#8b5cf6" fill="url(#colorProfit)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
              No trend data. Trend will appear after POS syncs analytics.
            </div>
          )}
        </div>
      </section>

      {/* ── TOP PRODUCTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <SectionHeader title="Top Selling Products (by Quantity)" />
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="h-32 animate-pulse bg-slate-800 m-4 rounded-lg" />
            ) : topQty.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Product</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Qty</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topQty.slice(0, 8).map((p, i) => (
                    <tr key={p.product_id} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition">
                      <td className="px-4 py-2.5 text-slate-300">
                        <span className="text-slate-600 mr-2">{i + 1}.</span>
                        {p.product_name}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{p.qty}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-400">{pkr(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-600 text-sm p-4">No product data yet.</p>
            )}
          </div>
        </section>

        <section>
          <SectionHeader title="Top Profit Products" />
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="h-32 animate-pulse bg-slate-800 m-4 rounded-lg" />
            ) : topProfit.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Product</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Profit</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topProfit.slice(0, 8).map((p, i) => (
                    <tr key={p.product_id} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition">
                      <td className="px-4 py-2.5 text-slate-300">
                        <span className="text-slate-600 mr-2">{i + 1}.</span>
                        {p.product_name}
                      </td>
                      <td className="px-4 py-2.5 text-right text-violet-400">{pkr(p.gross_profit)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{pkr(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-600 text-sm p-4">No product data yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* ── RECENT SALES ── */}
      <section>
        <SectionHeader title="Recent Sales" />
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="h-32 animate-pulse bg-slate-800 m-4 rounded-lg" />
          ) : recentSales.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Invoice</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Customer</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Net Sales</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((s, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition">
                      <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{s.invoice_number ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                        {new Date(s.occurred_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{s.customer_name ?? "Walk-in"}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-400">{pkr(s.net_sales ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          s.payment_method === "cash"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-blue-500/10 text-blue-400"
                        }`}>
                          {s.payment_method ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-600 text-sm p-4">No recent sales. Data will appear after POS syncs.</p>
          )}
        </div>
      </section>
    </div>
  );
}
