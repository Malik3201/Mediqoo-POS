"use client";

import React, { useMemo, useState } from "react";
import { TrendingUp, Sparkles, CreditCard, Banknote, Smartphone, BookOpen } from "lucide-react";

export interface TrendPoint {
  date: string;
  gross_sales: number;
  sales_returns: number;
  net_sales: number;
  gross_profit: number;
  net_profit: number;
  expenses: number;
  purchases: number;
}

function fmtPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
}

function fmtShortPKR(n: number): string {
  const abs = Math.abs(n || 0);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return `${Math.round(n || 0)}`;
}

function fmtShortDate(ymd: string): string {
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
  } catch {
    return ymd;
  }
}

export function SalesTrendCard({
  trend,
  days,
  loading,
}: {
  trend: TrendPoint[];
  days: 7 | 30;
  loading?: boolean;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [metric, setMetric] = useState<"net_sales" | "gross_profit">("net_sales");

  const stats = useMemo(() => {
    if (!trend.length) {
      return { total: 0, avg: 0, peak: null as TrendPoint | null, maxVal: 1 };
    }
    const vals = trend.map((t) => Math.max(0, Number(t[metric]) || 0));
    const total = vals.reduce((s, v) => s + v, 0);
    const avg = total / trend.length;
    let peakIdx = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > vals[peakIdx]) peakIdx = i;
    }
    return {
      total,
      avg,
      peak: trend[peakIdx],
      maxVal: Math.max(100, ...vals),
    };
  }, [trend, metric]);

  const activePoint =
    selectedIdx !== null && trend[selectedIdx]
      ? trend[selectedIdx]
      : trend.length > 0
      ? trend[trend.length - 1]
      : null;

  // Build crisp SVG area + line coordinates
  const W = 540;
  const H = 175;
  const padX = 14;
  const padTop = 18;
  const padBottom = 26;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;

  const points = useMemo(() => {
    if (!trend.length) return [];
    const stepX = trend.length > 1 ? chartW / (trend.length - 1) : 0;
    return trend.map((t, idx) => {
      const val = Math.max(0, Number(t[metric]) || 0);
      const x = padX + idx * stepX;
      const y = padTop + chartH - (val / stats.maxVal) * chartH;
      return { x, y, val, item: t, idx };
    });
  }, [trend, metric, stats.maxVal, chartW, chartH]);

  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  }, [points]);

  const areaPath = useMemo(() => {
    if (!linePath || points.length === 0) return "";
    const last = points[points.length - 1];
    const first = points[0];
    const baseY = padTop + chartH;
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
  }, [linePath, points, chartH]);

  const activeIdx =
    selectedIdx !== null && selectedIdx < points.length
      ? selectedIdx
      : points.length - 1;
  const activeDot = activeIdx >= 0 ? points[activeIdx] : null;

  const strokeColor = metric === "net_sales" ? "#0F766E" : "#0F172A";
  const gradId = metric === "net_sales" ? "ownerSalesAreaGrad" : "ownerProfitAreaGrad";

  return (
    <div className="bg-white rounded-2xl border border-[#D8E0EA] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
      <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-[#E6ECF2]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#0F172A] text-teal-400 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-[#0F172A] tracking-tight truncate">
              {days}-Day Performance Trend
            </h2>
            <p className="text-[11px] text-slate-600 truncate">
              Tap or hover any day to inspect exact figures
            </p>
          </div>
        </div>

        <div className="inline-flex bg-[#F3F5F8] p-1 rounded-xl border border-[#D8E0EA]">
          <button
            type="button"
            data-allow-rapid-click="true"
            onClick={() => setMetric("net_sales")}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              metric === "net_sales"
                ? "bg-[#0F766E] text-white"
                : "text-slate-600 hover:text-[#0F172A]"
            }`}
          >
            Sales
          </button>
          <button
            type="button"
            data-allow-rapid-click="true"
            onClick={() => setMetric("gross_profit")}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              metric === "gross_profit"
                ? "bg-[#0F172A] text-white"
                : "text-slate-600 hover:text-[#0F172A]"
            }`}
          >
            Profit
          </button>
        </div>
      </div>

      {/* Selected Day Interactive Callout Strip */}
      <div className="px-4 sm:px-5 pt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tabular-nums tracking-tight">
            {activePoint ? fmtPKR(activePoint[metric]) : "Rs 0"}
          </span>
          {activePoint && (
            <span className="text-xs font-bold text-[#0F766E] bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
              {fmtShortDate(activePoint.date)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span>
            Avg/day:{" "}
            <strong className="text-[#0F172A] tabular-nums">{fmtShortPKR(stats.avg)}</strong>
          </span>
          {stats.peak && (
            <span className="hidden sm:inline">
              Best:{" "}
              <strong className="text-[#0F766E] tabular-nums">
                {fmtShortDate(stats.peak.date)} ({fmtShortPKR(stats.peak[metric])})
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Pure SVG Smooth Chart */}
      <div className="px-2 sm:px-4 pt-2 pb-3 flex-1 flex items-center">
        {loading && trend.length === 0 ? (
          <div className="w-full h-[175px] rounded-xl bg-slate-100/80 animate-pulse mx-2" />
        ) : trend.length === 0 ? (
          <div className="w-full h-[175px] flex items-center justify-center text-xs text-slate-400">
            No daily trend data synced yet for this window.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-[175px] overflow-visible select-none"
            onMouseLeave={() => setSelectedIdx(null)}
          >
            <defs>
              <linearGradient id="ownerSalesAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0D9488" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#0D9488" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="ownerProfitAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.26" />
                <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Horizontal reference lines */}
            {[0, 0.5, 1].map((frac) => {
              const y = padTop + chartH - frac * chartH;
              return (
                <g key={frac}>
                  <line
                    x1={padX}
                    x2={W - padX}
                    y1={y}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  {frac > 0 && (
                    <text
                      x={W - padX}
                      y={y - 4}
                      textAnchor="end"
                      className="fill-slate-400 text-[9.5px] font-semibold"
                    >
                      {fmtShortPKR(stats.maxVal * frac)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Area & Line */}
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path
              d={linePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Active vertical guide & glowing dot */}
            {activeDot && (
              <g>
                <line
                  x1={activeDot.x}
                  x2={activeDot.x}
                  y1={padTop}
                  y2={padTop + chartH}
                  stroke={strokeColor}
                  strokeOpacity="0.3"
                  strokeDasharray="3 3"
                  strokeWidth="1.5"
                />
                <circle
                  cx={activeDot.x}
                  cy={activeDot.y}
                  r="7"
                  fill={strokeColor}
                  fillOpacity="0.18"
                />
                <circle
                  cx={activeDot.x}
                  cy={activeDot.y}
                  r="4"
                  fill="#FFFFFF"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                />
              </g>
            )}

            {/* X-axis sparse labels */}
            {points.map((pt, idx) => {
              const step = trend.length <= 7 ? 1 : Math.ceil(trend.length / 6);
              const showLabel = idx === 0 || idx === points.length - 1 || idx % step === 0;
              return (
                <g key={pt.item.date}>
                  {showLabel && (
                    <text
                      x={pt.x}
                      y={H - 6}
                      textAnchor={
                        idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"
                      }
                      className={`text-[9.5px] font-semibold ${
                        idx === activeIdx ? "fill-[#131B3A]" : "fill-slate-400"
                      }`}
                    >
                      {fmtShortDate(pt.item.date)}
                    </text>
                  )}
                  {/* Wide invisible hit target for easy touch & mouse scrub */}
                  <rect
                    x={Math.max(0, pt.x - chartW / Math.max(trend.length * 2, 14))}
                    y={0}
                    width={chartW / Math.max(trend.length, 7)}
                    height={H}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => setSelectedIdx(idx)}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export function BusinessHealthCard({
  kpis,
  livePos,
  opStatus,
  periodLabel,
}: {
  kpis: any;
  livePos: any;
  opStatus: any;
  periodLabel: string;
}) {
  // Compute clear, owner-friendly Pharmacy Pulse Score (0 - 100)
  const { score, label, tone, notes } = useMemo(() => {
    let pts = 72;
    const outOfStock = Number(livePos?.inventory?.out_of_stock_count ?? 0);
    const expiring = Number(livePos?.inventory?.expiring_soon_count ?? 0);
    const margin = Number(kpis?.gross_margin_pct ?? 0);
    const netSales = Number(kpis?.net_sales ?? 0);
    const returns = Number(kpis?.sales_returns ?? 0);
    const variance = Math.abs(Number(opStatus?.current_drawer?.variance ?? 0));

    if (opStatus?.pos_status === "online" || opStatus?.pos_status === "recent") pts += 10;
    else if (opStatus?.pos_status === "offline") pts -= 12;

    if (margin >= 15) pts += 10;
    else if (margin >= 10) pts += 5;

    if (variance < 1) pts += 8;
    else if (variance >= 500) pts -= 14;
    else pts -= 6;

    if (outOfStock >= 50) pts -= 10;
    else if (outOfStock >= 10) pts -= 5;

    if (expiring >= 15) pts -= 8;
    else if (expiring > 0) pts -= 3;

    if (netSales > 0 && returns / netSales > 0.1) pts -= 8;

    const clamped = Math.max(25, Math.min(99, Math.round(pts)));
    const statusLabel =
      clamped >= 80 ? "Strong Pulse" : clamped >= 62 ? "Healthy Store" : "Needs Attention";
    const statusTone = clamped >= 80 ? "teal" : clamped >= 62 ? "indigo" : "amber";

    const quickNotes = [
      opStatus?.pos_status === "online"
        ? "POS Cloud Live"
        : opStatus?.pos_status === "recent"
        ? "Synced Recently"
        : "Check POS Sync",
      variance < 1 ? "Drawer Balanced" : `Variance ${fmtPKR(variance)}`,
      margin > 0 ? `${margin}% Margin` : "Tracking Margin",
    ];
    return { score: clamped, label: statusLabel, tone: statusTone, notes: quickNotes };
  }, [kpis, livePos, opStatus]);

  // Payment tender mix
  const cashAmt = Math.max(0, Number(kpis?.cash_sales ?? 0));
  const cardAmt = Math.max(0, Number(kpis?.card_sales ?? 0));
  const walletAmt = Math.max(0, Number(kpis?.wallet_sales ?? 0));
  const creditAmt = Math.max(0, Number(kpis?.credit_sales ?? 0));
  const totalTender = Math.max(1, cashAmt + cardAmt + walletAmt + creditAmt);
  const hasTender = cashAmt + cardAmt + walletAmt + creditAmt > 0;

  const tenders = [
    { key: "cash", label: "Cash", amount: cashAmt, pct: (cashAmt / totalTender) * 100, color: "bg-teal-500", text: "text-teal-700", icon: Banknote },
    { key: "card", label: "Card", amount: cardAmt, pct: (cardAmt / totalTender) * 100, color: "bg-indigo-500", text: "text-indigo-700", icon: CreditCard },
    { key: "wallet", label: "Wallet", amount: walletAmt, pct: (walletAmt / totalTender) * 100, color: "bg-sky-500", text: "text-sky-700", icon: Smartphone },
    { key: "credit", label: "Khata", amount: creditAmt, pct: (creditAmt / totalTender) * 100, color: "bg-amber-500", text: "text-amber-700", icon: BookOpen },
  ];

  // Semi-circle SVG arc math
  const r = 48;
  const circumference = Math.PI * r;
  const dashOffset = circumference * (1 - score / 100);
  const arcStroke = tone === "teal" ? "#0F766E" : tone === "indigo" ? "#0F172A" : "#D97706";

  return (
    <div className="bg-white rounded-2xl border border-[#D8E0EA] shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-4 sm:p-5 flex flex-col justify-between gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-200 text-[#0F766E] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-[#0F172A] leading-tight">
              Store Health &amp; Payments
            </h2>
            <p className="text-[11px] text-slate-600">{periodLabel} summary</p>
          </div>
        </div>
        <span
          className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold border ${
            tone === "teal"
              ? "bg-teal-50 text-[#0F766E] border-teal-300"
              : tone === "indigo"
              ? "bg-slate-100 text-[#0F172A] border-slate-300"
              : "bg-amber-50 text-amber-900 border-amber-300"
          }`}
        >
          {label}
        </span>
      </div>

      {/* Compact Semi-Arc Gauge + Micro Pills */}
      <div className="flex items-center gap-4">
        <div className="relative w-[124px] h-[72px] shrink-0 flex items-end justify-center">
          <svg viewBox="0 0 120 70" className="w-full h-full overflow-visible">
            <path
              d="M 12 62 A 48 48 0 0 1 108 62"
              fill="none"
              stroke="#E8ECF4"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 12 62 A 48 48 0 0 1 108 62"
              fill="none"
              stroke={arcStroke}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
          </svg>
          <div className="absolute bottom-0.5 text-center leading-none">
            <span className="text-2xl font-black text-[#131B3A] tabular-nums">{score}</span>
            <span className="text-[10px] font-bold text-slate-400 block mt-0.5">of 100</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {notes.map((n) => (
            <div
              key={n}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 truncate"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
              <span className="truncate">{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Mix Breakdown Bar */}
      <div className="pt-3 border-t border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold uppercase tracking-wider text-slate-500">
            Payment Mix ({periodLabel})
          </span>
          <span className="font-bold text-[#131B3A] tabular-nums">
            {hasTender ? fmtPKR(cashAmt + cardAmt + walletAmt + creditAmt) : "No bills yet"}
          </span>
        </div>

        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex gap-0.5">
          {hasTender ? (
            tenders
              .filter((t) => t.amount > 0)
              .map((t) => (
                <div
                  key={t.key}
                  className={`${t.color} h-full first:rounded-l-full last:rounded-r-full transition-all`}
                  style={{ width: `${Math.max(3, t.pct)}%` }}
                  title={`${t.label}: ${fmtPKR(t.amount)}`}
                />
              ))
          ) : (
            <div className="w-full h-full bg-slate-200/70" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {tenders.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.key} className="flex items-center justify-between gap-1 text-[11px]">
                <span className="flex items-center gap-1.5 text-slate-600 font-medium truncate">
                  <span className={`w-2 h-2 rounded-full ${t.color} shrink-0`} />
                  <Icon className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </span>
                <span className="font-bold text-[#131B3A] tabular-nums shrink-0">
                  {fmtShortPKR(t.amount)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
