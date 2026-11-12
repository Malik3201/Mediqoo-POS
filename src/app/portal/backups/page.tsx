"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Download,
  Cloud,
  AlertCircle,
  ShieldCheck,
  Clock,
  HardDrive,
  CheckCircle2,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalSectionCard,
  PortalStatusBadge,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

interface Backup {
  id: string;
  license_id: string;
  _project_name: string;
  backup_type: string;
  created_at: string;
  uploaded_at: string;
  size_bytes: number;
  app_version: string;
  status: string;
}

export default function PortalBackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchBackups = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/backups", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load backups");
      setBackups(data.backups || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const downloadBackup = async (id: string, label: string) => {
    const toastId = toast.loading(`Preparing ${label} download...`);
    try {
      const res = await fetch(`/api/portal/backups/${id}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download failed");

      toast.success("Download starting", { id: toastId });

      const link = document.createElement("a");
      link.href = data.download_url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    }
  };

  const latestBackup = backups[0] || null;
  const previousBackup = backups[1] || null;
  const hasBackups = backups.length > 0;

  return (
    <div className="space-y-4 sm:space-y-5 max-w-5xl animate-portal-in">
      <PortalPageHeader
        icon={<Cloud className="w-5 h-5" />}
        title="Cloud Backups"
        subtitle="Continuous encrypted disaster recovery snapshots for your pharmacy. Download anytime."
        badge={
          <PortalStatusBadge tone={hasBackups ? "emerald" : "amber"} dot>
            {hasBackups ? "Protected" : "Never Backed Up"}
          </PortalStatusBadge>
        }
        actions={<PortalRefreshButton loading={loading} onClick={fetchBackups} />}
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm font-semibold text-rose-800 flex items-center gap-2.5">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Retention Policy Banner */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/80 text-[#009A4D] flex items-center justify-center shrink-0">
            <HardDrive className="h-4 w-4" />
          </div>
          <div className="text-xs text-slate-600 leading-relaxed">
            <strong className="text-slate-900 block sm:inline">Rolling 2-Snapshot Retention: </strong>
            Only the newest 2 encrypted recovery archives are kept in cloud storage; older snapshots rotate automatically.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <div className="flex items-center gap-1">
            {[0, 1].map((slot) => (
              <span
                key={slot}
                className={`w-6 h-2 rounded-full ${
                  backups[slot] ? "bg-[#009A4D]" : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          <span className="text-xs font-extrabold text-slate-900 tabular-nums">
            {backups.length} / 2 Slots
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-72 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="h-72 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
      ) : !hasBackups ? (
        <PortalSectionCard>
          <PortalEmptyState
            icon={<Cloud className="w-7 h-7" />}
            title="No Cloud Backup Available Yet"
            description="Your AivraSol POS terminal automatically uploads encrypted backups continuously as sales and stock updates occur."
          />
        </PortalSectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Latest Backup */}
          <PortalSectionCard className="overflow-hidden flex flex-col border-emerald-200/90 shadow-sm">
            <div className="px-5 py-4 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-white">Latest Backup</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Authoritative most recent recovery snapshot
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold uppercase tracking-wider shrink-0">
                LATEST
              </span>
            </div>

            <div className="p-5 space-y-3 flex-1 text-xs">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-slate-500 flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5 text-slate-400" /> Snapshot Time
                </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {latestBackup.uploaded_at
                    ? format(new Date(latestBackup.uploaded_at), "dd/MM/yyyy hh:mm a")
                    : format(new Date(latestBackup.created_at), "dd/MM/yyyy hh:mm a")}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-slate-500 flex items-center gap-1.5 font-medium">
                  <Database className="h-3.5 w-3.5 text-slate-400" /> Archive Size
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {latestBackup.size_bytes ? formatBytes(latestBackup.size_bytes) : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-slate-500 font-medium">POS Terminal Version</span>
                <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                  {latestBackup.app_version || "1.5.x"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-500 font-medium">Security Integrity</span>
                <PortalStatusBadge tone="emerald">
                  <ShieldCheck className="w-3 h-3" />
                  Verified &amp; Encrypted
                </PortalStatusBadge>
              </div>
            </div>

            <div className="p-4 pt-0">
              <Button
                className="w-full min-h-[44px] rounded-xl bg-[#009A4D] hover:bg-emerald-700 text-white font-bold shadow-sm shadow-emerald-600/20"
                onClick={() => downloadBackup(latestBackup.id, "Latest Backup")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Latest Backup
              </Button>
            </div>
          </PortalSectionCard>

          {/* 2. Previous Backup */}
          {previousBackup ? (
            <PortalSectionCard className="overflow-hidden flex flex-col">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200/80 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                    Previous Backup
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Prior verified recovery snapshot fallback
                  </p>
                </div>
              </div>

              <div className="p-5 space-y-3 flex-1 text-xs">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5 font-medium">
                    <Clock className="h-3.5 w-3.5 text-slate-400" /> Snapshot Time
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {previousBackup.uploaded_at
                      ? format(new Date(previousBackup.uploaded_at), "dd/MM/yyyy hh:mm a")
                      : format(new Date(previousBackup.created_at), "dd/MM/yyyy hh:mm a")}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5 font-medium">
                    <Database className="h-3.5 w-3.5 text-slate-400" /> Archive Size
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {previousBackup.size_bytes ? formatBytes(previousBackup.size_bytes) : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">POS Terminal Version</span>
                  <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                    {previousBackup.app_version || "1.5.x"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-500 font-medium">Security Integrity</span>
                  <PortalStatusBadge tone="emerald">
                    <ShieldCheck className="w-3 h-3" />
                    Verified &amp; Encrypted
                  </PortalStatusBadge>
                </div>
              </div>

              <div className="p-4 pt-0">
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] rounded-xl font-bold border-slate-200 hover:bg-slate-50"
                  onClick={() => downloadBackup(previousBackup.id, "Previous Backup")}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Previous Backup
                </Button>
              </div>
            </PortalSectionCard>
          ) : (
            <PortalSectionCard className="border-dashed flex flex-col justify-center items-center p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <Clock className="h-6 w-6" />
              </div>
              <h4 className="font-bold text-sm text-slate-800">No Previous Backup Yet</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                A secondary fallback snapshot will appear here automatically after the next POS cloud backup cycle.
              </p>
            </PortalSectionCard>
          )}
        </div>
      )}
    </div>
  );
}
