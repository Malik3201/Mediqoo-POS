"use client";

import { useMemo, useState } from "react";
import { Package as PackageIcon, Plus, Download, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";
import { generatePackage } from "@/actions/packages";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PackageRow = {
  id: string;
  project_id: string;
  license_id: string | null;
  version: string;
  filename: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: string;
  notes: string | null;
  projects?: { name: string; slug: string } | null;
  licenses?: { license_key: string } | null;
};

type ProjectOpt = { id: string; name: string; slug: string; version: string };
type LicenseOpt = { id: string; license_key: string; project_id: string; status: string };

export default function PackagesPage() {
  const { data: rawRows = [], isLoading: loadingRows, refetch } = useDataQuery("packages");
  const { data: projects = [], isLoading: loadingProjects } = useDataQuery("projects");
  const { data: licenses = [], isLoading: loadingLicenses } = useDataQuery("licenses", { status: "active" });
  
  const { mutateAsync: mutatePackage } = useDataMutation("packages");

  const rows = useMemo(() => {
    return rawRows.map((r: any) => ({
      ...r,
      projects: projects.find((p: any) => p.id === r.project_id) || null,
      licenses: licenses.find((l: any) => l.id === r.license_id) || null,
    }));
  }, [rawRows, projects, licenses]);

  const loading = loadingRows || loadingProjects || loadingLicenses;

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [licenseId, setLicenseId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const projectLicenses = useMemo(
    () => licenses.filter((l: LicenseOpt) => l.project_id === projectId),
    [licenses, projectId],
  );

  function openNew() {
    setProjectId("");
    setLicenseId("");
    setNotes("");
    setOpen(true);
  }

  async function submit() {
    if (!projectId) {
      toast.error("Select a project");
      return;
    }
    setBusy(true);
    try {
      const res: any = await generatePackage({
        project_id: projectId,
        license_id: licenseId || undefined,
        notes: notes || undefined,
      });
      
      if (res.error) throw new Error(res.error);
      
      const bin = atob(res.content_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success(`Package generated (${res.filename})`);
      setOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : "Failed to generate package");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this package record? The already-downloaded file is not affected.")) return;
    try {
      await mutatePackage({ method: "DELETE", id });
      toast.success("Package deleted");
      refetch();
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  function copy(txt: string) {
    navigator.clipboard.writeText(txt);
    toast.success("Copied");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PackageIcon className="h-6 w-6 text-primary" />
            Packages
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate encrypted, signed <code className="font-mono">.aivra</code> deployment packages.
          </p>
        </div>
        <Button onClick={openNew} disabled={projects.length === 0}>
          <Plus className="h-4 w-4" />
          Generate package
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Checksum</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No packages generated yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r: PackageRow) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.filename}</TableCell>
                  <TableCell>
                    {r.projects?.name ?? "—"}
                    <div className="text-xs text-muted-foreground font-mono">v{r.version}</div>
                  </TableCell>
                  <TableCell>
                    {r.licenses?.license_key ? (
                      <Badge variant="outline" className="font-mono text-xs">
                        {r.licenses.license_key.slice(0, 12)}…
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {(r.size_bytes / 1024).toFixed(1)} KB
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <button
                      onClick={() => copy(r.checksum_sha256)}
                      className="inline-flex items-center gap-1 hover:underline"
                      title={r.checksum_sha256}
                    >
                      {r.checksum_sha256.slice(0, 10)}…
                      <Copy className="h-3 w-3" />
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Package</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Project *</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setLicenseId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: ProjectOpt) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} (v{p.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>License (Optional)</Label>
              <Select
                value={licenseId}
                onValueChange={setLicenseId}
                disabled={!projectId || projectLicenses.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={!projectId ? "Select project first" : "Select license to embed"} />
                </SelectTrigger>
                <SelectContent>
                  {projectLicenses.map((l: LicenseOpt) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.license_key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Embedding a license encrypts the package using the license key, allowing
                automatic activation. If omitted, the fallback workspace key is used.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Release Notes / Changelog</Label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Included in this build..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !projectId}>
              {busy ? "Generating…" : "Generate & Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
