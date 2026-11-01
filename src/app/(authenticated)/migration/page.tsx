"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Database,
  Upload,
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileText,
  KeyRound,
  Download,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Building2,
  PackageCheck,
  Layers,
  Archive,
  History,
  Info,
  ChevronRight,
  XCircle,
  FileCheck2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface PharmacyOption {
  license_id: string;
  license_key: string;
  project_id: string;
  pharmacy_name: string;
  client_id: string;
  client_name: string;
  status: string;
}

interface MigrationJobData {
  id: string;
  job_number: string;
  source_software: string;
  source_format: string;
  source_database?: string;
  source_filename: string;
  source_file_size: number;
  source_file_hash: string;
  pharmacy_name?: string;
  license_key?: string;
  status: string;
  stage: string;
  progress: number;
  mapping_version: string;
  converter_version: string;
  source_metrics?: {
    total_tables?: number;
    populated_tables?: number;
    torn_pages_restored?: number;
    raw_records?: Record<string, number>;
  };
  normalized_counts: {
    products: number;
    customers: number;
    suppliers: number;
    invoices: number;
    purchases: number;
    sales_returns: number;
    total: number;
  };
  archive_counts: {
    cmh_tables: number;
    orphan_sales: number;
    orphan_purchases: number;
    header_only_returns: number;
    unmapped_tables: number;
    total: number;
  };
  reconciliation: {
    stock_total_units: number;
    stock_valuation_pkr: number;
    sales_total_pkr: number;
    purchases_total_pkr: number;
    returns_total_pkr: number;
    customer_receivable_pkr: number;
    supplier_payable_pkr: number;
  };
  warnings: Array<{
    code: string;
    severity: "info" | "warning" | "blocking";
    message: string;
    count?: number;
  }>;
  blocking_issues: Array<{
    code: string;
    title: string;
    count: number;
    resolution_strategy: string;
    resolved: boolean;
  }>;
  output_backup?: {
    filename: string;
    size_bytes: number;
    checksum_sha256: string;
    created_at: string;
  };
  restore_key?: {
    key_preview?: string;
    issued_at?: string;
  };
  created_at: string;
  audit_events?: Array<{
    timestamp: string;
    actor: string;
    action: string;
    details?: string;
  }>;
}

export default function DataMigrationPage() {
  const [activeTab, setActiveTab] = useState<string>("new");
  const [jobs, setJobs] = useState<MigrationJobData[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([]);

  // Wizard state for "New Migration"
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const [currentJob, setCurrentJob] = useState<MigrationJobData | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [converting, setConverting] = useState<boolean>(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState<PharmacyOption | null>(null);

  // Restore key revealed state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [fetchingKey, setFetchingKey] = useState<boolean>(false);

  // Diagnostics modal
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [diagnosticsJob, setDiagnosticsJob] = useState<MigrationJobData | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch jobs
  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/admin/migration");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) {
      console.error("Failed to fetch migration jobs", e);
    } finally {
      setLoadingJobs(false);
    }
  };

  // Fetch pharmacies
  const fetchPharmacies = async () => {
    try {
      const res = await fetch("/api/admin/migration/pharmacies");
      if (res.ok) {
        const data = await res.json();
        setPharmacies(data.pharmacies || []);
      }
    } catch (e) {
      console.error("Failed to fetch pharmacies", e);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchPharmacies();
  }, []);

  // Compute file SHA-256 in browser for content validation
  const computeFileHash = async (file: File): Promise<string> => {
    // For small files or first 10MB chunk for fast response if file is huge
    const chunk = file.size > 20_000_000 ? file.slice(0, 20_000_000) : file;
    const arrayBuffer = await chunk.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate extension
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (ext !== ".bak" && ext !== ".zip") {
      toast.error("Unsupported file type", {
        description: "Please upload a SQL Server backup (.bak) or archive (.zip).",
      });
      return;
    }

    setSelectedFile(file);
    toast.info("Inspecting file...", { description: `Calculating hash for ${file.name}` });

    try {
      const hash = await computeFileHash(file);
      setFileHash(hash);
    } catch {
      setFileHash("hash-" + Date.now());
    }
  };

  // Step 1: Upload Backup via Presigned R2 URL
  const handleUploadBackup = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(5);

    try {
      // 1. Initiate job on server and obtain Presigned R2 PUT URL
      const initRes = await fetch("/api/admin/migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_filename: selectedFile.name,
          source_file_size: selectedFile.size,
          source_file_hash: fileHash,
          source_format: selectedFile.name.endsWith(".zip") ? ".zip" : ".bak",
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error || "Failed to initiate migration job");
      }

      const { job, uploadUrl } = await initRes.json();
      setCurrentJob(job);
      setUploadProgress(25);

      // 2. Upload file directly to Cloudflare R2 via presigned URL
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round(25 + (event.loaded / event.total) * 70);
          setUploadProgress(percent);
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`R2 upload failed with HTTP status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during R2 upload"));
        xhr.send(selectedFile);
      });

      setUploadProgress(100);
      toast.success("Backup uploaded to Cloudflare R2 successfully!");
      setWizardStep(2);
      fetchJobs();

      // Automatically trigger Step 2: Analyze
      triggerAnalysis(job.id);
    } catch (err: any) {
      toast.error("Upload failed", { description: err.message });
    } finally {
      setUploading(false);
    }
  };

  // Step 2: Analyze Backup
  const triggerAnalysis = async (jobId: string) => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/admin/migration/${jobId}/analyze`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      setCurrentJob(data.job);
      toast.success("Analysis complete!", {
        description: `Identified ${data.job.source_software} with ${data.job.normalized_counts.products.toLocaleString()} products.`,
      });
      setWizardStep(3); // Proceed to Review
      fetchJobs();
    } catch (err: any) {
      toast.error("Analysis failed", { description: err.message });
    } finally {
      setAnalyzing(false);
    }
  };

  // Step 4: Convert Job into Portable Migration Package
  const triggerConversion = async () => {
    if (!currentJob) return;

    setConverting(true);
    setWizardStep(4);
    try {
      const res = await fetch(`/api/admin/migration/${currentJob.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conversion failed");

      setCurrentJob(data.job);
      toast.success("Conversion completed!", {
        description: "Encrypted portable .aivrabak package and unique 256-bit restore key generated.",
      });
      setWizardStep(5); // Step 5: Download & Restore Key
      fetchJobs();
    } catch (err: any) {
      toast.error("Conversion failed", { description: err.message });
      setWizardStep(3);
    } finally {
      setConverting(false);
    }
  };

  // Reveal Restore Key
  const handleRevealKey = async (jobId: string) => {
    setFetchingKey(true);
    try {
      const res = await fetch(`/api/admin/migration/${jobId}/restore-key`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retrieve restore key");
      setRevealedKey(data.restore_key);
      toast.success("Restore key retrieved securely");
    } catch (err: any) {
      toast.error("Key retrieval failed", { description: err.message });
    } finally {
      setFetchingKey(false);
    }
  };

  // Copy Key to Clipboard
  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("Restore key copied to clipboard!");
  };

  // Download .aivrabak package
  const handleDownloadBackup = async (jobId: string) => {
    try {
      const res = await fetch(`/api/admin/migration/${jobId}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get download URL");

      window.open(data.downloadUrl, "_blank");
      toast.success("Download started");
    } catch (err: any) {
      toast.error("Download failed", { description: err.message });
    }
  };

  // Format currency
  const fmtPkr = (val?: number) => {
    return `Rs ${(val || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Data Migration</h1>
              <p className="text-sm text-muted-foreground">
                Cloud-native conversion of legacy pharmacy databases into verified, encrypted{" "}
                <span className="font-mono text-foreground font-semibold">.aivrabak</span> packages.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchJobs();
              toast.info("Refreshed migration jobs");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setActiveTab("new");
              setWizardStep(1);
              setSelectedFile(null);
              setCurrentJob(null);
              setRevealedKey(null);
            }}
          >
            <Upload className="h-4 w-4 mr-1.5" /> New Migration
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full md:w-[600px] mb-4">
          <TabsTrigger value="new">New Migration</TabsTrigger>
          <TabsTrigger value="history">
            History ({jobs.length})
          </TabsTrigger>
          <TabsTrigger value="review">
            Review Required ({jobs.filter((j) => j.status === "needs_review").length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({jobs.filter((j) => j.status === "completed").length})
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: NEW MIGRATION WORKFLOW ────────────────────────────── */}
        <TabsContent value="new" className="space-y-6">
          {/* Stepper Header */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border rounded-xl p-3 bg-muted/30 text-xs">
            {[
              { num: 1, label: "Upload Backup" },
              { num: 2, label: "Analyze" },
              { num: 3, label: "Review Data" },
              { num: 4, label: "Convert Backup" },
              { num: 5, label: "Download Backup & Key" },
            ].map((s) => {
              const isActive = wizardStep === s.num;
              const isDone = wizardStep > s.num;
              return (
                <div
                  key={s.num}
                  className={`flex items-center gap-2 p-2 rounded-lg font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isDone
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                      isActive
                        ? "bg-primary-foreground text-primary font-bold"
                        : isDone
                        ? "bg-primary/20 text-primary"
                        : "bg-muted-foreground/20 text-muted-foreground"
                    }`}
                  >
                    {isDone ? "✓" : s.num}
                  </span>
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* STEP 1: UPLOAD BACKUP */}
          {wizardStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 1: Upload Legacy Pharmacy Backup</CardTitle>
                <CardDescription>
                  Upload your raw database backup (e.g. Abuzar Software{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">AutoStartUpExecutivePhDBDump1.BAK</code> or KeyPOS).
                  Files are validated by content structure and uploaded directly to secure Cloudflare R2 storage.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".bak,.zip"
                  className="hidden"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/60 transition-colors bg-muted/20"
                >
                  <div className="grid h-12 w-12 place-items-center mx-auto rounded-full bg-primary/10 text-primary mb-3">
                    <Upload className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-base mb-1">
                    {selectedFile ? selectedFile.name : "Select or drag & drop legacy backup file"}
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Supported formats: Microsoft SQL Server .BAK (SQL 2000, 2008, 2014, 2019) or ZIP archives containing .BAK.
                  </p>
                  {selectedFile && (
                    <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-muted rounded-full text-xs font-mono">
                      <span>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                      <span>•</span>
                      <span className="text-muted-foreground">SHA-256: {fileHash.slice(0, 16)}...</span>
                    </div>
                  )}
                </div>

                {uploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Uploading to Cloudflare R2 storage...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} />
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    disabled={!selectedFile || uploading}
                    onClick={handleUploadBackup}
                    className="min-w-[140px]"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Uploading...
                      </>
                    ) : (
                      <>
                        Upload &amp; Analyze <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 2: ANALYZE */}
          {wizardStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 2: Server-Side Binary Analysis</CardTitle>
                <CardDescription>
                  Inspecting MTF streams, SQL Server page headers, Torn-Page bit repairs, and system catalog signatures.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4 p-4 border rounded-xl bg-muted/20">
                  <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                  <div>
                    <h4 className="font-semibold text-sm">Inspecting Legacy Database Structure...</h4>
                    <p className="text-xs text-muted-foreground">
                      Running non-destructive parser without requiring customer-side SQL Server installation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 3: REVIEW & RECONCILE */}
          {wizardStep === 3 && currentJob && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        Step 3: Data Inspection &amp; Reconciliation Review
                        <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-mono">
                          {currentJob.source_software}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Review recoverable operational entities, unit packaging, WAC cost conversions, and archive preservation.
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-muted-foreground block">Job Reference</span>
                      <span className="font-mono font-bold text-sm">{currentJob.job_number}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Category Counts Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 border rounded-xl bg-card">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                        <PackageCheck className="h-4 w-4 text-primary" /> Products &amp; Medicines
                      </div>
                      <div className="text-2xl font-bold">
                        {currentJob.normalized_counts.products.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Stock: {currentJob.reconciliation.stock_total_units.toLocaleString()} units ({fmtPkr(currentJob.reconciliation.stock_valuation_pkr)})
                      </div>
                    </div>

                    <div className="p-4 border rounded-xl bg-card">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                        <FileCheck2 className="h-4 w-4 text-emerald-600" /> Historical Sales
                      </div>
                      <div className="text-2xl font-bold">
                        {currentJob.normalized_counts.invoices.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Revenue: {fmtPkr(currentJob.reconciliation.sales_total_pkr)}
                      </div>
                    </div>

                    <div className="p-4 border rounded-xl bg-card">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                        <Layers className="h-4 w-4 text-amber-600" /> Historical Purchases
                      </div>
                      <div className="text-2xl font-bold">
                        {currentJob.normalized_counts.purchases.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Total GRN: {fmtPkr(currentJob.reconciliation.purchases_total_pkr)}
                      </div>
                    </div>

                    <div className="p-4 border rounded-xl bg-card">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                        <Archive className="h-4 w-4 text-indigo-600" /> Lossless Archive Records
                      </div>
                      <div className="text-2xl font-bold">
                        {currentJob.archive_counts.total.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        CMH tables, orphan lines &amp; audits preserved
                      </div>
                    </div>
                  </div>

                  {/* Financial & Packing Reconciliation Breakdown */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" /> Verified Conversion Rules
                      </h4>
                      <ul className="text-xs space-y-2 text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                          <span>
                            <strong>Base Unit Normalization:</strong> Pack retail price and WAC cost divided by{" "}
                            <code>PackUnits</code>. Base-unit stock preserved from <code>StockReport</code> without duplicate multiplication.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                          <span>
                            <strong>SaaS &amp; FBR Protection:</strong> Historical sales are marked{" "}
                            <code>billable: false</code> and <code>fbrStatus: &quot;not_applicable&quot;</code> to prevent double billing or FBR transmission.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                          <span>
                            <strong>Supplier Payable Guard:</strong> Historical purchases flagged{" "}
                            <code>excludeFromSupplierBalance: true</code> so missing legacy vouchers do not fabricate debt.
                          </span>
                        </li>
                      </ul>
                    </div>

                    <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" /> Warnings &amp; Review Items ({currentJob.warnings.length})
                      </h4>
                      <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-2">
                        {currentJob.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="text-xs p-2 rounded bg-card border flex items-start gap-2"
                          >
                            <Info className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <span className="font-medium text-foreground">{w.message}</span>
                              {w.count && (
                                <Badge variant="outline" className="ml-2 text-[10px]">
                                  {w.count} items
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t">
                    <Button variant="outline" onClick={() => setWizardStep(1)}>
                      Back to Upload
                    </Button>
                    <Button onClick={triggerConversion} disabled={converting}>
                      Convert to Portable Package <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* STEP 4: CONVERTING */}
          {wizardStep === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 4: Server-Side Conversion &amp; Encryption</CardTitle>
                <CardDescription>
                  Extracting canonical records, compiling Lossless Source Archive, deriving 256-bit CSPRNG restore key, and encrypting portable .aivrabak V2.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4 p-6 border rounded-xl bg-muted/20">
                  <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                  <div>
                    <h4 className="font-semibold text-sm">Generating Verified Portable Migration Package...</h4>
                    <p className="text-xs text-muted-foreground">
                      Running AES-256-GCM encryption with 200,000 PBKDF2 iterations and strict manifest validation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 5: DOWNLOAD & RESTORE KEY */}
          {wizardStep === 5 && currentJob && (
            <Card className="border-success/30 bg-success/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-success/20 text-success">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">Portable Migration Package Ready</CardTitle>
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[11px]">
                        Portable General Mode
                      </Badge>
                    </div>
                    <CardDescription>
                      The legacy backup was safely converted into a general encrypted .aivrabak file that can initialize any activated, empty AivraSol POS.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Package Info Card */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-xl bg-card space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Package Artifact (.aivrabak V2)
                    </span>
                    <div className="font-semibold text-sm truncate">
                      {currentJob.output_backup?.filename}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      Size: {((currentJob.output_backup?.size_bytes || 0) / 1024 / 1024).toFixed(2)} MB • SHA-256:{" "}
                      {currentJob.output_backup?.checksum_sha256?.slice(0, 16)}...
                    </div>
                    <div className="pt-2">
                      <Button
                        size="sm"
                        className="w-full bg-success text-success-foreground hover:bg-success/90"
                        onClick={() => handleDownloadBackup(currentJob.id)}
                      >
                        <Download className="h-4 w-4 mr-2" /> Download .aivrabak Package
                      </Button>
                    </div>
                  </div>

                  {/* Restore Key Card */}
                  <div className="p-4 border rounded-xl bg-card space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Unique Restore Security Key (256-bit CSPRNG)
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded-lg truncate border">
                        {revealedKey ? revealedKey : currentJob.restore_key?.key_preview || "MIG-PORTABLE-••••"}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          if (revealedKey) {
                            setRevealedKey(null);
                          } else {
                            handleRevealKey(currentJob.id);
                          }
                        }}
                        disabled={fetchingKey}
                      >
                        {revealedKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          if (revealedKey) {
                            handleCopyKey(revealedKey);
                          } else {
                            handleRevealKey(currentJob.id).then(() => {
                              if (revealedKey) handleCopyKey(revealedKey);
                            });
                          }
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Give this key to the pharmacy owner. They enter it in AivraSol POS{" "}
                      <strong>Settings → Backup &amp; Restore</strong>.
                    </p>
                  </div>
                </div>

                {/* Final Reconciliation Summary */}
                <div className="p-4 border rounded-xl bg-card space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                    Preserved Operational Snapshot
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs pt-1">
                    <div>
                      <span className="text-muted-foreground block">Products</span>
                      <span className="font-bold text-sm">{currentJob.normalized_counts.products.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Cutover Stock</span>
                      <span className="font-bold text-sm">{currentJob.reconciliation.stock_total_units.toLocaleString()} units</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Historical Sales</span>
                      <span className="font-bold text-sm">{currentJob.normalized_counts.invoices.toLocaleString()} invoices</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Target Scope</span>
                      <span className="font-bold text-sm text-primary">
                        {currentJob.pharmacy_name ? currentJob.pharmacy_name : "Any Activated POS (Empty DB)"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDiagnosticsJob(currentJob);
                      setShowDiagnostics(true);
                    }}
                  >
                    <FileText className="h-4 w-4 mr-2" /> View Diagnostics &amp; Audit Trail
                  </Button>
                  <Button
                    onClick={() => {
                      setActiveTab("history");
                    }}
                  >
                    View in Migration History <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB 2: MIGRATION HISTORY ──────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">All Migration Jobs</CardTitle>
                  <CardDescription className="text-xs">
                    Complete history of legacy database conversions and generated packages.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingJobs ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading migrations...
                </div>
              ) : jobs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No migration jobs found. Start a new migration above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-y bg-muted/40 text-muted-foreground text-left">
                      <tr>
                        <th className="py-2.5 px-4 font-medium">Job #</th>
                        <th className="py-2.5 px-4 font-medium">Source</th>
                        <th className="py-2.5 px-4 font-medium">Target / Scope</th>
                        <th className="py-2.5 px-4 font-medium">Status</th>
                        <th className="py-2.5 px-4 font-medium">Products</th>
                        <th className="py-2.5 px-4 font-medium">Created</th>
                        <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {jobs.map((job) => (
                        <tr key={job.id} className="hover:bg-muted/20">
                          <td className="py-3 px-4 font-mono font-medium">{job.job_number}</td>
                          <td className="py-3 px-4">
                            <span className="font-semibold block">{job.source_software}</span>
                            <span className="text-[11px] text-muted-foreground">{job.source_filename}</span>
                          </td>
                          <td className="py-3 px-4">
                            {job.license_key ? (
                              <>
                                <span className="font-medium block">{job.pharmacy_name || "Bound Pharmacy"}</span>
                                <span className="text-[11px] font-mono text-muted-foreground">
                                  {job.license_key}
                                </span>
                              </>
                            ) : (
                              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[11px]">
                                Portable (Any POS)
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant={
                                job.status === "completed"
                                  ? "default"
                                  : job.status === "needs_review"
                                  ? "destructive"
                                  : "outline"
                              }
                              className="capitalize"
                            >
                              {job.status.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 font-medium">
                            {job.normalized_counts.products.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {new Date(job.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            {job.status === "completed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadBackup(job.id)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1" /> .aivrabak
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDiagnosticsJob(job);
                                setShowDiagnostics(true);
                              }}
                            >
                              Diagnostics
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 3: REVIEW REQUIRED ────────────────────────────────── */}
        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Jobs Requiring Super Admin Review</CardTitle>
              <CardDescription className="text-xs">
                Migrations with cost discrepancies, missing packaging, or data gaps requiring confirmation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.filter((j) => j.status === "needs_review").length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2 opacity-50" />
                  No jobs currently require review. All migrations are resolved.
                </div>
              ) : (
                <div className="space-y-4">
                  {jobs
                    .filter((j) => j.status === "needs_review")
                    .map((job) => (
                      <div key={job.id} className="p-4 border rounded-xl space-y-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-mono font-bold text-sm mr-2">{job.job_number}</span>
                            <Badge variant="destructive">Needs Review</Badge>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              setCurrentJob(job);
                              setActiveTab("new");
                              setWizardStep(3);
                            }}
                          >
                            Open Review &amp; Reconcile
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {job.warnings.length} warning(s) flagged during source extraction.
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: COMPLETED BACKUPS ──────────────────────────────── */}
        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ready .aivrabak Packages</CardTitle>
              <CardDescription className="text-xs">
                Verified, encrypted backups ready for pharmacy restoration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.filter((j) => j.status === "completed").length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No completed migration packages yet.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {jobs
                    .filter((j) => j.status === "completed")
                    .map((job) => (
                      <div key={job.id} className="p-4 border rounded-xl space-y-3 bg-card">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-semibold text-sm block">{job.pharmacy_name}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              License: {job.license_key}
                            </span>
                          </div>
                          <Badge variant="default" className="bg-success text-success-foreground">
                            Ready
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>File: {job.output_backup?.filename}</div>
                          <div>Products: {job.normalized_counts.products.toLocaleString()}</div>
                          <div>
                            Key: <span className="font-mono">{job.restore_key?.key_preview}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-2 border-t">
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => handleDownloadBackup(job.id)}
                          >
                            <Download className="h-4 w-4 mr-1.5" /> Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDiagnosticsJob(job);
                              setShowDiagnostics(true);
                            }}
                          >
                            Details
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Diagnostics Dialog */}
      <Dialog open={showDiagnostics} onOpenChange={setShowDiagnostics}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Migration Diagnostics &amp; Audit
            </DialogTitle>
            <DialogDescription>
              Job {diagnosticsJob?.job_number} • {diagnosticsJob?.source_software}
            </DialogDescription>
          </DialogHeader>

          {diagnosticsJob && (
            <div className="space-y-4 text-xs">
              <div className="p-3 border rounded-lg bg-muted/20 space-y-2">
                <span className="font-semibold uppercase tracking-wider text-[11px] block">
                  Database Page &amp; Record Summary
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>Database Name: {diagnosticsJob.source_database || "—"}</div>
                  <div>Torn Pages Restored: {diagnosticsJob.source_metrics?.torn_pages_restored || 0}</div>
                  <div>Populated Tables: {diagnosticsJob.source_metrics?.populated_tables || 0}</div>
                  <div>Total User Tables: {diagnosticsJob.source_metrics?.total_tables || 0}</div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="font-semibold uppercase tracking-wider text-[11px] block">
                  Audit Trail ({diagnosticsJob.audit_events?.length || 0} events)
                </span>
                <div className="border rounded-lg divide-y max-h-[200px] overflow-y-auto">
                  {diagnosticsJob.audit_events?.map((ev, i) => (
                    <div key={i} className="p-2.5 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold block">{ev.action}</span>
                        <span className="text-muted-foreground">{ev.details}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
