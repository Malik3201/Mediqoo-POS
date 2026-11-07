"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Cloud,
  Database,
  Server,
  RefreshCw,
  Settings,
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  HardDrive,
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  ShieldCheck,
  Activity,
  TrendingUp,
  KeyRound,
  Building2,
  Boxes,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString();
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "Healthy":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          Healthy
        </Badge>
      );
    case "Approaching Allowance":
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
          <Info className="w-3.5 h-3.5 mr-1" />
          Approaching Allowance
        </Badge>
      );
    case "Warning":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          Warning
        </Badge>
      );
    case "Critical":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          Critical
        </Badge>
      );
    case "Configuration Required":
      return (
        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
          <KeyRound className="w-3.5 h-3.5 mr-1" />
          Configuration Required
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          {status || "Provider Unavailable"}
        </Badge>
      );
  }
}

function getOriginBadge(origin: string) {
  switch (origin) {
    case "provider_api":
      return (
        <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
          Live Provider API
        </Badge>
      );
    case "database_stats":
      return (
        <Badge variant="outline" className="text-[11px] font-mono border-blue-500/30 text-blue-700 dark:text-blue-400">
          Live MongoDB $collStats
        </Badge>
      );
    case "internal_telemetry":
      return (
        <Badge variant="outline" className="text-[11px] font-mono border-purple-500/30 text-purple-700 dark:text-purple-400">
          Internal Telemetry
        </Badge>
      );
    case "configured_quota":
      return (
        <Badge variant="outline" className="text-[11px] font-mono">
          Configured Quota
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[11px] font-mono text-muted-foreground">
          Configuration Required
        </Badge>
      );
  }
}

export default function CloudResourceMonitorPage() {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters for MongoDB Collections
  const [collectionSearch, setCollectionSearch] = useState<string>("");
  const [selectedFeatureGroup, setSelectedFeatureGroup] = useState<string>("ALL");
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});

  // Filters for R2 Tenants
  const [tenantSearch, setTenantSearch] = useState<string>("");

  // Config Modal State
  const [configOpen, setConfigOpen] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [configDraft, setConfigDraft] = useState<{
    info_threshold_pct: number;
    warning_threshold_pct: number;
    critical_threshold_pct: number;
    r2_plan_tier: string;
    r2_free_storage_gb: number;
    r2_class_a_allowance: number;
    r2_class_b_allowance: number;
    mongodb_cluster_tier: string;
    mongodb_storage_limit_mb: number;
    vercel_plan_override: string;
  }>({
    info_threshold_pct: 70,
    warning_threshold_pct: 85,
    critical_threshold_pct: 95,
    r2_plan_tier: "Standard Free Tier (10 GB-Month + Paid Overage)",
    r2_free_storage_gb: 10,
    r2_class_a_allowance: 1_000_000,
    r2_class_b_allowance: 10_000_000,
    mongodb_cluster_tier: "M0 Free Tier",
    mongodb_storage_limit_mb: 512,
    vercel_plan_override: "Auto-Detect via API",
  });

  const loadReport = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const res = await fetch(
        `/api/admin/infrastructure/cloud-monitor${forceRefresh ? "?refresh=true" : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load Cloud Resource Monitor");
      }
      setReport(data);
      if (data.config) {
        setConfigDraft({
          info_threshold_pct: data.config.info_threshold_pct ?? 70,
          warning_threshold_pct: data.config.warning_threshold_pct ?? 85,
          critical_threshold_pct: data.config.critical_threshold_pct ?? 95,
          r2_plan_tier: data.config.r2_plan_tier || "Standard Free Tier (10 GB-Month + Paid Overage)",
          r2_free_storage_gb: Number(
            ((data.config.r2_free_storage_bytes || 10 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)).toFixed(2)
          ),
          r2_class_a_allowance: data.config.r2_class_a_allowance ?? 1_000_000,
          r2_class_b_allowance: data.config.r2_class_b_allowance ?? 10_000_000,
          mongodb_cluster_tier: data.config.mongodb_cluster_tier || "M0 Free Tier",
          mongodb_storage_limit_mb: Number(
            ((data.config.mongodb_storage_limit_bytes || 512 * 1024 * 1024) / (1024 * 1024)).toFixed(0)
          ),
          vercel_plan_override: data.config.vercel_plan_override || "Auto-Detect via API",
        });
      }
      if (forceRefresh) {
        if (data.refresh_cooldown_remaining_sec > 0 && data.cached) {
          toast.info(
            `Refresh cooldown active (${data.refresh_cooldown_remaining_sec}s remaining). Showing recent snapshot.`
          );
        } else {
          toast.success("Cloud infrastructure metrics refreshed from live providers");
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load Cloud Resource Monitor");
      toast.error(err?.message || "Failed to load Cloud Resource Monitor");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadReport(false);
  }, [loadReport]);

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const res = await fetch("/api/admin/infrastructure/cloud-monitor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            info_threshold_pct: Number(configDraft.info_threshold_pct),
            warning_threshold_pct: Number(configDraft.warning_threshold_pct),
            critical_threshold_pct: Number(configDraft.critical_threshold_pct),
            r2_plan_tier: configDraft.r2_plan_tier,
            r2_free_storage_bytes: Math.round(Number(configDraft.r2_free_storage_gb) * 1024 * 1024 * 1024),
            r2_class_a_allowance: Number(configDraft.r2_class_a_allowance),
            r2_class_b_allowance: Number(configDraft.r2_class_b_allowance),
            mongodb_cluster_tier: configDraft.mongodb_cluster_tier,
            mongodb_storage_limit_bytes: Math.round(
              Number(configDraft.mongodb_storage_limit_mb) * 1024 * 1024
            ),
            vercel_plan_override: configDraft.vercel_plan_override,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update configuration");
      }
      setReport(data.report);
      setConfigOpen(false);
      toast.success("Cloud monitor thresholds and allowances updated");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  const r2 = report?.providers?.cloudflare_r2;
  const mongo = report?.providers?.mongodb_atlas;
  const vercel = report?.providers?.vercel;

  const filteredCollections = useMemo(() => {
    const list: any[] = mongo?.collections || [];
    return list.filter((c) => {
      if (selectedFeatureGroup !== "ALL" && c.feature_group !== selectedFeatureGroup) {
        return false;
      }
      if (collectionSearch.trim()) {
        const q = collectionSearch.trim().toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.feature_group.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [mongo?.collections, selectedFeatureGroup, collectionSearch]);

  const filteredTenants = useMemo(() => {
    const list: any[] = r2?.tenant_attribution?.tenants || [];
    if (!tenantSearch.trim()) return list;
    const q = tenantSearch.trim().toLowerCase();
    return list.filter(
      (t) =>
        (t.pharmacy_name || "").toLowerCase().includes(q) ||
        (t.client_name || "").toLowerCase().includes(q) ||
        (t.license_key || "").toLowerCase().includes(q) ||
        (t.tenant_key || "").toLowerCase().includes(q)
    );
  }, [r2?.tenant_attribution?.tenants, tenantSearch]);

  const toggleCollectionExpand = (name: string) => {
    setExpandedCollections((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  if (loading && !report) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Cloud className="w-6 h-6 text-primary" />
              Cloud Resource Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Querying live Cloudflare R2 buckets, MongoDB Atlas cluster telemetry, and Vercel usage APIs...
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-24 bg-muted/30" />
              <CardContent className="h-36 bg-muted/10" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Cloud className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              Cloud Infrastructure & Resource Monitor
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              Super Admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Live capacity, free-tier allowances, per-pharmacy tenant attribution, and collection-level telemetry across Cloudflare R2, MongoDB Atlas, and Vercel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {report?.generated_at && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mr-2 bg-muted/40 px-2.5 py-1.5 rounded-md border">
              <Clock className="w-3.5 h-3.5" />
              <span>Snapshot: {formatDateTime(report.generated_at)}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">
                {report.cached ? "Cached (15m TTL)" : "Live Query"}
              </Badge>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="w-4 h-4 mr-1.5" />
            Thresholds & Quotas
          </Button>

          <Button
            size="sm"
            onClick={() => loadReport(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh Metrics"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadReport(true)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Alerts & Configuration Notices Banner */}
      {report?.alerts && report.alerts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {report.alerts.map((alert: any) => {
            const isCrit = alert.severity === "critical";
            const isWarn = alert.severity === "warning";
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3.5 rounded-lg border text-sm ${
                  isCrit
                    ? "bg-destructive/10 border-destructive/40 text-destructive"
                    : isWarn
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-800 dark:text-amber-300"
                    : "bg-blue-500/5 border-blue-500/30 text-foreground"
                }`}
              >
                <div className="mt-0.5">
                  {isCrit || isWarn ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <Info className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div className="space-y-0.5 flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    <span>{alert.provider}: {alert.title}</span>
                    {alert.usage_pct !== null && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {alert.usage_pct}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {alert.message}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Top 3 Provider Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card 1: Cloudflare R2 */}
        <Card className="border-t-4 border-t-orange-500 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base">Cloudflare R2 Object Storage</CardTitle>
                  <CardDescription className="text-xs">
                    {r2?.plan_tier || "Standard Free Tier (10 GB-Month)"}
                  </CardDescription>
                </div>
              </div>
              {getStatusBadge(r2?.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Current Snapshot Storage</span>
                <span className="font-bold text-base">
                  {formatBytes(r2?.storage?.total_bytes)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {formatBytes(r2?.storage?.free_allowance_bytes)} ({r2?.storage?.usage_pct ?? 0}%)
                  </span>
                </span>
              </div>
              <Progress value={Math.min(100, r2?.storage?.usage_pct || 0)} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                <span>Remaining Free Headroom: {formatBytes(r2?.storage?.remaining_free_bytes)}</span>
                <span>{formatNumber(r2?.storage?.total_objects)} objects ({r2?.buckets?.length || 0} buckets)</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs">
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Class A Ops (Write/List)</div>
                <div className="font-semibold mt-0.5">
                  {r2?.operations?.available
                    ? `${formatNumber(r2.operations.class_a_used)} / ${formatNumber(r2.operations.class_a_allowance)}`
                    : "Config Required"}
                </div>
              </div>
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Class B Ops (Read/Head)</div>
                <div className="font-semibold mt-0.5">
                  {r2?.operations?.available
                    ? `${formatNumber(r2.operations.class_b_used)} / ${formatNumber(r2.operations.class_b_allowance)}`
                    : "Config Required"}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>Origin:</span>
                {getOriginBadge(r2?.metric_origin)}
              </div>
              <span>Period: {r2?.billing_period?.label}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: MongoDB Atlas */}
        <Card className="border-t-4 border-t-emerald-600 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base">MongoDB Atlas Database</CardTitle>
                  <CardDescription className="text-xs">
                    {mongo?.plan_tier} · {mongo?.topology?.region || "AWS"} ({mongo?.topology?.replica_set || "Replica Set"})
                  </CardDescription>
                </div>
              </div>
              {getStatusBadge(mongo?.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Logical Data + Index Footprint</span>
                <span className="font-bold text-base">
                  {formatBytes(mongo?.storage?.logical_plus_index_bytes)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    / {formatBytes(mongo?.storage?.storage_limit_bytes)} ({mongo?.storage?.usage_pct ?? 0}%)
                  </span>
                </span>
              </div>
              <Progress value={Math.min(100, mongo?.storage?.usage_pct || 0)} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                <span>Remaining Headroom: {formatBytes(mongo?.storage?.remaining_bytes)}</span>
                <span>
                  {formatNumber(mongo?.storage?.collections_count)} collections · {formatNumber(mongo?.storage?.total_documents)} docs
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Logical Data</div>
                <div className="font-semibold mt-0.5">{formatBytes(mongo?.storage?.logical_data_size_bytes)}</div>
              </div>
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Disk Allocated</div>
                <div className="font-semibold mt-0.5">{formatBytes(mongo?.storage?.allocated_storage_size_bytes)}</div>
              </div>
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Total Indexes</div>
                <div className="font-semibold mt-0.5">{formatBytes(mongo?.storage?.index_size_bytes)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>Origin:</span>
                {getOriginBadge(mongo?.metric_origin)}
              </div>
              <span>{mongo?.topology?.node_count || 3}-Node Replica Set</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Vercel */}
        <Card className="border-t-4 border-t-slate-800 dark:border-t-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-slate-500/10 text-foreground">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base">Vercel Cloud & Serverless</CardTitle>
                  <CardDescription className="text-xs">
                    {vercel?.plan_tier || "Configuration Required"}
                  </CardDescription>
                </div>
              </div>
              {getStatusBadge(vercel?.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {vercel?.configured && vercel?.billing_charges?.available ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Current Period Billed Charges</span>
                  <span className="font-bold text-base">
                    ${Number(vercel.billing_charges.total_billed_cost_usd || 0).toFixed(2)} USD
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Effective Cost: ${Number(vercel.billing_charges.total_effective_cost_usd || 0).toFixed(2)} ·{" "}
                  {vercel.projects?.length || 0} Vercel project(s) discovered
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs space-y-1">
                <div className="font-semibold text-amber-800 dark:text-amber-300">
                  Direct Billing API Token Not Configured
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Add <code className="font-mono bg-background px-1 rounded">VERCEL_API_TOKEN</code> to display live FOCUS v1.3 function invocations, fluid compute GB-hours, and bandwidth usage.
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">AI Gateway (30d)</div>
                <div className="font-semibold mt-0.5">
                  {formatNumber(vercel?.internal_app_traffic?.ai_gateway_requests_30d)} reqs
                </div>
              </div>
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">POS Syncs (30d)</div>
                <div className="font-semibold mt-0.5">
                  {formatNumber(vercel?.internal_app_traffic?.analytics_events_30d)} events
                </div>
              </div>
              <div className="bg-muted/40 p-2 rounded border">
                <div className="text-muted-foreground">Metered API</div>
                <div className="font-semibold mt-0.5">
                  {formatNumber(vercel?.internal_app_traffic?.metered_api_requests_month)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>Origin:</span>
                {getOriginBadge(vercel?.metric_origin)}
              </div>
              <a
                href={vercel?.dashboard_url || "https://vercel.com/dashboard/usage"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              >
                Vercel Usage <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Provider Tabs */}
      <Tabs defaultValue="r2" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto p-1">
          <TabsTrigger value="r2" className="py-2">
            <HardDrive className="w-4 h-4 mr-2" />
            Cloudflare R2 ({formatBytes(r2?.storage?.total_bytes)})
          </TabsTrigger>
          <TabsTrigger value="mongodb" className="py-2">
            <Database className="w-4 h-4 mr-2" />
            MongoDB Atlas ({mongo?.storage?.collections_count || 0} Colls)
          </TabsTrigger>
          <TabsTrigger value="vercel" className="py-2">
            <Server className="w-4 h-4 mr-2" />
            Vercel & API Traffic
          </TabsTrigger>
          <TabsTrigger value="trends" className="py-2">
            <TrendingUp className="w-4 h-4 mr-2" />
            Trends & Setup Guide
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: CLOUDFLARE R2 ================= */}
        <TabsContent value="r2" className="space-y-6">
          {/* R2 Storage & Billing Rules Explanation */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">R2 Storage Capacity & Billing Rules</CardTitle>
                    <CardDescription>
                      Live S3 bucket inventory + Cloudflare GraphQL Analytics breakdown
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/storage">
                      <HardDrive className="w-4 h-4 mr-1.5" />
                      Open Storage Cleanup & Retention
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Standard Storage</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatBytes(r2?.storage?.standard_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      10 GB-month free tier eligible
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Infrequent Access (IA)</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatBytes(r2?.storage?.infrequent_access_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Not covered by free tier
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Protected Objects</div>
                    <div className="text-lg font-bold mt-0.5 text-emerald-600 dark:text-emerald-400">
                      {formatBytes(
                        (r2?.categories || []).reduce((s: number, c: any) => s + (c.protected_bytes || 0), 0)
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Active releases & latest backups
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Reclaimable Candidates</div>
                    <div className="text-lg font-bold mt-0.5 text-amber-600 dark:text-amber-400">
                      {formatBytes(
                        (r2?.categories || []).reduce((s: number, c: any) => s + (c.reclaimable_bytes || 0), 0)
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Safe cleanup eligible in /storage
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">GB-Month Billing vs Current Snapshot:</strong>{" "}
                  {r2?.storage?.billing_note}
                </div>
              </CardContent>
            </Card>

            {/* Class A / Class B Operations Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Monthly R2 Operations (Class A & B)</CardTitle>
                <CardDescription>
                  Free tier: 1M Class A + 10M Class B operations / month
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {r2?.operations?.available ? (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">Class A (PutObject, ListObjects, Copy)</span>
                        <span className="font-mono">
                          {formatNumber(r2.operations.class_a_used)} / {formatNumber(r2.operations.class_a_allowance)} ({r2.operations.class_a_usage_pct}%)
                        </span>
                      </div>
                      <Progress value={Math.min(100, r2.operations.class_a_usage_pct || 0)} className="h-2" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">Class B (GetObject, HeadObject)</span>
                        <span className="font-mono">
                          {formatNumber(r2.operations.class_b_used)} / {formatNumber(r2.operations.class_b_allowance)} ({r2.operations.class_b_usage_pct}%)
                        </span>
                      </div>
                      <Progress value={Math.min(100, r2.operations.class_b_usage_pct || 0)} className="h-2" />
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs space-y-2">
                    <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4" />
                      Configuration Required: CLOUDFLARE_API_TOKEN
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      {r2?.operations?.reason}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Per-Bucket Breakdown Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Discovered Cloudflare R2 Buckets ({r2?.buckets?.length || 0})</CardTitle>
              <CardDescription>
                All buckets discovered via live S3 ListBuckets + ListObjectsV2 inspection on your Cloudflare account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bucket Name</TableHead>
                    <TableHead>Role / Application Purpose</TableHead>
                    <TableHead className="text-right">Objects</TableHead>
                    <TableHead className="text-right">Standard Storage</TableHead>
                    <TableHead className="text-right">Infrequent Access</TableHead>
                    <TableHead className="text-right">Total Size</TableHead>
                    <TableHead className="text-right">Class A / B Ops (Month)</TableHead>
                    <TableHead className="text-right">Last Modified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(r2?.buckets || []).map((b: any) => (
                    <TableRow key={b.bucket_name}>
                      <TableCell className="font-mono font-medium">
                        {b.bucket_name}
                        {b.is_primary_pos_bucket && (
                          <Badge className="ml-2 text-[10px]" variant="secondary">
                            Primary POS
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.purpose}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(b.object_count)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBytes(b.standard_bytes)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBytes(b.infrequent_access_bytes)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatBytes(b.total_bytes)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {b.class_a_ops_month !== null
                          ? `${formatNumber(b.class_a_ops_month)} A / ${formatNumber(b.class_b_ops_month)} B`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDateTime(b.last_modified)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* R2 Object Categories Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">R2 Storage Breakdown by Application Category</CardTitle>
              <CardDescription>
                Classified across Pharmacy Cloud Backups, Software Releases, Migration Uploads/Packages, and Other Buckets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Objects</TableHead>
                    <TableHead className="text-right">Total Bytes</TableHead>
                    <TableHead className="text-right">% of R2</TableHead>
                    <TableHead className="text-right">Protected Bytes</TableHead>
                    <TableHead className="text-right">Reclaimable Bytes</TableHead>
                    <TableHead className="text-right">Latest Object</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(r2?.categories || []).map((c: any) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-medium">{c.label}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(c.object_count)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatBytes(c.total_bytes)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.share_pct}%</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {formatBytes(c.protected_bytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                        {formatBytes(c.reclaimable_bytes)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDateTime(c.latest_modified)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Per-Pharmacy Tenant Attribution Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    Per-Pharmacy Tenant Storage vs Shared Global Infrastructure
                  </CardTitle>
                  <CardDescription>
                    Tenant-Owned Storage: {formatBytes(r2?.tenant_attribution?.tenant_owned_bytes)} ({r2?.tenant_attribution?.tenant_owned_objects || 0} objects) · Shared Global Infrastructure (Releases, Shared Assets): {formatBytes(r2?.tenant_attribution?.shared_global_bytes)} ({r2?.tenant_attribution?.shared_global_objects || 0} objects)
                  </CardDescription>
                </div>
                <div className="relative w-full md:w-72">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter pharmacy, client, license..."
                    value={tenantSearch}
                    onChange={(e) => setTenantSearch(e.target.value)}
                    className="pl-8 h-9 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pharmacy / Tenant</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>License Key</TableHead>
                    <TableHead className="text-right">Cloud Backups</TableHead>
                    <TableHead className="text-right">Migration Files</TableHead>
                    <TableHead className="text-right">Total Tenant Storage</TableHead>
                    <TableHead>Attribution Source</TableHead>
                    <TableHead className="text-right">Latest Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                        No tenant storage records match your filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTenants.map((t: any) => (
                      <TableRow key={t.tenant_key}>
                        <TableCell className="font-medium">{t.pharmacy_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.client_name || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {t.license_key || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {t.backup_count} ({formatBytes(t.backup_bytes)})
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {t.migration_count} ({formatBytes(t.migration_bytes)})
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatBytes(t.total_bytes)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {t.attribution_source}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatDateTime(t.latest_backup_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 2: MONGODB ATLAS ================= */}
        <TabsContent value="mongodb" className="space-y-6">
          {/* Cluster Topology & Storage Semantics */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">MongoDB Atlas Cluster Topology & Quota Semantics</CardTitle>
                <CardDescription>
                  Primary Host: <code className="font-mono text-xs">{mongo?.topology?.primary_host}</code> · Replica Set: <code className="font-mono text-xs">{mongo?.topology?.replica_set}</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Logical Data (dataSize)</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatBytes(mongo?.storage?.logical_data_size_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Uncompressed BSON payload
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">WiredTiger Allocated</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatBytes(mongo?.storage?.allocated_storage_size_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Compressed disk blocks
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Total Index Size</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatBytes(mongo?.storage?.index_size_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      B-Tree index footprint
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Combined Logical + Index</div>
                    <div className="text-lg font-bold mt-0.5 text-emerald-600 dark:text-emerald-400">
                      {formatBytes(mongo?.storage?.logical_plus_index_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {mongo?.storage?.usage_pct}% of {formatBytes(mongo?.storage?.storage_limit_bytes)}
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Quota Source & Calculation:</strong>{" "}
                  {mongo?.quota_source}
                </div>
              </CardContent>
            </Card>

            {/* Databases on Cluster */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cluster Databases</CardTitle>
                <CardDescription>
                  Active database: <code className="font-mono">{mongo?.topology?.database_name}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Database</TableHead>
                      <TableHead className="text-right">Size on Disk</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(mongo?.databases || []).map((dbItem: any) => (
                      <TableRow key={dbItem.name}>
                        <TableCell className="font-mono font-medium">{dbItem.name}</TableCell>
                        <TableCell className="text-right font-mono">{formatBytes(dbItem.size_on_disk_bytes)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-[10px]">
                            {dbItem.empty ? "Empty" : "Active"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Application Feature Group Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">MongoDB Footprint by Application Feature Group</CardTitle>
              <CardDescription>
                Click any feature group below to filter the 44-collection inspection table
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedFeatureGroup("ALL")}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    selectedFeatureGroup === "ALL"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <div className="text-xs font-medium text-muted-foreground">All Collections</div>
                  <div className="text-lg font-bold mt-0.5">
                    {formatBytes(mongo?.storage?.logical_plus_index_bytes)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {mongo?.collections?.length || 0} collections · {formatNumber(mongo?.storage?.total_documents)} docs
                  </div>
                </button>
                {(mongo?.feature_groups || []).map((fg: any) => (
                  <button
                    key={fg.feature_group}
                    type="button"
                    onClick={() =>
                      setSelectedFeatureGroup(
                        selectedFeatureGroup === fg.feature_group ? "ALL" : fg.feature_group
                      )
                    }
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selectedFeatureGroup === fg.feature_group
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{fg.feature_group}</span>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {fg.share_pct}%
                      </Badge>
                    </div>
                    <div className="text-base font-bold mt-1">
                      {formatBytes(fg.combined_logical_plus_index_bytes)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {fg.collections_count} colls · {formatNumber(fg.document_count)} docs
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Searchable 44-Collection + Per-Index Breakdown Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Collection & Index Breakdown ({filteredCollections.length} of {mongo?.collections?.length || 0})
                  </CardTitle>
                  <CardDescription>
                    Click any row to inspect individual B-Tree index sizes from live MongoDB <code className="font-mono">$collStats</code>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selectedFeatureGroup !== "ALL" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedFeatureGroup("ALL")}
                      className="text-xs h-9"
                    >
                      Clear Group Filter ({selectedFeatureGroup})
                    </Button>
                  )}
                  <div className="relative w-full md:w-72">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search collection name..."
                      value={collectionSearch}
                      onChange={(e) => setCollectionSearch(e.target.value)}
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Collection</TableHead>
                    <TableHead>Feature Group</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Documents</TableHead>
                    <TableHead className="text-right">Avg Doc</TableHead>
                    <TableHead className="text-right">Logical Data</TableHead>
                    <TableHead className="text-right">Disk Allocated</TableHead>
                    <TableHead className="text-right">Indexes</TableHead>
                    <TableHead className="text-right">Combined Footprint</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCollections.map((c: any) => {
                    const isExpanded = Boolean(expandedCollections[c.name]);
                    return (
                      <React.Fragment key={c.name}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleCollectionExpand(c.name)}
                        >
                          <TableCell>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-medium text-xs">{c.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.feature_group}</TableCell>
                          <TableCell>
                            <Badge
                              variant={c.is_tenant_scoped ? "secondary" : "outline"}
                              className="text-[10px]"
                            >
                              {c.is_tenant_scoped ? "Tenant-Scoped" : "Global"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatNumber(c.document_count)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {formatBytes(c.avg_obj_size_bytes)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatBytes(c.logical_data_size_bytes)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {formatBytes(c.allocated_storage_size_bytes)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {c.index_count} ({formatBytes(c.total_index_size_bytes)})
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-xs">
                            {formatBytes(c.combined_logical_plus_index_bytes)}
                          </TableCell>
                        </TableRow>
                        {isExpanded && c.indexes && c.indexes.length > 0 && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={10} className="p-3">
                              <div className="text-xs font-semibold mb-2 text-muted-foreground">
                                Indexes on <code className="font-mono text-foreground">{c.name}</code> ({c.indexes.length}):
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {c.indexes.map((idx: any) => (
                                  <div
                                    key={idx.name}
                                    className="flex items-center justify-between p-2 rounded border bg-background text-xs font-mono"
                                  >
                                    <span className="truncate mr-2" title={idx.name}>
                                      {idx.name}
                                    </span>
                                    <span className="text-muted-foreground shrink-0">
                                      {formatBytes(idx.size_bytes)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 3: VERCEL & APPLICATION TRAFFIC ================= */}
        <TabsContent value="vercel" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Vercel Direct API Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Vercel Cloud Billing & Projects API</CardTitle>
                    <CardDescription>
                      Official Vercel REST + FOCUS v1.3 <code className="font-mono">/v1/billing/charges</code> integration
                    </CardDescription>
                  </div>
                  {getStatusBadge(vercel?.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!vercel?.configured ? (
                  <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-3 text-sm">
                    <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <KeyRound className="w-4 h-4" />
                      Configuration Required: VERCEL_API_TOKEN
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {vercel?.setup_instructions}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Badge variant="outline" className="font-mono text-xs">
                        Required: VERCEL_API_TOKEN
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        Optional: VERCEL_TEAM_ID
                      </Badge>
                    </div>
                    <div className="pt-2">
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={vercel?.dashboard_url || "https://vercel.com/dashboard/usage"}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Vercel Usage Dashboard <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="p-3 rounded-lg border bg-muted/20">
                        <div className="text-xs text-muted-foreground">Account / Team</div>
                        <div className="font-bold mt-0.5">{vercel.account_name || "Configured"}</div>
                        <div className="text-xs text-muted-foreground">Plan: {vercel.plan_tier}</div>
                      </div>
                      <div className="p-3 rounded-lg border bg-muted/20">
                        <div className="text-xs text-muted-foreground">Current Period Billed</div>
                        <div className="font-bold mt-0.5">
                          ${Number(vercel.billing_charges?.total_billed_cost_usd || 0).toFixed(2)} USD
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Effective: ${Number(vercel.billing_charges?.total_effective_cost_usd || 0).toFixed(2)} USD
                        </div>
                      </div>
                    </div>

                    {vercel.billing_charges?.by_service?.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Service / Meter</TableHead>
                            <TableHead className="text-right">Consumed Quantity</TableHead>
                            <TableHead className="text-right">Billed USD</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vercel.billing_charges.by_service.map((s: any) => (
                            <TableRow key={s.service_name}>
                              <TableCell className="font-medium text-xs">{s.service_name}</TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {formatNumber(s.consumed_quantity)} {s.unit}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold">
                                ${Number(s.billed_cost_usd || 0).toFixed(4)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Supplementary Internal Application Traffic Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Internal Application Traffic (MongoDB Recorded)</CardTitle>
                    <CardDescription>
                      Actual API workload recorded by AivraSol collections (supplementary to Vercel edge billing)
                    </CardDescription>
                  </div>
                  {getOriginBadge("internal_telemetry")}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">AI Gateway Calls (This Month)</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatNumber(vercel?.internal_app_traffic?.ai_gateway_requests_month)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last 30d: {formatNumber(vercel?.internal_app_traffic?.ai_gateway_requests_30d)} requests
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">POS Telemetry Syncs (Month)</div>
                    <div className="text-lg font-bold mt-0.5">
                      {formatNumber(vercel?.internal_app_traffic?.analytics_events_month)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last 30d: {formatNumber(vercel?.internal_app_traffic?.analytics_events_30d)} events
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded-md bg-muted/40 border text-xs text-muted-foreground leading-relaxed">
                  {vercel?.internal_app_traffic?.note}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================= TAB 4: TRENDS & SETUP GUIDE ================= */}
        <TabsContent value="trends" className="space-y-6">
          {/* Historical Trend Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historical Storage Growth Snapshots</CardTitle>
              <CardDescription>
                Daily recorded snapshots of Cloudflare R2 and MongoDB Atlas capacity usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">R2 Objects</TableHead>
                    <TableHead className="text-right">R2 Total Bytes</TableHead>
                    <TableHead className="text-right">MongoDB Logical Data</TableHead>
                    <TableHead className="text-right">MongoDB Index Size</TableHead>
                    <TableHead className="text-right">MongoDB Combined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.trends?.points || []).map((pt: any) => (
                    <TableRow key={pt.date}>
                      <TableCell className="font-mono text-xs font-medium">{pt.date}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatNumber(pt.r2_objects)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">
                        {formatBytes(pt.r2_total_bytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatBytes(pt.mongodb_logical_bytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatBytes(pt.mongodb_index_bytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">
                        {formatBytes(pt.mongodb_logical_bytes + pt.mongodb_index_bytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Provider Credentials Status & Setup Guide */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider API Credentials & Least-Privilege Setup Guide</CardTitle>
              <CardDescription>
                Server-side environment variable status (secret values are never exposed to the browser)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Environment Variable(s)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Required Permission / Scope</TableHead>
                    <TableHead>Metrics Powered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Cloudflare R2 (S3 API)</TableCell>
                    <TableCell className="font-mono text-xs">
                      R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">R2 Object Read / ListBuckets</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Live bucket discovery, object counts, byte sizes, storage classes, tenant attribution
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Cloudflare GraphQL Analytics</TableCell>
                    <TableCell className="font-mono text-xs">CLOUDFLARE_API_TOKEN</TableCell>
                    <TableCell>
                      {r2?.operations?.available ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                          Optional (Not Set)
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">Account Analytics: Read</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Monthly Class A & Class B operation counts (`r2OperationsAdaptiveGroups`) & metadata bytes
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">MongoDB Atlas Driver</TableCell>
                    <TableCell className="font-mono text-xs">MONGODB_URI</TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">Database Reader / dbStats / $collStats</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Cluster topology, logical dataSize, allocated storageSize, indexSize, 44-collection & per-index breakdown
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Vercel REST & Billing API</TableCell>
                    <TableCell className="font-mono text-xs">VERCEL_API_TOKEN, VERCEL_TEAM_ID</TableCell>
                    <TableCell>
                      {vercel?.configured ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                          Optional (Not Set)
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">Read-only Account / Team Billing & Projects</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Live project list and FOCUS v1.3 `/v1/billing/charges` usage & cost breakdown
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Configure Thresholds & Quotas Modal */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure Cloud Thresholds & Plan Allowances</DialogTitle>
            <DialogDescription>
              Customize alert thresholds and plan quotas used when a provider API does not expose account-tier limits directly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Info Threshold (%)</Label>
                <Input
                  type="number"
                  value={configDraft.info_threshold_pct}
                  onChange={(e) =>
                    setConfigDraft((d) => ({ ...d, info_threshold_pct: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Warning Threshold (%)</Label>
                <Input
                  type="number"
                  value={configDraft.warning_threshold_pct}
                  onChange={(e) =>
                    setConfigDraft((d) => ({ ...d, warning_threshold_pct: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Critical Threshold (%)</Label>
                <Input
                  type="number"
                  value={configDraft.critical_threshold_pct}
                  onChange={(e) =>
                    setConfigDraft((d) => ({ ...d, critical_threshold_pct: Number(e.target.value) }))
                  }
                />
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="font-semibold text-xs uppercase text-muted-foreground">
                Cloudflare R2 Allowances
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Free Standard Storage (GB)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={configDraft.r2_free_storage_gb}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, r2_free_storage_gb: Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Plan Label</Label>
                  <Input
                    value={configDraft.r2_plan_tier}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, r2_plan_tier: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="font-semibold text-xs uppercase text-muted-foreground">
                MongoDB Atlas Quota
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cluster Tier Label</Label>
                  <Input
                    value={configDraft.mongodb_cluster_tier}
                    onChange={(e) =>
                      setConfigDraft((d) => ({ ...d, mongodb_cluster_tier: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Storage Quota Limit (MB)</Label>
                  <Input
                    type="number"
                    value={configDraft.mongodb_storage_limit_mb}
                    onChange={(e) =>
                      setConfigDraft((d) => ({
                        ...d,
                        mongodb_storage_limit_mb: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfig} disabled={savingConfig}>
              {savingConfig ? "Saving..." : "Save Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

