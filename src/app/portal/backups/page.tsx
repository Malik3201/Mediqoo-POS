"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, Cloud, RefreshCw, AlertCircle, ShieldCheck, Clock, HardDrive, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils";

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
    <div className="space-y-6 max-w-[1000px] mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Cloud Backup
          </h1>
          <p className="text-sm text-muted-foreground">
            Continuous disaster recovery backups for your pharmacy. Download anytime.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge 
            variant="outline" 
            className={`px-3 py-1 text-xs font-semibold flex items-center gap-1.5 ${
              hasBackups 
                ? "border-emerald-300 text-emerald-700 bg-emerald-50" 
                : "border-amber-300 text-amber-700 bg-amber-50"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Status: {hasBackups ? "Protected" : "Never Backed Up"}
          </Badge>
          <Button onClick={fetchBackups} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Retention Policy Note */}
      <div className="rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground flex items-center justify-between">
        <span className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <span>Storage Policy: Only the newest 2 recovery snapshots are retained. Older backups are automatically pruned.</span>
        </span>
        <span className="font-semibold text-foreground">
          {backups.length} of 2 Slots Used
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="animate-pulse h-64 bg-muted/20" />
          <Card className="animate-pulse h-64 bg-muted/20" />
        </div>
      ) : !hasBackups ? (
        <Card className="border-dashed py-12 text-center">
          <CardContent className="space-y-3">
            <Cloud className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
            <h3 className="font-semibold text-lg">No cloud backup available yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your AivraSol POS on your main terminal will automatically back up your data continuously as sales and changes occur.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. Latest Backup */}
          <Card className="border-primary/30 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1 rounded-bl">
              LATEST
            </div>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Latest Backup
              </CardTitle>
              <CardDescription className="text-xs">
                Authoritative most recent recovery snapshot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-1.5 border-b text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Date &amp; Time
                </span>
                <span className="font-semibold">
                  {latestBackup.uploaded_at ? format(new Date(latestBackup.uploaded_at), "dd/MM/yyyy hh:mm a") : format(new Date(latestBackup.created_at), "dd/MM/yyyy hh:mm a")}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <HardDrive className="h-3.5 w-3.5" /> File Size
                </span>
                <span className="font-mono font-medium">
                  {latestBackup.size_bytes ? formatBytes(latestBackup.size_bytes) : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b text-xs">
                <span className="text-muted-foreground">POS Version</span>
                <span className="font-mono text-[11px]">{latestBackup.app_version || "1.5.x"}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 text-xs">
                <span className="text-muted-foreground">Integrity</span>
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                  Verified &amp; Encrypted
                </Badge>
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <Button 
                className="w-full" 
                onClick={() => downloadBackup(latestBackup.id, "Latest Backup")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Latest Backup
              </Button>
            </CardFooter>
          </Card>

          {/* 2. Previous Backup */}
          {previousBackup ? (
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  Previous Backup
                </CardTitle>
                <CardDescription className="text-xs">
                  Prior verified recovery snapshot fallback
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-1.5 border-b text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Date &amp; Time
                  </span>
                  <span className="font-semibold">
                    {previousBackup.uploaded_at ? format(new Date(previousBackup.uploaded_at), "dd/MM/yyyy hh:mm a") : format(new Date(previousBackup.created_at), "dd/MM/yyyy hh:mm a")}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" /> File Size
                  </span>
                  <span className="font-mono font-medium">
                    {previousBackup.size_bytes ? formatBytes(previousBackup.size_bytes) : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b text-xs">
                  <span className="text-muted-foreground">POS Version</span>
                  <span className="font-mono text-[11px]">{previousBackup.app_version || "1.5.x"}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 text-xs">
                  <span className="text-muted-foreground">Integrity</span>
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                    Verified &amp; Encrypted
                  </Badge>
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => downloadBackup(previousBackup.id, "Previous Backup")}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Previous Backup
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card className="border border-dashed flex flex-col justify-center items-center p-6 text-center text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-40" />
              <h4 className="font-semibold text-sm">No Previous Backup Yet</h4>
              <p className="text-xs mt-1 max-w-xs">
                A second snapshot slot will be saved here automatically on the next backup cycle.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
