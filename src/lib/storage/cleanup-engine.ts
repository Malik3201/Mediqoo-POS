import connectToDatabase from "@/lib/db";
import {
  checkR2Object,
  deleteR2Object,
  abortR2MultipartUpload,
} from "@/lib/r2";
import {
  scanStorageInventory,
  CleanupPolicyId,
  InventoryObjectItem,
  MockInventoryInputs,
} from "./inventory";
import CloudBackup from "@/models/CloudBackup";
import MigrationJob from "@/models/MigrationJob";
import Release from "@/models/Release";
import AuditLog from "@/models/AuditLog";
import StorageCleanupRun, { IStorageCleanupItem } from "@/models/StorageCleanupRun";

export const DEFAULT_SAFE_CLEANUP_POLICIES: CleanupPolicyId[] = [
  "migration_source_files",
  "expired_converted_packages",
  "expired_temporary_exports",
  "failed_upload_artifacts",
  "abandoned_multipart_uploads",
  "redundant_auto_backups",
  "superseded_releases",
];

const ALLOWED_DELETE_PREFIXES = [
  "backups/",
  "releases/",
  "uploads/migration-sources/",
  "migrations/",
  "tmp/",
  "temp/",
  "exports/",
  "test-storage-cleanup/",
];

const LOCK_TTL_MS = 10 * 60_000; // 10 minutes
const MIN_VALID_BACKUP_BYTES = 64;

export interface RunCleanupOptions {
  mode: "dry_run" | "execute";
  trigger?: "manual" | "cron_daily" | "cron_weekly" | "post_migration" | "threshold_auto";
  actor: { id: string; email: string };
  policies?: CleanupPolicyId[];
  /** Optional explicit list of object keys to restrict execution to a subset of eligible items. */
  onlyKeys?: string[];
  /** Whether to also reconcile stale DB records pointing to already-absent R2 objects (default: true). */
  reconcileDbMetadata?: boolean;
  /** Optional mock inputs + mock deleter for isolated unit testing without touching live R2/DB. */
  mockTest?: {
    inputs: MockInventoryInputs;
    onDeleteObject?: (key: string) => Promise<void> | void;
    onAbortMultipart?: (key: string, uploadId: string) => Promise<void> | void;
    checkObject?: (key: string) => Promise<{ size: number } | null>;
  };
}

export interface CleanupRunResult {
  id: string;
  mode: "dry_run" | "execute";
  trigger: string;
  actor: { id: string; email: string };
  status: "completed" | "failed";
  policies_applied: CleanupPolicyId[];
  candidates_count: number;
  reclaimable_bytes: number;
  deleted_count: number;
  deleted_bytes: number;
  failed_count: number;
  protected_excluded_count: number;
  db_reconciled_count: number;
  multipart_aborted_count: number;
  items: IStorageCleanupItem[];
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

function isSafeDeletionKey(key: string): boolean {
  if (!key || typeof key !== "string" || key.includes("..") || key.startsWith("/")) {
    return false;
  }
  return ALLOWED_DELETE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function formatOwnerLabel(item: InventoryObjectItem): string | undefined {
  if (item.owner?.pharmacy_name || item.owner?.license_key) {
    return [item.owner.pharmacy_name, item.owner.license_key].filter(Boolean).join(" · ");
  }
  if (item.migration_job) {
    return `${item.migration_job.job_number} (${item.migration_job.source_software})`;
  }
  if (item.release_info) {
    return `v${item.release_info.version} (${item.release_info.release_type})`;
  }
  return undefined;
}

export async function runStorageCleanup(options: RunCleanupOptions): Promise<CleanupRunResult> {
  const startedAt = new Date();
  const t0 = Date.now();
  const mode = options.mode;
  const trigger = options.trigger || "manual";
  const policies = options.policies?.length ? options.policies : DEFAULT_SAFE_CLEANUP_POLICIES;
  const policySet = new Set<CleanupPolicyId>(policies);
  const onlyKeySet = options.onlyKeys?.length ? new Set(options.onlyKeys) : null;
  const isMock = Boolean(options.mockTest);

  let runDoc: any = null;

  if (!isMock) {
    await connectToDatabase();

    // Prevent overlapping execute runs using durable MongoDB lock check
    if (mode === "execute") {
      const staleCutoff = new Date(Date.now() - LOCK_TTL_MS);
      await StorageCleanupRun.updateMany(
        { status: "running", started_at: { $lt: staleCutoff } },
        {
          $set: {
            status: "failed",
            completed_at: new Date(),
            error_message: "Interrupted cleanup lock expired after 10 minutes",
          },
        }
      );

      const activeRun = await StorageCleanupRun.findOne({
        mode: "execute",
        status: "running",
      }).lean();

      if (activeRun) {
        throw new Error("CLEANUP_ALREADY_RUNNING: Another storage cleanup execution is currently in progress.");
      }
    }

    runDoc = await StorageCleanupRun.create({
      mode,
      trigger,
      actor: options.actor,
      status: "running",
      policies_applied: policies,
      started_at: startedAt,
    });
  }

  try {
    // Always perform a fresh inventory scan before dry_run or execute
    const inventory = await scanStorageInventory({
      saveSnapshot: !isMock && mode === "dry_run",
      triggeredBy: `cleanup:${mode}:${trigger}`,
      mockInputs: options.mockTest?.inputs,
    });

    const eligibleItems: InventoryObjectItem[] = [];
    let protectedExcludedCount = 0;

    for (const obj of inventory.objects) {
      // Never auto-delete protected or unclassified objects
      if (obj.protected || !obj.cleanup_eligible || !obj.cleanup_policy || obj.category === "unclassified_objects") {
        protectedExcludedCount++;
        continue;
      }
      if (!policySet.has(obj.cleanup_policy)) {
        protectedExcludedCount++;
        continue;
      }
      if (onlyKeySet && !onlyKeySet.has(obj.key)) {
        continue;
      }
      eligibleItems.push(obj);
    }

    const reclaimableBytes = eligibleItems.reduce((sum, i) => sum + i.size_bytes, 0);
    const reconcilableDbMismatches =
      options.reconcileDbMetadata !== false
        ? inventory.db_mismatches.filter((m) => m.can_auto_reconcile)
        : [];

    // STAGE A: DRY RUN (Preview only, zero deletions)
    if (mode === "dry_run") {
      const items: IStorageCleanupItem[] = eligibleItems.map((item) => ({
        key: item.key,
        category: item.category,
        size_bytes: item.size_bytes,
        policy: item.cleanup_policy || "unknown",
        reason: item.cleanup_reason,
        owner_label: formatOwnerLabel(item),
        status: "eligible",
      }));

      const completedAt = new Date();
      const durationMs = Date.now() - t0;

      if (runDoc) {
        runDoc.status = "completed";
        runDoc.candidates_count = items.length;
        runDoc.reclaimable_bytes = reclaimableBytes;
        runDoc.protected_excluded_count = protectedExcludedCount;
        runDoc.db_reconciled_count = reconcilableDbMismatches.length;
        runDoc.items = items;
        runDoc.completed_at = completedAt;
        runDoc.duration_ms = durationMs;
        await runDoc.save();
      }

      return {
        id: runDoc?.id || `dryrun_${Date.now()}`,
        mode: "dry_run",
        trigger,
        actor: options.actor,
        status: "completed",
        policies_applied: policies,
        candidates_count: items.length,
        reclaimable_bytes: reclaimableBytes,
        deleted_count: 0,
        deleted_bytes: 0,
        failed_count: 0,
        protected_excluded_count: protectedExcludedCount,
        db_reconciled_count: reconcilableDbMismatches.length,
        multipart_aborted_count: 0,
        items,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: durationMs,
      };
    }

    // STAGE B: EXECUTE (Re-verify eligibility immediately before each deletion)
    const items: IStorageCleanupItem[] = [];
    let deletedCount = 0;
    let deletedBytes = 0;
    let failedCount = 0;
    let multipartAbortedCount = 0;

    const checkObjFn =
      options.mockTest?.checkObject ||
      (async (k: string) => {
        if (options.mockTest) {
          const found = options.mockTest.inputs.r2Objects.find((o) => o.key === k);
          return found ? { size: found.size } : null;
        }
        return checkR2Object(k);
      });

    const deleteObjFn =
      options.mockTest?.onDeleteObject ||
      (async (k: string) => {
        if (options.mockTest) return;
        await deleteR2Object(k);
      });

    const abortMpFn =
      options.mockTest?.onAbortMultipart ||
      (async (k: string, uid: string) => {
        if (options.mockTest) return;
        await abortR2MultipartUpload(k, uid);
      });

    for (const candidate of eligibleItems) {
      const itemRecord: IStorageCleanupItem = {
        key: candidate.key,
        category: candidate.category,
        size_bytes: candidate.size_bytes,
        policy: candidate.cleanup_policy || "unknown",
        reason: candidate.cleanup_reason,
        owner_label: formatOwnerLabel(candidate),
        status: "eligible",
      };

      try {
        // Multipart upload abort
        if (candidate.category === "multipart_uploads" && candidate.multipart_info?.upload_id) {
          await abortMpFn(candidate.key, candidate.multipart_info.upload_id);
          itemRecord.status = "deleted";
          multipartAbortedCount++;
          items.push(itemRecord);
          continue;
        }

        // Strict prefix & path-traversal validation
        if (!isSafeDeletionKey(candidate.key)) {
          itemRecord.status = "skipped_protected";
          itemRecord.error = "Refused: object key outside allowed cleanup prefixes";
          protectedExcludedCount++;
          items.push(itemRecord);
          continue;
        }

        // Pre-deletion safety re-verification for Pharmacy Cloud Backups
        if (candidate.category === "pharmacy_cloud_backups") {
          const licenseId = candidate.owner?.license_id;
          const minRequired = Math.max(2, inventory.config.backup_min_verified_retained);

          if (!licenseId) {
            itemRecord.status = "skipped_protected";
            itemRecord.error = "Refused: missing license_id on backup object";
            protectedExcludedCount++;
            items.push(itemRecord);
            continue;
          }

          // Re-verify that >= minRequired OTHER verified uploaded backups exist in R2 right now
          const allUploadedForLicense = isMock
            ? (options.mockTest!.inputs.backups || []).filter(
                (b) => b.license_id === licenseId && b.status === "uploaded" && b.object_key !== candidate.key
              )
            : await CloudBackup.find({
                license_id: licenseId,
                status: "uploaded",
                object_key: { $ne: candidate.key },
              })
                .sort({ uploaded_at: -1, created_at: -1 })
                .lean();

          let verifiedInR2Count = 0;
          for (const b of allUploadedForLicense) {
            const head = await checkObjFn(b.object_key);
            if (head && head.size >= MIN_VALID_BACKUP_BYTES) {
              verifiedInR2Count++;
              if (verifiedInR2Count >= minRequired) break;
            }
          }

          if (verifiedInR2Count < minRequired) {
            itemRecord.status = "skipped_protected";
            itemRecord.error = `Protected guard: only ${verifiedInR2Count} verified backup(s) confirmed in R2 (minimum ${minRequired} required before deleting any backup object)`;
            protectedExcludedCount++;
            items.push(itemRecord);
            continue;
          }
        }

        // Pre-deletion safety re-verification for completed Migration Source Uploads
        if (
          candidate.category === "migration_source_uploads" &&
          candidate.migration_job?.status === "completed" &&
          candidate.migration_job.id
        ) {
          const job = isMock
            ? (options.mockTest!.inputs.migrationJobs || []).find((j) => j.id === candidate.migration_job!.id)
            : await MigrationJob.findOne({ id: candidate.migration_job.id }).lean();

          const outKey = job?.output_backup?.object_key;
          const outPresent = outKey ? await checkObjFn(outKey) : null;
          if (!outPresent && !job?.output_backup?.deleted_at) {
            itemRecord.status = "skipped_protected";
            itemRecord.error = "Protected guard: converted .aivrabak output not verified in R2; retaining source";
            protectedExcludedCount++;
            items.push(itemRecord);
            continue;
          }
        }

        // Check if object still exists in R2 before deleting
        const existingHead = await checkObjFn(candidate.key);
        if (!existingHead) {
          itemRecord.status = "already_absent";
        } else {
          // Execute deletion with 1 retry for transient network errors
          try {
            await deleteObjFn(candidate.key);
          } catch (firstErr) {
            await new Promise((r) => setTimeout(r, 250));
            await deleteObjFn(candidate.key);
          }
          itemRecord.status = "deleted";
          deletedCount++;
          deletedBytes += existingHead.size || candidate.size_bytes;
        }

        // Update MongoDB metadata consistently (when not in mock mode)
        if (!isMock) {
          if (candidate.category === "pharmacy_cloud_backups" && candidate.db_reference.id) {
            await CloudBackup.updateOne(
              { id: candidate.db_reference.id },
              {
                $set: {
                  status: "deleted",
                  deleted_at: new Date(),
                  failure_reason: candidate.cleanup_reason,
                },
              }
            );
          } else if (candidate.category === "migration_source_uploads" && candidate.migration_job?.id) {
            await MigrationJob.updateOne(
              { id: candidate.migration_job.id },
              {
                $set: {
                  "source_cleanup.status": "deleted",
                  "source_cleanup.deleted_at": new Date(),
                  "source_cleanup.reason": candidate.cleanup_reason,
                  "source_cleanup.failure_reason": undefined,
                },
                $push: {
                  audit_events: {
                    timestamp: new Date(),
                    actor: options.actor.email,
                    action: "SOURCE_DELETED",
                    details: `Safe storage cleanup (${candidate.cleanup_policy}): ${candidate.key}`,
                  },
                },
              }
            );
          } else if (candidate.category === "converted_migration_packages" && candidate.migration_job?.id) {
            await MigrationJob.updateOne(
              { id: candidate.migration_job.id },
              {
                $set: {
                  "output_backup.deleted_at": new Date(),
                },
                $push: {
                  audit_events: {
                    timestamp: new Date(),
                    actor: options.actor.email,
                    action: "OUTPUT_DELETED",
                    details: `Safe storage cleanup (${candidate.cleanup_policy}): ${candidate.key}`,
                  },
                },
              }
            );
          } else if (candidate.category === "software_releases" && candidate.release_info?.id) {
            await Release.updateOne(
              { id: candidate.release_info.id },
              {
                $set: {
                  status: "archived",
                  storage_deleted_at: new Date(),
                },
              }
            );
          }
        }
      } catch (err: any) {
        itemRecord.status = "failed";
        itemRecord.error = String(err?.message || err);
        failedCount++;
      }

      items.push(itemRecord);
    }

    // Reconcile database metadata records whose R2 objects were already absent
    let dbReconciledCount = 0;
    if (!isMock && reconcilableDbMismatches.length > 0) {
      for (const mismatch of reconcilableDbMismatches) {
        try {
          if (mismatch.type === "migration_source_already_absent") {
            await MigrationJob.updateOne(
              { id: mismatch.id },
              {
                $set: {
                  "source_cleanup.status": "deleted",
                  "source_cleanup.deleted_at": new Date(),
                  "source_cleanup.failure_reason": undefined,
                  "source_cleanup.reason": "Reconciled: source object already absent in R2",
                },
              }
            );
            dbReconciledCount++;
          } else if (mismatch.type === "migration_abandoned_missing_source") {
            await MigrationJob.updateOne(
              { id: mismatch.id },
              {
                $set: {
                  status: "cancelled",
                  stage: "Expired — source upload absent or abandoned",
                  "source_cleanup.status": "deleted",
                  "source_cleanup.deleted_at": new Date(),
                  "source_cleanup.reason": "Abandoned upload session reconciled (no R2 object present)",
                },
              }
            );
            dbReconciledCount++;
          } else if (mismatch.type === "backup_pending_upload_stale") {
            await CloudBackup.updateOne(
              { id: mismatch.id, status: "pending_upload" },
              {
                $set: {
                  status: "deleted",
                  deleted_at: new Date(),
                  failure_reason: "Abandoned pending_upload session reconciled (no object uploaded to R2)",
                },
              }
            );
            dbReconciledCount++;
          }
        } catch (recErr) {
          console.warn("[storage-cleanup] metadata reconciliation error:", recErr);
        }
      }
    }

    const completedAt = new Date();
    const durationMs = Date.now() - t0;

    if (!isMock) {
      if (runDoc) {
        runDoc.status = "completed";
        runDoc.candidates_count = eligibleItems.length;
        runDoc.reclaimable_bytes = reclaimableBytes;
        runDoc.deleted_count = deletedCount;
        runDoc.deleted_bytes = deletedBytes;
        runDoc.failed_count = failedCount;
        runDoc.protected_excluded_count = protectedExcludedCount;
        runDoc.db_reconciled_count = dbReconciledCount;
        runDoc.multipart_aborted_count = multipartAbortedCount;
        runDoc.items = items;
        runDoc.completed_at = completedAt;
        runDoc.duration_ms = durationMs;
        await runDoc.save();
      }

      await AuditLog.create({
        action: "r2_storage_cleanup_executed",
        entity_type: "storage_cleanup_run",
        entity_id: runDoc?.id || "manual",
        actor_id: options.actor.id,
        metadata: {
          actor_email: options.actor.email,
          trigger,
          policies_applied: policies,
          candidates_count: eligibleItems.length,
          deleted_count: deletedCount,
          deleted_bytes: deletedBytes,
          failed_count: failedCount,
          db_reconciled_count: dbReconciledCount,
          multipart_aborted_count: multipartAbortedCount,
        },
      }).catch(() => {});

      // Capture fresh post-cleanup snapshot so dashboard shows verified post-cleanup numbers
      await scanStorageInventory({
        saveSnapshot: true,
        triggeredBy: `post_cleanup:${trigger}`,
      }).catch(() => {});
    }

    return {
      id: runDoc?.id || `exec_${Date.now()}`,
      mode: "execute",
      trigger,
      actor: options.actor,
      status: "completed",
      policies_applied: policies,
      candidates_count: eligibleItems.length,
      reclaimable_bytes: reclaimableBytes,
      deleted_count: deletedCount,
      deleted_bytes: deletedBytes,
      failed_count: failedCount,
      protected_excluded_count: protectedExcludedCount,
      db_reconciled_count: dbReconciledCount,
      multipart_aborted_count: multipartAbortedCount,
      items,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
    };
  } catch (err: any) {
    if (runDoc) {
      runDoc.status = "failed";
      runDoc.completed_at = new Date();
      runDoc.duration_ms = Date.now() - t0;
      runDoc.error_message = String(err?.message || err);
      await runDoc.save().catch(() => {});
    }
    throw err;
  }
}

