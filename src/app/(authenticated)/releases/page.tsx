"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Rocket,
  Plus,
  Upload,
  Trash2,
  Archive,
  CheckCircle2,
  Users,
  ChevronRight,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";
import { deleteReleaseFile } from "@/actions/releases";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

type Release = any;
type ClientRow = { id: string; name: string };

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default function ReleasesPage() {
  const { data: session } = useSession();
  const { data: rawRows = [], isLoading: loadingRows, refetch: refetchRows } = useDataQuery("releases");
  const { data: clients = [], isLoading: loadingClients } = useDataQuery("clients");
  const { data: installs = [], refetch: refetchInstalls } = useDataQuery("release_installs");
  const { mutateAsync: mutateRelease } = useDataMutation("releases");

  const [openNew, setOpenNew] = useState(false);
  const [detail, setDetail] = useState<Release | null>(null);

  const rows = useMemo(() => {
    return rawRows.map((r: any) => {
      const installedCount = installs.filter((i: any) => i.release_id === r.id && i.status === "installed").length;
      return { ...r, installed_count: installedCount };
    }).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [rawRows, installs]);

  const refresh = async () => {
    await refetchRows();
    await refetchInstalls();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" /> Releases
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Publish POS updates. Installed clients pick them up automatically on next launch.
          </p>
        </div>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4 mr-1" /> New release
        </Button>
      </header>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rollout</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Installed</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="w-[140px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(loadingRows || loadingClients) ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  No releases yet. Publish your first POS update.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell>
                    <div className="font-mono font-semibold">v{r.version}</div>
                    {r.mandatory && (
                      <Badge variant="destructive" className="mt-1 text-[10px]">
                        Mandatory
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "published"
                          ? "default"
                          : r.status === "draft"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.rollout_type === "all" ? (
                      <span className="text-muted-foreground">All clients</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {r.target_client_ids?.length ?? 0} selected
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{fmtSize(r.installer_size ?? 0)}</TableCell>
                  <TableCell className="text-sm">{r.installed_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.published_at ? new Date(r.published_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="h-4 w-4 inline text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {openNew && (
        <NewReleaseDialog
          clients={clients}
          onClose={() => setOpenNew(false)}
          onCreated={async () => {
            setOpenNew(false);
            await refresh();
          }}
          mutateRelease={mutateRelease}
          session={session}
        />
      )}

      {detail && (
        <ReleaseDetailDialog
          release={detail}
          allInstalls={installs}
          onClose={() => setDetail(null)}
          onChanged={refresh}
          mutateRelease={mutateRelease}
        />
      )}
    </div>
  );
}

function NewReleaseDialog({
  clients,
  onClose,
  onCreated,
  mutateRelease,
  session,
}: {
  clients: ClientRow[];
  onClose: () => void;
  onCreated: () => void;
  mutateRelease: any;
  session: any;
}) {
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rollout, setRollout] = useState<"all" | "specific">("all");
  const [targets, setTargets] = useState<string[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggleTarget = (id: string) => {
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!version.trim()) return toast.error("Version required");
    if (!file) return toast.error("Select an installer file");
    if (rollout === "specific" && targets.length === 0)
      return toast.error("Pick at least one client");

    setBusy(true);
    try {
      setProgress(10);
      
      // 1. Get Pre-signed URL from our API
      const signRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          fileType: file.type || "application/octet-stream",
          version: version.trim()
        })
      });

      if (!signRes.ok) throw new Error("Failed to initialize upload");
      const { uploadUrl, publicUrl } = await signRes.json();
      
      setProgress(30);

      // 2. Upload file directly to Cloudflare R2 using XHR for realistic progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            // scale progress nicely between 15% and 85%
            const percent = 15 + Math.round((event.loaded / event.total) * 70);
            setProgress(percent);
          }
        });
        
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed with status ${xhr.status}`));
        });
        
        xhr.addEventListener("error", () => reject(new Error("Network error or CORS block")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });
      
      setProgress(80);

      const status = publish ? "published" : "draft";
      const path = publicUrl;
      
      await mutateRelease({
        method: "POST",
        data: {
          version: version.trim(),
          changelog: changelog.trim(),
          storage_path: path,
          installer_size: file.size,
          rollout_type: rollout,
          target_client_ids: rollout === "specific" ? targets : [],
          mandatory,
          status,
          published_at: publish ? new Date().toISOString() : null,
          created_by: session?.user?.id,
        },
      });

      setProgress(100);
      toast.success(publish ? `v${version} published` : `v${version} saved as draft`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(val) => { if (!busy) onClose(); }}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>New POS release</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Version</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.2.0"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Installer (.exe, .zip)</Label>
              <Input
                type="file"
                accept=".exe,.msi,.zip,application/octet-stream,application/zip,application/x-zip-compressed"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground mt-1">
                  {fmtSize(file.size)} — {file.name}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Changelog (what's new)</Label>
            <Textarea
              rows={4}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="- Barcode scanner improvements&#10;- Fixed print alignment&#10;- New receipt templates"
            />
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <Label className="text-sm">Who receives this update?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={rollout === "all" ? "default" : "outline"}
                onClick={() => setRollout("all")}
              >
                All clients
              </Button>
              <Button
                type="button"
                size="sm"
                variant={rollout === "specific" ? "default" : "outline"}
                onClick={() => setRollout("specific")}
              >
                Specific clients
              </Button>
            </div>
            {rollout === "specific" && (
              <div className="max-h-40 overflow-y-auto rounded border bg-muted/30 p-2 space-y-1">
                {clients.length === 0 && (
                  <p className="text-xs text-muted-foreground">No clients yet.</p>
                )}
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm py-1">
                    <Checkbox
                      checked={targets.includes(c.id)}
                      onCheckedChange={() => toggleTarget(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Mandatory update</div>
              <div className="text-xs text-muted-foreground">
                POS auto-restarts with a 30s warning instead of asking.
              </div>
            </div>
            <Switch checked={mandatory} onCheckedChange={setMandatory} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Publish immediately</div>
              <div className="text-xs text-muted-foreground">
                Turn off to save as draft and publish later.
              </div>
            </div>
            <Switch checked={publish} onCheckedChange={setPublish} />
          </div>

          {busy && (
            <div className="text-xs text-muted-foreground">
              Uploading… {progress}%
              <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Upload className="h-4 w-4 mr-1" />
            {busy ? "Uploading…" : publish ? "Publish release" : "Save draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDetailDialog({
  release,
  allInstalls,
  onClose,
  onChanged,
  mutateRelease,
}: {
  release: Release;
  allInstalls: any[];
  onClose: () => void;
  onChanged: () => void;
  mutateRelease: any;
}) {
  const [busy, setBusy] = useState(false);
  const installs = useMemo(() => allInstalls.filter(i => i.release_id === release.id), [allInstalls, release.id]);

  const stats = useMemo(() => {
    const s = { checked: 0, downloaded: 0, installed: 0, failed: 0 };
    for (const i of installs) s[i.status as keyof typeof s] = (s[i.status as keyof typeof s] ?? 0) + 1;
    return s;
  }, [installs]);

  const doStatus = async (status: "draft" | "published" | "archived") => {
    setBusy(true);
    try {
      const payload: any = { status };
      if (status === "published") payload.published_at = new Date().toISOString();
      await mutateRelease({ method: "PATCH", id: release.id, data: payload });
      toast.success(`Marked as ${status}`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm(`Delete v${release.version}? This removes the installer file.`)) return;
    setBusy(true);
    try {
      if (release.storage_path) {
        await deleteReleaseFile(release.storage_path);
      }
      await mutateRelease({ method: "DELETE", id: release.id });
      toast.success("Release deleted");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" /> v{release.version}
            <Badge variant={release.status === "published" ? "default" : "secondary"}>
              {release.status}
            </Badge>
            {release.mandatory && <Badge variant="destructive">Mandatory</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 text-center">
          <StatBox label="Checked" value={stats.checked} />
          <StatBox label="Downloaded" value={stats.downloaded} />
          <StatBox label="Installed" value={stats.installed} highlight />
          <StatBox label="Failed" value={stats.failed} danger />
        </div>

        {release.changelog && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Changelog</div>
            <pre className="text-sm whitespace-pre-wrap font-sans">{release.changelog}</pre>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <div>Rollout: {release.rollout_type === "all" ? "All clients" : `${release.target_client_ids?.length ?? 0} specific clients`}</div>
          <div>Size: {fmtSize(release.installer_size ?? 0)}</div>
          <div>Created: {new Date(release.created_at).toLocaleString()}</div>
          {release.published_at && <div>Published: {new Date(release.published_at).toLocaleString()}</div>}
        </div>

        <div className="rounded-lg border">
          <div className="text-xs font-semibold px-3 py-2 border-b flex items-center gap-1">
            <FileDown className="h-3.5 w-3.5" /> Recent install activity
          </div>
          <div className="max-h-56 overflow-y-auto text-xs">
            {installs.length === 0 && (
              <div className="p-3 text-muted-foreground">No activity yet.</div>
            )}
            {installs.slice(0, 30).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between px-3 py-1.5 border-b last:border-0">
                <span className="font-mono">{i.license_key?.slice(0, 12)}…</span>
                <Badge variant="outline" className="text-[10px]">{i.status}</Badge>
                <span className="text-muted-foreground">{new Date(i.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {release.status !== "published" && (
            <Button onClick={() => doStatus("published")} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Publish
            </Button>
          )}
          {release.status === "published" && (
            <Button variant="outline" onClick={() => doStatus("archived")} disabled={busy}>
              <Archive className="h-4 w-4 mr-1" /> Archive
            </Button>
          )}
          {release.status === "archived" && (
            <Button variant="outline" onClick={() => doStatus("draft")} disabled={busy}>
              Move to draft
            </Button>
          )}
          <Button variant="destructive" onClick={doDelete} disabled={busy}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-primary bg-primary/5" : danger && value > 0 ? "border-destructive bg-destructive/5" : ""
      }`}
    >
      <div className={`text-2xl font-bold ${danger && value > 0 ? "text-destructive" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
