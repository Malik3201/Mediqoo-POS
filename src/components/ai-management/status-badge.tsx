"use client";

import { formatDistanceToNowStrict, isFuture, format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Hourglass,
  ShieldAlert,
  Info,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AlertSeverity, KeyStatus, LicenseAiStatus } from "./api";

/* ---------------------------- formatters ---------------------------- */

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd MMM yyyy, HH:mm");
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDistanceToNowStrict(d)} ago`;
}

/** "resets in 4 minutes" when the date is in the future, otherwise null. */
export function resetsIn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !isFuture(d)) return null;
  return `resets in ${formatDistanceToNowStrict(d)}`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
}

/* ------------------------------ key status ------------------------------ */

export const KEY_STATUS_INFO: Record<KeyStatus, { tone: string; icon: typeof CheckCircle2; help: string }> = {
  Healthy: {
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
    help: "This key is working normally and can serve AI requests.",
  },
  "Rate Limited": {
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Hourglass,
    help: "Groq asked us to slow down. The key is paused for a short cooldown and returns automatically.",
  },
  "Temporarily Unavailable": {
    tone: "bg-orange-50 text-orange-700 border-orange-200",
    icon: AlertTriangle,
    help: "Groq had a temporary problem or timeout with this key. It is paused briefly and will be retried automatically.",
  },
  "Invalid Credentials": {
    tone: "bg-red-50 text-red-700 border-red-200",
    icon: XCircle,
    help: "Groq rejected this key (revoked, wrong or expired). Replace it with a new key.",
  },
  Disabled: {
    tone: "bg-slate-100 text-slate-600 border-slate-200",
    icon: CircleSlash,
    help: "Turned off by an admin. It will not be used until you enable it again.",
  },
  "Needs Attention": {
    tone: "bg-red-50 text-red-700 border-red-200",
    icon: ShieldAlert,
    help: "This key failed several times in a row. Test it, and replace it if the problem continues.",
  },
};

export function KeyStatusBadge({ status, cooldownUntil }: { status: KeyStatus; cooldownUntil?: string | null }) {
  const info = KEY_STATUS_INFO[status] ?? KEY_STATUS_INFO["Needs Attention"];
  const Icon = info.icon;
  const reset = resetsIn(cooldownUntil);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="outline" className={cn("gap-1 whitespace-nowrap font-medium", info.tone)}>
              <Icon className="h-3 w-3" aria-hidden />
              {status}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{info.help}</TooltipContent>
      </Tooltip>
      {reset && <span className="text-[11px] text-muted-foreground">{reset}</span>}
    </div>
  );
}

/* ------------------------------ license status ------------------------------ */

const LICENSE_TONE: Record<LicenseAiStatus, string> = {
  Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Grace Period": "bg-amber-50 text-amber-700 border-amber-200",
  "Renewal Required": "bg-orange-50 text-orange-700 border-orange-200",
  Suspended: "bg-red-50 text-red-700 border-red-200",
  Revoked: "bg-red-50 text-red-700 border-red-200",
  Unknown: "bg-slate-100 text-slate-600 border-slate-200",
};

export function LicenseStatusBadge({ status }: { status: LicenseAiStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", LICENSE_TONE[status] ?? LICENSE_TONE.Unknown)}>
      {status}
    </Badge>
  );
}

/* ------------------------------ severity ------------------------------ */

const SEVERITY: Record<AlertSeverity, { tone: string; icon: typeof Info; label: string }> = {
  critical: { tone: "bg-red-50 text-red-700 border-red-200", icon: ShieldAlert, label: "Critical" },
  warning: { tone: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertTriangle, label: "Warning" },
  info: { tone: "bg-sky-50 text-sky-700 border-sky-200", icon: Info, label: "Info" },
};

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY[severity] ?? SEVERITY.info;
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap font-medium", s.tone)}>
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

/* ------------------------------ request status ------------------------------ */

export function RequestStatusBadge({ status }: { status: string }) {
  const ok = /^(success|ok|completed)$/i.test(status);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium capitalize",
        ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200",
      )}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

