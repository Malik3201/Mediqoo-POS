"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, Cloud, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const fetchBackups = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/backups");
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

  const downloadBackup = async (id: string) => {
    const toastId = toast.loading("Preparing download...");
    try {
      const res = await fetch(`/api/portal/backups/${id}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download failed");
      
      toast.success("Download starting", { id: toastId });
      
      // Trigger download
      const link = document.createElement("a");
      link.href = data.download_url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    }
  };

  const filtered = backups.filter(b => typeFilter === "all" || b.backup_type === typeFilter);

  const formatType = (t: string) => {
    return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Backup & Recovery
          </h1>
          <p className="text-sm text-muted-foreground">
            Download your securely encrypted cloud backups for disaster recovery.
          </p>
        </div>
        <Button onClick={fetchBackups} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="day_end">Day End</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="month_end">Month End</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>POS Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading backups...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Cloud className="h-8 w-8 text-muted-foreground/50" />
                        <h3 className="font-semibold text-lg">No cloud backups found</h3>
                        <p className="text-sm text-muted-foreground">
                          {backups.length === 0 
                            ? "No cloud backups have been created yet."
                            : "No backups match the selected filter."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {format(new Date(b.created_at), "MMM d, yyyy HH:mm")}
                      </TableCell>
                      <TableCell>{b._project_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatType(b.backup_type)}</Badge>
                      </TableCell>
                      <TableCell>{formatBytes(b.size_bytes || 0)}</TableCell>
                      <TableCell>{b.app_version || "Unknown"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          size="sm" 
                          variant="secondary"
                          onClick={() => downloadBackup(b.id)}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
