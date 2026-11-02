import fs from "fs";
import path from "path";
import crypto from "crypto";
import connectToDatabase from "../db";
import MigrationJob, { IMigrationJob } from "../../models/MigrationJob";
import { downloadBufferFromR2, uploadBufferToR2, checkR2Object, deleteR2Object } from "../r2";
import {
  createEncryptedAivrabak,
  verifyEncryptedAivrabak,
  generateUniqueRestoreKey,
} from "./aivrabak-encoder";
import { encryptRecoverySecret, decryptRecoverySecret } from "../backup-crypto";
import { AbuzarMigrationAdapter } from "./adapters/abuzar/abuzar_adapter";
import { KeyPosMigrationAdapter } from "./adapters/keypos/keypos_adapter";
import type { MigrationSourceAdapter, SourceAnalysisResult } from "./core/adapter";
import {
  buildPosCollections,
  validatePosCollections,
  MAPPING_VERSION,
  CONVERTER_VERSION,
  LEGACY_ARCHIVE_COLLECTION,
  PosMappingResult,
} from "./pos-mapper";
import {
  MIGRATION_TEMP_DIR,
  cleanupLocalJobArtifacts,
  deleteJobSource,
  deleteJobOutput,
  scheduleSourceDeletion,
  FAILED_SOURCE_RETENTION_HOURS,
  CANCELLED_SOURCE_RETENTION_HOURS,
  OUTPUT_RETENTION_DAYS,
  isOwnedOutputKey,
} from "./cleanup";

export { MAPPING_VERSION, CONVERTER_VERSION };

/** A completed job whose package predates mapping v3 must be re-converted. */
export function isOutdatedMigrationJob(job: Pick<IMigrationJob, "mapping_version">): boolean {
  const major = parseInt(String(job.mapping_version || "0").split(".")[0], 10);
  return !Number.isFinite(major) || major < parseInt(MAPPING_VERSION.split(".")[0], 10);
}

export interface ConversionOutput {
  aivrabakBuffer: Buffer;
  restoreKey: string;
  outputSha256: string;
  outputFilename: string;
  mapping: PosMappingResult;
  sourceSoftware: string;
  conversionId: string;
  /** Decrypted snapshot from the self-verification step (for tests/diagnostics). */
  verifiedSnapshot: any;
}

export class ServerMigrationEngine {
  private adapters: MigrationSourceAdapter[] = [];
  private tempDir = MIGRATION_TEMP_DIR;

  constructor() {
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
    this.adapters.push(new AbuzarMigrationAdapter());
    this.adapters.push(new KeyPosMigrationAdapter());
  }

  /** Downloads the job's source into a job-scoped temp file (deleted on completion/failure). */
  async getLocalBackupFile(job: IMigrationJob): Promise<string> {
    if (fs.existsSync(job.source_object_key)) return job.source_object_key; // local/dev path
    const localPath = path.join(this.tempDir, `${job.id}_${path.basename(job.source_filename)}`);
    if (fs.existsSync(localPath) && fs.statSync(localPath).size === job.source_file_size) return localPath;
    const buf = await downloadBufferFromR2(job.source_object_key);
    fs.writeFileSync(localPath, buf);
    return localPath;
  }

  async detectAdapter(filePath: string): Promise<MigrationSourceAdapter> {
    for (const adapter of this.adapters) {
      if (await adapter.canHandle(filePath)) return adapter;
    }
    throw new Error(`Unsupported backup format. No compatible adapter detected for file: ${path.basename(filePath)}`);
  }

  async analyzeBackup(filePath: string): Promise<SourceAnalysisResult> {
    const adapter = await this.detectAdapter(filePath);
    return adapter.analyze(filePath);
  }

  async analyzeJob(jobId: string, actorEmail: string): Promise<IMigrationJob> {
    await connectToDatabase();
    const job = await MigrationJob.findOne({ id: jobId });
    if (!job) throw new Error(`Migration job not found: ${jobId}`);
    if (job.status === "converting" || (job.status === "completed" && !isOutdatedMigrationJob(job))) {
      throw new Error(`Cannot analyze job in status: ${job.status}`);
    }
    if (job.source_cleanup?.status === "deleted") throw new Error("The uploaded source backup has already been deleted. Please upload it again.");

    job.status = "analyzing";
    job.stage = "Detecting source software and parsing catalog";
    job.progress = 10;
    job.started_at = new Date();
    job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "ANALYZE_STARTED", details: "Started binary source detection and inspection" });
    await job.save();

    try {
      const localFile = await this.getLocalBackupFile(job);
      const adapter = await this.detectAdapter(localFile);
      job.source_software = adapter.name;
      job.stage = "Analyzing source tables, pages, and data records";
      job.progress = 30;
      await job.save();

      const analysis = await adapter.analyze(localFile);
      const tableDetails = analysis.compatibility?.tableDetails || {};
      const tableKeys = Object.keys(tableDetails);
      const populated = tableKeys.filter((k) => (tableDetails[k]?.rowCount || 0) > 0);
      job.source_database = analysis.sourceDatabaseName || "Unknown";
      job.source_metrics = {
        total_tables: tableKeys.length,
        populated_tables: populated.length,
        empty_tables: tableKeys.length - populated.length,
        raw_records: Object.fromEntries(populated.map((n) => [n, tableDetails[n].rowCount])),
      };
      const m = analysis.metrics;
      job.normalized_counts = {
        products: m.productsCount,
        customers: m.customersCount,
        suppliers: m.suppliersCount,
        invoices: m.salesInvoicesCount,
        purchases: m.purchasesCount,
        sales_returns: m.salesReturnsCount,
        total: m.productsCount + m.customersCount + m.suppliersCount + m.salesInvoicesCount + m.purchasesCount + m.salesReturnsCount,
      };
      job.reconciliation = {
        stock_total_units: m.currentStockQty,
        stock_valuation_pkr: m.stockValuationCost,
        sales_total_pkr: m.salesTotalRevenue,
        purchases_total_pkr: m.purchasesTotalCost,
        returns_total_pkr: m.salesReturnsTotal,
        customer_receivable_pkr: m.outstandingReceivables,
        supplier_payable_pkr: m.outstandingPayables,
      };
      job.warnings = (analysis.warnings || []).map((w: any) => ({
        code: w.id || "WARN",
        severity: (w.severity === "BLOCKING" ? "blocking" : w.severity === "INFO" ? "info" : "warning") as any,
        message: `${w.title}: ${w.description}`,
        count: w.impactedCount,
        details: w.recommendedAction,
      }));
      job.blocking_issues = (analysis.warnings || [])
        .filter((w: any) => w.severity === "BLOCKING")
        .map((b: any) => ({ code: b.id || "BLOCKING", title: b.title, count: b.impactedCount || 1, resolution_strategy: b.recommendedAction || "Review and verify", resolved: false }));

      const blocked = job.blocking_issues.some((b: any) => !b.resolved);
      job.status = blocked ? "needs_review" : "ready_to_convert";
      job.stage = blocked ? "Analysis complete — Review required before conversion" : "Analysis complete — Ready to convert";
      job.progress = 100;
      if (blocked) scheduleSourceDeletion(job, FAILED_SOURCE_RETENTION_HOURS(), "Needs-review retry window");
      job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "ANALYZE_COMPLETED", details: `Products ${job.normalized_counts.products}, invoices ${job.normalized_counts.invoices}, purchases ${job.normalized_counts.purchases}. Status: ${job.status}` });
      await job.save();
      return job;
    } catch (err: any) {
      await this.failJob(job, actorEmail, "ANALYZE_FAILED", err);
      throw err;
    }
  }

  /**
   * Pure conversion (no DB / R2): legacy backup → validated, encrypted, self-verified portable .aivrabak.
   */
  async convertBackup(
    localFile: string,
    opts: { batchId?: string; sourceSha256?: string; sourceFileName?: string; targetLicenseKey?: string; pharmacyName?: string } = {}
  ): Promise<ConversionOutput> {
    const batchId = opts.batchId || `standalone_${Date.now()}`;
    const adapter = await this.detectAdapter(localFile);
    const canonical: any = await adapter.extractCanonical(localFile, batchId);
    const isAbuzar = canonical.sourceSystem === "ABUZAR_LEGACY";
    const sourceSoftware = isAbuzar ? "Abuzar Software (ExecutivePhDB)" : adapter.name;
    const sourceFileName = opts.sourceFileName || path.basename(localFile);

    const mapping = buildPosCollections(canonical, {
      batchId,
      sourceFileName,
      sourceSha256: opts.sourceSha256 || canonical.sourceMetrics?.backupHash,
      sourceDatabaseName: canonical.sourceMetrics?.databaseName,
      sourceSoftware,
    });
    validatePosCollections(mapping.collections);

    const isPortable = !opts.targetLicenseKey;
    const restoreKey = generateUniqueRestoreKey(isAbuzar ? "ABZ" : "KEY", isPortable);
    const outputFilename = `${(canonical.sourceSystem || "legacy").toLowerCase()}_${isPortable ? "portable_" : ""}migration_v${MAPPING_VERSION.split(".")[0]}_${Date.now()}.aivrabak`;

    const { buffer, sha256 } = createEncryptedAivrabak(
      mapping.collections as any,
      restoreKey,
      {
        packageType: isPortable ? "portable-legacy-migration" : "license-bound-legacy-migration",
        isPortable,
        targetLicenseKey: isPortable ? undefined : opts.targetLicenseKey,
        pharmacyName: isPortable ? undefined : opts.pharmacyName,
        migrationJobId: batchId,
        mappingVersion: MAPPING_VERSION,
        converterVersion: CONVERTER_VERSION,
        sourceSoftware,
        sourceFileName,
        sourceSha256: opts.sourceSha256 || canonical.sourceMetrics?.backupHash,
        sourceDatabaseName: canonical.sourceMetrics?.databaseName,
        reconciliation: mapping.reconciliation,
        review: mapping.review,
        warnings: (mapping.collections["migration-history"][0] as any)?.warnings || [],
        losslessArchive: {
          collection: LEGACY_ARCHIVE_COLLECTION,
          populatedTablesCount: mapping.archiveCounts.tables,
          sourceRowCount: mapping.archiveCounts.source_rows,
          archiveRecords: mapping.archiveCounts.archive_records,
          orphanSaleDetails: mapping.archiveCounts.orphan_sales,
          orphanPurchaseDetails: mapping.archiveCounts.orphan_purchases,
          headerOnlyReturns: mapping.archiveCounts.header_only_returns,
          cmhTables: mapping.archiveCounts.cmh_tables,
        },
      },
      { [LEGACY_ARCHIVE_COLLECTION]: mapping.archiveRecords }
    );

    // Gate C: decrypt with the issued key and compare against what was mapped
    const verifiedSnapshot = verifyEncryptedAivrabak(buffer, restoreKey);
    for (const name of ["products", "invoices", "purchases", "sales-returns", "customers", "suppliers"]) {
      if ((verifiedSnapshot.collections[name] || []).length !== (mapping.collections[name] || []).length) {
        throw new Error(`Self-verification failed: ${name} count changed during encryption`);
      }
    }
    if ((verifiedSnapshot.collections[LEGACY_ARCHIVE_COLLECTION] || []).length !== mapping.archiveRecords.length) {
      throw new Error("Self-verification failed: legacy archive records missing from package");
    }
    validatePosCollections(verifiedSnapshot.collections);

    return { aivrabakBuffer: buffer, restoreKey, outputSha256: sha256, outputFilename, mapping, sourceSoftware, conversionId: batchId, verifiedSnapshot };
  }

  async convertJob(
    jobId: string,
    actorEmail: string,
    targetPharmacyBinding?: { client_id: string; project_id: string; license_id: string; license_key: string; pharmacy_name: string }
  ): Promise<IMigrationJob> {
    await connectToDatabase();
    const job = await MigrationJob.findOne({ id: jobId });
    if (!job) throw new Error(`Migration job not found: ${jobId}`);
    if (job.status === "completed" && !isOutdatedMigrationJob(job)) throw new Error("Job is already completed.");
    if (job.status === "converting") throw new Error("Conversion already in progress.");
    if (job.source_cleanup?.status === "deleted") throw new Error("The uploaded source backup has already been deleted. Please upload it again to re-convert.");

    if (targetPharmacyBinding?.license_key) {
      job.client_id = targetPharmacyBinding.client_id;
      job.project_id = targetPharmacyBinding.project_id;
      job.license_id = targetPharmacyBinding.license_id;
      job.license_key = targetPharmacyBinding.license_key;
      job.pharmacy_name = targetPharmacyBinding.pharmacy_name;
      job.is_portable = false;
      job.package_type = "license-bound-legacy-migration";
    } else {
      job.is_portable = true;
      job.package_type = "portable-legacy-migration";
    }

    const previousOutput = job.output_backup?.object_key && !job.output_backup?.deleted_at ? { ...(job.output_backup as any) } : null;
    job.status = "converting";
    job.stage = "Extracting canonical records and reconciling stock & costs";
    job.progress = 15;
    job.error_message = undefined;
    job.mapping_version = MAPPING_VERSION;
    job.converter_version = CONVERTER_VERSION;
    job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "CONVERT_STARTED", details: `Converter ${CONVERTER_VERSION} / mapping ${MAPPING_VERSION} (${job.is_portable ? "portable" : `bound to ${job.license_key}`})` });
    await job.save();

    try {
      const localFile = await this.getLocalBackupFile(job);
      job.progress = 35;
      job.stage = "Mapping operational records, packaging, unit pricing and archive";
      await job.save();

      const out = await this.convertBackup(localFile, {
        batchId: job.id,
        sourceSha256: job.source_file_hash,
        sourceFileName: job.source_filename,
        targetLicenseKey: job.is_portable ? undefined : job.license_key,
        pharmacyName: job.is_portable ? undefined : job.pharmacy_name,
      });
      (out as any).verifiedSnapshot = undefined; // release plaintext snapshot early

      // Upload → verify object identity (size + SHA-256 + decryptability) before anything is deleted
      job.stage = "Uploading encrypted package to private Cloudflare R2 storage";
      job.progress = 85;
      await job.save();
      const outputR2Key = `migrations/${job.id}/${out.outputFilename}`;
      await uploadBufferToR2(outputR2Key, out.aivrabakBuffer, "application/octet-stream");
      const head = await checkR2Object(outputR2Key);
      if (!head || head.size !== out.aivrabakBuffer.length) throw new Error(`Uploaded package verification failed (R2 size ${head?.size ?? "missing"} ≠ ${out.aivrabakBuffer.length})`);
      const roundTrip = await downloadBufferFromR2(outputR2Key);
      const remoteSha = crypto.createHash("sha256").update(roundTrip).digest("hex");
      if (remoteSha !== out.outputSha256) throw new Error("Uploaded package SHA-256 mismatch");
      verifyEncryptedAivrabak(roundTrip, out.restoreKey);

      const enc = encryptRecoverySecret(out.restoreKey);
      job.restore_key = {
        encrypted_key: enc.encrypted_value,
        iv: enc.iv,
        tag: enc.tag,
        key_preview: `${out.restoreKey.slice(0, 12)}••••-••••-${out.restoreKey.slice(-4)}`,
        issued_at: new Date(),
      };
      job.output_backup = {
        object_key: outputR2Key,
        filename: out.outputFilename,
        size_bytes: out.aivrabakBuffer.length,
        checksum_sha256: out.outputSha256,
        format: "aivrasol-backup",
        version: 2,
        package_type: job.package_type,
        is_portable: job.is_portable,
        created_at: new Date(),
        verified_at: new Date(),
        expires_at: new Date(Date.now() + OUTPUT_RETENTION_DAYS() * 86400_000),
      };
      job.normalized_counts = out.mapping.normalizedCounts;
      job.archive_counts = out.mapping.archiveCounts as any;
      job.reconciliation = out.mapping.reconciliation;
      job.review_summary = out.mapping.review;
      job.status = "completed";
      job.stage = "Migration package generated, verified and ready for POS restore";
      job.progress = 100;
      job.completed_at = new Date();
      job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "CONVERT_COMPLETED", details: `Package ${(out.aivrabakBuffer.length / 1048576).toFixed(2)} MB, SHA-256 ${out.outputSha256.slice(0, 16)}…, archive ${out.mapping.archiveCounts.source_rows} source rows` });
      await job.save(); // persisted with output reference + final report BEFORE source deletion

      // Remove superseded package of an outdated earlier conversion
      if (previousOutput && previousOutput.object_key !== outputR2Key && isOwnedOutputKey(job, previousOutput.object_key)) {
        try {
          await deleteR2Object(previousOutput.object_key);
          job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "OUTPUT_DELETED", details: `Superseded outdated package removed: ${previousOutput.object_key}` });
        } catch {}
      }

      // Verified success → delete original upload + local temp/plaintext artifacts
      await deleteJobSource(job, actorEmail, "Verified successful conversion");
      cleanupLocalJobArtifacts(job.id);
      await job.save();
      return job;
    } catch (err: any) {
      await this.failJob(job, actorEmail, "CONVERT_FAILED", err);
      throw err;
    }
  }

  private async failJob(job: IMigrationJob, actor: string, action: string, err: any) {
    cleanupLocalJobArtifacts(job.id); // never leave plaintext/temp files behind
    job.status = "failed";
    job.stage = "Failed — source retained for retry window";
    job.error_message = String(err?.message || err).slice(0, 2000);
    job.progress = 0;
    scheduleSourceDeletion(job, FAILED_SOURCE_RETENTION_HOURS(), "Failed job retry window");
    job.audit_events.push({ timestamp: new Date(), actor, action, details: job.error_message });
    await job.save().catch(() => {});
  }

  async getDecryptedRestoreKey(jobId: string, actorEmail: string): Promise<string> {
    await connectToDatabase();
    const job = await MigrationJob.findOne({ id: jobId });
    if (!job) throw new Error("Migration job not found");
    if (!job.restore_key?.encrypted_key) throw new Error("No restore key has been issued for this job yet.");
    if (isOutdatedMigrationJob(job)) throw new Error("This package was produced by an outdated converter. Re-convert before use.");
    const plainKey = decryptRecoverySecret(job.restore_key.encrypted_key, job.restore_key.iv, job.restore_key.tag);
    job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "RESTORE_KEY_VIEWED", details: "Super Admin viewed/copied the restore key" });
    await job.save();
    return plainKey;
  }

  async cancelJob(jobId: string, actorEmail: string): Promise<IMigrationJob> {
    await connectToDatabase();
    const job = await MigrationJob.findOne({ id: jobId });
    if (!job) throw new Error("Migration job not found");
    if (job.status === "completed") throw new Error("Cannot cancel an already completed migration job.");
    job.status = "cancelled";
    job.stage = "Cancelled by Super Admin";
    job.audit_events.push({ timestamp: new Date(), actor: actorEmail, action: "JOB_CANCELLED", details: "Migration job cancelled safely" });
    cleanupLocalJobArtifacts(job.id);
    const hours = CANCELLED_SOURCE_RETENTION_HOURS();
    scheduleSourceDeletion(job, hours, "Cancelled job");
    if (hours === 0) await deleteJobSource(job, actorEmail, "Cancelled by Super Admin");
    await job.save();
    return job;
  }

  /** Manual deletion of the generated package (e.g. after successful POS restore). Metadata is kept. */
  async deleteOutputPackage(jobId: string, actorEmail: string): Promise<IMigrationJob> {
    await connectToDatabase();
    const job = await MigrationJob.findOne({ id: jobId });
    if (!job) throw new Error("Migration job not found");
    if (!job.output_backup?.object_key) throw new Error("No generated package exists for this job.");
    const ok = await deleteJobOutput(job, actorEmail, "Deleted manually by Super Admin");
    if (!ok) throw new Error("Package deletion failed; see audit log.");
    await job.save();
    return job;
  }
}

export const serverMigrationEngine = new ServerMigrationEngine();
