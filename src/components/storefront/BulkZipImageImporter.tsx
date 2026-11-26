"use client";

import React, { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  FileWarning,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  X,
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

interface CatalogCandidate {
  master_catalog_id: string;
  master_catalog_name: string;
  brand_name?: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  manufacturer?: string;
  barcode?: string;
}

interface ResolvedCatalogMatch {
  filename: string;
  matched: boolean;
  match_via: string;
  item: CatalogCandidate | null;
  suggestions?: CatalogCandidate[];
}

interface ImportIssue {
  filename: string;
  reason: string;
}

interface ExtractedEntry {
  filename: string;
  getBlob: () => Promise<Blob>;
  manifest_master_id?: string;
  manifest_name?: string;
}

interface PendingReviewItem {
  key: string;
  filename: string;
  reason: string;
  entry: ExtractedEntry;
  previewUrl: string | null;
  suggestions: CatalogCandidate[];
  selected: CatalogCandidate | null;
  uploading?: boolean;
  uploaded?: boolean;
  error?: string;
}

interface FailedUploadItem {
  key: string;
  entry: ExtractedEntry;
  catalog: CatalogCandidate;
  reason: string;
}

const IMAGE_EXT_RE = /\.(webp|jpg|jpeg|png)$/i;
const CHUNK_SIZE = 10;

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function BulkZipImageImporter({ onImportComplete, onNotify }: BulkZipImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);

  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [stageLabel, setStageLabel] = useState<string>("");
  const [stats, setStats] = useState({
    totalFiles: 0,
    matchedToCatalog: 0,
    smartMatched: 0,
    processed: 0,
    uploadedVerified: 0,
    deduplicated: 0,
    propagatedProducts: 0,
    originalBytes: 0,
    compressedBytes: 0,
  });
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [pendingReviews, setPendingReviews] = useState<PendingReviewItem[]>([]);
  const [failedUploads, setFailedUploads] = useState<FailedUploadItem[]>([]);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [uploadingAssigned, setUploadingAssigned] = useState(false);

  // Per-row Master Catalog live search state inside the review panel
  const [rowSearchQuery, setRowSearchQuery] = useState<Record<string, string>>({});
  const [rowSearchResults, setRowSearchResults] = useState<Record<string, CatalogCandidate[]>>({});
  const [rowSearching, setRowSearching] = useState<Record<string, boolean>>({});
  const searchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [recentPreviews, setRecentPreviews] = useState<
    Array<{ name: string; id: string; sizeKb: string; preview: string }>
  >([]);

  function revokePreviewUrls() {
    for (const url of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    objectUrlsRef.current = [];
  }

  useEffect(() => {
    return () => revokePreviewUrls();
  }, []);

  function stopImport() {
    stopRef.current = true;
    setStageLabel("Stopping after current chunk...");
  }

  function downloadIssuesCsv() {
    const allRows: ImportIssue[] = [
      ...pendingReviews
        .filter((r) => !r.uploaded)
        .map((r) => ({ filename: r.filename, reason: r.error || r.reason })),
      ...failedUploads.map((f) => ({ filename: f.catalog.master_catalog_name, reason: f.reason })),
      ...issues,
    ];
    if (allRows.length === 0) return;
    const rows = [
      "filename,reason",
      ...allRows.map((i) => `"${i.filename.replace(/"/g, '""')}","${i.reason.replace(/"/g, '""')}"`),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-image-import-unmatched-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Resilient chunk uploader:
   * - Retries transient 5xx / network failures up to 2 times with backoff
   * - If a multi-item chunk still fails with 5xx, splits into smaller sub-chunks (size 3 -> 1)
   *   so a single bad image NEVER fails the whole chunk!
   */
  async function uploadPreparedBatchResilient(
    readyBatch: Array<{
      entry: ExtractedEntry;
      catalog: CatalogCandidate;
      payload: Record<string, unknown>;
      preview: string;
      label: string;
      id: string;
      sizeKb: string;
    }>
  ): Promise<{
    uploaded: number;
    deduplicated: number;
    propagated: number;
    succeeded: typeof readyBatch;
    failedItems: FailedUploadItem[];
  }> {
    if (readyBatch.length === 0) {
      return { uploaded: 0, deduplicated: 0, propagated: 0, succeeded: [], failedItems: [] };
    }

    const postOnce = async (batch: typeof readyBatch) => {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_upload_verified",
          items: batch.map((b) => b.payload),
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      return { ok: res.ok && Boolean(data?.ok), status: res.status, data };
    };

    let lastStatus = 0;
    let lastError = "Upload failed";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await postOnce(readyBatch);
        if (res.ok) {
          const failedNameSet = new Map<string, string>();
          if (Array.isArray(res.data.failed)) {
            for (const f of res.data.failed) {
              failedNameSet.set(String(f.name || "").toLowerCase(), String(f.error || "failed"));
            }
          }
          const succeeded: typeof readyBatch = [];
          const failedItems: FailedUploadItem[] = [];
          for (const b of readyBatch) {
            const errMsg = failedNameSet.get(b.label.toLowerCase());
            if (errMsg) {
              failedItems.push({
                key: `${b.catalog.master_catalog_id}::${b.entry.filename}`,
                entry: b.entry,
                catalog: b.catalog,
                reason: errMsg,
              });
            } else {
              succeeded.push(b);
            }
          }
          return {
            uploaded: Number(res.data.uploaded || 0),
            deduplicated: Number(res.data.deduplicated || 0),
            propagated: Number(res.data.propagated_products || 0),
            succeeded,
            failedItems,
          };
        }
        lastStatus = res.status;
        lastError = res.data?.message || res.data?.error || `HTTP ${res.status}`;
        if (res.status >= 500 || res.status === 429) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        break;
      } catch (err: any) {
        lastError = err?.message || "Network error";
        await sleep(700 * (attempt + 1));
      }
    }

    // If a chunk > 1 still failed with 5xx/timeout, split and isolate cleanly!
    if (readyBatch.length > 1 && (lastStatus >= 500 || lastStatus === 0)) {
      const subSize = readyBatch.length > 3 ? 3 : 1;
      let uploaded = 0;
      let deduplicated = 0;
      let propagated = 0;
      const succeeded: typeof readyBatch = [];
      const failedItems: FailedUploadItem[] = [];
      for (let i = 0; i < readyBatch.length; i += subSize) {
        const sub = readyBatch.slice(i, i + subSize);
        const subRes = await uploadPreparedBatchResilient(sub);
        uploaded += subRes.uploaded;
        deduplicated += subRes.deduplicated;
        propagated += subRes.propagated;
        succeeded.push(...subRes.succeeded);
        failedItems.push(...subRes.failedItems);
      }
      return { uploaded, deduplicated, propagated, succeeded, failedItems };
    }

    return {
      uploaded: 0,
      deduplicated: 0,
      propagated: 0,
      succeeded: [],
      failedItems: readyBatch.map((b) => ({
        key: `${b.catalog.master_catalog_id}::${b.entry.filename}`,
        entry: b.entry,
        catalog: b.catalog,
        reason: lastError,
      })),
    };
  }

  async function compressAndUploadPairs(
    pairs: Array<{ entry: ExtractedEntry; catalog: CatalogCandidate }>,
    options?: { isRetryOrReview?: boolean }
  ) {
    let processed = 0;
    let uploadedVerified = 0;
    let deduplicated = 0;
    let propagatedProducts = 0;
    let originalBytes = 0;
    let compressedBytes = 0;
    const newFailed: FailedUploadItem[] = [];
    const newCompressionIssues: ImportIssue[] = [];

    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
      if (stopRef.current) break;
      const slice = pairs.slice(i, i + CHUNK_SIZE);
      setStageLabel(
        `${options?.isRetryOrReview ? "Uploading adjusted" : "Compressing & uploading verified"} chunk ${Math.floor(i / CHUNK_SIZE) + 1} / ${Math.ceil(pairs.length / CHUNK_SIZE)} (${processed}/${pairs.length})...`
      );

      const readyBatch: Array<{
        entry: ExtractedEntry;
        catalog: CatalogCandidate;
        payload: Record<string, unknown>;
        preview: string;
        label: string;
        id: string;
        sizeKb: string;
      }> = [];

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
                entry,
                catalog,
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
              newCompressionIssues.push({
                filename: entry.filename,
                reason: `Compression failed: ${err?.message || "invalid image"}`,
              });
            }
          })
        );
      }

      if (readyBatch.length > 0) {
        const res = await uploadPreparedBatchResilient(readyBatch);
        uploadedVerified += res.uploaded;
        deduplicated += res.deduplicated;
        propagatedProducts += res.propagated;
        newFailed.push(...res.failedItems);

        if (res.succeeded.length > 0) {
          setRecentPreviews((prev) =>
            [
              ...res.succeeded
                .slice(0, 6)
                .map((b) => ({ name: b.label, id: b.id, sizeKb: b.sizeKb, preview: b.preview })),
              ...prev,
            ].slice(0, 8)
          );
        }
      }

      processed += slice.length;
      if (!options?.isRetryOrReview) {
        setStats((prev) => ({
          ...prev,
          processed,
          uploadedVerified,
          deduplicated,
          propagatedProducts,
          originalBytes,
          compressedBytes,
        }));
      } else {
        setStats((prev) => ({
          ...prev,
          uploadedVerified: prev.uploadedVerified + uploadedVerified,
          deduplicated: prev.deduplicated + deduplicated,
          propagatedProducts: prev.propagatedProducts + propagatedProducts,
          originalBytes: prev.originalBytes + originalBytes,
          compressedBytes: prev.compressedBytes + compressedBytes,
        }));
        uploadedVerified = 0;
        deduplicated = 0;
        propagatedProducts = 0;
        originalBytes = 0;
        compressedBytes = 0;
      }
    }

    return {
      processed,
      uploadedVerified,
      deduplicated,
      propagatedProducts,
      newFailed,
      newCompressionIssues,
    };
  }

  async function processDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    stopRef.current = false;
    revokePreviewUrls();
    setRunning(true);
    setIssues([]);
    setPendingReviews([]);
    setFailedUploads([]);
    setRecentPreviews([]);
    setRowSearchQuery({});
    setRowSearchResults({});
    setStats({
      totalFiles: 0,
      matchedToCatalog: 0,
      smartMatched: 0,
      processed: 0,
      uploadedVerified: 0,
      deduplicated: 0,
      propagatedProducts: 0,
      originalBytes: 0,
      compressedBytes: 0,
    });

    try {
      setStageLabel("Extracting ZIP archive in browser (0 server memory used)...");
      const extracted: ExtractedEntry[] = [];
      const manifestByFilename = new Map<string, ManifestRow>();

      for (const f of files) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          const zip = await JSZip.loadAsync(f);

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
      setStageLabel(`Smart-matching ${extracted.length} images against 41,441 Master Catalog medicines...`);

      // Match all filenames against Master Catalog (exact + smart clinical normalizer + top 5 suggestions)
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
      const matchedPairs: Array<{ entry: ExtractedEntry; catalog: CatalogCandidate }> = [];
      const reviewItems: PendingReviewItem[] = [];
      let smartMatched = 0;

      for (let idx = 0; idx < resolvedList.length; idx++) {
        const res = resolvedList[idx];
        const entry = extracted[idx];
        if (!entry) continue;
        if (res.matched && res.item) {
          if (res.match_via === "smart_clinical_name") smartMatched++;
          matchedPairs.push({ entry, catalog: res.item });
        } else {
          // Create thumbnail preview URL for first 120 unmatched files so admin can visually verify & pick!
          let previewUrl: string | null = null;
          if (reviewItems.length < 120) {
            try {
              const blob = await entry.getBlob();
              previewUrl = URL.createObjectURL(blob);
              objectUrlsRef.current.push(previewUrl);
            } catch {
              previewUrl = null;
            }
          }
          const suggestions = Array.isArray(res.suggestions) ? res.suggestions : [];
          reviewItems.push({
            key: `rev_${idx}_${entry.filename}`,
            filename: entry.filename,
            reason: "Name slightly differs from Master Catalog — pick exact medicine below to upload",
            entry,
            previewUrl,
            suggestions,
            selected: null,
          });
        }
      }

      setPendingReviews(reviewItems);
      setStats((s) => ({
        ...s,
        matchedToCatalog: matchedPairs.length,
        smartMatched,
      }));

      if (matchedPairs.length === 0) {
        const msg =
          reviewItems.length > 0
            ? `0 exact matches, but ${reviewItems.length} image(s) are ready below for 1-click Master Catalog matching!`
            : "No filenames matched the Master Catalog.";
        setStageLabel(msg);
        onNotify?.(msg);
        setRunning(false);
        return;
      }

      const runRes = await compressAndUploadPairs(matchedPairs);
      setIssues(runRes.newCompressionIssues);
      setFailedUploads(runRes.newFailed);

      const doneMsg = stopRef.current
        ? `Bulk import paused at ${runRes.processed}/${matchedPairs.length}. ${runRes.uploadedVerified} verified & uploaded.`
        : `Bulk upload complete! ${runRes.uploadedVerified} new + ${runRes.deduplicated} deduplicated verified in R2` +
          (reviewItems.length > 0 ? ` · ${reviewItems.length} unmatched image(s) ready for 1-click adjust below.` : ".");
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

  function handleSearchForReviewRow(rowKey: string, query: string) {
    setRowSearchQuery((prev) => ({ ...prev, [rowKey]: query }));
    if (searchTimersRef.current[rowKey]) {
      clearTimeout(searchTimersRef.current[rowKey]);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRowSearchResults((prev) => ({ ...prev, [rowKey]: [] }));
      setRowSearching((prev) => ({ ...prev, [rowKey]: false }));
      return;
    }
    setRowSearching((prev) => ({ ...prev, [rowKey]: true }));
    searchTimersRef.current[rowKey] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/master-catalog?q=${encodeURIComponent(trimmed)}&limit=8`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.results)) {
          setRowSearchResults((prev) => ({ ...prev, [rowKey]: data.results }));
        }
      } catch {
        // ignore
      } finally {
        setRowSearching((prev) => ({ ...prev, [rowKey]: false }));
      }
    }, 220);
  }

  function selectCandidateForRow(rowKey: string, cand: CatalogCandidate | null) {
    setPendingReviews((prev) =>
      prev.map((r) => (r.key === rowKey ? { ...r, selected: cand, error: undefined } : r))
    );
    if (cand) {
      setRowSearchResults((prev) => ({ ...prev, [rowKey]: [] }));
      setRowSearchQuery((prev) => ({ ...prev, [rowKey]: "" }));
    }
  }

  async function uploadSingleReviewedRow(row: PendingReviewItem) {
    if (!row.selected || row.uploading || row.uploaded) return;
    setPendingReviews((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, uploading: true, error: undefined } : r))
    );
    try {
      const res = await compressAndUploadPairs(
        [{ entry: row.entry, catalog: row.selected }],
        { isRetryOrReview: true }
      );
      if (res.newFailed.length > 0 || res.newCompressionIssues.length > 0) {
        const errText = res.newFailed[0]?.reason || res.newCompressionIssues[0]?.reason || "Upload failed";
        setPendingReviews((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, uploading: false, error: errText } : r))
        );
        onNotify?.(`Failed to upload "${row.selected.master_catalog_name}": ${errText}`);
      } else {
        setPendingReviews((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, uploading: false, uploaded: true, error: undefined } : r))
        );
        onNotify?.(`Verified & linked "${row.filename}" → "${row.selected.master_catalog_name}"!`);
        onImportComplete?.();
      }
    } catch (err: any) {
      setPendingReviews((prev) =>
        prev.map((r) =>
          r.key === row.key ? { ...r, uploading: false, error: err?.message || "Upload failed" } : r
        )
      );
    }
  }

  async function uploadAllAssignedReviews() {
    const readyRows = pendingReviews.filter((r) => r.selected && !r.uploaded && !r.uploading);
    if (readyRows.length === 0 || uploadingAssigned) return;
    setUploadingAssigned(true);
    try {
      const keySet = new Set(readyRows.map((r) => r.key));
      setPendingReviews((prev) =>
        prev.map((r) => (keySet.has(r.key) ? { ...r, uploading: true, error: undefined } : r))
      );
      const res = await compressAndUploadPairs(
        readyRows.map((r) => ({ entry: r.entry, catalog: r.selected! })),
        { isRetryOrReview: true }
      );
      const failedByKey = new Map<string, string>();
      for (const f of res.newFailed) {
        failedByKey.set(f.entry.filename, f.reason);
      }
      for (const ci of res.newCompressionIssues) {
        failedByKey.set(ci.filename, ci.reason);
      }

      let okCount = 0;
      setPendingReviews((prev) =>
        prev.map((r) => {
          if (!keySet.has(r.key)) return r;
          const failMsg = failedByKey.get(r.filename);
          if (failMsg) {
            return { ...r, uploading: false, error: failMsg };
          }
          okCount++;
          return { ...r, uploading: false, uploaded: true, error: undefined };
        })
      );
      onNotify?.(`Uploaded & verified ${okCount} / ${readyRows.length} manually matched images!`);
      onImportComplete?.();
    } finally {
      setUploadingAssigned(false);
    }
  }

  async function retryAllFailedUploads() {
    if (failedUploads.length === 0 || retryingFailed) return;
    setRetryingFailed(true);
    stopRef.current = false;
    try {
      const targets = [...failedUploads];
      const res = await compressAndUploadPairs(
        targets.map((f) => ({ entry: f.entry, catalog: f.catalog })),
        { isRetryOrReview: true }
      );
      setFailedUploads(res.newFailed);
      const fixedCount = targets.length - res.newFailed.length;
      onNotify?.(
        res.newFailed.length === 0
          ? `Retry succeeded! All ${fixedCount} previously failed images are now verified in R2.`
          : `Retried ${targets.length}: ${fixedCount} succeeded, ${res.newFailed.length} still failed.`
      );
      onImportComplete?.();
    } finally {
      setRetryingFailed(false);
    }
  }

  const remainingReviewCount = pendingReviews.filter((r) => !r.uploaded).length;
  const assignedReadyCount = pendingReviews.filter((r) => r.selected && !r.uploaded).length;
  const totalUnresolved = remainingReviewCount + failedUploads.length + issues.length;

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
              Smart Bulk ZIP &amp; Image Importer (Auto-Match + Manual Adjust + Auto-Retry)
            </h3>
            <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90 max-w-3xl leading-relaxed">
              Drop any <code className="font-mono bg-white/80 dark:bg-slate-900 px-1.5 py-0.5 rounded">.zip</code>{" "}
              or individual medicine photos. Slight name differences (spaces, <code className="font-mono">(20)</code>,{" "}
              <code className="font-mono">(5 S)</code>, <code className="font-mono">TAB/TABLET</code>,{" "}
              <code className="font-mono">2M/2MG</code>) auto-match safely, failed chunks auto-retry, and any remaining
              unmatched image can be matched in <strong>1 click</strong> below without re-uploading.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>Auto-Retry + 1-Click Adjust</span>
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
                Drop Medicine Packshot <span className="text-emerald-600">.ZIP</span> or Individual Images Here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Click to browse a <code>.zip</code> archive or select multiple <code>.jpg/.png/.webp</code> files.
                Smart clinical name matching + 1-click manual adjust for any differences.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px] text-slate-500">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Auto WebP ≤ 35 KB
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Smart Name Normalizer
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                Auto-Retry on 500
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                1-Click Manual Match
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
              Images Found
            </span>
            <span className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
              {stats.totalFiles}
            </span>
            <span className="text-[11px] text-emerald-600 font-semibold">
              {stats.matchedToCatalog} matched
              {stats.smartMatched > 0 ? ` (${stats.smartMatched} smart)` : ""}
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
              Library Entries Live
            </span>
            <span className="text-xl font-black font-mono text-indigo-700 dark:text-indigo-300 mt-1 block">
              {stats.propagatedProducts}
            </span>
            <span className="text-[11px] text-indigo-600/90 font-semibold">Auto-applied to R2</span>
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
              Needs Review / Failed
            </span>
            <span className="text-xl font-black font-mono text-amber-700 dark:text-amber-300 mt-1 block">
              {totalUnresolved}
            </span>
            {totalUnresolved > 0 ? (
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

      {/* Retry Failed Uploads Banner (for any transient HTTP 5xx/network hiccup) */}
      {failedUploads.length > 0 && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200">
              <FileWarning className="h-4 w-4 shrink-0" />
              <span className="text-xs font-black">
                {failedUploads.length} Matched Image(s) Hit a Server/Network Error
              </span>
            </div>
            <button
              type="button"
              disabled={retryingFailed}
              onClick={retryAllFailedUploads}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              {retryingFailed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {retryingFailed ? "Retrying..." : `Retry Failed (${failedUploads.length})`}
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-rose-200/60 dark:divide-rose-900/50 text-xs">
            {failedUploads.map((f) => (
              <div key={f.key} className="py-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                  {f.catalog.master_catalog_name}{" "}
                  <span className="text-[10px] text-slate-500">({f.catalog.master_catalog_id})</span>
                </span>
                <span className="text-rose-700 dark:text-rose-300 shrink-0 text-[11px]">{f.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Unmatched Review & 1-Click Manual Match Panel */}
      {remainingReviewCount > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Link2 className="h-4 w-4 text-amber-600" />
                Unmatched Images — 1-Click Match &amp; Upload ({remainingReviewCount} left)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pick the matching Master Catalog medicine from the smart suggestions or search box below, then upload directly without re-renaming files.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {assignedReadyCount > 0 && (
                <button
                  type="button"
                  disabled={uploadingAssigned}
                  onClick={uploadAllAssignedReviews}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  {uploadingAssigned ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload All Assigned ({assignedReadyCount})
                </button>
              )}
              <button
                type="button"
                onClick={downloadIssuesCsv}
                className="px-3 py-2 rounded-xl border border-amber-300 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
            {pendingReviews
              .filter((r) => !r.uploaded)
              .map((row) => {
                const searchVal = rowSearchQuery[row.key] || "";
                const searchHits = rowSearchResults[row.key] || [];
                const isSearching = Boolean(rowSearching[row.key]);
                return (
                  <div
                    key={row.key}
                    className={`rounded-xl border p-3 flex flex-col md:flex-row gap-3 items-start ${
                      row.selected
                        ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/15"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white flex items-center justify-center overflow-hidden shrink-0">
                      {row.previewUrl ? (
                        <img
                          src={row.previewUrl}
                          alt={row.filename}
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <FileArchive className="h-6 w-6 text-slate-400" />
                      )}
                    </div>

                    {/* Matching controls */}
                    <div className="flex-1 min-w-0 space-y-2 w-full">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
                            {row.filename}
                          </div>
                          {row.error && (
                            <div className="text-[11px] font-semibold text-rose-600 mt-0.5">{row.error}</div>
                          )}
                        </div>

                        {row.selected && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={row.uploading}
                              onClick={() => void uploadSingleReviewedRow(row)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1"
                            >
                              {row.uploading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Upload Verified
                            </button>
                            <button
                              type="button"
                              disabled={row.uploading}
                              onClick={() => selectCandidateForRow(row.key, null)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900"
                              title="Change selection"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {row.selected ? (
                        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 block">
                              Selected Master Catalog Target
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {row.selected.master_catalog_name}
                            </span>
                            <span className="ml-2 font-mono text-[10px] text-slate-500">
                              {row.selected.master_catalog_id}
                            </span>
                          </div>
                          <div className="flex gap-1.5 text-[10px]">
                            {row.selected.strength && (
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold">
                                {row.selected.strength}
                              </span>
                            )}
                            {row.selected.dosage_form && (
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                                {row.selected.dosage_form}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Top Smart Suggested Pills */}
                          {row.suggestions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mr-1">
                                Suggested:
                              </span>
                              {row.suggestions.map((cand) => (
                                <button
                                  key={cand.master_catalog_id}
                                  type="button"
                                  onClick={() => selectCandidateForRow(row.key, cand)}
                                  className="px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-left text-[11px] font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 transition"
                                >
                                  <span>{cand.master_catalog_name}</span>
                                  {cand.dosage_form && (
                                    <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                      {cand.dosage_form}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Live Master Catalog Search Box */}
                          <div className="relative">
                            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                              type="text"
                              value={searchVal}
                              onChange={(e) => handleSearchForReviewRow(row.key, e.target.value)}
                              placeholder="Search 41,441 Master Catalog medicines (e.g. Recept 2, Amkay 100, Losaan H)..."
                              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            {isSearching && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600 absolute right-2.5 top-2.5" />
                            )}
                            {searchHits.length > 0 && (
                              <div className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                                {searchHits.map((hit) => (
                                  <button
                                    key={hit.master_catalog_id}
                                    type="button"
                                    onClick={() => selectCandidateForRow(row.key, hit)}
                                    className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-between gap-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-bold text-slate-900 dark:text-white truncate">
                                        {hit.master_catalog_name}
                                      </div>
                                      <div className="text-[10px] text-slate-500 truncate">
                                        {hit.generic_name || hit.manufacturer || hit.master_catalog_id}
                                      </div>
                                    </div>
                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 shrink-0">
                                      {hit.master_catalog_id}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
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

      {/* Compression / Invalid Image Issue Log */}
      {issues.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5">
              <FileWarning className="h-4 w-4" />
              Invalid / Unreadable Files ({issues.length})
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
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
