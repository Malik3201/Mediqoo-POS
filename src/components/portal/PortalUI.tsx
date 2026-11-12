"use client";

import React from "react";
import Link from "next/link";
import { RefreshCw, X } from "lucide-react";

/**
 * Shared mobile-first visual primitives for AivraSol Owner Portal.
 * Presentation-only components that unify spacing, typography, badges,
 * executive stat cards, and responsive sheets/drawers across every page.
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
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 pb-1">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-[#009A4D] to-emerald-700 text-white shadow-sm shadow-emerald-600/20 flex items-center justify-center shrink-0 mt-0.5">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight leading-snug">
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
      className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-white border border-slate-200/90 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all shadow-2xs disabled:opacity-60"
    >
      <RefreshCw
        className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : "text-slate-500"}`}
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
    wrap: "bg-white border-slate-200/85 hover:border-slate-300",
    label: "text-slate-500",
    value: "text-slate-900",
    sub: "text-slate-400",
    iconWrap: "bg-slate-100 text-slate-600",
  },
  emerald: {
    wrap: "bg-gradient-to-br from-emerald-50/90 via-white to-white border-emerald-200/90 hover:border-emerald-300",
    label: "text-emerald-800",
    value: "text-[#008A44]",
    sub: "text-emerald-700/80",
    iconWrap: "bg-emerald-100 text-[#009A4D]",
  },
  amber: {
    wrap: "bg-gradient-to-br from-amber-50/90 via-white to-white border-amber-200/90 hover:border-amber-300",
    label: "text-amber-800",
    value: "text-amber-700",
    sub: "text-amber-700/80",
    iconWrap: "bg-amber-100 text-amber-700",
  },
  rose: {
    wrap: "bg-gradient-to-br from-rose-50/90 via-white to-white border-rose-200/90 hover:border-rose-300",
    label: "text-rose-800",
    value: "text-rose-600",
    sub: "text-rose-700/80",
    iconWrap: "bg-rose-100 text-rose-600",
  },
  sky: {
    wrap: "bg-gradient-to-br from-sky-50/90 via-white to-white border-sky-200/90 hover:border-sky-300",
    label: "text-sky-800",
    value: "text-sky-700",
    sub: "text-sky-700/80",
    iconWrap: "bg-sky-100 text-sky-700",
  },
  indigo: {
    wrap: "bg-gradient-to-br from-indigo-50/90 via-white to-white border-indigo-200/90 hover:border-indigo-300",
    label: "text-indigo-800",
    value: "text-indigo-700",
    sub: "text-indigo-700/80",
    iconWrap: "bg-indigo-100 text-indigo-700",
  },
  dark: {
    wrap: "bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border-slate-800 text-white",
    label: "text-slate-300",
    value: "text-emerald-400",
    sub: "text-slate-300/85",
    iconWrap: "bg-white/10 text-emerald-400",
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
  const baseClass = `group w-full text-left rounded-2xl border p-3.5 sm:p-4 transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
    active && activeToneClass
      ? activeToneClass
      : active
      ? "bg-slate-900 text-white border-slate-900 shadow-md"
      : styles.wrap
  } ${
    onClick || href
      ? "cursor-pointer hover:shadow-sm active:scale-[0.99]"
      : ""
  } ${className}`;

  const content = (
    <div className="flex flex-col h-full justify-between gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`text-[11px] font-bold tracking-tight leading-snug ${
            active ? "opacity-90" : styles.label
          }`}
        >
          {label}
        </span>
        {icon && (
          <span
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
              active ? "bg-white/15 text-white" : styles.iconWrap
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
      className={`bg-white rounded-2xl border border-slate-200/85 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden ${className}`}
    >
      {(title || headerRight) && (
        <div
          className={`px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5 ${headerClassName}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="shrink-0">{icon}</span>}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight truncate">
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
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200/90",
  amber: "bg-amber-50 text-amber-800 border-amber-200/90",
  rose: "bg-rose-50 text-rose-700 border-rose-200/90",
  sky: "bg-sky-50 text-sky-700 border-sky-200/90",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200/90",
  slate: "bg-slate-100 text-slate-700 border-slate-200/90",
  dark: "bg-slate-900 text-white border-slate-900",
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
      ? "bg-emerald-500"
      : tone === "amber"
      ? "bg-amber-500"
      : tone === "rose"
      ? "bg-rose-500"
      : tone === "sky"
      ? "bg-sky-500"
      : tone === "indigo"
      ? "bg-indigo-500"
      : tone === "dark"
      ? "bg-emerald-400"
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
      className={`fixed inset-0 ${zIndexClass} flex items-end sm:items-stretch sm:justify-end bg-slate-900/50 backdrop-blur-[2px]`}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className={`relative z-10 w-full ${maxWidthClass} bg-white h-[92dvh] sm:h-full rounded-t-3xl sm:rounded-none shadow-2xl border-t sm:border-t-0 sm:border-l border-slate-200 flex flex-col overflow-hidden animate-portal-drawer`}
      >
        {/* Mobile Pull Handle */}
        <div
          className={`sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 ${
            darkHeader ? "bg-slate-900" : "bg-white"
          }`}
        >
          <span
            className={`w-10 h-1.5 rounded-full ${
              darkHeader ? "bg-slate-700" : "bg-slate-200"
            }`}
          />
        </div>

        {/* Sticky Drawer Header */}
        <div
          className={`px-4 sm:px-6 py-3.5 sm:py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            darkHeader
              ? "bg-slate-900 text-white border-slate-800"
              : "bg-white text-slate-900 border-slate-200"
          }`}
        >
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div
                className={`text-[10px] font-extrabold uppercase tracking-wider mb-0.5 ${
                  darkHeader ? "text-emerald-400" : "text-[#009A4D]"
                }`}
              >
                {eyebrow}
              </div>
            )}
            <h2
              className={`text-sm sm:text-base font-extrabold truncate ${
                darkHeader ? "text-white" : "text-slate-900"
              }`}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className={`text-xs mt-0.5 truncate ${
                  darkHeader ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                darkHeader
                  ? "text-slate-300 hover:text-white hover:bg-slate-800"
                  : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              }`}
              aria-label="Close panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto portal-scroll p-4 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-5">
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
      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
        {icon}
      </div>
      <div className="space-y-1 max-w-sm mx-auto">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {description && (
          <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

