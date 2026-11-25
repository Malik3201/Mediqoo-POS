"use client";

import React, { useRef, useState } from "react";
import JSZip from "jszip";
import {
  Archive,
  CheckCircle2,
  Download,
  FileArchive,
  FileWarning,
  HardDrive,
  Loader2,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Zap,
} from "lucide-react";
import { optimizeBlobForBulkCentralLibrary } from "@/lib/storefront/image-optimizer";

interface BulkZipImporterProps {
  onImportComplete?: () => void;
  onNotify?: (msg: string) => void;
}

interface ManifestRow {
  master_catalog_id?: string;
  filename?: string;
  exact_name?: string;
}

interface ResolvedCatalogMatch {
  filename: string;
  matched: boolean;
  match_via: string;
  item: {
    master_catalog_id: string;
    master_catalog_name: string;
    brand_name?: string;
    generic_name?: string;
    strength?: string;
    dosage_form?: string;
    manufacturer?: string;
    barcode?: string;
  } | null;
}

interface ImportIssue {
  filename: string;
  reason: string;
}

const IMAGE_EXT_RE = /\.(webp|jpg|jpeg|png)$/i;
const CHUNK_SIZE = 12;

function parseSimpleCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BulkZipImageImporter({ onImportComplete, onNotify }: BulkZipImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [stageLabel, setStageLabel] = useState<string>("");
  const [stats, setStats] = useState({
    totalFiles: 0,
    matchedToCatalog: 0,
    processed: 0,
    uploadedVerified: 0,
    deduplicated: 0,
    propagatedProducts: 0,
    originalBytes: 0,
    compressedBytes: 0,
  });
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [recentPreviews, setRecentPreviews] = useState<
    Array<{ name: string; id: string; sizeKb: string; preview: string }>
  >([]);

  function stopImport() {
    stopRef.current = true;
    setStageLabel("Stopping after current chunk...");
  }

  function downloadIssuesCsv() {
    if (issues.length === 0) return;
    const rows = ["filename,reason", ...issues.map((i) => `"${i.filename.replace(/"/g, '""')}","${i.reason.replace(/"/g, '""')}"`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-image-import-unmatched-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function processDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    stopRef.current = false;
    setRunning(true);
    setIssues([]);
    setRecentPreviews([]);
    setStats({
      totalFiles: 0,
      matchedToCatalog: 0,
      processed: 0,
      uploadedVerified: 0,
      deduplicated: 0,
      propagatedProducts: 0,
      originalBytes: 0,
      compressedBytes: 0,
    });

    try {
      // 1. Collect image blobs from ZIP archive(s) or direct multi-file selection
      setStageLabel("Extracting ZIP archive in browser (0 server memory used)...");
      const extracted: Array<{
        filename: string;
        getBlob: () => Promise<Blob>;
        manifest_master_id?: string;
        manifest_name?: string;
      }> = [];

      const manifestByFilename = new Map<string, ManifestRow>();

      for (const f of files) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          const zip = await JSZip.loadAsync(f);

          // First parse optional manifest.csv inside ZIP
          for (const [entryPath, zipObj] of Object.entries(zip.files)) {
            if (zipObj.dir || entryPath.includes("__MACOSX/")) continue;
            const base = entryPath.split("/").pop()?.toLowerCase() || "";
            if (base === "manifest.csv") {
              const csvText = await zipObj.async("string");
              const parsed = parseSimpleCsv(csvText);
              for (const row of parsed) {
                const fn = (row.filename || row.expected_filename || "").split("/").pop()?.toLowerCase();
                if (fn) {
                  manifestByFilename.set(fn, {
                    master_catalog_id: row.master_catalog_id || row.master_id || row.id,
                    filename: fn,
                    exact_name: row.exact_name || row.master_catalog_name || row.name,
                  });
                }
              }
            }
          }

          for (const [entryPath, zipObj] of Object.entries(zip.files)) {
            if (zipObj.dir || entryPath.includes("__MACOSX/")) continue;
            const base = entryPath.split("/").pop() || "";
            if (!base || base.startsWith(".") || !IMAGE_EXT_RE.test(base)) continue;
            const mRow = manifestByFilename.get(base.toLowerCase());
            extracted.push({
              filename: base,
              getBlob: () => zipObj.async("blob"),
              manifest_master_id: mRow?.master_catalog_id,
              manifest_name: mRow?.exact_name,
            });
          }
        } else if (IMAGE_EXT_RE.test(f.name)) {
          extracted.push({
            filename: f.name,
            getBlob: async () => f,
          });
        }
      }

      if (extracted.length === 0) {
        onNotify?.("No valid .webp, .jpg, or .png images found in the selected ZIP/files.");
        setRunning(false);
        return;
      }

      setStats((s) => ({ ...s, totalFiles: extracted.length }));
      setStageLabel(`Matching ${extracted.length} images against 41,441 Master Catalog medicines...`);

      // 2. Match all filenames against Master Catalog in ONE fast API call
      const resolveRes = await fetch("/api/admin/master-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve_bulk",
          entries: extracted.map((e) => ({
            filename: e.filename,
            manifest_master_id: e.manifest_master_id,
            manifest_name: e.manifest_name,
          })),
        }),
      });
      const resolveData = await resolveRes.json();
      if (!resolveRes.ok || !resolveData.ok) {
        throw new Error(resolveData.error || "Failed to match filenames against Master Catalog.");
      }

      const resolvedList: ResolvedCatalogMatch[] = resolveData.results || [];
      const matchedPairs: Array<{
        entry: (typeof extracted)[number];
        catalog: NonNullable<ResolvedCatalogMatch["item"]>;
      }> = [];
      const newIssues: ImportIssue[] = [];

      resolvedList.forEach((res, idx) => {
        const entry = extracted[idx];
        if (!entry) return;
        if (res.matched && res.item) {
          matchedPairs.push({ entry, catalog: res.item });
        } else {
          newIssues.push({
            filename: entry.filename,
            reason: "Could not match filename to Master Catalog ID or exact medicine name",
          });
        }
      });

      setIssues(newIssues);
      setStats((s) => ({ ...s, matchedToCatalog: matchedPairs.length }));

      if (matchedPairs.length === 0) {
        onNotify?.(
          "No filenames matched the Master Catalog. Ensure files use {master_catalog_id}__{Medicine_Name}.webp naming."
        );
        setRunning(false);
        return;
      }

      // 3. Process in chunks: Compress in browser to <= 35KB WebP -> Upload & Auto-Verify -> Auto-Propagate!
      let processed = 0;
      let uploadedVerified = 0;
      let deduplicated = 0;
      let propagatedProducts = 0;
      let originalBytes = 0;
      let compressedBytes = 0;

      for (let i = 0; i < matchedPairs.length; i += CHUNK_SIZE) {
        if (stopRef.current) break;

        const slice = matchedPairs.slice(i, i + CHUNK_SIZE);
        setStageLabel(
          `Compressing & uploading verified chunk ${Math.floor(i / CHUNK_SIZE) + 1} / ${Math.ceil(matchedPairs.length / CHUNK_SIZE)} (${processed}/${matchedPairs.length})...`
        );

        const readyBatch: Array<{
          payload: Record<string, unknown>;
          preview: string;
          label: string;
          id: string;
          sizeKb: string;
        }> = [];

        // Compress up to 4 images concurrently inside browser canvas
        const CONCURRENCY = 4;
        for (let c = 0; c < slice.length; c += CONCURRENCY) {
          const group = slice.slice(c, c + CONCURRENCY);
          await Promise.all(
            group.map(async ({ entry, catalog }) => {
              try {
                const rawBlob = await entry.getBlob();
                const opt = await optimizeBlobForBulkCentralLibrary(rawBlob, {
                  size: 500,
                  targetMaxBytes: 35 * 1024,
                });
                originalBytes += opt.originalBytes;
                compressedBytes += opt.byteSize;
                readyBatch.push({
                  payload: {
                    master_catalog_id: catalog.master_catalog_id,
                    master_catalog_name: catalog.master_catalog_name,
                    brand_name: catalog.brand_name || null,
                    generic_name: catalog.generic_name || null,
                    strength: catalog.strength || null,
                    dosage_form: catalog.dosage_form || null,
                    manufacturer: catalog.manufacturer || null,
                    barcode: catalog.barcode || null,
                    data_base64: opt.base64Data,
                    sha256_hex: opt.sha256Hex,
                    content_type: "image/webp",
                    byte_size: opt.byteSize,
                    width: opt.width,
                    height: opt.height,
                    source_type: "bulk_zip_import",
                    logical_file_name: `${catalog.master_catalog_name}.webp`,
                  },
                  preview: opt.previewDataUrl,
                  label: catalog.master_catalog_name,
                  id: catalog.master_catalog_id,
                  sizeKb: `${(opt.byteSize / 1024).toFixed(1)} KB`,
                });
              } catch (err: any) {
                newIssues.push({
                  filename: entry.filename,
                  reason: `Compression failed: ${err?.message || "invalid image"}`,
                });
              }
            })
          );
        }

        if (readyBatch.length > 0) {
          const upRes = await fetch("/api/admin/central-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "bulk_upload_verified",
              items: readyBatch.map((b) => b.payload),
            }),
          });
          const upData = await upRes.json().catch(() => ({ ok: false }));
          if (!upRes.ok || !upData.ok) {
            for (const b of readyBatch) {
              newIssues.push({
                filename: b.label,
                reason: upData.message || upData.error || `HTTP ${upRes.status}`,
              });
            }
          } else {
            uploadedVerified += Number(upData.uploaded || 0);
            deduplicated += Number(upData.deduplicated || 0);
            propagatedProducts += Number(upData.propagated_products || 0);
            if (Array.isArray(upData.failed)) {
              for (const f of upData.failed) {
                newIssues.push({ filename: String(f.name || "unknown"), reason: String(f.error || "failed") });
              }
            }
            setRecentPreviews((prev) =>
              [...readyBatch.slice(0, 6).map((b) => ({ name: b.label, id: b.id, sizeKb: b.sizeKb, preview: b.preview })), ...prev].slice(0, 8)
            );
          }
        }

        processed += slice.length;
        setIssues([...newIssues]);
        setStats({
          totalFiles: extracted.length,
          matchedToCatalog: matchedPairs.length,
          processed,
          uploadedVerified,
          deduplicated,
          propagatedProducts,
          originalBytes,
          compressedBytes,
        });
      }

      const doneMsg = stopRef.current
        ? `Bulk import paused at ${processed}/${matchedPairs.length}. ${uploadedVerified} verified & uploaded.`
        : `Bulk ZIP complete! ${uploadedVerified} new + ${deduplicated} deduplicated verified in R2, auto-linked to ${propagatedProducts} pharmacy products.`;
      setStageLabel(doneMsg);
      onNotify?.(doneMsg);
      onImportComplete?.();
    } catch (err: any) {
      const msg = err?.message || "Bulk ZIP import failed.";
      setStageLabel(msg);
      onNotify?.(msg);
    } finally {
      setRunning(false);
    }
  }

  const pct =
    stats.matchedToCatalog > 0
      ? Math.min(100, Math.round((stats.processed / stats.matchedToCatalog) * 100))
      : 0;
  const savedPct =
    stats.originalBytes > 0
      ? Math.max(0, Math.round((1 - stats.compressedBytes / stats.originalBytes) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* Info Strip */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-600 text-white shrink-0">
            <FileArchive className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-2">
              Zero-Click Bulk ZIP Medicine Importer (Auto-Compress + Auto-Verify + Auto-Link)
            </h3>
            <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90 max-w-3xl leading-relaxed">
              Drop any Muse AI <code className="font-mono bg-white/80 dark:bg-slate-900 px-1.5 py-0.5 rounded">.zip</code>{" "}
              archive (up to thousands of images). Files are extracted &amp; compressed right in your browser to{" "}
              <strong>500×500 WebP (~20–30 KB)</strong>, deduplicated by SHA-256 in Cloudflare R2, marked{" "}
              <strong>Verified</strong> automatically, and instantly propagated to every matching pharmacy website.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>ABZ-ITEM-12345__NAME.webp</span>
        </div>
      </div>

      {/* Main Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!running && e.dataTransfer.files?.length) {
            void processDroppedFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => {
          if (!running) fileInputRef.current?.click();
        }}
        className={`rounded-3xl border-2 border-dashed p-10 text-center transition cursor-pointer ${
          running
            ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/10 cursor-default"
            : dragging
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 scale-[1.005]"
              : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,image/webp,image/jpeg,image/png"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void processDroppedFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />

        {running ? (
          <div className="space-y-4 max-w-xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-xs font-bold">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{stageLabel || "Processing..."}</span>
            </div>

            <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-slate-600 dark:text-slate-300">
              <span>
                {stats.processed} / {stats.matchedToCatalog} matched images ({pct}%)
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  stopImport();
                }}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-sans font-bold text-xs inline-flex items-center gap-1"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-w-lg mx-auto">
            <div className="h-14 w-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <Upload className="h-7 w-7" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900 dark:text-white">
                Drop Muse AI Medicine Packshot <span className="text-emerald-600">.ZIP</span> Here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Or click to browse a <code>.zip</code> archive (or multiple <code>.jpg/.png/.webp</code> files).
                Compression, verification &amp; multi-pharmacy linking start automatically.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px] text-slate-500">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Auto WebP ≤ 35 KB
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                SHA-256 R2 Dedup
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Zero Vercel 4.5 MB Limit
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Auto-Verified &amp; Live
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Live Stats Cards */}
      {stats.totalFiles > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              ZIP Images Found
            </span>
            <span className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
              {stats.totalFiles}
            </span>
            <span className="text-[11px] text-emerald-600 font-semibold">
              {stats.matchedToCatalog} matched catalog
            </span>
          </div>

          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
              Verified &amp; Uploaded
            </span>
            <span className="text-xl font-black font-mono text-emerald-700 dark:text-emerald-300 mt-1 block">
              {stats.uploadedVerified}
            </span>
            <span className="text-[11px] text-emerald-600/90 font-semibold">
              +{stats.deduplicated} deduplicated
            </span>
          </div>

          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 block">
              Pharmacy Links Created
            </span>
            <span className="text-xl font-black font-mono text-indigo-700 dark:text-indigo-300 mt-1 block">
              {stats.propagatedProducts}
            </span>
            <span className="text-[11px] text-indigo-600/90 font-semibold">Auto-applied live</span>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              R2 Space Saved
            </span>
            <span className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
              {savedPct}%
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {formatBytes(stats.originalBytes)} → {formatBytes(stats.compressedBytes)}
            </span>
          </div>

          <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
              Unmatched / Skipped
            </span>
            <span className="text-xl font-black font-mono text-amber-700 dark:text-amber-300 mt-1 block">
              {issues.length}
            </span>
            {issues.length > 0 ? (
              <button
                type="button"
                onClick={downloadIssuesCsv}
                className="text-[11px] font-bold text-amber-700 hover:underline inline-flex items-center gap-1 mt-0.5"
              >
                <Download className="h-3 w-3" />
                Export CSV
              </button>
            ) : (
              <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Clean run
              </span>
            )}
          </div>
        </div>
      )}

      {/* Recent Verified Thumbnails Preview */}
      {recentPreviews.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              Recently Compressed &amp; Verified in R2
            </span>
            <span className="text-[11px] text-slate-400 font-mono">500×500 WebP · Shared Library</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
            {recentPreviews.map((p, idx) => (
              <div
                key={`${p.id}-${idx}`}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 bg-slate-50 dark:bg-slate-950 text-center space-y-1"
              >
                <img
                  src={p.preview}
                  alt={p.name}
                  className="h-16 w-16 object-contain mx-auto rounded-lg bg-white"
                />
                <div className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate" title={p.name}>
                  {p.name}
                </div>
                <div className="text-[9px] font-mono text-emerald-600">{p.sizeKb}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched / Issue Log Preview */}
      {issues.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5">
              <FileWarning className="h-4 w-4" />
              Unmatched / Skipped Entries ({issues.length})
            </span>
            <button
              type="button"
              onClick={downloadIssuesCsv}
              className="px-3 py-1 rounded-lg border border-amber-300 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              <Download className="h-3.5 w-3.5" />
              Download Report CSV
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {issues.slice(0, 30).map((it, idx) => (
              <div key={idx} className="py-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-slate-700 dark:text-slate-200 truncate">{it.filename}</span>
                <span className="text-amber-700 dark:text-amber-400 shrink-0 text-[11px]">{it.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
