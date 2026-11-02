"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Eye,
  History,
  AlertTriangle,
  CheckCircle2,
  Database,
  Rocket,
  Archive,
  FileWarning,
  Layers,
  Clock,
  Pin,
  PinOff,
  Settings,
  Search,
  CalendarPlus,
  Lock,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatAge(iso?: string): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const POLICY_LABELS: Record<string, { label: string; description: string }> = {
  migration_source_files: {
    label: "Migration Source Uploads",
    description: "Completed migration .BAK/.ZIP uploads (after verified .aivrabak output) and expired failed/abandoned uploads",
  },
  expired_converted_packages: {
    label: "Expired & Superseded Migration Packages",
    description: "Converted .aivrabak packages past retention expiry, confirmed restored, or superseded by newer verified conversions",
  },
  failed_upload_artifacts: {
    label: "Incomplete / Abandoned Upload Artifacts",
    description: "Stale pending_upload / failed objects where the pharmacy already has >= 2 newer verified backups in R2",
  },
  redundant_auto_backups: {
    label: "Redundant Automatic Pharmacy Backups",
    description: "Older automatic backups beyond the protected recovery set (latest 2 verified + pinned + rolling window)",
  },
  expired_temporary_exports: {
    label: "Expired Temporary Files",
    description: "Scratch exports and temporary objects past retention window",
  },
  abandoned_multipart_uploads: {
    label: "Abandoned Multipart Uploads",
    description: "Incomplete multipart upload sessions inactive for > 24 hours",
  },
  superseded_releases: {
    label: "Approved Superseded Releases",
    description: "Older superseded release binaries explicitly approved for cleanup by Super Admin",
  },
};

export default function StorageManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("categories");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "protected" | "eligible" | "review">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dry run / Execute states
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [runningExecute, setRunningExecute] = useState(false);
  const [confirmExecuteOpen, setConfirmExecuteOpen] = useState(false);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>(Object.keys(POLICY_LABELS));
  const [reconcileDb, setReconcileDb] = useState(true);

  // Settings Dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<any>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningPortalCompaction, setRunningPortalCompaction] = useState(false);

  const handleRunPortalCompaction = async () => {
    setRunningPortalCompaction(true);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_portal_retention_compaction" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to run retention compaction");
      toast.success(
        `Owner Portal retention compaction complete: ${json.compacted_count || 0} older event(s) compacted`
      );
      if (json.mongodb_telemetry) {
        setData((prev: any) =>
          prev ? { ...prev, mongodb_telemetry: json.mongodb_telemetry } : prev
        );
      }
    } catch (err: any) {
      toast.error(err.message || "Compaction failed");
    } finally {
      setRunningPortalCompaction(false);
    }
  };

  const fetchInventory = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true);
      else setLoading(true);
      const res = await fetch(`/api/admin/storage${force ? "?refresh=true" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load storage inventory");
      setData(json);
      setConfigDraft({
        ...json.inventory.config,
        budget_gb: Number((json.inventory.config.budget_bytes / (1024 * 1024 * 1024)).toFixed(2)),
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch storage data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory(false);
  }, [fetchInventory]);

  const handleDryRun = async () => {
    setRunningDryRun(true);
    try {
      const res = await fetch("/api/admin/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "dry_run",
          policies: selectedPolicies,
          reconcileDbMetadata: reconcileDb,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Dry run failed");
      setDryRunResult(json.result);
      setActiveTab("cleanup");
      toast.success(
        `Preview complete: ${json.result.candidates_count} eligible object(s), ${formatBytes(json.result.reclaimable_bytes)} reclaimable`
      );
    } catch (err: any) {
      toast.error(err.message || "Preview failed");
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleExecuteCleanup = async () => {
    setRunningExecute(true);
    try {
      const res = await fetch("/api/admin/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "execute",
          policies: selectedPolicies,
          reconcileDbMetadata: reconcileDb,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Safe cleanup failed");
      setConfirmExecuteOpen(false);
      setDryRunResult(json.result);
      toast.success(
        `Safe cleanup completed: ${json.result.deleted_count} object(s) deleted (${formatBytes(
          json.result.deleted_bytes
        )} freed), ${json.result.db_reconciled_count} metadata record(s) reconciled`
      );
      await fetchInventory(true);
    } catch (err: any) {
      toast.error(err.message || "Cleanup execution failed");
    } finally {
      setRunningExecute(false);
    }
  };

  const handlePinBackup = async (backupId: string, pinned: boolean) => {
    try {
      const res = await fetch("/api/admin/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pin_backup",
          backupId,
          pinned,
          reason: pinned ? "Pinned by Super Admin in Storage Management" : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update backup pin");
      toast.success(pinned ? "Backup pinned and protected" : "Backup unpinned");
      await fetchInventory(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExtendMigrationPkg = async (jobId: string, days = 7) => {
    try {
      const res = await fetch("/api/admin/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_migration_retention",
          jobId,
          extend_days: days,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to extend package retention");
      toast.success(`Extended package expiry by ${days} days`);
      await fetchInventory(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleToggleReleaseApproval = async (releaseId: string, approved: boolean) => {
    try {
      const res = await fetch("/api/admin/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_release_retention",
          releaseId,
          cleanup_approved: approved,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update release approval");
      toast.success(approved ? "Superseded release approved for cleanup" : "Release cleanup approval revoked");
      await fetchInventory(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleSaveSettings = async () => {
    if (!configDraft) return;
    setSavingSettings(true);
    try {
      const payload = {
        ...configDraft,
        budget_bytes: Math.round(Number(configDraft.budget_gb || 10) * 1024 * 1024 * 1024),
      };
      const res = await fetch("/api/admin/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save settings");
      toast.success("Storage budget & retention settings updated");
      setSettingsOpen(false);
      await fetchInventory(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const inventory = data?.inventory;
  const overview = inventory?.overview;
  const categoriesMap = inventory?.categories || {};
  const categoryList = useMemo(() => Object.values(categoriesMap) as any[], [categoriesMap]);

  const filteredObjects = useMemo(() => {
    const all: any[] = inventory?.objects || [];
    return all.filter((obj) => {
      if (selectedCategory !== "all" && obj.category !== selectedCategory) return false;
      if (statusFilter === "protected" && !obj.protected) return false;
      if (statusFilter === "eligible" && !obj.cleanup_eligible) return false;
      if (statusFilter === "review" && !obj.requires_admin_approval) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = [
          obj.key,
          obj.owner?.pharmacy_name,
          obj.owner?.client_name,
          obj.owner?.license_key,
          obj.migration_job?.job_number,
          obj.release_info?.version,
          obj.cleanup_reason,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inventory, selectedCategory, statusFilter, searchQuery]);

  const eligibleSummaryForModal = useMemo(() => {
    const all: any[] = inventory?.objects || [];
    const policySet = new Set(selectedPolicies);
    const matching = all.filter(
      (o) => !o.protected && o.cleanup_eligible && o.cleanup_policy && policySet.has(o.cleanup_policy)
    );
    const bytes = matching.reduce((s, o) => s + (o.size_bytes || 0), 0);
    return { count: matching.length, bytes, items: matching };
  }, [inventory, selectedPolicies]);

  if (loading && !inventory) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <HardDrive className="h-6 w-6 text-primary" /> Storage Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Scanning Cloudflare R2 object inventory and verifying customer backup protections…
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-32 animate-pulse bg-muted/30" />
          ))}
        </div>
      </div>
    );
  }

  const thresholdColor =
    overview?.threshold_state === "critical"
      ? "text-red-600 border-red-300 bg-red-50"
      : overview?.threshold_state === "high"
        ? "text-amber-700 border-amber-300 bg-amber-50"
        : overview?.threshold_state === "warning"
          ? "text-yellow-700 border-yellow-300 bg-yellow-50"
          : "text-emerald-700 border-emerald-200 bg-emerald-50";

  return (
    <div className="space-y-6">
      {/* Header & Main Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <HardDrive className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">R2 Storage Management</h1>
            <Badge variant="outline" className="font-mono text-xs">
              Bucket: {inventory?.bucket || "mediqoo"}
            </Badge>
            <Badge variant="outline" className={thresholdColor}>
              {overview?.threshold_state === "normal"
                ? "Healthy Capacity"
                : `${overview?.threshold_state?.toUpperCase()} Usage`}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Centralized Cloudflare R2 object inventory, disaster-recovery backup protection, and automated lifecycle cleanup.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchInventory(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Storage Usage
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDryRun}
            disabled={runningDryRun || runningExecute}
          >
            <Eye className="h-4 w-4 mr-1.5" />
            {runningDryRun ? "Scanning…" : "Preview Cleanup"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setConfirmExecuteOpen(true)}
            disabled={runningExecute}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Run Safe Cleanup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedCategory("all");
              setStatusFilter("protected");
              setActiveTab("protected");
            }}
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Review Protected Files
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveTab("history")}
          >
            <History className="h-4 w-4 mr-1.5" />
            Cleanup History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            title="Storage Budget & Policy Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Alert Banners */}
      {inventory?.alerts?.length > 0 && (
        <div className="space-y-2">
          {inventory.alerts.map((alert: any, idx: number) => (
            <div
              key={idx}
              className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                alert.level === "critical"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : alert.level === "high" || alert.level === "warning"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-blue-200 bg-blue-50/70 text-blue-900"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {alert.level === "info" ? (
                  <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                )}
                <div>
                  <span className="font-semibold">{alert.title}: </span>
                  <span>{alert.message}</span>
                </div>
              </div>
              {alert.code === "RECLAIMABLE_SPACE_AVAILABLE" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-white shrink-0"
                  onClick={handleDryRun}
                >
                  Preview Reclaimable
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Overview KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Total R2 Storage Used</span>
              <span className="font-mono text-xs">{overview?.usage_pct ?? 0}% of budget</span>
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {formatBytes(overview?.total_bytes || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={Math.min(100, overview?.usage_pct || 0)} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{overview?.total_objects || 0} live objects</span>
              <span>
                Avail: {formatBytes(overview?.available_bytes || 0)} / {formatBytes(overview?.budget_bytes || 0)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Protected Customer Backups</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">
              {formatBytes(overview?.protected_backup_bytes || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {overview?.protected_backup_objects || 0} verified backups
              </span>{" "}
              across{" "}
              <span className="font-medium text-foreground">
                {overview?.protected_pharmacies_count || 0} active pharmacies
              </span>
            </div>
            <div className="text-[11px] text-emerald-700 mt-1">
              Latest {inventory?.config?.backup_min_verified_retained || 2} verified backups per pharmacy guaranteed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Potentially Reclaimable Space</span>
              <Trash2 className="h-4 w-4 text-amber-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-700">
              {formatBytes(overview?.reclaimable_bytes || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {overview?.reclaimable_objects || 0} eligible objects
              </span>{" "}
              +{" "}
              <span className="font-medium text-foreground">
                {overview?.db_mismatches_count || 0} DB metadata records
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Est. post-cleanup:{" "}
              <span className="font-medium text-foreground">
                {formatBytes(Math.max(0, (overview?.total_bytes || 0) - (overview?.reclaimable_bytes || 0)))}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Last Scan & Cleanup Status</span>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              {data?.cleanupStatus === "running" ? (
                <Badge variant="default" className="bg-amber-600">Cleanup Running</Badge>
              ) : (
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
                  Idle · Ready
                </Badge>
              )}
              <span className="text-xs font-normal text-muted-foreground">
                ({inventory?.duration_ms || 0} ms)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              Scanned: <span className="text-foreground">{formatDateTime(inventory?.scanned_at)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Open Multipart: <span className="font-medium">{overview?.multipart_uploads_count || 0}</span> ·
              Unclassified: <span className="font-medium">{overview?.unclassified_objects || 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MongoDB Atlas M0 & Owner Portal Resource Monitor */}
      {data?.mongodb_telemetry && (
        <Card className="border-emerald-200/80 bg-emerald-50/20">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-700" />
                  <span>MongoDB Atlas M0 &amp; Owner Portal Resource Monitor</span>
                  <Badge
                    variant="outline"
                    className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                  >
                    {data.mongodb_telemetry.usage_pct}% of 512 MB Free Tier
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Tracks MongoDB data + index footprint, Owner Portal read-model collections, and
                  automated {data.mongodb_telemetry.detail_retention_days}-day line-item compaction.
                  On-demand PDF vouchers &amp; reports use 0 B of R2 and DB storage.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunPortalCompaction}
                disabled={runningPortalCompaction}
                className="shrink-0 bg-white"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 mr-1.5 ${
                    runningPortalCompaction ? "animate-spin" : ""
                  }`}
                />
                {runningPortalCompaction
                  ? "Compacting…"
                  : `Compact >${data.mongodb_telemetry.detail_retention_days}d Line Items`}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Total DB Footprint
                </span>
                <p className="text-sm font-bold mt-0.5">
                  {formatBytes(data.mongodb_telemetry.total_footprint_bytes)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Data: {formatBytes(data.mongodb_telemetry.data_size_bytes)} · Index:{" "}
                  {formatBytes(data.mongodb_telemetry.index_size_bytes)}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Remaining M0 Headroom
                </span>
                <p className="text-sm font-bold text-emerald-700 mt-0.5">
                  {formatBytes(data.mongodb_telemetry.remaining_headroom_bytes)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Limit: {formatBytes(data.mongodb_telemetry.m0_limit_bytes)}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Analytics Events
                </span>
                <p className="text-sm font-bold mt-0.5">
                  {data.mongodb_telemetry.portal_counts?.analytics_events_total || 0}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Detailed: {data.mongodb_telemetry.portal_counts?.recent_detail_events || 0} ·
                  Compacted: {data.mongodb_telemetry.portal_counts?.compacted_events || 0}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Portal &amp; Action States
                </span>
                <p className="text-sm font-bold mt-0.5">
                  {data.mongodb_telemetry.portal_counts?.portal_states || 0} /{" "}
                  {data.mongodb_telemetry.portal_counts?.action_states || 0}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  1 bounded doc per pharmacy
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Khata Notes &amp; Vouchers
                </span>
                <p className="text-sm font-bold mt-0.5">
                  {data.mongodb_telemetry.portal_counts?.customer_metas || 0} /{" "}
                  {data.mongodb_telemetry.portal_counts?.renewal_vouchers || 0}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Customer meta / Renewal vouchers
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Last Retention Run
                </span>
                <p className="text-sm font-bold mt-0.5">
                  {data.mongodb_telemetry.portal_counts?.last_retention_compaction_at
                    ? formatAge(data.mongodb_telemetry.portal_counts.last_retention_compaction_at)
                    : "Auto on Sync"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Throttled 12h per tenant
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="categories">Storage Categories & Explorer</TabsTrigger>
          <TabsTrigger value="cleanup">
            Cleanup Preview & Policies ({overview?.reclaimable_objects || 0})
          </TabsTrigger>
          <TabsTrigger value="protected">
            Protected Recovery Files ({overview?.protected_total_objects || 0})
          </TabsTrigger>
          <TabsTrigger value="history">
            Cleanup & Scan History ({data?.cleanupHistory?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: STORAGE CATEGORIES & OBJECT EXPLORER */}
        <TabsContent value="categories" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {categoryList.map((cat: any) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(isSelected ? "all" : cat.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm">{cat.label}</div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {cat.count}
                    </Badge>
                  </div>
                  <div className="text-xl font-bold mt-2">{formatBytes(cat.bytes)}</div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cat.description}</p>
                  <div className="mt-3 pt-2 border-t flex items-center justify-between text-[11px]">
                    <span className="text-emerald-700 font-medium">
                      Protected: {cat.protected_count} ({formatBytes(cat.protected_bytes)})
                    </span>
                    {cat.reclaimable_count > 0 ? (
                      <span className="text-amber-700 font-semibold">
                        Reclaim: {cat.reclaimable_count} ({formatBytes(cat.reclaimable_bytes)})
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0 reclaimable</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Object Explorer Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    R2 Object Inventory Explorer ({filteredObjects.length} object{filteredObjects.length === 1 ? "" : "s"})
                  </CardTitle>
                  <CardDescription>
                    Click any category card above to filter. Protected customer backups and active releases cannot be auto-deleted.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64">
                    <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Filter key, pharmacy, job, version…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                  <div className="flex rounded-md border p-0.5 bg-muted/30 text-xs">
                    {(["all", "protected", "eligible", "review"] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 rounded capitalize transition-colors ${
                          statusFilter === st ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  {selectedCategory !== "all" && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedCategory("all")}>
                      Clear Category
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Object Key & Category</TableHead>
                      <TableHead>Owner / Context</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Modified</TableHead>
                      <TableHead>Retention Status</TableHead>
                      <TableHead>Policy & Explanation</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredObjects.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                          No R2 objects match the current filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredObjects.map((obj: any) => (
                        <TableRow key={`${obj.category}:${obj.key}`}>
                          <TableCell className="max-w-[300px]">
                            <div className="font-mono text-xs truncate" title={obj.key}>
                              {obj.key}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className="text-[10px]">
                                {categoriesMap[obj.category]?.label || obj.category}
                              </Badge>
                              {obj.db_reference?.exists ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  DB: {obj.db_reference.status || "linked"}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                                  No DB Record
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {obj.owner?.pharmacy_name && (
                              <div className="font-medium">{obj.owner.pharmacy_name}</div>
                            )}
                            {obj.owner?.license_key && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {obj.owner.license_key}
                              </div>
                            )}
                            {obj.migration_job && (
                              <div>
                                <span className="font-mono font-medium">{obj.migration_job.job_number}</span>{" "}
                                <span className="text-muted-foreground">
                                  (v{obj.migration_job.mapping_version})
                                </span>
                                {obj.migration_job.expires_at && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Exp: {obj.migration_job.expires_at.slice(0, 10)} · Downloads:{" "}
                                    {obj.migration_job.download_count || 0}
                                  </div>
                                )}
                              </div>
                            )}
                            {obj.release_info && (
                              <div>
                                <span className="font-mono font-semibold">v{obj.release_info.version}</span>{" "}
                                <Badge variant="outline" className="text-[10px] ml-1">
                                  {obj.release_info.release_type}
                                </Badge>
                              </div>
                            )}
                            {!obj.owner?.pharmacy_name &&
                              !obj.owner?.license_key &&
                              !obj.migration_job &&
                              !obj.release_info && <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {formatBytes(obj.size_bytes)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            <div>{formatAge(obj.last_modified)}</div>
                            <div className="text-[10px]">{obj.last_modified?.slice(0, 10)}</div>
                          </TableCell>
                          <TableCell>
                            {obj.protected ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px]">
                                <Lock className="h-3 w-3 mr-1" /> Protected
                              </Badge>
                            ) : obj.cleanup_eligible ? (
                              <Badge variant="outline" className="text-amber-700 border-amber-400 bg-amber-50 text-[10px]">
                                Eligible for Cleanup
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                Review Required
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs max-w-[300px]">
                            <div className="text-foreground">{obj.cleanup_reason}</div>
                            {obj.cleanup_policy && (
                              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                Policy: {obj.cleanup_policy}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {obj.category === "pharmacy_cloud_backups" && obj.db_reference?.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handlePinBackup(obj.db_reference.id, !obj.backup_info?.pinned)}
                              >
                                {obj.backup_info?.pinned ? (
                                  <>
                                    <PinOff className="h-3.5 w-3.5 mr-1 text-amber-600" /> Unpin
                                  </>
                                ) : (
                                  <>
                                    <Pin className="h-3.5 w-3.5 mr-1" /> Pin
                                  </>
                                )}
                              </Button>
                            )}
                            {obj.category === "converted_migration_packages" && obj.migration_job?.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleExtendMigrationPkg(obj.migration_job.id, 7)}
                              >
                                <CalendarPlus className="h-3.5 w-3.5 mr-1" /> +7d
                              </Button>
                            )}
                            {obj.category === "software_releases" &&
                              obj.release_info?.id &&
                              obj.retention_class === "superseded_release" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    handleToggleReleaseApproval(
                                      obj.release_info.id,
                                      !obj.release_info.cleanup_approved
                                    )
                                  }
                                >
                                  {obj.release_info.cleanup_approved ? "Revoke Approval" : "Approve Cleanup"}
                                </Button>
                              )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: CLEANUP PREVIEW & POLICIES */}
        <TabsContent value="cleanup" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Active Safe Cleanup Policies</CardTitle>
                <CardDescription>
                  Select which automated cleanup policies to include in the dry-run preview or execution.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(POLICY_LABELS).map(([policyId, info]) => {
                  const checked = selectedPolicies.includes(policyId);
                  return (
                    <label key={policyId} className="flex items-start gap-2.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setSelectedPolicies((prev) =>
                            v ? [...prev, policyId] : prev.filter((x) => x !== policyId)
                          );
                        }}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium leading-none">{info.label}</div>
                        <div className="text-xs text-muted-foreground mt-1">{info.description}</div>
                      </div>
                    </label>
                  );
                })}

                <div className="pt-3 border-t">
                  <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                    <Checkbox
                      checked={reconcileDb}
                      onCheckedChange={(v) => setReconcileDb(Boolean(v))}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium leading-none">Reconcile Stale Database Metadata</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Update abandoned pending_upload records and migration jobs whose R2 source is already absent.
                      </div>
                    </div>
                  </label>
                </div>

                <div className="pt-3 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleDryRun}
                    disabled={runningDryRun || runningExecute}
                  >
                    <Eye className="h-4 w-4 mr-1.5" />
                    {runningDryRun ? "Running Dry Run…" : "Run Dry Run"}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => setConfirmExecuteOpen(true)}
                    disabled={runningExecute}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Execute Cleanup
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {dryRunResult
                        ? `${dryRunResult.mode === "execute" ? "Last Executed Cleanup" : "Dry-Run Cleanup Preview"}`
                        : "Eligible Cleanup Candidates"}
                    </CardTitle>
                    <CardDescription>
                      Protected customer backups, current/previous software releases, and unclassified objects are strictly excluded.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    {eligibleSummaryForModal.count} eligible · {formatBytes(eligibleSummaryForModal.bytes)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Object Key</TableHead>
                        <TableHead>Policy</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(dryRunResult?.items || eligibleSummaryForModal.items).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                            No eligible R2 objects for the selected policies. Storage is clean!
                          </TableCell>
                        </TableRow>
                      ) : (
                        (dryRunResult?.items || eligibleSummaryForModal.items).map((item: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs max-w-[260px] truncate" title={item.key}>
                              {item.key}
                              {item.owner_label && (
                                <div className="font-sans text-[11px] text-muted-foreground">
                                  {item.owner_label}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {item.policy || item.cleanup_policy}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-nowrap">
                              {formatBytes(item.size_bytes)}
                            </TableCell>
                            <TableCell className="text-xs max-w-[280px]">
                              {item.reason || item.cleanup_reason}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={item.status === "deleted" ? "default" : "outline"}
                                className="text-[10px]"
                              >
                                {item.status || "eligible"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Reconcilable DB Mismatches */}
                {inventory?.db_mismatches?.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Database Metadata Consistency Checks ({inventory.db_mismatches.length})
                    </div>
                    <div className="rounded-md border divide-y text-xs">
                      {inventory.db_mismatches.map((m: any, i: number) => (
                        <div key={i} className="p-2.5 flex items-center justify-between gap-3">
                          <div>
                            <span className="font-mono font-medium">{m.label}</span>:{" "}
                            <span className="text-muted-foreground">{m.details}</span>
                          </div>
                          <Badge variant={m.can_auto_reconcile ? "secondary" : "outline"} className="text-[10px] shrink-0">
                            {m.can_auto_reconcile ? "Auto-Reconcilable" : "Info Only"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: PROTECTED RECOVERY FILES */}
        <TabsContent value="protected" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Protected Customer Backups, Active Releases & Retained Packages
              </CardTitle>
              <CardDescription>
                These files are actively protected by Mediqoo recovery guardrails and are excluded from all automatic cleanup operations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Object Key</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Pharmacy / Version / Job</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Protection Rule</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(inventory?.objects || [])
                      .filter((o: any) => o.protected)
                      .map((obj: any) => (
                        <TableRow key={obj.key}>
                          <TableCell className="font-mono text-xs max-w-[300px] truncate" title={obj.key}>
                            {obj.key}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {categoriesMap[obj.category]?.label || obj.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {obj.owner?.pharmacy_name ||
                              obj.owner?.license_key ||
                              (obj.release_info ? `v${obj.release_info.version} (${obj.release_info.release_type})` : "") ||
                              obj.migration_job?.job_number ||
                              "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatBytes(obj.size_bytes)}
                          </TableCell>
                          <TableCell className="text-xs text-emerald-700 font-medium">
                            {obj.cleanup_reason}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: CLEANUP & SCAN HISTORY */}
        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cleanup Execution & Dry-Run Audit Log</CardTitle>
              <CardDescription>
                Complete audit trail of manual and scheduled R2 storage cleanup runs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Mode / Trigger</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Candidates</TableHead>
                      <TableHead>Deleted / Freed</TableHead>
                      <TableHead>DB Reconciled</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.cleanupHistory || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                          No cleanup runs recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (data?.cleanupHistory || []).map((run: any) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDateTime(run.started_at)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={run.mode === "execute" ? "default" : "secondary"} className="text-[10px]">
                              {run.mode === "execute" ? "EXECUTE" : "DRY RUN"}
                            </Badge>
                            <span className="ml-1.5 text-muted-foreground">{run.trigger}</span>
                          </TableCell>
                          <TableCell className="text-xs">{run.actor?.email || "system"}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {run.candidates_count} ({formatBytes(run.reclaimable_bytes)})
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {run.mode === "execute"
                              ? `${run.deleted_count} (${formatBytes(run.deleted_bytes)})`
                              : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{run.db_reconciled_count || 0}</TableCell>
                          <TableCell>
                            <Badge
                              variant={run.status === "completed" ? "outline" : "destructive"}
                              className="text-[10px]"
                            >
                              {run.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog for Bulk Safe Cleanup Execution */}
      <Dialog open={confirmExecuteOpen} onOpenChange={setConfirmExecuteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Safe R2 Storage Cleanup</DialogTitle>
            <DialogDescription>
              Every candidate object will be re-verified immediately before deletion. Protected customer backups, active software releases, and unclassified files will not be touched.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Eligible R2 Objects to Delete:</span>
              <span className="font-mono font-semibold">{eligibleSummaryForModal.count} object(s)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Space to Reclaim:</span>
              <span className="font-mono font-semibold text-amber-700">
                {formatBytes(eligibleSummaryForModal.bytes)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Protected Objects Excluded:</span>
              <span className="font-mono font-semibold text-emerald-700">
                {overview?.protected_total_objects || 0} object(s) ({formatBytes(overview?.protected_total_bytes || 0)})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stale DB Records to Reconcile:</span>
              <span className="font-mono font-semibold">
                {reconcileDb ? (inventory?.db_mismatches || []).filter((m: any) => m.can_auto_reconcile).length : 0}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmExecuteOpen(false)} disabled={runningExecute}>
              Cancel
            </Button>
            <Button onClick={handleExecuteCleanup} disabled={runningExecute}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              {runningExecute ? "Executing Safe Cleanup…" : "Confirm & Run Safe Cleanup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget & Policy Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Storage Budget & Retention Policy Settings</DialogTitle>
            <DialogDescription>
              Configure operational R2 storage budget, alert thresholds, and retention windows.
            </DialogDescription>
          </DialogHeader>
          {configDraft && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Operational Storage Budget (GB)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    value={configDraft.budget_gb}
                    onChange={(e) => setConfigDraft({ ...configDraft, budget_gb: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Min Verified Backups / Pharmacy</Label>
                  <Input
                    type="number"
                    min="2"
                    max="10"
                    value={configDraft.backup_min_verified_retained}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, backup_min_verified_retained: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Warning (%)</Label>
                  <Input
                    type="number"
                    value={configDraft.warning_threshold_pct}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, warning_threshold_pct: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>High Usage (%)</Label>
                  <Input
                    type="number"
                    value={configDraft.high_threshold_pct}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, high_threshold_pct: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Critical (%)</Label>
                  <Input
                    type="number"
                    value={configDraft.critical_threshold_pct}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, critical_threshold_pct: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Rolling 7-Day Extra Auto Backups</Label>
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    value={configDraft.backup_rolling_auto_retained}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, backup_rolling_auto_retained: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Converted Package Retention (Days)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="90"
                    value={configDraft.migration_output_retention_days}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, migration_output_retention_days: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Failed Migration Retention (Hours)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="168"
                    value={configDraft.migration_failed_retention_hours}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, migration_failed_retention_hours: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Abandoned Upload Expiry (Hours)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="168"
                    value={configDraft.migration_abandoned_upload_hours}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, migration_abandoned_upload_hours: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium">Auto-Clean Superseded Releases</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically remove release binaries older than the latest {configDraft.release_keep_stable_count} stable versions.
                  </div>
                </div>
                <Switch
                  checked={Boolean(configDraft.release_auto_cleanup_approved)}
                  onCheckedChange={(v) => setConfigDraft({ ...configDraft, release_auto_cleanup_approved: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)} disabled={savingSettings}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving…" : "Save Settings"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

