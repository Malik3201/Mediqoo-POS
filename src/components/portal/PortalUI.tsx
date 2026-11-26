"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";

/**
 * Shared solid, high-contrast Clinical-Executive Light UI primitives for AivraSol Owner Portal.
 *
 * Visual system:
 * - Page backdrop: Solid #F3F5F8
 * - Surface cards: Solid #FFFFFF with crisp 1px #D8E0EA borders
 * - Primary ink:   Solid #0F172A (Deep Slate)
 * - Primary action: Solid #0F766E (Clinical Teal/Emerald, hover #115E59)
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
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#D8E0EA]">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#0F172A] text-teal-300 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-[21px] font-extrabold text-[#0F172A] tracking-tight leading-snug">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs sm:text-[13px] text-slate-600 mt-0.5 leading-relaxed">
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
      className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-white border border-[#D8E0EA] text-xs font-bold text-[#0F172A] hover:bg-slate-50 hover:border-teal-600 active:scale-[0.97] active:opacity-90 transition-all duration-100 disabled:opacity-60 cursor-pointer"
    >
      <RefreshCw
        className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#0F766E]" : "text-[#0F766E]"}`}
      />
      <span>{loading ? "Syncing…" : label}</span>
    </button>
  );
}

export type PortalActionVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "warning"
  | "ghost"
  | "dark";

export type PortalActionSize = "sm" | "md" | "lg";

const ACTION_VARIANT_MAP: Record<PortalActionVariant, string> = {
  primary:
    "bg-[#0F766E] hover:bg-[#115E59] text-white border border-[#0F766E] shadow-2xs",
  secondary:
    "bg-white hover:bg-slate-50 text-[#0F172A] border border-[#D8E0EA] hover:border-slate-400",
  danger:
    "bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 shadow-2xs",
  warning:
    "bg-amber-600 hover:bg-amber-700 text-white border border-amber-700 shadow-2xs",
  ghost:
    "bg-slate-100 hover:bg-slate-200 text-[#0F172A] border border-transparent",
  dark:
    "bg-[#0F172A] hover:bg-slate-800 text-white border border-[#0F172A] shadow-2xs",
};

const ACTION_SIZE_MAP: Record<PortalActionSize, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs rounded-xl gap-1.5",
  md: "min-h-[42px] px-4 py-2 text-xs sm:text-[13px] rounded-xl gap-2",
  lg: "min-h-[46px] px-5 py-2.5 text-sm rounded-xl gap-2",
};

export interface PortalActionButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  loading?: boolean;
  loadingText?: string;
  variant?: PortalActionVariant;
  size?: PortalActionSize;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  allowRapidClick?: boolean;
}

/**
 * Reusable anti-double-click action button with automatic async busy lock,
 * inline Loader2 spinner, disabled state, and crisp tactile press feedback.
 */
export function PortalActionButton({
  onClick,
  loading = false,
  loadingText,
  variant = "primary",
  size = "md",
  icon,
  fullWidth = false,
  allowRapidClick = false,
  disabled = false,
  className = "",
  type = "button",
  children,
  ...rest
}: PortalActionButtonProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busyRef = useRef(false);

  const isBusy = loading || internalBusy;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || isBusy || busyRef.current) {
      e.preventDefault();
      return;
    }
    if (!onClick) return;

    const result = onClick(e);
    if (result && typeof (result as Promise<void>).then === "function") {
      busyRef.current = true;
      setInternalBusy(true);
      try {
        await result;
      } finally {
        busyRef.current = false;
        setInternalBusy(false);
      }
    }
  };

  return (
    <button
      type={type}
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      data-allow-rapid-click={allowRapidClick ? "true" : undefined}
      onClick={onClick ? (e) => void handleClick(e) : undefined}
      className={`inline-flex items-center justify-center font-bold active:scale-[0.97] active:opacity-90 transition-all duration-100 disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer select-none ${
        ACTION_VARIANT_MAP[variant]
      } ${ACTION_SIZE_MAP[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {isBusy ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : icon ? (
        <span className="shrink-0 inline-flex items-center">{icon}</span>
      ) : null}
      <span>{isBusy && loadingText ? loadingText : children}</span>
    </button>
  );
}

export interface PortalConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "primary";
  loading?: boolean;
}

/**
 * Mobile-first solid confirmation dialog with built-in async lock & spinner
 * for logout and all destructive / high-impact Owner Portal actions.
 */
export function PortalConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  loading = false,
}: PortalConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const isBusy = loading || busy;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current && !loading) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const toneConfig =
    tone === "danger"
      ? {
          iconBg: "bg-rose-50 border-rose-200 text-rose-700",
          Icon: ShieldAlert,
          confirmVariant: "danger" as const,
          topBar: "bg-rose-600",
        }
      : tone === "warning"
      ? {
          iconBg: "bg-amber-50 border-amber-200 text-amber-700",
          Icon: AlertTriangle,
          confirmVariant: "warning" as const,
          topBar: "bg-amber-500",
        }
      : {
          iconBg: "bg-teal-50 border-teal-200 text-[#0F766E]",
          Icon: CheckCircle2,
          confirmVariant: "primary" as const,
          topBar: "bg-[#0F766E]",
        };

  const ToneIcon = toneConfig.Icon;

  const handleConfirm = async () => {
    if (isBusy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-[#0F172A]/65 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-confirm-title"
    >
      <div
        className="fixed inset-0"
        onClick={() => {
          if (!isBusy) onClose();
        }}
      />
      <div className="relative z-10 w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-[#D8E0EA] shadow-2xl overflow-hidden animate-portal-drawer">
        {/* Top solid status bar */}
        <div className={`h-1.5 w-full ${toneConfig.topBar}`} />

        <div className="p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${toneConfig.iconBg}`}
            >
              <ToneIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                id="portal-confirm-title"
                className="text-base font-extrabold text-[#0F172A] leading-snug"
              >
                {title}
              </h3>
              {description && (
                <div className="text-xs sm:text-[13px] text-slate-600 mt-1.5 leading-relaxed">
                  {description}
                </div>
              )}
              {details && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-[#F3F5F8] border border-[#D8E0EA] text-[11.5px] font-semibold text-[#0F172A]">
                  {details}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 disabled:opacity-40"
              aria-label="Close confirmation dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[#E6ECF2]">
            <PortalActionButton
              variant="secondary"
              size="md"
              disabled={isBusy}
              onClick={onClose}
              className="w-full sm:w-auto"
            >
              {cancelLabel}
            </PortalActionButton>
            <PortalActionButton
              variant={toneConfig.confirmVariant}
              size="md"
              loading={isBusy}
              loadingText="Processing…"
              onClick={handleConfirm}
              className="w-full sm:w-auto"
            >
              {confirmLabel}
            </PortalActionButton>
          </div>
        </div>
      </div>
    </div>
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
    wrap: "bg-white border-[#D8E0EA] hover:border-slate-400",
    label: "text-slate-600",
    value: "text-[#0F172A]",
    sub: "text-slate-600",
    iconWrap: "bg-slate-100 text-slate-700 border border-slate-200",
  },
  emerald: {
    wrap: "bg-white border-[#D8E0EA] hover:border-[#0F766E]",
    label: "text-slate-600",
    value: "text-[#0F766E]",
    sub: "text-slate-600",
    iconWrap: "bg-teal-50 text-[#0F766E] border border-teal-200",
  },
  amber: {
    wrap: "bg-white border-[#D8E0EA] hover:border-amber-500",
    label: "text-slate-600",
    value: "text-amber-700",
    sub: "text-slate-600",
    iconWrap: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  rose: {
    wrap: "bg-white border-[#D8E0EA] hover:border-rose-500",
    label: "text-slate-600",
    value: "text-rose-700",
    sub: "text-slate-600",
    iconWrap: "bg-rose-50 text-rose-700 border border-rose-200",
  },
  sky: {
    wrap: "bg-white border-[#D8E0EA] hover:border-sky-500",
    label: "text-slate-600",
    value: "text-sky-800",
    sub: "text-slate-600",
    iconWrap: "bg-sky-50 text-sky-700 border border-sky-200",
  },
  indigo: {
    wrap: "bg-white border-[#D8E0EA] hover:border-slate-500",
    label: "text-slate-600",
    value: "text-[#0F172A]",
    sub: "text-slate-600",
    iconWrap: "bg-slate-100 text-slate-800 border border-slate-300",
  },
  dark: {
    wrap: "bg-[#0F172A] border-slate-800 text-white",
    label: "text-slate-300",
    value: "text-teal-300",
    sub: "text-slate-400",
    iconWrap: "bg-slate-800 text-teal-300 border border-slate-700",
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
  const baseClass = `group w-full text-left rounded-2xl border p-3.5 sm:p-4 transition-all ${
    active && activeToneClass
      ? activeToneClass
      : active
      ? "bg-[#0F172A] text-white border-[#0F172A] shadow-sm"
      : styles.wrap
  } ${
    onClick || href
      ? "cursor-pointer hover:shadow-sm active:scale-[0.98]"
      : ""
  } ${className}`;

  const content = (
    <div className="flex flex-col h-full justify-between gap-2">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`text-[11px] font-bold uppercase tracking-wider leading-snug ${
            active ? "text-slate-300" : styles.label
          }`}
        >
          {label}
        </span>
        {icon && (
          <span
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              active ? "bg-slate-800 text-teal-300 border border-slate-700" : styles.iconWrap
            }`}
          >
            {icon}
          </span>
        )}
      </div>

      <div
        className={`text-lg sm:text-xl font-extrabold tabular-nums tracking-tight leading-none truncate ${
          active ? "text-white" : styles.value
        }`}
      >
        {value}
      </div>

      {subtext && (
        <div
          className={`text-[11px] font-medium leading-snug ${
            active ? "text-slate-300" : styles.sub
          }`}
        >
          {subtext}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} prefetch={true} className={baseClass}>
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
      className={`bg-white rounded-2xl border border-[#D8E0EA] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden ${className}`}
    >
      {(title || headerRight) && (
        <div
          className={`px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-[#D8E0EA] flex flex-wrap items-center justify-between gap-2.5 ${headerClassName}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="shrink-0 text-[#0F766E]">{icon}</span>}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-extrabold text-[#0F172A] tracking-tight truncate">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-[11px] text-slate-600 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {headerRight && (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">{headerRight}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

const BADGE_MAP: Record<string, string> = {
  emerald: "bg-teal-50 text-teal-800 border-teal-300",
  amber: "bg-amber-50 text-amber-900 border-amber-300",
  rose: "bg-rose-50 text-rose-800 border-rose-300",
  sky: "bg-sky-50 text-sky-900 border-sky-300",
  indigo: "bg-slate-100 text-[#0F172A] border-slate-300",
  slate: "bg-slate-100 text-slate-800 border-slate-300",
  dark: "bg-[#0F172A] text-white border-slate-800",
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
      ? "bg-[#0F766E]"
      : tone === "amber"
      ? "bg-amber-500"
      : tone === "rose"
      ? "bg-rose-600"
      : tone === "sky"
      ? "bg-sky-600"
      : tone === "indigo"
      ? "bg-slate-700"
      : tone === "dark"
      ? "bg-teal-400"
      : "bg-slate-500";

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
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-end sm:items-stretch sm:justify-end bg-[#0F172A]/60`}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className={`relative z-10 w-full ${maxWidthClass} bg-[#F3F5F8] h-[92dvh] sm:h-full rounded-t-3xl sm:rounded-none shadow-2xl border-t sm:border-t-0 sm:border-l border-[#D8E0EA] flex flex-col overflow-hidden animate-portal-drawer`}
      >
        {/* Mobile Pull Handle */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 bg-[#0F172A]">
          <span className="w-11 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Sticky Solid Drawer Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-[#0F172A] text-white">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5 text-teal-400">
                {eyebrow}
              </div>
            )}
            <h2 className="text-sm sm:text-base font-extrabold truncate text-white">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs mt-0.5 truncate text-slate-300">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-slate-300 hover:text-white hover:bg-slate-800"
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
      <div className="w-12 h-12 rounded-2xl bg-[#F3F5F8] border border-[#D8E0EA] text-[#0F766E] flex items-center justify-center mx-auto">
        {icon}
      </div>
      <div className="space-y-1 max-w-md mx-auto">
        <p className="text-sm font-extrabold text-[#0F172A]">{title}</p>
        {description && (
          <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
