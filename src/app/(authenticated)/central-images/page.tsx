"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Images,
  Search,
  Upload,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  Layers,
  HardDrive,
  Database,
  ArrowRight,
  Filter,
  RefreshCw,
  Eye,
  FileCheck,
  Building,
  Tag,
  ShieldCheck,
  Zap,
  Clock,
  RotateCcw,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  CheckCheck,
} from "lucide-react";
import {
  optimizeImageForStorefront,
  OptimizedImageResult,
} from "@/lib/storefront/image-optimizer";

interface CentralOverview {
  total_canonical_medicines: number;
  verified_shared_images: number;
  pending_submissions: number;
  unassigned_products: number;
  shared_references: number;
  owner_overrides: number;
  unique_r2_objects: number;
  total_stored_bytes: number;
  estimated_saved_bytes: number;
  average_image_bytes: number;
}

interface CanonicalMedicine {
  id: string;
  master_catalog_id?: string | null;
  master_catalog_name?: string | null;
  canonical_name: string;
  brand_name?: string | null;
  generic_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  manufacturer?: string | null;
  pack_size?: number | null;
  pack_unit?: string | null;
  barcode?: string | null;
  aliases_json?: string | null;
  verification_status: string;
  preferred_media_id?: string | null;
  preferred_image_url?: string | null;
  image_byte_size?: number | null;
  referencing_products_count?: number;
}

interface ImageSubmission {
  id: string;
  media_id: string;
  pharmacy_id: string;
  storefront_id?: string;
  pharmacy_name?: string;
  pos_product_id: string;
  product_name_snapshot: string;
  generic_snapshot?: string;
  strength_snapshot?: string;
  dosage_form_snapshot?: string;
  brand_snapshot?: string;
  media_url?: string;
  byte_size?: number;
  status: string;
  created_at: string;
}

interface DiscoveryOverview {
  total_imported: number;
  pending: number;
  searching: number;
  candidate_found: number;
  verified: number;
  needs_review: number;
  not_found: number;
  failed: number;
  auto_approve_strict: boolean;
  daily_search_limit: number;
  daily_searches_used: number;
  collector_status: string;
  enabled_sources: string[];
}

interface DiscoveryCandidate {
  source: string;
  image_url: string;
  title: string;
  license?: string;
  attribution?: string;
  width?: number;
  height?: number;
  byte_size?: number;
  mime_type?: string;
  match_confidence?: number;
  matched_strength?: string;
  matched_form?: string;
}

interface DiscoveryQueueItem {
  id: string;
  master_catalog_id: string;
  master_catalog_name: string;
  brand_name?: string | null;
  generic?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  pack_size?: number | null;
  pack_unit?: string | null;
  barcode?: string | null;
  priority: number;
  status: string;
  attempts_count: number;
  selected_source?: string | null;
  candidate_results: DiscoveryCandidate[];
  approved_media_id?: string | null;
  approved_image_url?: string | null;
  rejection_reason?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

interface MasterCatalogSearchResult {
  master_catalog_id: string;
  master_catalog_name: string;
  brand_name?: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  manufacturer?: string;
  pack_size?: number;
  pack_unit?: string;
  barcode?: string;
}

export default function CentralMedicineImagesPage() {
  const [activeTab, setActiveTab] = useState<"library" | "submissions" | "discovery" | "batch">("library");
  const [overview, setOverview] = useState<CentralOverview | null>(null);
  const [medicines, setMedicines] = useState<CanonicalMedicine[]>([]);
  const [submissions, setSubmissions] = useState<ImageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dosageFilter, setDosageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hasImageFilter, setHasImageFilter] = useState("all");
  const [toast, setToast] = useState<string | null>(null);

  // Discovery Tab State
  const [discoveryOverview, setDiscoveryOverview] = useState<DiscoveryOverview | null>(null);
  const [discoveryItems, setDiscoveryItems] = useState<DiscoveryQueueItem[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryStatusFilter, setDiscoveryStatusFilter] = useState("all");
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [discoveryPage, setDiscoveryPage] = useState(1);
  const [discoveryTotalCount, setDiscoveryTotalCount] = useState(0);
  const [discoveryTotalPages, setDiscoveryTotalPages] = useState(1);
  const [importingMaster, setImportingMaster] = useState(false);
  const [autoStreamingMaster, setAutoStreamingMaster] = useState(false);
  const [streamingProgress, setStreamingProgress] = useState<{ current: number; total: number } | null>(null);
  const stopStreamingRef = useRef(false);
  const [togglingQueueStatus, setTogglingQueueStatus] = useState(false);
  const [togglingStrict, setTogglingStrict] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [reviewingQueueId, setReviewingQueueId] = useState<string | null>(null);

  // New / Edit Canonical Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMed, setSelectedMed] = useState<CanonicalMedicine | null>(null);
  const [modalForm, setModalForm] = useState({
    master_catalog_id: "",
    master_catalog_name: "",
    canonical_name: "",
    brand_name: "",
    generic_name: "",
    strength: "",
    dosage_form: "Tablet",
    manufacturer: "",
    pack_size: "100",
    pack_unit: "Tablet",
    barcode: "",
    aliases: "",
  });

  // Master Catalog Search Autocomplete State
  const [masterSearchQuery, setMasterSearchQuery] = useState("");
  const [masterSearchResults, setMasterSearchResults] = useState<MasterCatalogSearchResult[]>([]);
  const [masterSearchLoading, setMasterSearchLoading] = useState(false);
  const [showMasterDropdown, setShowMasterDropdown] = useState(false);

  // Image Upload State
  const [uploadOptimized, setUploadOptimized] = useState<OptimizedImageResult | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingMed, setSavingMed] = useState(false);

  // Batch Matching State
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    processed: number;
    matched: number;
    offset: number;
    hasMore: boolean;
  }>({ processed: 0, matched: 0, offset: 0, hasMore: true });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function loadOverview() {
    try {
      const res = await fetch("/api/admin/central-images?view=overview");
      const data = await res.json();
      if (data.ok && data.overview) {
        setOverview(data.overview);
      }
    } catch {
      // ignore
    }
  }

  async function loadMedicines() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        view: "medicines",
        q: searchQuery,
        dosage_form: dosageFilter,
        status: statusFilter,
        has_image: hasImageFilter === "with" ? "1" : hasImageFilter === "without" ? "0" : "",
      });
      const res = await fetch(`/api/admin/central-images?${params.toString()}`);
      const data = await res.json();
      if (data.ok && data.medicines) {
        setMedicines(data.medicines);
      }
    } catch {
      notify("Failed to load canonical medicines");
    } finally {
      setLoading(false);
    }
  }

  async function loadSubmissions() {
    try {
      const res = await fetch("/api/admin/central-images?view=submissions&status=pending");
      const data = await res.json();
      if (data.ok && data.submissions) {
        setSubmissions(data.submissions);
      }
    } catch {
      // ignore
    }
  }

  async function loadDiscoveryOverview() {
    try {
      const res = await fetch("/api/admin/central-images?view=discovery_overview");
      const data = await res.json();
      if (data.ok && data.overview) {
        setDiscoveryOverview(data.overview);
      }
    } catch {
      // ignore
    }
  }

  async function loadDiscoveryQueue(page = 1, status = discoveryStatusFilter, search = discoverySearch) {
    setDiscoveryLoading(true);
    try {
      const params = new URLSearchParams({
        view: "discovery_queue",
        page: String(page),
        limit: "25",
        status: status === "all" ? "" : status,
        search: search.trim(),
      });
      const res = await fetch(`/api/admin/central-images?${params.toString()}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.items)) {
        setDiscoveryItems(data.items);
        setDiscoveryPage(page);
        if (data.pagination) {
          setDiscoveryTotalCount(data.pagination.totalCount || data.items.length);
          setDiscoveryTotalPages(data.pagination.totalPages || 1);
        }
      }
    } catch {
      notify("Failed to load discovery queue");
    } finally {
      setDiscoveryLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    void loadMedicines();
    void loadSubmissions();
    void loadDiscoveryOverview();
  }, []);

  useEffect(() => {
    if (activeTab === "discovery") {
      void loadDiscoveryOverview();
      void loadDiscoveryQueue(discoveryPage, discoveryStatusFilter, discoverySearch);
    }
  }, [activeTab, discoveryPage, discoveryStatusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMedicines();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, dosageFilter, statusFilter, hasImageFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "discovery") {
        setDiscoveryPage(1);
        void loadDiscoveryQueue(1, discoveryStatusFilter, discoverySearch);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [discoverySearch]);

  // Master Catalog Live Search Autocomplete
  async function handleMasterSearch(query: string) {
    setMasterSearchQuery(query);
    if (!query.trim() || query.trim().length < 2) {
      setMasterSearchResults([]);
      setShowMasterDropdown(false);
      return;
    }
    setMasterSearchLoading(true);
    setShowMasterDropdown(true);
    try {
      const res = await fetch(`/api/admin/master-catalog?q=${encodeURIComponent(query.trim())}&limit=8`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        setMasterSearchResults(data.results);
      }
    } catch {
      // ignore
    } finally {
      setMasterSearchLoading(false);
    }
  }

  function handleSelectMasterItem(item: MasterCatalogSearchResult) {
    setModalForm({
      master_catalog_id: item.master_catalog_id,
      master_catalog_name: item.master_catalog_name,
      canonical_name: item.master_catalog_name,
      brand_name: item.brand_name || "",
      generic_name: item.generic_name || "",
      strength: item.strength || "",
      dosage_form: item.dosage_form || "Tablet",
      manufacturer: item.manufacturer || "",
      pack_size: String(item.pack_size || "100"),
      pack_unit: item.pack_unit || "Tablet",
      barcode: item.barcode || "",
      aliases: "",
    });
    setShowMasterDropdown(false);
    setMasterSearchQuery("");
    notify(`Linked to Master Catalog: ${item.master_catalog_name} (${item.master_catalog_id})`);
  }

  // Handle local file selection and WebP optimization
  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const opt = await optimizeImageForStorefront(file, "product");
      setUploadOptimized(opt);
      notify(`Image optimized to WebP (${(opt.byteSize / 1024).toFixed(1)} KB, ${opt.width}×${opt.height}px)`);
    } catch (err: any) {
      notify(err.message || "Image optimization failed");
    } finally {
      setUploadingImage(false);
    }
  }

  // Save canonical medicine (and optionally upload its shared image)
  async function handleSaveMedicine(e: React.FormEvent) {
    e.preventDefault();
    if (!modalForm.canonical_name.trim()) {
      notify("Medicine name is required");
      return;
    }

    setSavingMed(true);
    try {
      let preferredMediaId = selectedMed?.preferred_media_id || undefined;

      // 1. If an image was optimized, upload it directly to shared media
      if (uploadOptimized) {
        const uploadRes = await fetch("/api/admin/central-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload_shared_image",
            payload: {
              data_base64: uploadOptimized.base64Data,
              content_type: uploadOptimized.mimeType,
              byte_size: uploadOptimized.byteSize,
              width: uploadOptimized.width,
              height: uploadOptimized.height,
              sha256_hex: uploadOptimized.sha256Hex,
              logical_file_name: `${modalForm.canonical_name.replace(/[/\\?%*:|"<>]/g, "-")}.webp`,
            },
          }),
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.ok) {
          throw new Error(uploadData.message || "Failed to upload shared image");
        }
        preferredMediaId = uploadData.media_id;
      }

      // 2. Upsert Canonical Medicine Identity
      const aliasesArray = modalForm.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const upsertRes = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_medicine",
          medicine: {
            id: selectedMed?.id,
            master_catalog_id: modalForm.master_catalog_id || undefined,
            master_catalog_name: modalForm.master_catalog_name || undefined,
            canonical_name: modalForm.canonical_name,
            brand_name: modalForm.brand_name || null,
            generic_name: modalForm.generic_name || null,
            strength: modalForm.strength || null,
            dosage_form: modalForm.dosage_form || null,
            manufacturer: modalForm.manufacturer || null,
            pack_size: modalForm.pack_size ? Number(modalForm.pack_size) : null,
            pack_unit: modalForm.pack_unit || null,
            barcode: modalForm.barcode || null,
            aliases: aliasesArray,
            preferred_media_id: preferredMediaId,
            logical_file_name: `${modalForm.canonical_name.replace(/[/\\?%*:|"<>]/g, "-")}.webp`,
          },
        }),
      });

      const upsertData = await upsertRes.json();
      if (!upsertRes.ok || !upsertData.ok) {
        throw new Error(upsertData.message || "Failed to save canonical medicine");
      }

      notify("Canonical medicine and shared image saved successfully!");
      setShowAddModal(false);
      setSelectedMed(null);
      setUploadOptimized(null);
      void loadOverview();
      void loadMedicines();
    } catch (err: any) {
      notify(err.message || "Save failed");
    } finally {
      setSavingMed(false);
    }
  }

  // Handle Owner Submission Approval
  async function handleApproveSubmission(sub: ImageSubmission, targetCanonicalId?: string) {
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve_submission",
          submission_id: sub.id,
          target_canonical_id: targetCanonicalId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(`Approved submission for "${sub.product_name_snapshot}"`);
        void loadOverview();
        void loadSubmissions();
        void loadMedicines();
      } else {
        notify(data.error || "Approval failed");
      }
    } catch {
      notify("Network error approving submission");
    }
  }

  // Handle Owner Submission Rejection
  async function handleRejectSubmission(subId: string) {
    const reason = window.prompt("Reason for rejection:", "Does not meet verified product photo standards");
    if (!reason) return;

    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject_submission",
          submission_id: subId,
          reason,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify("Submission rejected");
        void loadSubmissions();
      } else {
        notify(data.error || "Rejection failed");
      }
    } catch {
      notify("Network error rejecting submission");
    }
  }

  // Discovery Actions
  async function handleToggleStrictAutoApprove() {
    if (!discoveryOverview) return;
    setTogglingStrict(true);
    const nextVal = !discoveryOverview.auto_approve_strict;
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discovery_settings",
          settings: {
            auto_approve_strict: nextVal,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(
          nextVal
            ? "Strict Auto-Approve enabled (safe 100% matches automatically approved)"
            : "Strict Auto-Approve disabled (all candidates require Super Admin manual review)"
        );
        setDiscoveryOverview({ ...discoveryOverview, auto_approve_strict: nextVal });
      } else {
        notify(data.error || "Failed to update settings");
      }
    } catch {
      notify("Network error updating settings");
    } finally {
      setTogglingStrict(false);
    }
  }

  async function handleApproveDiscoveryCandidate(item: DiscoveryQueueItem, candidate?: DiscoveryCandidate) {
    setReviewingQueueId(item.id);
    try {
      const chosen = candidate || item.candidate_results?.[0];
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discovery_approve_candidate",
          queue_id: item.id,
          candidate: chosen,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(`Approved image for "${item.master_catalog_name}"! Propagated to all matching pharmacies.`);
        void loadDiscoveryOverview();
        void loadDiscoveryQueue(discoveryPage);
        void loadOverview();
        void loadMedicines();
      } else {
        notify(data.error || "Approval failed");
      }
    } catch {
      notify("Network error approving candidate");
    } finally {
      setReviewingQueueId(null);
    }
  }

  async function handleRejectDiscoveryCandidate(item: DiscoveryQueueItem) {
    const reason = window.prompt("Reason for rejection:", "Image does not match packaging or clinical strength");
    if (!reason) return;

    setReviewingQueueId(item.id);
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discovery_reject_candidate",
          queue_id: item.id,
          reason,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(`Candidate rejected for "${item.master_catalog_name}"`);
        void loadDiscoveryOverview();
        void loadDiscoveryQueue(discoveryPage);
      } else {
        notify(data.error || "Rejection failed");
      }
    } catch {
      notify("Network error rejecting candidate");
    } finally {
      setReviewingQueueId(null);
    }
  }

  async function handleImportNextMasterBatch() {
    setImportingMaster(true);
    try {
      const currentOffset = discoveryOverview?.total_imported || 0;
      const res = await fetch("/api/admin/master-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_batch",
          offset: currentOffset,
          limit: 50,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(`Imported ${data.imported} medicines into discovery queue (total: ${currentOffset + data.imported})`);
        void loadDiscoveryOverview();
        void loadDiscoveryQueue(1);
      } else {
        notify(data.error || "Import failed");
      }
    } catch {
      notify("Network error importing master batch");
    } finally {
      setImportingMaster(false);
    }
  }

  async function handleToggleQueuePause() {
    if (!discoveryOverview) return;
    setTogglingQueueStatus(true);
    const isPaused = discoveryOverview.collector_status === "paused";
    const nextStatus = isPaused ? "running" : "paused";
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discovery_settings",
          settings: {
            collector_status: nextStatus,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(nextStatus === "paused" ? "Discovery queue paused" : "Discovery queue resumed and active");
        setDiscoveryOverview({ ...discoveryOverview, collector_status: nextStatus });
      } else {
        notify(data.error || "Failed to update queue status");
      }
    } catch {
      notify("Network error updating queue status");
    } finally {
      setTogglingQueueStatus(false);
    }
  }

  async function handleStreamAllMasterMedicines() {
    if (autoStreamingMaster) {
      stopStreamingRef.current = true;
      setAutoStreamingMaster(false);
      notify("Stopped Master Catalog stream");
      return;
    }

    setAutoStreamingMaster(true);
    stopStreamingRef.current = false;
    let offset = discoveryOverview?.total_imported || 0;
    const batchSize = 100;

    try {
      while (!stopStreamingRef.current) {
        const res = await fetch("/api/admin/master-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import_batch",
            offset,
            limit: batchSize,
          }),
        });
        const data = await res.json();
        if (!data.ok || !data.hasMore || data.imported === 0) {
          offset += data.imported || 0;
          break;
        }
        offset = data.nextOffset;
        setStreamingProgress({ current: offset, total: data.totalCatalog });
        setDiscoveryOverview((prev) => (prev ? { ...prev, total_imported: offset } : null));
        await new Promise((r) => setTimeout(r, 150));
      }
      notify(`Master Catalog population complete! Total ${offset} items queued.`);
      void loadDiscoveryOverview();
      void loadDiscoveryQueue(1);
    } catch {
      notify("Streaming network error");
    } finally {
      setAutoStreamingMaster(false);
      setStreamingProgress(null);
    }
  }

  async function handleRetryFailedSearches() {
    setRetryingFailed(true);
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discovery_retry_failed",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        notify(`Re-queued ${data.requeued_count || 0} failed searches for retry`);
        void loadDiscoveryOverview();
        void loadDiscoveryQueue(1);
      } else {
        notify(data.error || "Failed to retry jobs");
      }
    } catch {
      notify("Network error retrying failed searches");
    } finally {
      setRetryingFailed(false);
    }
  }

  // Batch Matching execution
  async function runBatchMatchStep(currentOffset: number, accumulatedMatched: number) {
    setBatchRunning(true);
    try {
      const res = await fetch("/api/admin/central-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_match",
          batch_size: 100,
          offset: currentOffset,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const newTotalProcessed = currentOffset + data.processed;
        const newTotalMatched = accumulatedMatched + data.matched;
        setBatchProgress({
          processed: newTotalProcessed,
          matched: newTotalMatched,
          offset: data.nextOffset,
          hasMore: data.hasMore,
        });

        if (data.hasMore && data.processed > 0) {
          setTimeout(() => {
            void runBatchMatchStep(data.nextOffset, newTotalMatched);
          }, 300);
        } else {
          setBatchRunning(false);
          notify(`Batch matching complete! Matched ${newTotalMatched} medicines to verified shared images.`);
          void loadOverview();
          void loadMedicines();
        }
      } else {
        setBatchRunning(false);
        notify(data.error || "Batch matching encountered an error");
      }
    } catch {
      setBatchRunning(false);
      notify("Batch match network error");
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Zap className="h-4 w-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold border border-emerald-200 dark:border-emerald-800 mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            Central Smart Medicine Image Library
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Central Medicine Images &amp; Shared Catalog
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
            Store verified pharmaceutical packaging photos once in R2. Intelligently match and auto-reuse
            approved images across multi-tenant pharmacy websites using the Master Medicine Catalog standard.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              void loadOverview();
              void loadMedicines();
              void loadSubmissions();
              void loadDiscoveryOverview();
              if (activeTab === "discovery") void loadDiscoveryQueue(discoveryPage);
            }}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition shadow-xs"
            title="Refresh All"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedMed(null);
              setModalForm({
                master_catalog_id: "",
                master_catalog_name: "",
                canonical_name: "",
                brand_name: "",
                generic_name: "",
                strength: "",
                dosage_form: "Tablet",
                manufacturer: "",
                pack_size: "100",
                pack_unit: "Tablet",
                barcode: "",
                aliases: "",
              });
              setMasterSearchQuery("");
              setMasterSearchResults([]);
              setShowMasterDropdown(false);
              setUploadOptimized(null);
              setShowAddModal(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-2 shadow-sm transition"
          >
            <Plus className="h-4 w-4" />
            Add Verified Medicine Image
          </button>
        </div>
      </div>

      {/* KPI Overview Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Central Identities
          </span>
          <span className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
            {overview?.total_canonical_medicines ?? 0}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">Verified catalog variants</span>
        </div>

        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
            Shared Images
          </span>
          <span className="text-2xl font-black font-mono text-emerald-800 dark:text-emerald-300 mt-1 block">
            {overview?.verified_shared_images ?? 0}
          </span>
          <span className="text-[11px] text-emerald-600/80 font-medium">Ready for cross-reuse</span>
        </div>

        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/50 dark:bg-amber-950/20 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
            Discovery Review
          </span>
          <span className="text-2xl font-black font-mono text-amber-800 dark:text-amber-300 mt-1 block">
            {(discoveryOverview?.needs_review ?? 0) + (discoveryOverview?.candidate_found ?? 0)}
          </span>
          <span className="text-[11px] text-amber-600/80 font-medium">Candidates awaiting review</span>
        </div>

        <div className="rounded-2xl border border-blue-200 dark:border-blue-800/80 bg-blue-50/50 dark:bg-blue-950/20 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 block">
            Active Reuses
          </span>
          <span className="text-2xl font-black font-mono text-blue-800 dark:text-blue-300 mt-1 block">
            {overview?.shared_references ?? 0}
          </span>
          <span className="text-[11px] text-blue-600/80 font-medium">Products referencing library</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Unique R2 Files
          </span>
          <span className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
            {overview?.unique_r2_objects ?? 0}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            {formatBytes(overview?.total_stored_bytes ?? 0)} stored
          </span>
        </div>

        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 block">
            Storage Saved
          </span>
          <span className="text-2xl font-black font-mono text-indigo-800 dark:text-indigo-300 mt-1 block">
            {formatBytes(overview?.estimated_saved_bytes ?? 0)}
          </span>
          <span className="text-[11px] text-indigo-600/80 font-medium">Via single-instance storage</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("library")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "library"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Images className="h-4 w-4" />
          Central Medicine Library ({medicines.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("discovery")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "discovery"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Sparkles className="h-4 w-4 text-emerald-500" />
          Automatic Image Discovery
          {discoveryOverview && (discoveryOverview.needs_review > 0 || discoveryOverview.candidate_found > 0) && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-mono font-bold">
              {discoveryOverview.needs_review + discoveryOverview.candidate_found}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("submissions")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "submissions"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <FileCheck className="h-4 w-4" />
          Owner Submissions
          {submissions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-mono font-bold">
              {submissions.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("batch")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "batch"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Zap className="h-4 w-4" />
          Batch Catalog Matcher
        </button>
      </div>

      {/* TAB 1: CENTRAL MEDICINE LIBRARY */}
      {activeTab === "library" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by trade name, generic composition, barcode, brand..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={dosageFilter}
                onChange={(e) => setDosageFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="all">All Dosage Forms</option>
                <option value="Tablet">Tablets</option>
                <option value="Capsule">Capsules</option>
                <option value="Syrup">Syrups &amp; Liquids</option>
                <option value="Suspension">Suspensions</option>
                <option value="Injection">Injections</option>
                <option value="Drops">Eye/Ear Drops</option>
                <option value="Sachet">Sachets</option>
                <option value="Topical">Creams/Ointments</option>
              </select>

              <select
                value={hasImageFilter}
                onChange={(e) => setHasImageFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="all">All Medicines</option>
                <option value="with">With Verified Image</option>
                <option value="without">Missing Image</option>
              </select>
            </div>
          </div>

          {/* Medicines Grid */}
          {loading ? (
            <div className="py-16 text-center text-xs text-slate-400">Loading canonical medicine library…</div>
          ) : medicines.length === 0 ? (
            <div className="py-16 text-center space-y-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <Images className="h-8 w-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                No Canonical Medicines Found
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Add your first verified packaging photo or discover images automatically using the Master Medicine Catalog.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {medicines.map((med) => {
                const hasImage = Boolean(med.preferred_image_url);
                return (
                  <div
                    key={med.id}
                    className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-800 transition flex flex-col justify-between"
                  >
                    <div>
                      {/* Image Thumbnail Frame */}
                      <div className="relative aspect-[4/3] rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 flex items-center justify-center overflow-hidden mb-3">
                        {hasImage ? (
                          <img
                            src={med.preferred_image_url!}
                            alt={med.canonical_name}
                            className="max-h-full max-w-full object-contain p-2"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget;
                              target.style.display = "none";
                              const fallback = target.nextElementSibling;
                              if (fallback) (fallback as HTMLElement).classList.remove("hidden");
                            }}
                          />
                        ) : null}
                        <div
                          className={`text-center p-3 text-slate-400 space-y-1 ${
                            hasImage ? "hidden" : "block"
                          }`}
                        >
                          <Images className="h-6 w-6 mx-auto text-slate-300" />
                          <span className="text-[10px] font-bold block uppercase tracking-wider">
                            Category Placeholder
                          </span>
                        </div>

                        <span
                          className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            hasImage
                              ? "bg-emerald-500/90 text-white"
                              : "bg-slate-600/90 text-white"
                          }`}
                        >
                          {hasImage ? "Verified Image" : "Missing Image"}
                        </span>

                        {med.master_catalog_id && (
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-blue-600/90 text-white font-mono text-[9px]">
                            {med.master_catalog_id}
                          </span>
                        )}

                        {med.image_byte_size && (
                          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-900/80 text-white font-mono text-[9.5px]">
                            {formatBytes(med.image_byte_size)}
                          </span>
                        )}
                      </div>

                      {/* Details */}
                      <div className="space-y-1">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                          {med.canonical_name}
                        </h3>
                        {med.generic_name && (
                          <p className="text-[11px] text-slate-500 font-medium">
                            {med.generic_name}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {med.strength && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10.5px] font-mono font-bold text-slate-700 dark:text-slate-300">
                              {med.strength}
                            </span>
                          )}
                          {med.dosage_form && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10.5px] font-bold text-slate-700 dark:text-slate-300">
                              {med.dosage_form}
                            </span>
                          )}
                          {med.pack_size && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10.5px] text-slate-600 dark:text-slate-400">
                              {med.pack_size} {med.pack_unit || "units"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-500 font-medium">
                        Used by:{" "}
                        <strong className="text-slate-900 dark:text-white font-mono">
                          {med.referencing_products_count || 0}
                        </strong>{" "}
                        products
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMed(med);
                          setModalForm({
                            master_catalog_id: med.master_catalog_id || "",
                            master_catalog_name: med.master_catalog_name || med.canonical_name,
                            canonical_name: med.canonical_name,
                            brand_name: med.brand_name || "",
                            generic_name: med.generic_name || "",
                            strength: med.strength || "",
                            dosage_form: med.dosage_form || "Tablet",
                            manufacturer: med.manufacturer || "",
                            pack_size: String(med.pack_size || "100"),
                            pack_unit: med.pack_unit || "Tablet",
                            barcode: med.barcode || "",
                            aliases: med.aliases_json ? JSON.parse(med.aliases_json).join(", ") : "",
                          });
                          setMasterSearchQuery("");
                          setMasterSearchResults([]);
                          setShowMasterDropdown(false);
                          setUploadOptimized(null);
                          setShowAddModal(true);
                        }}
                        className="px-2.5 py-1 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-bold transition"
                      >
                        {hasImage ? "Update Photo" : "Upload Photo"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AUTOMATIC IMAGE DISCOVERY */}
      {activeTab === "discovery" && (
        <div className="space-y-6">
          {/* Discovery KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Master Queue Total
              </span>
              <span className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
                {discoveryOverview?.total_imported ?? 0}
              </span>
              <span className="text-[10.5px] text-slate-500">Master Catalog items</span>
            </div>

            <div className="rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 block">
                Pending Searches
              </span>
              <span className="text-xl font-black font-mono text-blue-800 dark:text-blue-300 mt-1 block">
                {(discoveryOverview?.pending ?? 0) + (discoveryOverview?.searching ?? 0)}
              </span>
              <span className="text-[10.5px] text-blue-600/80">Awaiting collector query</span>
            </div>

            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
                Needs Admin Review
              </span>
              <span className="text-xl font-black font-mono text-amber-800 dark:text-amber-300 mt-1 block">
                {(discoveryOverview?.needs_review ?? 0) + (discoveryOverview?.candidate_found ?? 0)}
              </span>
              <span className="text-[10.5px] text-amber-600/80">Candidates ready to verify</span>
            </div>

            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                Verified &amp; Reused
              </span>
              <span className="text-xl font-black font-mono text-emerald-800 dark:text-emerald-300 mt-1 block">
                {discoveryOverview?.verified ?? 0}
              </span>
              <span className="text-[10.5px] text-emerald-600/80">Active across pharmacies</span>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Unfound / Retries
              </span>
              <span className="text-xl font-black font-mono text-slate-700 dark:text-slate-300 mt-1 block">
                {(discoveryOverview?.not_found ?? 0) + (discoveryOverview?.failed ?? 0)}
              </span>
              <span className="text-[10.5px] text-slate-500">No safe image found</span>
            </div>

            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 block">
                Daily Free Quota
              </span>
              <span className="text-xl font-black font-mono text-indigo-800 dark:text-indigo-300 mt-1 block">
                {discoveryOverview?.daily_searches_used ?? 0} / {discoveryOverview?.daily_search_limit ?? 500}
              </span>
              <span className="text-[10.5px] text-indigo-600/80">Wikipedia / Wikimedia queries</span>
            </div>
          </div>

          {/* Discovery Control Toolbar */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search Master Catalog Name, ID, or Generic..."
                  value={discoverySearch}
                  onChange={(e) => setDiscoverySearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <select
                value={discoveryStatusFilter}
                onChange={(e) => setDiscoveryStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="all">All Statuses</option>
                <option value="needs_review">Needs Review / Candidates</option>
                <option value="verified">Verified Images</option>
                <option value="pending">Pending Searches</option>
                <option value="not_found">Not Found</option>
                <option value="failed">Failed Searches</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Queue Pause / Resume Toggle */}
              <button
                type="button"
                disabled={togglingQueueStatus}
                onClick={handleToggleQueuePause}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition ${
                  discoveryOverview?.collector_status === "paused"
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300"
                    : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300"
                }`}
                title="Pause or Resume automated image discovery queue"
              >
                <Clock className="h-3.5 w-3.5" />
                Queue: {discoveryOverview?.collector_status === "paused" ? "PAUSED" : "ACTIVE"}
              </button>

              {/* Strict Auto-Approve Toggle */}
              <button
                type="button"
                disabled={togglingStrict}
                onClick={handleToggleStrictAutoApprove}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition ${
                  discoveryOverview?.auto_approve_strict
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-700 dark:text-emerald-300"
                    : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300"
                }`}
                title="When ON: 100% exact brand + strength + form matches are automatically approved and applied to all pharmacies. When OFF: All candidates pause for Super Admin review."
              >
                <Sparkles
                  className={`h-3.5 w-3.5 ${
                    discoveryOverview?.auto_approve_strict ? "text-emerald-600 animate-pulse" : "text-slate-400"
                  }`}
                />
                Strict Auto-Approve: {discoveryOverview?.auto_approve_strict ? "ON" : "OFF"}
              </button>

              {/* Auto-Populate Entire Master Catalog */}
              <button
                type="button"
                onClick={handleStreamAllMasterMedicines}
                className={`px-3 py-1.5 rounded-xl text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition ${
                  autoStreamingMaster ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-700 hover:bg-emerald-800"
                }`}
                title="Automatically populate the entire 41,441 Master Medicine Catalog into Cloudflare D1 queue in bounded chunks"
              >
                {autoStreamingMaster ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Stop Stream ({streamingProgress ? `${streamingProgress.current}/${streamingProgress.total}` : "..."})
                  </>
                ) : (
                  <>
                    <Database className="h-3.5 w-3.5 text-white" />
                    Auto-Populate All 41k Meds
                  </>
                )}
              </button>

              {/* Import Next 50 Master Medicines */}
              <button
                type="button"
                disabled={importingMaster || autoStreamingMaster}
                onClick={handleImportNextMasterBatch}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition disabled:opacity-50"
              >
                {importingMaster ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 text-emerald-400" />
                    Import Next 50
                  </>
                )}
              </button>

              {/* Retry Failed */}
              <button
                type="button"
                disabled={retryingFailed}
                onClick={handleRetryFailedSearches}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1.5 transition disabled:opacity-50"
                title="Re-queue failed search jobs"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${retryingFailed ? "animate-spin" : ""}`} />
                Retry Failed
              </button>
            </div>
          </div>

          {/* Discovery Items Table */}
          {discoveryLoading ? (
            <div className="py-20 text-center text-xs text-slate-400">Loading discovery queue…</div>
          ) : discoveryItems.length === 0 ? (
            <div className="py-16 text-center space-y-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <Sparkles className="h-8 w-8 text-emerald-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Discovery Queue Empty for Selected Filter
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click &quot;Import Next 50 Master Meds&quot; above to import medicines from the AivraSol Master Catalog
                into the discovery pipeline.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {discoveryItems.map((item) => {
                const candidate = item.candidate_results?.[0];
                const isReviewing = reviewingQueueId === item.id;

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-xs hover:border-emerald-200 dark:hover:border-emerald-900/60 transition"
                  >
                    {/* Left: Master Catalog Medicine Identity */}
                    <div className="space-y-1.5 flex-1 min-w-[280px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {item.master_catalog_name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-bold border border-blue-200 dark:border-blue-800">
                          {item.master_catalog_id}
                        </span>
                      </div>

                      {item.generic && (
                        <p className="text-xs text-slate-500 font-medium">{item.generic}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {item.brand_name && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-semibold">
                            Brand: {item.brand_name}
                          </span>
                        )}
                        {item.strength && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                            {item.strength}
                          </span>
                        )}
                        {item.dosage_form && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                            {item.dosage_form}
                          </span>
                        )}
                        {item.pack_size && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
                            Pack of {item.pack_size} {item.pack_unit || "units"}
                          </span>
                        )}
                        {item.barcode && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-500">
                            GTIN: {item.barcode}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle: Candidate Image Preview & License Metadata */}
                    <div className="flex items-center gap-3 w-full lg:w-auto">
                      <div className="h-20 w-24 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                        {item.approved_image_url ? (
                          <img
                            src={item.approved_image_url}
                            alt={item.master_catalog_name}
                            className="max-h-full max-w-full object-contain p-1"
                          />
                        ) : candidate?.image_url ? (
                          <img
                            src={candidate.image_url}
                            alt={item.master_catalog_name}
                            className="max-h-full max-w-full object-contain p-1"
                          />
                        ) : (
                          <Images className="h-6 w-6 text-slate-300" />
                        )}

                        <span
                          className={`absolute bottom-1 right-1 px-1 py-0.2 rounded text-[8.5px] font-bold ${
                            item.status === "verified"
                              ? "bg-emerald-600 text-white"
                              : item.status === "candidate_found" || item.status === "needs_review"
                              ? "bg-amber-600 text-white"
                              : "bg-slate-700 text-white"
                          }`}
                        >
                          {item.status === "verified"
                            ? "Verified"
                            : item.status === "candidate_found" || item.status === "needs_review"
                            ? "Candidate"
                            : item.status}
                        </span>
                      </div>

                      <div className="text-xs space-y-0.5 flex-1 lg:max-w-xs">
                        {item.status === "verified" ? (
                          <div className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                            <CheckCheck className="h-3.5 w-3.5" />
                            Approved &amp; Reused Globally
                          </div>
                        ) : candidate ? (
                          <>
                            <div className="font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                              {candidate.title || "Free Repository Photo"}
                            </div>
                            <div className="text-[10.5px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                              <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 font-medium">
                                {candidate.source || "Wikimedia"}
                              </span>
                              <span>{candidate.license || "CC-BY-SA 4.0"}</span>
                              {candidate.byte_size && <span>• {formatBytes(candidate.byte_size)}</span>}
                            </div>
                          </>
                        ) : item.status === "pending" || item.status === "searching" ? (
                          <div className="text-slate-400 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 animate-spin text-blue-500" />
                            <span>Queued for automated search…</span>
                          </div>
                        ) : item.status === "not_found" ? (
                          <div className="text-slate-400 text-[11px]">
                            No photographic match in free commons repository yet.
                          </div>
                        ) : (
                          <div className="text-rose-500 text-[11px] line-clamp-1">
                            {item.last_error || "Search error"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
                      {(item.status === "candidate_found" || item.status === "needs_review") && candidate && (
                        <>
                          <button
                            type="button"
                            disabled={isReviewing}
                            onClick={() => void handleRejectDiscoveryCandidate(item)}
                            className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800/60 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold transition disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={isReviewing}
                            onClick={() => void handleApproveDiscoveryCandidate(item, candidate)}
                            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isReviewing ? "Applying…" : "Approve & Apply to All"}
                          </button>
                        </>
                      )}

                      {item.status === "verified" && (
                        <span className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold inline-flex items-center gap-1">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          Live on Storefronts
                        </span>
                      )}

                      {(item.status === "not_found" || item.status === "failed") && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMed(null);
                            setModalForm({
                              master_catalog_id: item.master_catalog_id,
                              master_catalog_name: item.master_catalog_name,
                              canonical_name: item.master_catalog_name,
                              brand_name: item.brand_name || "",
                              generic_name: item.generic || "",
                              strength: item.strength || "",
                              dosage_form: item.dosage_form || "Tablet",
                              manufacturer: "",
                              pack_size: String(item.pack_size || "100"),
                              pack_unit: item.pack_unit || "Tablet",
                              barcode: item.barcode || "",
                              aliases: "",
                            });
                            setUploadOptimized(null);
                            setShowAddModal(true);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1.5 transition"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Upload Manually
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {discoveryTotalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-800">
              <span>
                Page <strong className="text-slate-900 dark:text-white font-mono">{discoveryPage}</strong> of{" "}
                <strong className="text-slate-900 dark:text-white font-mono">{discoveryTotalPages}</strong> (
                {discoveryTotalCount} medicines)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={discoveryPage <= 1}
                  onClick={() => setDiscoveryPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 font-bold"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>
                <button
                  type="button"
                  disabled={discoveryPage >= discoveryTotalPages}
                  onClick={() => setDiscoveryPage((p) => Math.min(discoveryTotalPages, p + 1))}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 font-bold"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: OWNER SUBMISSIONS */}
      {activeTab === "submissions" && (
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4 rounded-2xl flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <span className="font-bold block">Owner Contribution Verification Policy</span>
              Pharmacy owners can contribute medicine photos from their POS / website portal. Before an image
              becomes a globally shared asset across all pharmacies, verify that the packaging label, strength,
              and dosage form are crisp, authentic, and free of copyright issues.
            </div>
          </div>

          {submissions.length === 0 ? (
            <div className="py-16 text-center space-y-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Review Queue is Clear
              </p>
              <p className="text-xs text-slate-500">
                No pharmacy owner image contributions currently awaiting Super Admin review.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((sub) => (
                <div
                  key={sub.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col md:flex-row items-center gap-4 justify-between shadow-xs"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-20 w-20 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                      {sub.media_url ? (
                        <img
                          src={sub.media_url}
                          alt={sub.product_name_snapshot}
                          className="max-h-full max-w-full object-contain p-1"
                        />
                      ) : (
                        <Images className="h-6 w-6 text-slate-300" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {sub.product_name_snapshot}
                      </div>
                      <div className="text-xs text-slate-500">
                        Submitted by:{" "}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {sub.pharmacy_name || sub.pharmacy_id}
                        </strong>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        {sub.strength_snapshot && <span>Strength: {sub.strength_snapshot}</span>}
                        {sub.dosage_form_snapshot && <span>• Form: {sub.dosage_form_snapshot}</span>}
                        {sub.byte_size && <span>• Size: {formatBytes(sub.byte_size)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRejectSubmission(sub.id)}
                      className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold transition"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApproveSubmission(sub)}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve for Shared Library
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: BATCH CATALOG MATCHER */}
      {activeTab === "batch" && (
        <div className="space-y-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Cross-Pharmacy Batch Product Matcher
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
              Scans products currently stored in Cloudflare D1 across all pharmacy storefronts and checks them
              against verified canonical medicine identities. When an exact match is confirmed (via Master Catalog ID,
              Barcode, or Normalized Identity), the shared R2 image reference is attached automatically.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4 border border-slate-200/80 dark:border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Matching Status &amp; Progress
              </span>
              <span className="font-mono text-slate-500">
                {batchRunning ? "Processing batch in progress…" : "Idle / Ready"}
              </span>
            </div>

            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    overview?.total_canonical_medicines
                      ? Math.min(100, (batchProgress.processed / 2350) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Processed</span>
                <span className="font-mono font-bold text-sm text-slate-800 dark:text-slate-200">
                  {batchProgress.processed} products
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Matched to Shared</span>
                <span className="font-mono font-bold text-sm text-emerald-600">
                  {batchProgress.matched} matches
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Eligible Catalog</span>
                <span className="font-mono font-bold text-sm text-slate-800 dark:text-slate-200">
                  {overview?.unassigned_products ?? 2350} products
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Estimated Savings</span>
                <span className="font-mono font-bold text-sm text-indigo-600">
                  {formatBytes(batchProgress.matched * 26 * 1024)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={batchRunning}
              onClick={() => {
                setBatchProgress({ processed: 0, matched: 0, offset: 0, hasMore: true });
                void runBatchMatchStep(0, 0);
              }}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs inline-flex items-center gap-2 shadow-sm transition"
            >
              {batchRunning ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Matching Products…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Run Batch Catalog Matching
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ADD / EDIT CANONICAL MEDICINE & UPLOAD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-bold text-base text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                {selectedMed ? "Update Canonical Medicine & Image" : "Add Verified Canonical Medicine Image"}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Master Catalog Auto-Complete Search Bar */}
            <div className="bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-emerald-900 dark:text-emerald-300 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                  Auto-Fill from Master Medicine Catalog (41,000+ items)
                </label>
                {modalForm.master_catalog_id && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold">
                    ✓ Linked: {modalForm.master_catalog_id}
                  </span>
                )}
              </div>

              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Type medicine name (e.g. Panadol 500mg, Brufen, Augmentin)..."
                  value={masterSearchQuery}
                  onChange={(e) => void handleMasterSearch(e.target.value)}
                  onFocus={() => {
                    if (masterSearchResults.length > 0) setShowMasterDropdown(true);
                  }}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                {masterSearchLoading && (
                  <div className="absolute right-3 top-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                  </div>
                )}

                {showMasterDropdown && masterSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {masterSearchResults.map((item) => (
                      <button
                        key={item.master_catalog_id}
                        type="button"
                        onClick={() => handleSelectMasterItem(item)}
                        className="w-full text-left p-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            {item.master_catalog_name}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            {item.generic_name && <span>{item.generic_name}</span>}
                            {item.strength && <span>• {item.strength}</span>}
                            {item.dosage_form && <span>• {item.dosage_form}</span>}
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                          {item.master_catalog_id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveMedicine} className="space-y-4 text-xs">
              {/* Product Identity Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Canonical Trade Name * (e.g. Panadol 500mg Tablets)
                  </label>
                  <input
                    type="text"
                    required
                    value={modalForm.canonical_name}
                    onChange={(e) => setModalForm({ ...modalForm, canonical_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-medium"
                    placeholder="e.g. Panadol 500mg Tablets"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Brand / Manufacturer</label>
                  <input
                    type="text"
                    value={modalForm.brand_name}
                    onChange={(e) => setModalForm({ ...modalForm, brand_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    placeholder="e.g. Haleon / GSK"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Generic / Salt</label>
                  <input
                    type="text"
                    value={modalForm.generic_name}
                    onChange={(e) => setModalForm({ ...modalForm, generic_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    placeholder="e.g. Paracetamol"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Strength * (Exact)</label>
                  <input
                    type="text"
                    value={modalForm.strength}
                    onChange={(e) => setModalForm({ ...modalForm, strength: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    placeholder="e.g. 500mg, 120mg/5ml"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Dosage Form *</label>
                  <select
                    value={modalForm.dosage_form}
                    onChange={(e) => setModalForm({ ...modalForm, dosage_form: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="Tablet">Tablet</option>
                    <option value="Capsule">Capsule</option>
                    <option value="Syrup">Syrup</option>
                    <option value="Suspension">Suspension</option>
                    <option value="Injection">Injection</option>
                    <option value="Drops">Eye/Ear Drops</option>
                    <option value="Sachet">Sachet</option>
                    <option value="Topical">Topical / Cream</option>
                    <option value="Inhaler">Inhaler</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Pack Size &amp; Unit</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={modalForm.pack_size}
                      onChange={(e) => setModalForm({ ...modalForm, pack_size: e.target.value })}
                      className="w-24 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                      placeholder="100"
                    />
                    <input
                      type="text"
                      value={modalForm.pack_unit}
                      onChange={(e) => setModalForm({ ...modalForm, pack_unit: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                      placeholder="e.g. Tablet, Box"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">Barcode / GTIN</label>
                  <input
                    type="text"
                    value={modalForm.barcode}
                    onChange={(e) => setModalForm({ ...modalForm, barcode: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    placeholder="e.g. 8964000123456"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Approved Name Aliases (Comma-separated)
                  </label>
                  <input
                    type="text"
                    value={modalForm.aliases}
                    onChange={(e) => setModalForm({ ...modalForm, aliases: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    placeholder="e.g. PANADOL 500 MG TABS, Panadol Regular"
                  />
                </div>
              </div>

              {/* Photo Upload & In-Browser WebP Compressor Section */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  Packaging Photograph (Auto-compressed to ultra-lightweight WebP in KBs)
                </label>

                <div className="flex items-center gap-4">
                  <div className="h-24 w-24 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {uploadOptimized ? (
                      <img
                        src={uploadOptimized.previewDataUrl}
                        alt="Optimized preview"
                        className="max-h-full max-w-full object-contain p-1"
                      />
                    ) : selectedMed?.preferred_image_url ? (
                      <img
                        src={selectedMed.preferred_image_url}
                        alt="Existing image"
                        className="max-h-full max-w-full object-contain p-1"
                      />
                    ) : (
                      <Images className="h-8 w-8 text-slate-300" />
                    )}
                  </div>

                  <div className="space-y-1.5 flex-1">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageSelect}
                      className="hidden"
                    />

                    <button
                      type="button"
                      disabled={uploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold inline-flex items-center gap-1.5 transition text-xs text-slate-700 dark:text-slate-300"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingImage ? "Optimizing…" : "Select Product Photo"}
                    </button>

                    {uploadOptimized && (
                      <div className="text-[11px] text-emerald-600 font-medium">
                        ✓ WebP Optimized: {(uploadOptimized.byteSize / 1024).toFixed(1)} KB (
                        {uploadOptimized.width}×{uploadOptimized.height}px, text preserved)
                      </div>
                    )}
                    <span className="text-[10.5px] text-slate-400 block">
                      Recommended: Clear photo of medicine packaging front. Max 650 KB server upload.
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMed}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition disabled:opacity-50"
                >
                  {savingMed ? "Saving…" : "Save to Central Library"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
