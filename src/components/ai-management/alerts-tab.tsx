"use client";

import { useState } from "react";
import { BellOff, CheckCheck, CheckCircle2, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { aiApi, errMsg, useAiAlerts, useAiAudit, useAiMutation, type AiAlert, type AuditLogRow } from "./api";
import { EmptyState, ErrorState, TableSkeletonRows } from "./shared";
import { SeverityBadge, fmtAgo, fmtDateTime } from "./status-badge";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

function AlertCard({ alert, busyId, onAct }: { alert: AiAlert; busyId: string | null; onAct: (id: string, a: "acknowledge" | "resolve") => void }) {
  const busy = busyId === alert.id;
  const resolved = alert.status === "resolved";
  const acked = alert.status === "acknowledged";
  return (
    <Card className={cn(alert.severity === "critical" && !resolved && "border-red-200")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={alert.severity} />
            <h3 className="text-sm font-semibold">{alert.title}</h3>
            {alert.occurrence_count > 1 && (
              <Badge variant="secondary" className="font-normal">
                Happened {alert.occurrence_count} times
              </Badge>
            )}
            {acked && <Badge variant="outline">Acknowledged</Badge>}
            {resolved && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                Resolved
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {!resolved && !acked && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct(alert.id, "acknowledge")}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCheck />} Acknowledge
              </Button>
            )}
            {!resolved && (
              <Button size="sm" disabled={busy} onClick={() => onAct(alert.id, "resolve")}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Resolve
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm">{alert.reason}</p>
        <div className="rounded-md bg-muted/60 p-3 text-sm">
          <span className="font-medium">Recommended action: </span>
          {alert.recommended_action}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1">
            <dt>Affects:</dt>
            <dd className="font-medium text-foreground">
              {alert.affected_entity_name || alert.affected_entity_id || "—"}
              {alert.affected_entity_type ? ` (${alert.affected_entity_type})` : ""}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Detected:</dt>
            <dd title={fmtDateTime(alert.first_detected_at)}>{fmtAgo(alert.first_detected_at)}</dd>
          </div>
          {alert.occurrence_count > 1 && (
            <div className="flex gap-1">
              <dt>Last seen:</dt>
              <dd title={fmtDateTime(alert.last_detected_at)}>{fmtAgo(alert.last_detected_at)}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function AlertsList() {
  const [status, setStatus] = useState("active");
  const { data, isLoading, error, refetch } = useAiAlerts(status);
  const [busyId, setBusyId] = useState<string | null>(null);
  const act = useAiMutation((v: { id: string; action: "acknowledge" | "resolve" }) => aiApi.actOnAlert(v.id, v.action));

  const onAct = async (id: string, action: "acknowledge" | "resolve") => {
    setBusyId(id);
    try {
      await act.mutateAsync({ id, action });
      toast.success(action === "resolve" ? "Alert resolved" : "Alert acknowledged");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Show</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Alert status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : alerts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BellOff className="h-5 w-5" />}
            title={status === "active" ? "No active alerts" : "No alerts here"}
            description={status === "active" ? "Everything is running smoothly." : "Nothing matches this filter."}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a} busyId={busyId} onAct={(id, action) => void onAct(id, action)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- audit ----------------------------- */

const SENSITIVE = /key|secret|token|password|fingerprint|hash/i;

function humanize(s: string) {
  return s
    .replace(/^ai[._-]/i, "")
    .replace(/[._-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Turn metadata into a short readable summary — never raw JSON, never secrets. */
function summarize(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (SENSITIVE.test(k) && !/_limit|tokens?_budget|max_/i.test(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const text = String(v);
      parts.push(`${humanize(k)}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(" · ");
}

function AuditTable() {
  const { data, isLoading, error, refetch } = useAiAudit();
  const logs: AuditLogRow[] = data?.logs ?? [];
  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeletonRows cols={5} />
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No AI activity logged yet" />
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</TableCell>
                    <TableCell className="text-sm font-medium">{humanize(l.action)}</TableCell>
                    <TableCell className="text-xs">{l.actor_email ?? "System"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{humanize(l.entity_type)}</TableCell>
                    <TableCell className="max-w-[360px] text-xs text-muted-foreground">{summarize(l.metadata) || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function AlertsTab() {
  const [view, setView] = useState<"alerts" | "audit">("alerts");
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Alerts or audit log" className="inline-flex rounded-lg bg-muted p-1">
        {(["alerts", "audit"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-md px-4 py-1 text-sm font-medium text-muted-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v && "bg-background text-foreground shadow",
            )}
          >
            {v === "alerts" ? "Alerts" : "Audit log"}
          </button>
        ))}
      </div>
      {view === "alerts" ? <AlertsList /> : <AuditTable />}
    </div>
  );
}
