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

export default function CentralMedicineImagesPage() {
  const [activeTab, setActiveTab] = useState<"library" | "submissions" | "batch">("library");
  const [overview, setOverview] = useState<CentralOverview | null>(null);
  const [medicines, setMedicines] = useState<CanonicalMedicine[]>([]);
  const [submissions, setSubmissions] = useState<ImageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dosageFilter, setDosageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hasImageFilter, setHasImageFilter] = useState("all");
  const [toast, setToast] = useState<string | null>(null);

  // New / Edit Canonical Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMed, setSelectedMed] = useState<CanonicalMedicine | null>(null);
  const [modalForm, setModalForm] = useState({
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

  useEffect(() => {
    void loadOverview();
    void loadMedicines();
    void loadSubmissions();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMedicines();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, dosageFilter, statusFilter, hasImageFilter]);

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
      }
    } catch {
      notify("Network error rejecting submission");
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
          // Process next batch smoothly
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
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Toast */}
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
            approved images across multi-tenant pharmacy websites without duplicate uploads.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              void loadOverview();
              void loadMedicines();
              void loadSubmissions();
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
            Review Queue
          </span>
          <span className="text-2xl font-black font-mono text-amber-800 dark:text-amber-300 mt-1 block">
            {overview?.pending_submissions ?? 0}
          </span>
          <span className="text-[11px] text-amber-600/80 font-medium">Owner contributions pending</span>
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
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab("library")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 ${
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
          onClick={() => setActiveTab("submissions")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 ${
            activeTab === "submissions"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <FileCheck className="h-4 w-4" />
          Owner Submissions
          {submissions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold">
              {submissions.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("batch")}
          className={`pb-3 px-3 text-xs font-bold border-b-2 transition inline-flex items-center gap-1.5 ${
            activeTab === "batch"
              ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Zap className="h-4 w-4" />
          Batch Catalog Matcher
        </button>
      </div>

      {/* TAB 1: LIBRARY */}
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
                Add your first verified packaging photo or run the Batch Catalog Matcher to seed initial identities.
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
                          />
                        ) : (
                          <div className="text-center p-3 text-slate-400 space-y-1">
                            <Images className="h-6 w-6 mx-auto text-slate-300" />
                            <span className="text-[10px] font-bold block uppercase tracking-wider">
                              Category Placeholder
                            </span>
                          </div>
                        )}

                        <span
                          className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            hasImage
                              ? "bg-emerald-500/90 text-white"
                              : "bg-slate-600/90 text-white"
                          }`}
                        >
                          {hasImage ? "Verified Image" : "Missing Image"}
                        </span>

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

      {/* TAB 2: OWNER SUBMISSIONS */}
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

      {/* TAB 3: BATCH CATALOG MATCHER */}
      {activeTab === "batch" && (
        <div className="space-y-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Cross-Pharmacy Batch Product Matcher
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
              Scans products currently stored in Cloudflare D1 across all pharmacy storefronts and checks them
              against verified canonical medicine identities. When an exact match is confirmed (via Barcode or
              Normalized Identity), the shared R2 image reference is attached automatically.
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

