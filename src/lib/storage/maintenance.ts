import { runMigrationCleanupSweep, ensureMigrationSourceLifecycleRule } from "@/lib/migration/cleanup";
import { runStorageCleanup } from "@/lib/storage/cleanup-engine";
import { scanStorageInventory } from "@/lib/storage/inventory";
import { cleanupAllLicensesBackups } from "@/lib/cloud-backup-retention";
import StorageSnapshot from "@/models/StorageSnapshot";
import connectToDatabase from "@/lib/db";

/**
 * Centralized scheduled R2 Storage Maintenance:
 * - Daily:
 *   1. Expire failed/cancelled/abandoned migration uploads & expired packages
 *   2. Retry pending migration source deletions
 *   3. Abort stale multipart uploads & remove expired temporary exports / incomplete upload artifacts
 * - Weekly (Sundays or when ?mode=weekly or no snapshot in last 7 days):
 *   1. Full storage inventory snapshot
 *   2. Enforce redundant automatic pharmacy backup retention across all licenses
 *   3. Evaluate superseded releases & orphan objects
 */
export async function runScheduledStorageMaintenance(modeOverride?: "daily" | "weekly") {
  await connectToDatabase();

  const migrationSweep = await runMigrationCleanupSweep("system:cron-daily");

  // Determine whether weekly tasks should also run
  let runWeekly = modeOverride === "weekly" || new Date().getUTCDay() === 0;
  if (!runWeekly && !modeOverride) {
    const recentSnapshot = await StorageSnapshot.findOne({
      scanned_at: { $gte: new Date(Date.now() - 7 * 86400_000) },
    }).lean();
    if (!recentSnapshot) runWeekly = true;
  }

  let backupRetention: any = null;
  if (runWeekly) {
    backupRetention = await cleanupAllLicensesBackups().catch((e) => ({ error: String(e?.message || e) }));
  }

  const cleanupResult = await runStorageCleanup({
    mode: "execute",
    trigger: runWeekly ? "cron_weekly" : "cron_daily",
    actor: { id: "system:cron", email: "system@mediqoo.cron" },
    policies: [
      "migration_source_files",
      "expired_converted_packages",
      "expired_temporary_exports",
      "failed_upload_artifacts",
      "abandoned_multipart_uploads",
      ...(runWeekly ? (["redundant_auto_backups", "superseded_releases"] as const) : []),
    ],
    reconcileDbMetadata: true,
  });

  let lifecycle: any = "disabled";
  if (process.env.MIGRATION_R2_LIFECYCLE_ENABLED === "true") {
    lifecycle = await ensureMigrationSourceLifecycleRule().catch((e) => ({ error: String(e?.message || e) }));
  }

  const snapshot = await scanStorageInventory({
    saveSnapshot: true,
    triggeredBy: runWeekly ? "system:cron-weekly" : "system:cron-daily",
  });

  return {
    mode: runWeekly ? "weekly" : "daily",
    migrationSweep,
    backupRetention,
    cleanup: {
      id: cleanupResult.id,
      candidates_count: cleanupResult.candidates_count,
      deleted_count: cleanupResult.deleted_count,
      deleted_bytes: cleanupResult.deleted_bytes,
      db_reconciled_count: cleanupResult.db_reconciled_count,
      multipart_aborted_count: cleanupResult.multipart_aborted_count,
    },
    overview: snapshot.overview,
    lifecycle,
  };
}
