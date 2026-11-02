import connectToDatabase from "@/lib/db";
import {
  listAllR2Objects,
  listR2MultipartUploads,
  extractR2KeyFromUrl,
  getR2BucketName,
  R2ObjectSummary,
  R2MultipartUploadSummary,
} from "@/lib/r2";
import { cmpVer } from "@/lib/release";
import { isOutdatedMigrationJob } from "@/lib/migration/server-migration-engine";
import { getStorageConfig, StorageConfig } from "./config";
import CloudBackup from "@/models/CloudBackup";
import Release from "@/models/Release";
import MigrationJob from "@/models/MigrationJob";
import Feedback from "@/models/Feedback";
import License from "@/models/License";
import Client from "@/models/Client";
import Project from "@/models/Project";
import StorageSnapshot from "@/models/StorageSnapshot";

export type StorageCategoryId =
  | "pharmacy_cloud_backups"
  | "software_releases"
  | "migration_source_uploads"
  | "converted_migration_packages"
  | "temporary_files"
  | "multipart_uploads"
  | "unclassified_objects"
  | "other_application_files";

export type CleanupPolicyId =
  | "migration_source_files"
  | "expired_converted_packages"
  | "expired_temporary_exports"
  | "failed_upload_artifacts"
  | "abandoned_multipart_uploads"
  | "redundant_auto_backups"
  | "superseded_releases"
  | "orphans_requiring_review";

export interface InventoryObjectItem {
  key: string;
  bucket: string;
  size_bytes: number;
  last_modified?: string;
  etag?: string;
  category: StorageCategoryId;
  owner?: {
    client_id?: string;
    client_name?: string;
    project_id?: string;
    pharmacy_name?: string;
    license_id?: string;
    license_key?: string;
  };
  backup_info?: {
    id: string;
    backup_type: string;
    status: string;
    pinned?: boolean;
    uploaded_at?: string;
    rank_in_license?: number;
    verified_backups_for_license: number;
  };
  migration_job?: {
    id: string;
    job_number: string;
    status: string;
    source_software: string;
    mapping_version: string;
    pharmacy_name?: string;
    expires_at?: string;
    download_count?: number;
    last_downloaded_at?: string;
    restore_confirmed_at?: string;
    source_deleted?: boolean;
    protected?: boolean;
  };
  release_info?: {
    id: string;
    version: string;
    release_type: string;
    status: string;
    mandatory?: boolean;
    rollout_type?: string;
    published_at?: string;
    cleanup_approved?: boolean;
    protected?: boolean;
  };
  multipart_info?: {
    upload_id: string;
    initiated?: string;
  };
  db_reference: {
    collection: string | null;
    id: string | null;
    status: string | null;
    exists: boolean;
  };
  retention_class: string;
  protected: boolean;
  cleanup_eligible: boolean;
  cleanup_policy: CleanupPolicyId | null;
  cleanup_reason: string;
  requires_admin_approval: boolean;
}

export interface CategorySummary {
  id: StorageCategoryId;
  label: string;
  description: string;
  count: number;
  bytes: number;
  protected_count: number;
  protected_bytes: number;
  reclaimable_count: number;
  reclaimable_bytes: number;
  review_count: number;
  review_bytes: number;
  meta: Record<string, any>;
}

export interface DatabaseMismatchItem {
  type:
    | "migration_source_already_absent"
    | "migration_abandoned_missing_source"
    | "backup_pending_upload_stale"
    | "release_binary_missing_in_r2";
  collection: string;
  id: string;
  label: string;
  object_key?: string;
  details: string;
  can_auto_reconcile: boolean;
}

export interface StorageAlertItem {
  level: "info" | "warning" | "high" | "critical";
  code: string;
  title: string;
  message: string;
}

export interface StorageInventoryResult {
  scanned_at: string;
  duration_ms: number;
  bucket: string;
  config: StorageConfig;
  overview: {
    total_bytes: number;
    total_objects: number;
    budget_bytes: number;
    available_bytes: number;
    usage_pct: number;
    threshold_state: "normal" | "warning" | "high" | "critical";
    reclaimable_bytes: number;
    reclaimable_objects: number;
    protected_backup_bytes: number;
    protected_backup_objects: number;
    protected_pharmacies_count: number;
    protected_total_bytes: number;
    protected_total_objects: number;
    unclassified_bytes: number;
    unclassified_objects: number;
    multipart_uploads_count: number;
    db_mismatches_count: number;
  };
  categories: Record<StorageCategoryId, CategorySummary>;
  objects: InventoryObjectItem[];
  db_mismatches: DatabaseMismatchItem[];
  alerts: StorageAlertItem[];
}

export interface MockInventoryInputs {
  bucket?: string;
  config?: Partial<StorageConfig>;
  r2Objects: R2ObjectSummary[];
  multipartUploads?: R2MultipartUploadSummary[];
  backups?: any[];
  releases?: any[];
  migrationJobs?: any[];
  feedbacks?: any[];
  licenses?: any[];
  clients?: any[];
  projects?: any[];
  now?: Date;
}

const MIN_VALID_BACKUP_BYTES = 64;

function initCategoryMap(): Record<StorageCategoryId, CategorySummary> {
  return {
    pharmacy_cloud_backups: {
      id: "pharmacy_cloud_backups",
      label: "Pharmacy Cloud Backups",
      description: "Encrypted .aivrabak disaster recovery backups uploaded by active POS terminals",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { pharmacies_count: 0, verified_count: 0, pinned_count: 0, incomplete_count: 0 },
    },
    software_releases: {
      id: "software_releases",
      label: "Software Releases",
      description: "POS full portable installers (.zip) and hot update bundles (.asar)",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { current_versions: [], db_published_missing_in_r2: 0 },
    },
    migration_source_uploads: {
      id: "migration_source_uploads",
      label: "Migration Source Uploads",
      description: "Uploaded legacy database backups (.BAK / .ZIP) pending or following conversion",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { pending: 0, completed: 0, failed: 0 },
    },
    converted_migration_packages: {
      id: "converted_migration_packages",
      label: "Converted Migration Packages",
      description: "Generated encrypted .aivrabak migration packages ready for POS restore",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { active_packages: 0, superseded_or_expired: 0 },
    },
    temporary_files: {
      id: "temporary_files",
      label: "Temporary Files",
      description: "Scratch exports, temporary staging files and diagnostic artifacts",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: {},
    },
    multipart_uploads: {
      id: "multipart_uploads",
      label: "Multipart Uploads",
      description: "In-progress or abandoned multipart upload sessions consuming staging capacity",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { active_sessions: 0, stale_sessions: 0 },
    },
    unclassified_objects: {
      id: "unclassified_objects",
      label: "Unclassified Objects",
      description: "Unfamiliar object keys protected from automatic deletion pending Super Admin review",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: {},
    },
    other_application_files: {
      id: "other_application_files",
      label: "Other Application Files",
      description: "Customer feedback screenshots and portal application assets",
      count: 0,
      bytes: 0,
      protected_count: 0,
      protected_bytes: 0,
      reclaimable_count: 0,
      reclaimable_bytes: 0,
      review_count: 0,
      review_bytes: 0,
      meta: { feedback_screenshots: 0 },
    },
  };
}

/**
 * Pure classification and retention evaluation engine.
 * Can run on live R2 + MongoDB data or controlled test inputs.
 */
export function classifyStorageInventory(input: {
  bucket: string;
  config: StorageConfig;
  r2Objects: R2ObjectSummary[];
  multipartUploads: R2MultipartUploadSummary[];
  backups: any[];
  releases: any[];
  migrationJobs: any[];
  feedbacks: any[];
  licenses: any[];
  clients: any[];
  projects: any[];
  now?: Date;
  durationMs?: number;
}): StorageInventoryResult {
  const now = input.now || new Date();
  const nowMs = now.getTime();
  const { config, bucket } = input;
  const categories = initCategoryMap();

  const r2KeyMap = new Map<string, R2ObjectSummary>();
  for (const obj of input.r2Objects) {
    r2KeyMap.set(obj.key, obj);
  }

  // Build owner lookup maps
  const licenseMap = new Map<string, any>();
  for (const lic of input.licenses) licenseMap.set(lic.id, lic);
  const clientMap = new Map<string, any>();
  for (const cl of input.clients) clientMap.set(cl.id, cl);
  const projectMap = new Map<string, any>();
  for (const pr of input.projects) projectMap.set(pr.id, pr);

  const resolveOwner = (clientId?: string, licenseId?: string, projectId?: string, fallbackPharmacyName?: string) => {
    const lic = licenseId ? licenseMap.get(licenseId) : undefined;
    const cid = clientId || lic?.client_id;
    const pid = projectId || lic?.project_id;
    const cl = cid ? clientMap.get(cid) : undefined;
    const pr = pid ? projectMap.get(pid) : undefined;
    return {
      client_id: cid,
      client_name: cl?.name || cl?.company_name,
      project_id: pid,
      pharmacy_name: pr?.name || fallbackPharmacyName || cl?.name,
      license_id: licenseId,
      license_key: lic?.license_key,
    };
  };

  // 1. Index CloudBackups & compute verified recoverable backups per license
  const backupByKey = new Map<string, any>();
  for (const b of input.backups) {
    if (b.object_key) backupByKey.set(b.object_key, b);
  }

  // Group backups that ACTUALLY exist in R2 by license_id
  const r2BackupsByLicense = new Map<string, Array<{ obj: R2ObjectSummary; db?: any }>>();
  for (const obj of input.r2Objects) {
    if (!obj.key.startsWith("backups/")) continue;
    const dbRec = backupByKey.get(obj.key);
    const parts = obj.key.split("/");
    const licenseId = dbRec?.license_id || (parts.length >= 4 ? parts[2] : "unknown");
    if (!r2BackupsByLicense.has(licenseId)) r2BackupsByLicense.set(licenseId, []);
    r2BackupsByLicense.get(licenseId)!.push({ obj, db: dbRec });
  }

  // For each license, determine which backup keys are protected vs eligible
  const backupDecisionByKey = new Map<
    string,
    {
      protected: boolean;
      cleanup_eligible: boolean;
      cleanup_policy: CleanupPolicyId | null;
      retention_class: string;
      reason: string;
      rank?: number;
      verifiedCount: number;
    }
  >();

  const protectedPharmaciesSet = new Set<string>();
  const rollingWindowCutoffMs = nowMs - config.backup_rolling_window_days * 86400_000;
  const abandonedBackupCutoffMs = nowMs - config.backup_abandoned_upload_hours * 3600_000;

  for (const [licenseId, entries] of r2BackupsByLicense.entries()) {
    // Verified recoverable backups: status === "uploaded" AND size >= MIN_VALID_BACKUP_BYTES
    const verifiedUploaded = entries
      .filter((e) => e.db?.status === "uploaded" && e.obj.size >= MIN_VALID_BACKUP_BYTES)
      .sort((a, b) => {
        const ta = new Date(a.db?.uploaded_at || a.db?.created_at || a.obj.lastModified || 0).getTime();
        const tb = new Date(b.db?.uploaded_at || b.db?.created_at || b.obj.lastModified || 0).getTime();
        return tb - ta;
      });

    const verifiedCount = verifiedUploaded.length;
    const minRetained = Math.max(2, config.backup_min_verified_retained);

    // Track ranks of verified uploaded backups
    const verifiedRankMap = new Map<string, number>();
    verifiedUploaded.forEach((e, idx) => verifiedRankMap.set(e.obj.key, idx + 1));

    let additionalRollingKept = 0;

    for (const entry of entries) {
      const { obj, db } = entry;
      const rank = verifiedRankMap.get(obj.key);
      const isPinned = Boolean(db?.pinned);
      const isRestoreActive = Boolean(db?.restore_active_until && new Date(db.restore_active_until).getTime() > nowMs);
      const objTimeMs = new Date(db?.uploaded_at || db?.created_at || obj.lastModified || now).getTime();

      if (isPinned || isRestoreActive) {
        protectedPharmaciesSet.add(licenseId);
        backupDecisionByKey.set(obj.key, {
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: null,
          retention_class: "protected_pinned_backup",
          reason: isRestoreActive
            ? "Protected: referenced by an active cloud restore session"
            : `Protected: manually pinned backup${db?.pinned_reason ? ` (${db.pinned_reason})` : ""}`,
          rank,
          verifiedCount,
        });
        continue;
      }

      if (rank !== undefined && rank <= minRetained) {
        protectedPharmaciesSet.add(licenseId);
        backupDecisionByKey.set(obj.key, {
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: null,
          retention_class: rank === 1 ? "protected_latest_backup" : "protected_previous_backup",
          reason:
            rank === 1
              ? `Protected: latest verified recoverable backup (#1 of ${verifiedCount})`
              : `Protected: previous verified recoverable backup (#${rank} of ${verifiedCount})`,
          rank,
          verifiedCount,
        });
        continue;
      }

      // If this pharmacy has FEWER than 2 verified uploaded backups, NEVER delete any copy in R2!
      if (verifiedCount < 2) {
        protectedPharmaciesSet.add(licenseId);
        backupDecisionByKey.set(obj.key, {
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: null,
          retention_class: "protected_only_valid_backup",
          reason: `Protected: pharmacy has fewer than 2 verified backups (${verifiedCount} verified); all available copies are preserved`,
          rank,
          verifiedCount,
        });
        continue;
      }

      // At this point, the pharmacy has >= 2 newer verified recoverable backups in R2.
      if (rank !== undefined && rank > minRetained) {
        // It's an older verified backup beyond the top `minRetained`
        const isManual = db?.backup_type === "manual";
        if (
          !isManual &&
          additionalRollingKept < config.backup_rolling_auto_retained &&
          objTimeMs >= rollingWindowCutoffMs
        ) {
          additionalRollingKept++;
          backupDecisionByKey.set(obj.key, {
            protected: true,
            cleanup_eligible: false,
            cleanup_policy: null,
            retention_class: "retained_rolling_backup",
            reason: `Protected: rolling ${config.backup_rolling_window_days}-day automatic backup (#${additionalRollingKept} of ${config.backup_rolling_auto_retained})`,
            rank,
            verifiedCount,
          });
        } else {
          backupDecisionByKey.set(obj.key, {
            protected: false,
            cleanup_eligible: true,
            cleanup_policy: "redundant_auto_backups",
            retention_class: "redundant_auto_backup",
            reason: `Eligible: redundant backup (#${rank} of ${verifiedCount}); latest ${minRetained} verified backups are intact in R2`,
            rank,
            verifiedCount,
          });
        }
        continue;
      }

      // Otherwise, db.status is 'pending_upload', 'failed', 'deleted', or missing in DB
      if (!db) {
        backupDecisionByKey.set(obj.key, {
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: "orphans_requiring_review",
          retention_class: "unclassified_review_required",
          reason: "Unlinked backup object in R2 with no CloudBackup record; requires Super Admin review",
          verifiedCount,
        });
      } else if (db.status === "deleted") {
        backupDecisionByKey.set(obj.key, {
          protected: false,
          cleanup_eligible: true,
          cleanup_policy: "failed_upload_artifacts",
          retention_class: "deleted_in_db_orphan_in_r2",
          reason: `Eligible: marked deleted in MongoDB on ${db.deleted_at ? new Date(db.deleted_at).toISOString().slice(0, 10) : "earlier"}, and pharmacy has ${verifiedCount} verified newer backups`,
          verifiedCount,
        });
      } else {
        // pending_upload or failed
        const isStale = objTimeMs <= abandonedBackupCutoffMs;
        if (isStale) {
          backupDecisionByKey.set(obj.key, {
            protected: false,
            cleanup_eligible: true,
            cleanup_policy: "failed_upload_artifacts",
            retention_class: "abandoned_backup_upload",
            reason: `Eligible: incomplete '${db.status}' backup upload from ${new Date(objTimeMs).toISOString().slice(0, 10)} (> ${config.backup_abandoned_upload_hours}h old); pharmacy has ${verifiedCount} verified newer backups in R2`,
            verifiedCount,
          });
        } else {
          backupDecisionByKey.set(obj.key, {
            protected: true,
            cleanup_eligible: false,
            cleanup_policy: null,
            retention_class: "active_temporary_file",
            reason: `Protected: recent '${db.status}' upload session within ${config.backup_abandoned_upload_hours}h window`,
            verifiedCount,
          });
        }
      }
    }
  }

  // 2. Index Releases & determine protected vs superseded releases
  const releaseByKey = new Map<string, any>();
  const releasesWithR2 = new Set<string>();
  for (const r of input.releases) {
    const k =
      extractR2KeyFromUrl(r.storage_path) ||
      extractR2KeyFromUrl(r.asar_url) ||
      extractR2KeyFromUrl(r.full_package_url);
    if (k) {
      releaseByKey.set(k, r);
      if (r2KeyMap.has(k)) releasesWithR2.add(r.id);
    }
  }

  // Group published releases that exist in R2 by release_type ('hot' / 'full'), sorted newest version first
  const activePublishedByType = new Map<string, any[]>();
  for (const r of input.releases) {
    if (r.status !== "published" || !releasesWithR2.has(r.id)) continue;
    const rType = r.release_type || "hot";
    if (!activePublishedByType.has(rType)) activePublishedByType.set(rType, []);
    activePublishedByType.get(rType)!.push(r);
  }
  const releaseRankById = new Map<string, number>();
  for (const [rType, list] of activePublishedByType.entries()) {
    list.sort((a, b) => cmpVer(b.version, a.version));
    list.forEach((r, idx) => releaseRankById.set(r.id, idx + 1));
    if (list[0]) {
      categories.software_releases.meta.current_versions.push(`${rType}: v${list[0].version}`);
    }
  }

  // 3. Index MigrationJobs
  const jobBySourceKey = new Map<string, any>();
  const jobByOutputKey = new Map<string, any>();
  const jobById = new Map<string, any>();
  for (const j of input.migrationJobs) {
    jobById.set(j.id, j);
    if (j.source_object_key) jobBySourceKey.set(j.source_object_key, j);
    if (j.output_backup?.object_key) jobByOutputKey.set(j.output_backup.object_key, j);
  }

  // Determine the latest verified v3+ completed migration job per source_file_hash that exists in R2
  const newestCompletedOutputJobByHash = new Map<string, string>();
  const completedJobsWithR2Output = input.migrationJobs
    .filter(
      (j) =>
        j.status === "completed" &&
        !isOutdatedMigrationJob(j) &&
        j.output_backup?.object_key &&
        !j.output_backup?.deleted_at &&
        r2KeyMap.has(j.output_backup.object_key)
    )
    .sort(
      (a, b) =>
        new Date(b.completed_at || b.created_at || 0).getTime() -
        new Date(a.completed_at || a.created_at || 0).getTime()
    );

  for (const j of completedJobsWithR2Output) {
    const hashKey = j.source_file_hash || j.id;
    if (!newestCompletedOutputJobByHash.has(hashKey)) {
      newestCompletedOutputJobByHash.set(hashKey, j.id);
    }
  }

  // 4. Index Feedback screenshots
  const feedbackByKey = new Map<string, any>();
  for (const fb of input.feedbacks) {
    for (const url of fb.screenshots || []) {
      const k = extractR2KeyFromUrl(url);
      if (k) feedbackByKey.set(k, fb);
    }
  }

  // 5. Classify all R2 objects
  const objects: InventoryObjectItem[] = [];

  for (const obj of input.r2Objects) {
    const key = obj.key;
    const lastModIso = obj.lastModified ? new Date(obj.lastModified).toISOString() : undefined;
    const objAgeMs = obj.lastModified ? nowMs - new Date(obj.lastModified).getTime() : 0;

    // CATEGORY 1: Pharmacy Cloud Backups
    if (key.startsWith("backups/")) {
      const dbRec = backupByKey.get(key);
      const parts = key.split("/");
      const clientId = dbRec?.client_id || (parts.length >= 4 ? parts[1] : undefined);
      const licenseId = dbRec?.license_id || (parts.length >= 4 ? parts[2] : undefined);
      const decision = backupDecisionByKey.get(key) || {
        protected: true,
        cleanup_eligible: false,
        cleanup_policy: null,
        retention_class: "protected_only_valid_backup",
        reason: "Protected by default backup safety guard",
        verifiedCount: 1,
      };

      if (dbRec?.status === "uploaded") categories.pharmacy_cloud_backups.meta.verified_count++;
      else categories.pharmacy_cloud_backups.meta.incomplete_count++;
      if (dbRec?.pinned) categories.pharmacy_cloud_backups.meta.pinned_count++;

      objects.push({
        key,
        bucket,
        size_bytes: obj.size,
        last_modified: lastModIso,
        etag: obj.etag,
        category: "pharmacy_cloud_backups",
        owner: resolveOwner(clientId, licenseId),
        backup_info: {
          id: dbRec?.id || parts[3]?.replace(/\.aivrabak$/, "") || key,
          backup_type: dbRec?.backup_type || "unknown",
          status: dbRec?.status || "unlinked",
          pinned: Boolean(dbRec?.pinned),
          uploaded_at: dbRec?.uploaded_at ? new Date(dbRec.uploaded_at).toISOString() : undefined,
          rank_in_license: decision.rank,
          verified_backups_for_license: decision.verifiedCount,
        },
        db_reference: {
          collection: "cloudbackups",
          id: dbRec?.id || null,
          status: dbRec?.status || null,
          exists: Boolean(dbRec),
        },
        retention_class: decision.retention_class,
        protected: decision.protected,
        cleanup_eligible: decision.cleanup_eligible,
        cleanup_policy: decision.cleanup_policy,
        cleanup_reason: decision.reason,
        requires_admin_approval: !decision.cleanup_eligible && !decision.protected,
      });
      continue;
    }

    // CATEGORY 2: Software Releases
    if (key.startsWith("releases/")) {
      const rel = releaseByKey.get(key);
      if (!rel) {
        objects.push({
          key,
          bucket,
          size_bytes: obj.size,
          last_modified: lastModIso,
          etag: obj.etag,
          category: "software_releases",
          db_reference: { collection: "releases", id: null, status: null, exists: false },
          retention_class: "orphan_release_binary",
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: "orphans_requiring_review",
          cleanup_reason: "Orphan release binary in R2 with no matching Release record in MongoDB; requires Super Admin approval",
          requires_admin_approval: true,
        });
        continue;
      }

      const rank = releaseRankById.get(rel.id);
      const keepStable = Math.max(2, config.release_keep_stable_count);
      const isTargeted = rel.rollout_type === "specific" && (rel.target_client_ids?.length || 0) > 0;
      const isRecentDraft = rel.status === "draft" && objAgeMs < 7 * 86400_000;
      const isProtectedRelease =
        Boolean(rel.protected) ||
        (rank !== undefined && rank <= keepStable) ||
        isTargeted ||
        isRecentDraft;

      const approvedForCleanup = Boolean(rel.cleanup_approved || config.release_auto_cleanup_approved);

      let retentionClass = "superseded_release";
      let reason = `Superseded v${rel.version} (${rel.release_type || "hot"}): ${
        approvedForCleanup
          ? "approved for safe cleanup"
          : "requires Super Admin approval before removing superseded release binary"
      }`;
      if (rank === 1) {
        retentionClass = "protected_current_release";
        reason = `Protected: current production ${rel.release_type || "hot"} release (v${rel.version})`;
      } else if (rank !== undefined && rank <= keepStable) {
        retentionClass = "protected_previous_release";
        reason = `Protected: rollback / previous stable ${rel.release_type || "hot"} release (#${rank}, v${rel.version})`;
      } else if (isProtectedRelease) {
        retentionClass = "protected_active_release";
        reason = Boolean(rel.protected)
          ? `Protected: pinned release v${rel.version}`
          : isTargeted
            ? `Protected: targeted client release v${rel.version}`
            : `Protected: active draft release v${rel.version}`;
      }

      objects.push({
        key,
        bucket,
        size_bytes: obj.size,
        last_modified: lastModIso,
        etag: obj.etag,
        category: "software_releases",
        release_info: {
          id: rel.id,
          version: rel.version,
          release_type: rel.release_type || "hot",
          status: rel.status,
          mandatory: Boolean(rel.mandatory),
          rollout_type: rel.rollout_type,
          published_at: rel.published_at ? new Date(rel.published_at).toISOString() : undefined,
          cleanup_approved: Boolean(rel.cleanup_approved),
          protected: Boolean(rel.protected),
        },
        db_reference: {
          collection: "releases",
          id: rel.id,
          status: rel.status,
          exists: true,
        },
        retention_class: retentionClass,
        protected: isProtectedRelease || !approvedForCleanup,
        cleanup_eligible: !isProtectedRelease && approvedForCleanup,
        cleanup_policy: isProtectedRelease ? null : "superseded_releases",
        cleanup_reason: reason,
        requires_admin_approval: !isProtectedRelease && !approvedForCleanup,
      });
      continue;
    }

    // CATEGORY 3: Migration Source Uploads
    if (key.startsWith("uploads/migration-sources/")) {
      const parts = key.split("/");
      const jobIdFromPath = parts.length >= 4 ? parts[2] : undefined;
      const job = jobBySourceKey.get(key) || (jobIdFromPath ? jobById.get(jobIdFromPath) : undefined);

      if (!job) {
        const isExpiredOrphan = objAgeMs > config.migration_abandoned_upload_hours * 3600_000;
        categories.migration_source_uploads.meta.failed++;
        objects.push({
          key,
          bucket,
          size_bytes: obj.size,
          last_modified: lastModIso,
          etag: obj.etag,
          category: "migration_source_uploads",
          db_reference: { collection: "migrationjobs", id: null, status: null, exists: false },
          retention_class: isExpiredOrphan ? "expired_migration_source" : "active_migration_source",
          protected: !isExpiredOrphan,
          cleanup_eligible: isExpiredOrphan,
          cleanup_policy: isExpiredOrphan ? "migration_source_files" : null,
          cleanup_reason: isExpiredOrphan
            ? `Eligible: orphaned migration source upload with no MigrationJob record (> ${config.migration_abandoned_upload_hours}h old)`
            : "Protected: recent migration source upload within active window",
          requires_admin_approval: false,
        });
        continue;
      }

      const isRunning = ["analyzing", "converting", "validating"].includes(job.status);
      const isSourceProtected = Boolean(job.source_cleanup?.protected);
      const outputKey = job.output_backup?.object_key;
      const outputVerifiedAndPresent =
        job.status === "completed" &&
        Boolean(outputKey && (r2KeyMap.has(outputKey) || job.output_backup?.deleted_at));

      let isEligible = false;
      let retentionClass = "active_migration_source";
      let reason = `Protected: migration job ${job.job_number} is in status '${job.status}'`;

      if (isRunning) {
        categories.migration_source_uploads.meta.pending++;
        isEligible = false;
      } else if (isSourceProtected) {
        categories.migration_source_uploads.meta.failed++;
        isEligible = false;
        retentionClass = "failed_migration_source_retained";
        reason = `Protected: source upload explicitly pinned for investigation (${job.job_number})`;
      } else if (job.status === "completed") {
        categories.migration_source_uploads.meta.completed++;
        if (outputVerifiedAndPresent) {
          isEligible = true;
          retentionClass = "completed_migration_source";
          reason = `Eligible: migration ${job.job_number} completed and encrypted .aivrabak output is verified in R2`;
        } else {
          isEligible = false;
          reason = `Protected: migration ${job.job_number} marked completed but output .aivrabak is not verified in R2`;
        }
      } else if (job.status === "cancelled") {
        categories.migration_source_uploads.meta.failed++;
        isEligible = true;
        retentionClass = "expired_migration_source";
        reason = `Eligible: migration job ${job.job_number} was cancelled`;
      } else if (job.status === "failed" || job.status === "needs_review") {
        categories.migration_source_uploads.meta.failed++;
        const deleteAfterMs = job.source_cleanup?.delete_after
          ? new Date(job.source_cleanup.delete_after).getTime()
          : new Date(job.updated_at || job.created_at || now).getTime() +
            config.migration_failed_retention_hours * 3600_000;
        if (nowMs >= deleteAfterMs) {
          isEligible = true;
          retentionClass = "expired_migration_source";
          reason = `Eligible: ${job.status} migration source past ${config.migration_failed_retention_hours}h retention window (${job.job_number})`;
        } else {
          isEligible = false;
          retentionClass = "failed_migration_source_retained";
          reason = `Retained until ${new Date(deleteAfterMs).toISOString()} for retry/investigation (${job.job_number})`;
        }
      } else {
        // uploaded or ready_to_convert
        categories.migration_source_uploads.meta.pending++;
        const createdMs = new Date(job.created_at || obj.lastModified || now).getTime();
        if (nowMs - createdMs >= config.migration_abandoned_upload_hours * 3600_000) {
          isEligible = true;
          retentionClass = "expired_migration_source";
          reason = `Eligible: abandoned '${job.status}' source upload older than ${config.migration_abandoned_upload_hours}h (${job.job_number})`;
        }
      }

      objects.push({
        key,
        bucket,
        size_bytes: obj.size,
        last_modified: lastModIso,
        etag: obj.etag,
        category: "migration_source_uploads",
        owner: resolveOwner(job.client_id, job.license_id, job.project_id, job.pharmacy_name),
        migration_job: {
          id: job.id,
          job_number: job.job_number,
          status: job.status,
          source_software: job.source_software,
          mapping_version: job.mapping_version || "1.0.0",
          pharmacy_name: job.pharmacy_name,
          protected: isSourceProtected,
        },
        db_reference: {
          collection: "migrationjobs",
          id: job.id,
          status: job.status,
          exists: true,
        },
        retention_class: retentionClass,
        protected: !isEligible,
        cleanup_eligible: isEligible,
        cleanup_policy: isEligible ? "migration_source_files" : null,
        cleanup_reason: reason,
        requires_admin_approval: false,
      });
      continue;
    }

    // CATEGORY 4: Converted Migration Packages
    if (key.startsWith("migrations/")) {
      const parts = key.split("/");
      const jobIdFromPath = parts.length >= 3 ? parts[1] : undefined;
      const job = jobByOutputKey.get(key) || (jobIdFromPath ? jobById.get(jobIdFromPath) : undefined);

      if (!job) {
        const isExpiredOrphan = objAgeMs > config.migration_output_retention_days * 86400_000;
        objects.push({
          key,
          bucket,
          size_bytes: obj.size,
          last_modified: lastModIso,
          etag: obj.etag,
          category: "converted_migration_packages",
          db_reference: { collection: "migrationjobs", id: null, status: null, exists: false },
          retention_class: isExpiredOrphan ? "expired_migration_package" : "active_migration_package",
          protected: !isExpiredOrphan,
          cleanup_eligible: isExpiredOrphan,
          cleanup_policy: isExpiredOrphan ? "expired_converted_packages" : null,
          cleanup_reason: isExpiredOrphan
            ? "Eligible: orphaned migration package past retention period"
            : "Protected: unlinked migration package within retention window",
          requires_admin_approval: !isExpiredOrphan,
        });
        continue;
      }

      const out = job.output_backup || {};
      const isProtectedPkg = Boolean(out.protected);
      const isDownloadActive = Boolean(out.active_download_until && new Date(out.active_download_until).getTime() > nowMs);
      const isRestoreConfirmed = Boolean(out.restore_confirmed_at);
      const expiresAtMs = out.expires_at
        ? new Date(out.expires_at).getTime()
        : new Date(out.created_at || job.completed_at || job.created_at || now).getTime() +
          config.migration_output_retention_days * 86400_000;
      const isExpired = nowMs >= expiresAtMs;
      const isOutdated = isOutdatedMigrationJob(job);
      const hashKey = job.source_file_hash || job.id;
      const newestJobIdForHash = newestCompletedOutputJobByHash.get(hashKey);
      const isSupersededByNewerValidPkg = Boolean(newestJobIdForHash && newestJobIdForHash !== job.id);

      let isEligible = false;
      let retentionClass = "active_migration_package";
      let reason = `Protected: active converted package for ${job.job_number} (expires ${new Date(expiresAtMs).toISOString().slice(0, 10)})`;

      if (isProtectedPkg || isDownloadActive) {
        isEligible = false;
        reason = isDownloadActive
          ? `Protected: package has an active download session (${job.job_number})`
          : `Protected: package manually pinned by Super Admin (${job.job_number})`;
      } else if (isRestoreConfirmed) {
        isEligible = true;
        retentionClass = "expired_migration_package";
        reason = `Eligible: POS restore confirmed on ${new Date(out.restore_confirmed_at).toISOString().slice(0, 10)} (${job.job_number})`;
      } else if (isExpired) {
        isEligible = true;
        retentionClass = "expired_migration_package";
        reason = `Eligible: converted package retention expired on ${new Date(expiresAtMs).toISOString().slice(0, 10)} (${job.job_number})`;
      } else if (isOutdated && isSupersededByNewerValidPkg) {
        isEligible = true;
        retentionClass = "superseded_migration_package";
        reason = `Eligible: outdated v${job.mapping_version || "1.0.0"} package superseded by verified v3+ package (${job.job_number})`;
      } else if (isSupersededByNewerValidPkg) {
        isEligible = true;
        retentionClass = "superseded_migration_package";
        reason = `Eligible: duplicate conversion of same source backup superseded by newer verified job (${job.job_number})`;
      }

      if (isEligible) categories.converted_migration_packages.meta.superseded_or_expired++;
      else categories.converted_migration_packages.meta.active_packages++;

      objects.push({
        key,
        bucket,
        size_bytes: obj.size,
        last_modified: lastModIso,
        etag: obj.etag,
        category: "converted_migration_packages",
        owner: resolveOwner(job.client_id, job.license_id, job.project_id, job.pharmacy_name),
        migration_job: {
          id: job.id,
          job_number: job.job_number,
          status: job.status,
          source_software: job.source_software,
          mapping_version: job.mapping_version || "1.0.0",
          pharmacy_name: job.pharmacy_name,
          expires_at: new Date(expiresAtMs).toISOString(),
          download_count: out.download_count || 0,
          last_downloaded_at: out.last_downloaded_at ? new Date(out.last_downloaded_at).toISOString() : undefined,
          restore_confirmed_at: out.restore_confirmed_at ? new Date(out.restore_confirmed_at).toISOString() : undefined,
          source_deleted: job.source_cleanup?.status === "deleted" || !r2KeyMap.has(job.source_object_key),
          protected: isProtectedPkg,
        },
        db_reference: {
          collection: "migrationjobs",
          id: job.id,
          status: job.status,
          exists: true,
        },
        retention_class: retentionClass,
        protected: !isEligible,
        cleanup_eligible: isEligible,
        cleanup_policy: isEligible ? "expired_converted_packages" : null,
        cleanup_reason: reason,
        requires_admin_approval: false,
      });
      continue;
    }

    // CATEGORY 5: Temporary Files
    if (
      key.startsWith("tmp/") ||
      key.startsWith("temp/") ||
      key.startsWith("exports/") ||
      key.startsWith("test-storage-cleanup/")
    ) {
      const isTestObject = key.startsWith("test-storage-cleanup/");
      const isExpiredTemp = isTestObject || objAgeMs >= config.temp_retention_hours * 3600_000;
      objects.push({
        key,
        bucket,
        size_bytes: obj.size,
        last_modified: lastModIso,
        etag: obj.etag,
        category: "temporary_files",
        db_reference: { collection: null, id: null, status: null, exists: false },
        retention_class: isExpiredTemp ? "expired_temporary_file" : "active_temporary_file",
        protected: !isExpiredTemp,
        cleanup_eligible: isExpiredTemp,
        cleanup_policy: isExpiredTemp ? "expired_temporary_exports" : null,
        cleanup_reason: isTestObject
          ? "Eligible: disposable isolated storage test object"
          : isExpiredTemp
            ? `Eligible: temporary file older than ${config.temp_retention_hours}h retention window`
            : `Protected: temporary file within ${config.temp_retention_hours}h active window`,
        requires_admin_approval: false,
      });
      continue;
    }

    // CATEGORY 7 (Other Application Files): Feedback screenshots
    if (key.startsWith("feedbacks/")) {
      const fb = feedbackByKey.get(key);
      categories.other_application_files.meta.feedback_screenshots++;
      if (fb) {
        objects.push({
          key,
          bucket,
          size_bytes: obj.size,
          last_modified: lastModIso,
          etag: obj.etag,
          category: "other_application_files",
          db_reference: {
            collection: "feedbacks",
            id: String(fb._id || fb.id),
            status: fb.status,
            exists: true,
          },
          retention_class: "active_feedback_attachment",
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: null,
          cleanup_reason: `Protected: screenshot attached to customer feedback (${fb.status || "open"})`,
          requires_admin_approval: false,
        });
      } else {
        objects.push({
          key,
          bucket,
          size_bytes: obj.size,
          last_modified: lastModIso,
          etag: obj.etag,
          category: "other_application_files",
          db_reference: { collection: "feedbacks", id: null, status: null, exists: false },
          retention_class: "orphan_feedback_attachment",
          protected: true,
          cleanup_eligible: false,
          cleanup_policy: "orphans_requiring_review",
          cleanup_reason: "Unreferenced feedback attachment; protected pending Super Admin review",
          requires_admin_approval: true,
        });
      }
      continue;
    }

    // CATEGORY 8: Unclassified Objects (Never automatically deleted!)
    objects.push({
      key,
      bucket,
      size_bytes: obj.size,
      last_modified: lastModIso,
      etag: obj.etag,
      category: "unclassified_objects",
      db_reference: { collection: null, id: null, status: null, exists: false },
      retention_class: "unclassified_review_required",
      protected: true,
      cleanup_eligible: false,
      cleanup_policy: "orphans_requiring_review",
      cleanup_reason: "Unclassified object prefix; protected from automatic deletion (requires Super Admin review)",
      requires_admin_approval: true,
    });
  }

  // 6. Add Multipart Uploads (Category 6)
  for (const mp of input.multipartUploads) {
    const initMs = mp.initiated ? new Date(mp.initiated).getTime() : nowMs;
    const isStale = nowMs - initMs >= config.multipart_stale_hours * 3600_000;
    if (isStale) categories.multipart_uploads.meta.stale_sessions++;
    else categories.multipart_uploads.meta.active_sessions++;

    objects.push({
      key: mp.key,
      bucket,
      size_bytes: 0,
      last_modified: mp.initiated ? new Date(mp.initiated).toISOString() : undefined,
      category: "multipart_uploads",
      multipart_info: {
        upload_id: mp.uploadId,
        initiated: mp.initiated ? new Date(mp.initiated).toISOString() : undefined,
      },
      db_reference: { collection: null, id: mp.uploadId, status: isStale ? "stale" : "active", exists: false },
      retention_class: isStale ? "stale_multipart_upload" : "active_multipart_upload",
      protected: !isStale,
      cleanup_eligible: isStale,
      cleanup_policy: isStale ? "abandoned_multipart_uploads" : null,
      cleanup_reason: isStale
        ? `Eligible: incomplete multipart upload older than ${config.multipart_stale_hours}h`
        : `Protected: active multipart upload initiated within ${config.multipart_stale_hours}h`,
      requires_admin_approval: false,
    });
  }

  // 7. Compute category totals & overall totals
  let totalBytes = 0;
  let totalObjects = 0;
  let reclaimableBytes = 0;
  let reclaimableObjects = 0;
  let protectedBackupBytes = 0;
  let protectedBackupObjects = 0;
  let protectedTotalBytes = 0;
  let protectedTotalObjects = 0;

  for (const item of objects) {
    const cat = categories[item.category];
    cat.count++;
    cat.bytes += item.size_bytes;

    if (item.category !== "multipart_uploads") {
      totalObjects++;
      totalBytes += item.size_bytes;
    }

    if (item.cleanup_eligible) {
      cat.reclaimable_count++;
      cat.reclaimable_bytes += item.size_bytes;
      reclaimableObjects++;
      reclaimableBytes += item.size_bytes;
    } else if (item.requires_admin_approval) {
      cat.review_count++;
      cat.review_bytes += item.size_bytes;
      protectedTotalObjects++;
      protectedTotalBytes += item.size_bytes;
    } else {
      cat.protected_count++;
      cat.protected_bytes += item.size_bytes;
      protectedTotalObjects++;
      protectedTotalBytes += item.size_bytes;
      if (item.category === "pharmacy_cloud_backups") {
        protectedBackupObjects++;
        protectedBackupBytes += item.size_bytes;
      }
    }
  }

  categories.pharmacy_cloud_backups.meta.pharmacies_count = r2BackupsByLicense.size;

  // 8. Detect Database-to-R2 Mismatches
  const dbMismatches: DatabaseMismatchItem[] = [];

  for (const j of input.migrationJobs) {
    const srcExists = j.source_object_key ? r2KeyMap.has(j.source_object_key) : false;
    if (
      !srcExists &&
      j.source_cleanup?.status &&
      ["failed", "pending", "retained"].includes(j.source_cleanup.status)
    ) {
      dbMismatches.push({
        type: "migration_source_already_absent",
        collection: "migrationjobs",
        id: j.id,
        label: j.job_number,
        object_key: j.source_object_key,
        details: `Job ${j.job_number} has source_cleanup.status='${j.source_cleanup.status}', but source object is already absent from R2.`,
        can_auto_reconcile: true,
      });
    }
    if (
      !srcExists &&
      ["uploaded", "ready_to_convert"].includes(j.status) &&
      nowMs - new Date(j.created_at || now).getTime() > 2 * 3600_000
    ) {
      dbMismatches.push({
        type: "migration_abandoned_missing_source",
        collection: "migrationjobs",
        id: j.id,
        label: j.job_number,
        object_key: j.source_object_key,
        details: `Job ${j.job_number} is in status '${j.status}', but its source upload object is not present in R2.`,
        can_auto_reconcile: true,
      });
    }
  }

  for (const b of input.backups) {
    if (
      b.status === "pending_upload" &&
      !r2KeyMap.has(b.object_key) &&
      nowMs - new Date(b.created_at || now).getTime() > 2 * 3600_000
    ) {
      dbMismatches.push({
        type: "backup_pending_upload_stale",
        collection: "cloudbackups",
        id: b.id,
        label: b.original_filename || b.id,
        object_key: b.object_key,
        details: `Backup session ${b.id.slice(0, 8)} has been stuck in 'pending_upload' since ${new Date(b.created_at).toISOString().slice(0, 10)} with no object in R2.`,
        can_auto_reconcile: true,
      });
    }
  }

  for (const r of input.releases) {
    if (r.status === "published" && !releasesWithR2.has(r.id)) {
      categories.software_releases.meta.db_published_missing_in_r2++;
      dbMismatches.push({
        type: "release_binary_missing_in_r2",
        collection: "releases",
        id: r.id,
        label: `v${r.version} (${r.release_type || "hot"})`,
        object_key: extractR2KeyFromUrl(r.storage_path) || r.storage_path,
        details: `Release v${r.version} (${r.release_type || "hot"}) is marked 'published' in MongoDB, but its binary object is not present in R2.`,
        can_auto_reconcile: false,
      });
    }
  }

  // 9. Compute Budget & Threshold Alerts
  const usagePct = config.budget_bytes > 0 ? Number(((totalBytes / config.budget_bytes) * 100).toFixed(2)) : 0;
  let thresholdState: "normal" | "warning" | "high" | "critical" = "normal";
  if (usagePct >= config.critical_threshold_pct) thresholdState = "critical";
  else if (usagePct >= config.high_threshold_pct) thresholdState = "high";
  else if (usagePct >= config.warning_threshold_pct) thresholdState = "warning";

  const alerts: StorageAlertItem[] = [];
  if (thresholdState !== "normal") {
    alerts.push({
      level: thresholdState,
      code: `BUDGET_${thresholdState.toUpperCase()}`,
      title: `R2 Storage Usage ${thresholdState.toUpperCase()} (${usagePct}%)`,
      message: `Current usage is ${(totalBytes / (1024 * 1024)).toFixed(2)} MB of ${(config.budget_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB operational budget. Customer backups remain active and protected.`,
    });
  }
  if (reclaimableBytes > 0) {
    alerts.push({
      level: "info",
      code: "RECLAIMABLE_SPACE_AVAILABLE",
      title: `${(reclaimableBytes / (1024 * 1024)).toFixed(2)} MB Reclaimable (${reclaimableObjects} objects)`,
      message: `Safe cleanup can reclaim ${(reclaimableBytes / (1024 * 1024)).toFixed(2)} MB across ${reclaimableObjects} eligible object(s) without touching any protected customer backups or current releases.`,
    });
  }
  if (dbMismatches.filter((m) => m.can_auto_reconcile).length > 0) {
    const reconcilableCount = dbMismatches.filter((m) => m.can_auto_reconcile).length;
    alerts.push({
      level: "info",
      code: "DB_METADATA_RECONCILIATION",
      title: `${reconcilableCount} Stale Database Metadata Record(s) Detected`,
      message: `${reconcilableCount} database record(s) (abandoned upload sessions / already-deleted migration sources) can be automatically reconciled during safe cleanup.`,
    });
  }

  return {
    scanned_at: now.toISOString(),
    duration_ms: input.durationMs || 0,
    bucket,
    config,
    overview: {
      total_bytes: totalBytes,
      total_objects: totalObjects,
      budget_bytes: config.budget_bytes,
      available_bytes: Math.max(0, config.budget_bytes - totalBytes),
      usage_pct: usagePct,
      threshold_state: thresholdState,
      reclaimable_bytes: reclaimableBytes,
      reclaimable_objects: reclaimableObjects,
      protected_backup_bytes: protectedBackupBytes,
      protected_backup_objects: protectedBackupObjects,
      protected_pharmacies_count: protectedPharmaciesSet.size,
      protected_total_bytes: protectedTotalBytes,
      protected_total_objects: protectedTotalObjects,
      unclassified_bytes: categories.unclassified_objects.bytes,
      unclassified_objects: categories.unclassified_objects.count,
      multipart_uploads_count: input.multipartUploads.length,
      db_mismatches_count: dbMismatches.length,
    },
    categories,
    objects,
    db_mismatches: dbMismatches,
    alerts,
  };
}

/**
 * Performs a real storage inventory scan against Cloudflare R2 and MongoDB.
 */
export async function scanStorageInventory(options?: {
  saveSnapshot?: boolean;
  triggeredBy?: string;
  mockInputs?: MockInventoryInputs;
}): Promise<StorageInventoryResult> {
  const t0 = Date.now();

  if (options?.mockInputs) {
    const m = options.mockInputs;
    const config = { ...(await getStorageConfig().catch(() => ({} as any))), ...(m.config || {}) };
    return classifyStorageInventory({
      bucket: m.bucket || "mediqoo-test",
      config,
      r2Objects: m.r2Objects,
      multipartUploads: m.multipartUploads || [],
      backups: m.backups || [],
      releases: m.releases || [],
      migrationJobs: m.migrationJobs || [],
      feedbacks: m.feedbacks || [],
      licenses: m.licenses || [],
      clients: m.clients || [],
      projects: m.projects || [],
      now: m.now,
      durationMs: Date.now() - t0,
    });
  }

  await connectToDatabase();
  const [config, r2Listing, multipartUploads, backups, releases, migrationJobs, feedbacks, licenses, clients, projects] =
    await Promise.all([
      getStorageConfig(),
      listAllR2Objects(),
      listR2MultipartUploads(),
      CloudBackup.find({}).lean(),
      Release.find({}).lean(),
      MigrationJob.find({}).lean(),
      Feedback.find({}).lean(),
      License.find({}).lean(),
      Client.find({}).lean(),
      Project.find({}).lean(),
    ]);

  const durationMs = Date.now() - t0;
  const result = classifyStorageInventory({
    bucket: r2Listing.bucket || getR2BucketName(),
    config,
    r2Objects: r2Listing.objects,
    multipartUploads,
    backups,
    releases,
    migrationJobs,
    feedbacks,
    licenses,
    clients,
    projects,
    durationMs,
  });

  if (options?.saveSnapshot !== false) {
    const catSummary: Record<string, any> = {};
    for (const [k, v] of Object.entries(result.categories)) {
      catSummary[k] = {
        count: v.count,
        bytes: v.bytes,
        protected_count: v.protected_count,
        protected_bytes: v.protected_bytes,
        reclaimable_count: v.reclaimable_count,
        reclaimable_bytes: v.reclaimable_bytes,
        review_count: v.review_count,
        review_bytes: v.review_bytes,
      };
    }
    await StorageSnapshot.create({
      scanned_at: new Date(result.scanned_at),
      triggered_by: options?.triggeredBy || "manual",
      bucket: result.bucket,
      budget_bytes: result.overview.budget_bytes,
      total_bytes: result.overview.total_bytes,
      total_objects: result.overview.total_objects,
      reclaimable_bytes: result.overview.reclaimable_bytes,
      reclaimable_objects: result.overview.reclaimable_objects,
      protected_backup_bytes: result.overview.protected_backup_bytes,
      protected_backup_objects: result.overview.protected_backup_objects,
      protected_total_bytes: result.overview.protected_total_bytes,
      protected_total_objects: result.overview.protected_total_objects,
      unclassified_bytes: result.overview.unclassified_bytes,
      unclassified_objects: result.overview.unclassified_objects,
      multipart_uploads_count: result.overview.multipart_uploads_count,
      db_mismatches_count: result.overview.db_mismatches_count,
      categories: catSummary,
      alerts: result.alerts,
      duration_ms: durationMs,
    }).catch((err) => console.warn("[storage-inventory] snapshot save failed:", err?.message));
  }

  return result;
}

