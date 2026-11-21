"use client";

import React from "react";
import Link from "next/link";
import { RefreshCw, X } from "lucide-react";

/**
 * Shared executive visual primitives for AivraSol Owner Portal.
 * Distinct Midnight Indigo + Electric Teal executive identity — clearly separated
 * from the Clinical Emerald Counter POS mobile app while matching its effortless
 * app-grade UX, touch targets, and readability across mobile & desktop screens.
 */

export function PortalPageHeader({
  icon,
  title,
  subtitle,
  badge,
  actions,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-indigo-950/[0.08]">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-[#131B3A] via-[#1B2B5C] to-[#13425E] text-teal-300 shadow-[0_6px_16px_-4px_rgba(19,27,58,0.35)] flex items-center justify-center shrink-0 mt-0.5">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-[21px] font-extrabold text-[#131B3A] tracking-tight leading-snug">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs sm:text-[13px] text-slate-500 mt-0.5 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

export function PortalRefreshButton({
  loading,
  onClick,
  label = "Refresh",
}: {
  loading?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-white border border-indigo-950/10 text-xs font-bold text-[#131B3A] hover:bg-indigo-50/50 hover:border-indigo-300 active:scale-[0.97] transition-all shadow-2xs disabled:opacity-60"
    >
      <RefreshCw
        className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-indigo-600"}`}
      />
      <span>{label}</span>
    </button>
  );
}

export type PortalTone =
  | "default"
  | "emerald"
  | "amber"
  | "rose"
  | "sky"
  | "indigo"
  | "dark";

const KPI_TONE_CLASSES: Record<
  PortalTone,
  { wrap: string; label: string; value: string; sub: string; iconWrap: string }
> = {
  default: {
    wrap: "bg-white border-indigo-950/[0.08] hover:border-indigo-300",
    label: "text-slate-500",
    value: "text-[#131B3A]",
    sub: "text-slate-500",
    iconWrap: "bg-slate-100 text-slate-700",
  },
  emerald: {
    wrap: "bg-white border-teal-200/80 hover:border-teal-400",
    label: "text-slate-500",
    value: "text-teal-700",
    sub: "text-slate-500",
    iconWrap: "bg-teal-50 text-teal-700 border border-teal-200/70",
  },
  amber: {
    wrap: "bg-white border-amber-200/80 hover:border-amber-400",
    label: "text-slate-500",
    value: "text-amber-700",
    sub: "text-slate-500",
    iconWrap: "bg-amber-50 text-amber-700 border border-amber-200/70",
  },
  rose: {
    wrap: "bg-white border-rose-200/80 hover:border-rose-400",
    label: "text-slate-500",
    value: "text-rose-700",
    sub: "text-slate-500",
    iconWrap: "bg-rose-50 text-rose-600 border border-rose-200/70",
  },
  sky: {
    wrap: "bg-white border-sky-200/80 hover:border-sky-400",
    label: "text-slate-500",
    value: "text-sky-800",
    sub: "text-slate-500",
    iconWrap: "bg-sky-50 text-sky-700 border border-sky-200/70",
  },
  indigo: {
    wrap: "bg-white border-indigo-200/80 hover:border-indigo-400",
    label: "text-slate-500",
    value: "text-indigo-800",
    sub: "text-slate-500",
    iconWrap: "bg-indigo-50 text-indigo-700 border border-indigo-200/70",
  },
  dark: {
    wrap: "bg-gradient-to-br from-[#131B3A] via-[#1B2A5A] to-[#113D58] border-indigo-800 text-white",
    label: "text-indigo-200/90",
    value: "text-teal-300",
    sub: "text-indigo-200/75",
    iconWrap: "bg-white/10 text-teal-300 border border-white/15",
  },
};

export function PortalKpiCard({
  label,
  value,
  subtext,
  icon,
  tone = "default",
  active = false,
  activeToneClass,
  onClick,
  href,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: PortalTone;
  active?: boolean;
  activeToneClass?: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const styles = KPI_TONE_CLASSES[tone];
  const baseClass = `group w-full text-left rounded-2xl border p-4 sm:p-4.5 transition-all shadow-[0_4px_18px_-6px_rgba(19,27,58,0.07)] ${
    active && activeToneClass
      ? activeToneClass
      : active
      ? "bg-gradient-to-br from-[#131B3A] to-[#1C2F63] text-white border-indigo-800 shadow-md"
      : styles.wrap
  } ${
    onClick || href
      ? "cursor-pointer hover:shadow-[0_10px_24px_-8px_rgba(19,27,58,0.14)] hover:-translate-y-0.5 active:scale-[0.985]"
      : ""
  } ${className}`;

  const content = (
    <div className="flex flex-col h-full justify-between gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`text-[11px] font-bold uppercase tracking-wider leading-snug ${
            active ? "opacity-90" : styles.label
          }`}
        >
          {label}
        </span>
        {icon && (
          <span
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              active ? "bg-white/15 text-teal-300" : styles.iconWrap
            }`}
          >
            {icon}
          </span>
        )}
      </div>

      <div
        className={`text-lg sm:text-xl font-extrabold tabular-nums tracking-tight leading-none ${
          active ? "text-white" : styles.value
        }`}
      >
        {value}
      </div>

      {subtext && (
        <div
          className={`text-[11px] font-medium leading-snug ${
            active ? "opacity-80" : styles.sub
          }`}
        >
          {subtext}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {content}
      </button>
    );
  }
  return <div className={baseClass}>{content}</div>;
}

export function PortalSectionCard({
  title,
  subtitle,
  icon,
  headerRight,
  headerClassName = "",
  children,
  className = "",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  headerClassName?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-indigo-950/[0.08] shadow-[0_4px_20px_-6px_rgba(19,27,58,0.08)] overflow-hidden ${className}`}
    >
      {(title || headerRight) && (
        <div
          className={`px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#F7F9FD] to-white border-b border-indigo-950/[0.06] flex flex-wrap items-center justify-between gap-2.5 ${headerClassName}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="shrink-0">{icon}</span>}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-extrabold text-[#131B3A] tracking-tight truncate">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {headerRight && (
            <div className="flex items-center gap-2 shrink-0">{headerRight}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

const BADGE_MAP: Record<string, string> = {
  emerald: "bg-teal-50 text-teal-800 border-teal-200/80",
  amber: "bg-amber-50 text-amber-800 border-amber-200/80",
  rose: "bg-rose-50 text-rose-800 border-rose-200/80",
  sky: "bg-sky-50 text-sky-800 border-sky-200/80",
  indigo: "bg-indigo-50 text-indigo-800 border-indigo-200/80",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  dark: "bg-[#131B3A] text-white border-indigo-900",
};

export function PortalStatusBadge({
  tone = "slate",
  dot = false,
  children,
  className = "",
}: {
  tone?: "emerald" | "amber" | "rose" | "sky" | "indigo" | "slate" | "dark";
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const dotColor =
    tone === "emerald"
      ? "bg-teal-500"
      : tone === "amber"
      ? "bg-amber-500"
      : tone === "rose"
      ? "bg-rose-500"
      : tone === "sky"
      ? "bg-sky-500"
      : tone === "indigo"
      ? "bg-indigo-500"
      : tone === "dark"
      ? "bg-teal-400"
      : "bg-slate-400";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border leading-tight ${BADGE_MAP[tone]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />}
      <span>{children}</span>
    </span>
  );
}

export function PortalSlideOver({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  headerActions,
  maxWidthClass = "max-w-2xl",
  darkHeader = false,
  zIndexClass = "z-50",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  headerActions?: React.ReactNode;
  maxWidthClass?: string;
  darkHeader?: boolean;
  zIndexClass?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-end sm:items-stretch sm:justify-end bg-[#0B1026]/60 backdrop-blur-[3px]`}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className={`relative z-10 w-full ${maxWidthClass} bg-[#F3F5FA] h-[92dvh] sm:h-full rounded-t-3xl sm:rounded-none shadow-2xl border-t sm:border-t-0 sm:border-l border-indigo-950/15 flex flex-col overflow-hidden animate-portal-drawer`}
      >
        {/* Mobile Pull Handle */}
        <div
          className={`sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 ${
            darkHeader ? "bg-[#131B3A]" : "bg-[#131B3A]"
          }`}
        >
          <span className="w-11 h-1 rounded-full bg-indigo-300/35" />
        </div>

        {/* Sticky Drawer Header */}
        <div
          className={`px-4 sm:px-6 py-4 border-b flex items-center justify-between gap-3 shrink-0 bg-gradient-to-r from-[#131B3A] via-[#1A2756] to-[#133A56] text-white border-white/10`}
        >
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5 text-teal-300">
                {eyebrow}
              </div>
            )}
            <h2 className="text-sm sm:text-base font-extrabold truncate text-white">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs mt-0.5 truncate text-indigo-200/80">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-indigo-200 hover:text-white hover:bg-white/10"
              aria-label="Close panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto portal-scroll p-4 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-5 bg-white">
          {children}
        </div>
      </div>
    </div>
  );
}

export function PortalEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="p-8 sm:p-12 text-center space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-500 flex items-center justify-center mx-auto">
        {icon}
      </div>
      <div className="space-y-1 max-w-sm mx-auto">
        <p className="text-sm font-extrabold text-[#131B3A]">{title}</p>
        {description && (
          <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
