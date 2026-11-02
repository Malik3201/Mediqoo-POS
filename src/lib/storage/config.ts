import connectToDatabase from "@/lib/db";
import SystemSetting from "@/models/SystemSetting";
import AuditLog from "@/models/AuditLog";

export interface StorageConfig {
  /** Operational storage budget in bytes (default: 10 GB = 10,737,418,240 bytes). */
  budget_bytes: number;
  /** Warning threshold percentage (default: 70%). */
  warning_threshold_pct: number;
  /** High usage threshold percentage (default: 85%). */
  high_threshold_pct: number;
  /** Critical usage threshold percentage (default: 95%). */
  critical_threshold_pct: number;

  /** Minimum independently verified recoverable backups retained per pharmacy (default: 2, minimum: 2). */
  backup_min_verified_retained: number;
  /** Additional recent automatic backups retained within rolling window (default: 0 to honor existing 2-backup policy; configurable up to 3+). */
  backup_rolling_auto_retained: number;
  /** Rolling window in days for additional automatic backups (default: 7 days). */
  backup_rolling_window_days: number;
  /** Hours before an incomplete/abandoned pending_upload backup session is eligible for cleanup (default: 24h). */
  backup_abandoned_upload_hours: number;

  /** Number of stable releases retained per channel/type (default: 2 = current + previous stable). */
  release_keep_stable_count: number;
  /** Whether automatic cleanup of superseded releases is approved by Super Admin (default: false). */
  release_auto_cleanup_approved: boolean;

  /** Retention window for failed/needs-review migration source uploads in hours (default: 24h). */
  migration_failed_retention_hours: number;
  /** Retention window for abandoned migration uploads in hours (default: 24h). */
  migration_abandoned_upload_hours: number;
  /** Retention window for converted .aivrabak packages in days (default: 7 days). */
  migration_output_retention_days: number;

  /** Inactivity window before incomplete multipart uploads are aborted in hours (default: 24h). */
  multipart_stale_hours: number;
  /** Retention window for temporary export/scratch objects in hours (default: 24h). */
  temp_retention_hours: number;
}

export const TEN_GB_BYTES = 10 * 1024 * 1024 * 1024; // 10,737,418,240 bytes

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  budget_bytes: Number(process.env.R2_STORAGE_BUDGET_BYTES) || TEN_GB_BYTES,
  warning_threshold_pct: 70,
  high_threshold_pct: 85,
  critical_threshold_pct: 95,
  backup_min_verified_retained: 2,
  backup_rolling_auto_retained: 0,
  backup_rolling_window_days: 7,
  backup_abandoned_upload_hours: 24,
  release_keep_stable_count: 2,
  release_auto_cleanup_approved: false,
  migration_failed_retention_hours: Number(process.env.MIGRATION_FAILED_SOURCE_RETENTION_HOURS) || 24,
  migration_abandoned_upload_hours: Number(process.env.MIGRATION_ABANDONED_UPLOAD_HOURS) || 24,
  migration_output_retention_days: Number(process.env.MIGRATION_OUTPUT_RETENTION_DAYS) || 7,
  multipart_stale_hours: 24,
  temp_retention_hours: 24,
};

const SETTING_KEY = "r2_storage_config";

export function sanitizeStorageConfig(raw: Partial<StorageConfig> = {}): StorageConfig {
  const merged = { ...DEFAULT_STORAGE_CONFIG, ...raw };
  return {
    budget_bytes: Math.max(100 * 1024 * 1024, Number(merged.budget_bytes) || TEN_GB_BYTES),
    warning_threshold_pct: Math.min(95, Math.max(10, Number(merged.warning_threshold_pct) || 70)),
    high_threshold_pct: Math.min(98, Math.max(20, Number(merged.high_threshold_pct) || 85)),
    critical_threshold_pct: Math.min(100, Math.max(50, Number(merged.critical_threshold_pct) || 95)),
    // Never allow reducing below 2 verified backups per pharmacy
    backup_min_verified_retained: Math.max(2, Math.min(10, Math.floor(Number(merged.backup_min_verified_retained) || 2))),
    backup_rolling_auto_retained: Math.max(0, Math.min(10, Math.floor(Number(merged.backup_rolling_auto_retained) ?? 0))),
    backup_rolling_window_days: Math.max(1, Math.min(30, Math.floor(Number(merged.backup_rolling_window_days) || 7))),
    backup_abandoned_upload_hours: Math.max(2, Math.min(168, Number(merged.backup_abandoned_upload_hours) || 24)),
    release_keep_stable_count: Math.max(2, Math.min(10, Math.floor(Number(merged.release_keep_stable_count) || 2))),
    release_auto_cleanup_approved: Boolean(merged.release_auto_cleanup_approved),
    migration_failed_retention_hours: Math.max(1, Math.min(168, Number(merged.migration_failed_retention_hours) || 24)),
    migration_abandoned_upload_hours: Math.max(1, Math.min(168, Number(merged.migration_abandoned_upload_hours) || 24)),
    migration_output_retention_days: Math.max(1, Math.min(90, Number(merged.migration_output_retention_days) || 7)),
    multipart_stale_hours: Math.max(1, Math.min(168, Number(merged.multipart_stale_hours) || 24)),
    temp_retention_hours: Math.max(1, Math.min(168, Number(merged.temp_retention_hours) || 24)),
  };
}

export async function getStorageConfig(): Promise<StorageConfig> {
  try {
    await connectToDatabase();
    const doc = await SystemSetting.findOne({ key: SETTING_KEY }).lean();
    if (!doc?.value) return { ...DEFAULT_STORAGE_CONFIG };
    const parsed = JSON.parse(doc.value);
    return sanitizeStorageConfig(parsed);
  } catch {
    return { ...DEFAULT_STORAGE_CONFIG };
  }
}

export async function updateStorageConfig(
  patch: Partial<StorageConfig>,
  actor: { id: string; email: string }
): Promise<StorageConfig> {
  await connectToDatabase();
  const current = await getStorageConfig();
  const updated = sanitizeStorageConfig({ ...current, ...patch });

  await SystemSetting.findOneAndUpdate(
    { key: SETTING_KEY },
    { $set: { value: JSON.stringify(updated) } },
    { upsert: true, new: true }
  );

  await AuditLog.create({
    action: "storage_config_updated",
    entity_type: "system_setting",
    entity_id: SETTING_KEY,
    actor_id: actor.id,
    metadata: {
      actor_email: actor.email,
      previous: current,
      updated,
    },
  }).catch(() => {});

  return updated;
}

