"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Smartphone,
  Monitor,
  ShieldCheck,
  ShieldAlert,
  PauseCircle,
  PlayCircle,
  Download,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useDataQuery } from "@/hooks/use-data";

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

type ReleaseRow = any;
type ClientRow = { id: string; name: string };
type ProductFilter = "all" | "windows-pos" | "android-pos";

interface ServerCapabilities {
  r2Configured: boolean;
  signingConfigured: boolean;
  signingKeyId: string | null;
  signingPublicKeyB64: string | null;
  signingError: string | null;
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function computeFileSha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function ReleasesPage() {
  const { data: clients = [], isLoading: loadingClients } = useDataQuery("clients");
  const { data: installs = [], refetch: refetchInstalls } = useDataQuery("release_installs");

  const [rawRows, setRawRows] = useState<ReleaseRow[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [openNew, setOpenNew] = useState(false);
  const [detail, setDetail] = useState<ReleaseRow | null>(null);

  const loadReleases = useCallback(async () => {
    setLoadingRows(true);
    try {
      const res = await fetch("/api/admin/releases", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load releases");
      }
      const json = await res.json();
      setRawRows(Array.isArray(json.releases) ? json.releases : []);
      setCapabilities(json.capabilities || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load releases");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  const rows = useMemo(() => {
    return rawRows
      .filter((r) => {
        const appType = r.app_type || "windows-pos";
        if (productFilter === "all") return true;
        return appType === productFilter;
      })
      .map((r: any) => {
        const installedCount = installs.filter(
          (i: any) => i.release_id === r.id && i.status === "installed"
        ).length;
        return { ...r, installed_count: installedCount };
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [rawRows, installs, productFilter]);

  const refresh = async () => {
    await Promise.all([loadReleases(), refetchInstalls()]);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" /> Releases
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Publish signed Android Pharmacy POS bundles & APKs and Windows POS updates. Android updates remain private to licensed terminals.
          </p>
        </div>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4 mr-1" /> New release
        </Button>
      </header>

      {capabilities && (
        <div
          className={`rounded-lg border p-3 text-xs flex flex-wrap items-center justify-between gap-3 ${capabilities.signingConfigured
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/10"
            }`}
        >
          <div className="flex items-start gap-2">
            {capabilities.signingConfigured ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            )}
            <div>
              {capabilities.signingConfigured ? (
                <>
                  <div className="font-semibold text-foreground">
                    Android Ed25519 Release Signing Active (Key ID: {capabilities.signingKeyId})
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono break-all">
                    Pinned Public Key: {capabilities.signingPublicKeyB64}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-amber-800 dark:text-amber-300">
                    Android Signing Not Configured on Server
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {capabilities.signingError ||
                      "Set RELEASE_MANIFEST_SIGNING_SEED on the server before creating/publishing signed Android releases."}
                  </div>
                </>
              )}
            </div>
          </div>
          {capabilities.signingConfigured && capabilities.signingPublicKeyB64 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(capabilities.signingPublicKeyB64 || "");
                toast.success("Pinned Ed25519 public key copied");
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy Public Key
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={productFilter === "all" ? "default" : "outline"}
          onClick={() => setProductFilter("all")}
        >
          All Products ({rawRows.length})
        </Button>
        <Button
          size="sm"
          variant={productFilter === "android-pos" ? "default" : "outline"}
          onClick={() => setProductFilter("android-pos")}
        >
          <Smartphone className="h-3.5 w-3.5 mr-1.5" />
          Android Pharmacy POS (
          {rawRows.filter((r) => (r.app_type || "windows-pos") === "android-pos").length})
        </Button>
        <Button
          size="sm"
          variant={productFilter === "windows-pos" ? "default" : "outline"}
          onClick={() => setProductFilter("windows-pos")}
        >
          <Monitor className="h-3.5 w-3.5 mr-1.5" />
          Windows Electron POS (
          {rawRows.filter((r) => (r.app_type || "windows-pos") === "windows-pos").length})
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product / Version</TableHead>
              <TableHead>Channel & Security</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rollout</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Installed</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingRows || loadingClients ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No releases yet for this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r: any) => {
                const isAndroid = r.app_type === "android-pos";
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setDetail(r)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {isAndroid ? (
                          <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Monitor className="h-3.5 w-3.5 text-blue-600" />
                        )}
                        <span className="font-mono font-semibold">v{r.version}</span>
                        {isAndroid && r.version_code ? (
                          <span className="text-xs text-muted-foreground font-mono">
                            (build {r.version_code})
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {r.release_type === "web-bundle" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-emerald-700 border-emerald-600"
                          >
                            Android Web Hot-Update
                          </Badge>
                        ) : r.release_type === "apk" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-purple-700 border-purple-600"
                          >
                            Android Full APK
                          </Badge>
                        ) : r.release_type === "full" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-blue-600 border-blue-600"
                          >
                            Windows Full
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-orange-600 border-orange-600"
                          >
                            Windows Hot ASAR
                          </Badge>
                        )}
                        {r.mandatory && (
                          <Badge variant="destructive" className="text-[10px]">
                            Mandatory
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs space-y-1">
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {r.channel || "stable"}
                        </Badge>
                        {isAndroid && (
                          <Badge
                            variant={r.signature_status === "signed" ? "default" : "destructive"}
                            className="text-[10px]"
                          >
                            {r.signature_status === "signed"
                              ? `Ed25519 Signed (${r.manifest_key_id || ""})`
                              : "Unsigned"}
                          </Badge>
                        )}
                      </div>
                      {isAndroid && (
                        <div className="text-[11px] text-muted-foreground">
                          seq #{r.release_seq ?? "?"} · minBuild {r.min_native_version_code ?? 1}
                          {r.max_native_version_code ? `..${r.max_native_version_code}` : "+"} · schema v
                          {r.schema_version ?? 1}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
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
                        {r.disabled && (
                          <Badge variant="destructive" className="text-[10px]">
                            Disabled
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.rollout_type === "all" ? (
                        <span className="text-muted-foreground">All clients</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" /> {r.target_client_ids?.length ?? 0}{" "}
                          selected
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {openNew && (
        <NewReleaseDialog
          clients={clients}
          capabilities={capabilities}
          onClose={() => setOpenNew(false)}
          onCreated={async () => {
            setOpenNew(false);
            await refresh();
          }}
        />
      )}

      {detail && (
        <ReleaseDetailDialog
          release={detail}
          allInstalls={installs}
          onClose={() => setDetail(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function NewReleaseDialog({
  clients,
  capabilities,
  onClose,
  onCreated,
}: {
  clients: ClientRow[];
  capabilities: ServerCapabilities | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [appType, setAppType] = useState<"android-pos" | "windows-pos">("android-pos");
  const [androidType, setAndroidType] = useState<"web-bundle" | "apk">("web-bundle");
  const [windowsType, setWindowsType] = useState<"hot" | "full">("hot");
  const [channel, setChannel] = useState<"stable" | "beta" | "debug">("stable");
  const [version, setVersion] = useState("");
  const [versionCode, setVersionCode] = useState("2");
  const [minNativeVersionCode, setMinNativeVersionCode] = useState("1");
  const [maxNativeVersionCode, setMaxNativeVersionCode] = useState("");
  const [schemaVersion, setSchemaVersion] = useState("1");
  const [packageId, setPackageId] = useState("com.aivrasol.pos");
  const [signingCertSha256, setSigningCertSha256] = useState("");
  const [changelog, setChangelog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState("");
  const [hashingFile, setHashingFile] = useState(false);
  const [rollout, setRollout] = useState<"all" | "specific">("all");
  const [targets, setTargets] = useState<string[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const releaseType = appType === "android-pos" ? androidType : windowsType;

  const toggleTarget = (id: string) => {
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleArtifactSelect = async (selected: File | null) => {
    setFile(selected);
    setSha256("");
    if (!selected) return;
    setHashingFile(true);
    try {
      const digest = await computeFileSha256Hex(selected);
      setSha256(digest);
    } catch {
      toast.error("Failed to compute file SHA-256 in browser.");
    } finally {
      setHashingFile(false);
    }
  };

  const handleMetaJsonImport = async (metaFile: File | null) => {
    if (!metaFile) return;
    try {
      const parsed = JSON.parse(await metaFile.text());
      if (parsed.releaseType === "apk" || parsed.versionCode) {
        setAppType("android-pos");
        setAndroidType("apk");
      } else if (parsed.releaseType === "web-bundle") {
        setAppType("android-pos");
        setAndroidType("web-bundle");
      }
      if (parsed.version) setVersion(String(parsed.version));
      if (parsed.versionName) setVersion(String(parsed.versionName));
      if (parsed.versionCode) setVersionCode(String(parsed.versionCode));
      if (parsed.minNativeVersionCode) setMinNativeVersionCode(String(parsed.minNativeVersionCode));
      if (parsed.maxNativeVersionCode) setMaxNativeVersionCode(String(parsed.maxNativeVersionCode));
      if (parsed.schemaVersion) setSchemaVersion(String(parsed.schemaVersion));
      if (parsed.packageId) setPackageId(String(parsed.packageId));
      if (parsed.signingCertSha256) setSigningCertSha256(String(parsed.signingCertSha256));
      if (parsed.channel === "stable" || parsed.channel === "beta" || parsed.channel === "debug") {
        setChannel(parsed.channel);
      }
      if (parsed.changelog) setChangelog(String(parsed.changelog));
      toast.success("Loaded release metadata JSON.");
    } catch {
      toast.error("Invalid metadata JSON file.");
    }
  };

  const submit = async () => {
    if (!version.trim()) return toast.error("Version is required.");
    if (!file) return toast.error("Select the release artifact file.");
    if (hashingFile) return toast.error("Wait for SHA-256 calculation to finish.");
    if (rollout === "specific" && targets.length === 0) {
      return toast.error("Pick at least one target pharmacy client.");
    }
    if (appType === "android-pos") {
      if (!capabilities?.signingConfigured) {
        return toast.error(
          capabilities?.signingError ||
          "Server Ed25519 RELEASE_MANIFEST_SIGNING_SEED is missing; cannot create signed Android release."
        );
      }
      if (androidType === "apk") {
        if (!Number.isSafeInteger(Number(versionCode)) || Number(versionCode) < 1) {
          return toast.error("Valid integer Android versionCode is required for APK.");
        }
        if (!/^[a-fA-F0-9:]{64,}$/.test(signingCertSha256.trim())) {
          return toast.error(
            "64-hex APK signing certificate SHA-256 fingerprint is required (from apk-meta.json)."
          );
        }
      }
    }

    setBusy(true);
    try {
      setProgress(10);
      const signRes = await fetch("/api/admin/releases/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appType,
          releaseType,
          channel,
          filename: file.name,
          fileType: file.type || "application/octet-stream",
          version: version.trim(),
          sizeBytes: file.size,
        }),
      });
      const signBody = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(signBody.error || "Failed to get presigned upload URL");

      setProgress(20);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setProgress(20 + Math.round((event.loaded / event.total) * 65));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 upload failed with HTTP ${xhr.status}`));
        });
        xhr.addEventListener("error", () => reject(new Error("Network error or R2 CORS block")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
        xhr.open("PUT", signBody.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      setProgress(90);

      const createRes = await fetch("/api/admin/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appType,
          releaseType,
          channel,
          version: version.trim(),
          versionCode: androidType === "apk" ? Number(versionCode) : undefined,
          minNativeVersionCode: Number(minNativeVersionCode || 1),
          maxNativeVersionCode: maxNativeVersionCode.trim()
            ? Number(maxNativeVersionCode.trim())
            : null,
          schemaVersion: Number(schemaVersion || 1),
          packageId: packageId.trim(),
          signingCertSha256: signingCertSha256.trim() || undefined,
          objectKey: signBody.objectKey,
          sizeBytes: file.size,
          sha256: sha256.trim() || undefined,
          changelog: changelog.trim(),
          rolloutType: rollout,
          targetClientIds: rollout === "specific" ? targets : [],
          mandatory,
          status: publish ? "published" : "draft",
        }),
      });

      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(createBody.error || "Release verification/signing failed.");
      }

      setProgress(100);
      toast.success(
        publish
          ? `${appType === "android-pos" ? "Signed Android" : "Windows"} v${version} published!`
          : `Saved v${version} as draft.`
      );
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New POS Release</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Target Product (Separate Products)</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setAppType("android-pos")}
                className={`rounded-lg border p-3 text-left transition ${appType === "android-pos"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "hover:bg-muted/50"
                  }`}
              >
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-emerald-600" /> Android Pharmacy POS
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Ed25519-signed private OTA bundles & APKs
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAppType("windows-pos")}
                className={`rounded-lg border p-3 text-left transition ${appType === "windows-pos"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "hover:bg-muted/50"
                  }`}
              >
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <Monitor className="h-4 w-4 text-blue-600" /> Windows Electron POS
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Legacy hot .asar & Windows setup installers
                </div>
              </button>
            </div>
          </div>

          {appType === "android-pos" ? (
            <>
              <div>
                <Label>Android Artifact Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setAndroidType("web-bundle")}
                    className={`rounded-lg border p-2.5 text-left text-xs ${androidType === "web-bundle"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <div className="font-semibold text-sm">Web Hot-Update (.zip)</div>
                    <div className="text-muted-foreground mt-0.5">
                      Signed web bundle activated natively without reinstalling APK
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAndroidType("apk")}
                    className={`rounded-lg border p-2.5 text-left text-xs ${androidType === "apk"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <div className="font-semibold text-sm">Full Android APK (.apk)</div>
                    <div className="text-muted-foreground mt-0.5">
                      Native shell / plugin / schema upgrade requiring user install
                    </div>
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-dashed p-3 bg-muted/20">
                <Label className="text-xs">
                  Optional: Load build metadata JSON (manifest-meta.json or apk-meta.json)
                </Label>
                <Input
                  type="file"
                  accept=".json"
                  className="mt-1.5 h-8 text-xs"
                  onChange={(e) => handleMetaJsonImport(e.target.files?.[0] ?? null)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Channel</Label>
                  <select
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={channel}
                    onChange={(e) =>
                      setChannel(e.target.value as "stable" | "beta" | "debug")
                    }
                  >
                    <option value="stable">stable</option>
                    <option value="beta">beta</option>
                    <option value="debug">debug</option>
                  </select>
                </div>
                <div>
                  <Label>SemVer Version</Label>
                  <Input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder={androidType === "web-bundle" ? "1.0.1" : "1.1.0"}
                  />
                </div>
              </div>

              {androidType === "web-bundle" ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Min Native versionCode</Label>
                    <Input
                      type="number"
                      min={1}
                      value={minNativeVersionCode}
                      onChange={(e) => setMinNativeVersionCode(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max Native versionCode</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Optional"
                      value={maxNativeVersionCode}
                      onChange={(e) => setMaxNativeVersionCode(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Schema Version</Label>
                    <Input
                      type="number"
                      min={1}
                      value={schemaVersion}
                      onChange={(e) => setSchemaVersion(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Android versionCode (Integer)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={versionCode}
                        onChange={(e) => setVersionCode(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Package ID</Label>
                      <Input
                        value={packageId}
                        onChange={(e) => setPackageId(e.target.value)}
                        readOnly
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Signing Cert SHA-256 (64-hex fingerprint)</Label>
                    <Input
                      value={signingCertSha256}
                      onChange={(e) => setSigningCertSha256(e.target.value)}
                      placeholder="From apk-meta.json or apksigner verify --print-certs"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <Label>Windows Release Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setWindowsType("hot")}
                    className={`rounded-lg border p-2.5 text-left text-xs ${windowsType === "hot"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <div className="font-semibold text-sm">Hot update (.asar)</div>
                    <div className="text-muted-foreground mt-0.5">Windows Electron ASAR</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWindowsType("full")}
                    className={`rounded-lg border p-2.5 text-left text-xs ${windowsType === "full"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <div className="font-semibold text-sm">Full installer (.exe/.zip)</div>
                    <div className="text-muted-foreground mt-0.5">Desktop installer</div>
                  </button>
                </div>
              </div>

              <div>
                <Label>Version</Label>
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.7.1"
                />
              </div>
            </>
          )}

          <div>
            <Label>
              Artifact File (
              {appType === "android-pos"
                ? androidType === "web-bundle"
                  ? "POSIX .zip"
                  : "Signed .apk"
                : windowsType === "hot"
                  ? ".asar"
                  : ".exe / .zip"}
              )
            </Label>
            <Input
              type="file"
              accept={
                appType === "android-pos"
                  ? androidType === "web-bundle"
                    ? ".zip"
                    : ".apk"
                  : windowsType === "hot"
                    ? ".asar"
                    : ".exe,.zip,.msi"
              }
              onChange={(e) => void handleArtifactSelect(e.target.files?.[0] ?? null)}
            />
            {file && (
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <div>
                  {file.name} · {fmtSize(file.size)}
                </div>
                <div className="font-mono break-all">
                  SHA-256: {hashingFile ? "computing…" : sha256 || "—"}
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Changelog (what&apos;s new)</Label>
            <Textarea
              rows={3}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="- Describe what changed in this update"
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
              <div className="max-h-36 overflow-y-auto rounded border bg-muted/30 p-2 space-y-1">
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
                Require activation promptly once idle instead of passive prompt.
              </div>
            </div>
            <Switch checked={mandatory} onCheckedChange={setMandatory} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Publish immediately</div>
              <div className="text-xs text-muted-foreground">
                Turn off to save as signed draft before staged rollout.
              </div>
            </div>
            <Switch checked={publish} onCheckedChange={setPublish} />
          </div>

          {busy && (
            <div className="text-xs text-muted-foreground">
              Uploading, verifying SHA-256 & signing… {progress}%
              <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || hashingFile}>
            <Upload className="h-4 w-4 mr-1" />
            {busy ? "Processing…" : publish ? "Verify, Sign & Publish" : "Verify, Sign & Save Draft"}
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
}: {
  release: ReleaseRow;
  allInstalls: any[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const installs = useMemo(
    () => allInstalls.filter((i) => i.release_id === release.id),
    [allInstalls, release.id]
  );

  const stats = useMemo(() => {
    const s = { checked: 0, downloaded: 0, installed: 0, failed: 0 };
    for (const i of installs) {
      if (i.status === "checked") s.checked++;
      else if (i.status === "downloaded") s.downloaded++;
      else if (i.status === "installed") s.installed++;
      else if (i.status === "failed" || i.status === "rolled_back") s.failed++;
    }
    return s;
  }, [installs]);

  const patchRelease = async (patch: Record<string, any>, msg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/releases/${encodeURIComponent(release.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Update failed");
      toast.success(msg);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm(`Delete v${release.version}? This also removes the artifact from R2 if unshared.`))
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/releases/${encodeURIComponent(release.id)}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed");
      toast.success("Release deleted");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const isAndroid = release.app_type === "android-pos";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Rocket className="h-5 w-5" /> v{release.version}
            <Badge variant={release.status === "published" ? "default" : "secondary"}>
              {release.status}
            </Badge>
            {release.disabled && <Badge variant="destructive">Disabled</Badge>}
            {release.mandatory && <Badge variant="destructive">Mandatory</Badge>}
            {isAndroid && (
              <Badge variant={release.signature_status === "signed" ? "default" : "destructive"}>
                {release.signature_status === "signed"
                  ? `Ed25519 Signed (${release.manifest_key_id})`
                  : "Unsigned"}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 text-center">
          <StatBox label="Checked" value={stats.checked} />
          <StatBox label="Downloaded" value={stats.downloaded} />
          <StatBox label="Installed" value={stats.installed} highlight />
          <StatBox label="Failed / Rolled Back" value={stats.failed} danger />
        </div>

        {release.changelog && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Changelog</div>
            <pre className="text-sm whitespace-pre-wrap font-sans">{release.changelog}</pre>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1 font-mono">
          <div>
            Product: {release.app_type || "windows-pos"} · Type: {release.release_type} · Channel:{" "}
            {release.channel || "stable"}
          </div>
          <div>
            Rollout:{" "}
            {release.rollout_type === "all"
              ? "All clients"
              : `${release.target_client_ids?.length ?? 0} specific clients`}
          </div>
          {isAndroid && (
            <>
              <div>
                Package ID: {release.package_id || "com.aivrasol.pos"} · Seq #
                {release.release_seq ?? "—"} · Schema v{release.schema_version ?? 1}
              </div>
              {release.version_code ? (
                <div>Native versionCode: {release.version_code}</div>
              ) : (
                <div>
                  Compatible native builds: {release.min_native_version_code ?? 1}..
                  {release.max_native_version_code ?? "latest"}
                </div>
              )}
              {release.signing_cert_sha256 && (
                <div className="break-all">Signing Cert: {release.signing_cert_sha256}</div>
              )}
            </>
          )}
          <div className="break-all">Object Key / Path: {release.object_key || release.storage_path || "—"}</div>
          <div className="break-all">SHA-256: {release.sha256 ?? "—"}</div>
          {release.installer_size ? <div>Size: {fmtSize(release.installer_size)}</div> : null}
          <div>Created: {new Date(release.created_at).toLocaleString()}</div>
          {release.published_at && (
            <div>Published: {new Date(release.published_at).toLocaleString()}</div>
          )}
        </div>

        {release.manifest_json && (
          <details className="rounded-lg border bg-muted/20 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">
              Inspect Signed Ed25519 Manifest JSON
            </summary>
            <pre className="mt-2 overflow-x-auto text-[11px] whitespace-pre-wrap break-all font-mono">
              {release.manifest_json}
            </pre>
          </details>
        )}

        <div className="rounded-lg border">
          <div className="text-xs font-semibold px-3 py-2 border-b flex items-center gap-1">
            <FileDown className="h-3.5 w-3.5" /> Recent install activity
          </div>
          <div className="max-h-56 overflow-y-auto text-xs">
            {installs.length === 0 && (
              <div className="p-3 text-muted-foreground">No activity yet.</div>
            )}
            {installs.slice(0, 30).map((i: any) => (
              <div
                key={i.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-0"
              >
                <span className="font-mono">{i.license_key?.slice(0, 12)}…</span>
                <span className="text-muted-foreground truncate max-w-[140px]">
                  {i.machine_id?.slice(0, 10) || "—"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {i.status}
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(i.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.open(
                `/api/admin/releases/${encodeURIComponent(release.id)}/download?redirect=1`,
                "_blank",
                "noopener,noreferrer"
              );
            }}
          >
            <Download className="h-4 w-4 mr-1" /> Admin Download
          </Button>
          {release.status !== "published" && (
            <Button
              onClick={() => patchRelease({ status: "published", disabled: false }, "Release published")}
              disabled={busy}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Publish
            </Button>
          )}
          {release.status === "published" && !release.disabled && (
            <Button
              variant="outline"
              onClick={() => patchRelease({ disabled: true }, "Release disabled / paused")}
              disabled={busy}
            >
              <PauseCircle className="h-4 w-4 mr-1" /> Disable Rollout
            </Button>
          )}
          {release.status === "published" && release.disabled && (
            <Button
              variant="outline"
              onClick={() => patchRelease({ disabled: false }, "Release re-enabled")}
              disabled={busy}
            >
              <PlayCircle className="h-4 w-4 mr-1" /> Re-enable Rollout
            </Button>
          )}
          {release.status === "published" && (
            <Button
              variant="outline"
              onClick={() => patchRelease({ status: "archived" }, "Release archived")}
              disabled={busy}
            >
              <Archive className="h-4 w-4 mr-1" /> Archive
            </Button>
          )}
          {release.status === "archived" && (
            <Button
              variant="outline"
              onClick={() => patchRelease({ status: "draft" }, "Moved to draft")}
              disabled={busy}
            >
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
      className={`rounded-lg border p-3 ${highlight
          ? "border-primary bg-primary/5"
          : danger && value > 0
            ? "border-destructive bg-destructive/5"
            : ""
        }`}
    >
      <div className={`text-2xl font-bold ${danger && value > 0 ? "text-destructive" : ""}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
