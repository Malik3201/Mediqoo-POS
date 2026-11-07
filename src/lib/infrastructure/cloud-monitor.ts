import crypto from "crypto";
import mongoose from "mongoose";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import connectToDatabase from "@/lib/db";
import { getR2Client, getR2BucketName, listAllR2Objects } from "@/lib/r2";
import { scanStorageInventory, StorageCategoryId } from "@/lib/storage/inventory";
import SystemSetting from "@/models/SystemSetting";
import StorageSnapshot from "@/models/StorageSnapshot";
import AuditLog from "@/models/AuditLog";
import AiUsageLog from "@/models/AiUsageLog";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import BillingUsage from "@/models/BillingUsage";

export type ProviderStatusState =
  | "healthy"
  | "approaching_limit"
  | "warning"
  | "critical"
  | "configuration_required"
  | "partial_configuration"
  | "provider_unavailable"
  | "estimate_only";

export type MetricOrigin =
  | "provider_api"
  | "database_stats"
  | "internal_telemetry"
  | "configured_quota"
  | "estimated"
  | "unavailable";

export interface CloudMonitorConfig {
  /** Threshold percentages (applied only when a valid mathematical denominator exists) */
  info_threshold_pct: number;     // default 70%
  warning_threshold_pct: number;  // default 85%
  critical_threshold_pct: number; // default 95%

  /** Cloudflare R2 Plan & Allowances */
  r2_plan_type: "free_standard" | "paid_payg";
  r2_free_storage_bytes: number;       // default 10 GB (10 * 1024^3 = 10,737,418,240 bytes)
  r2_free_class_a_ops_monthly: number; // default 1,000,000
  r2_free_class_b_ops_monthly: number; // default 10,000,000

  /** MongoDB Atlas Plan & Allowances */
  mongodb_cluster_tier: "M0_FREE" | "M2_SHARED" | "M5_SHARED" | "M10_DEDICATED" | "CUSTOM_PAID";
  mongodb_storage_limit_bytes: number | null; // 512 MB for M0, 2 GB for M2, 5 GB for M5, or custom/null
}

export const TEN_GB_BYTES = 10 * 1024 * 1024 * 1024;
export const M0_512MB_BYTES = 512 * 1024 * 1024;

export const DEFAULT_CLOUD_MONITOR_CONFIG: CloudMonitorConfig = {
  info_threshold_pct: 70,
  warning_threshold_pct: 85,
  critical_threshold_pct: 95,
  r2_plan_type: "free_standard",
  r2_free_storage_bytes: Number(process.env.R2_STORAGE_BUDGET_BYTES) || TEN_GB_BYTES,
  r2_free_class_a_ops_monthly: 1_000_000,
  r2_free_class_b_ops_monthly: 10_000_000,
  mongodb_cluster_tier: "M0_FREE",
  mongodb_storage_limit_bytes: M0_512MB_BYTES,
};

const MONITOR_CONFIG_KEY = "cloud_resource_monitor_config_v1";
const MONITOR_HISTORY_KEY = "cloud_resource_monitor_history_v1";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes server-side cache
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000; // 60 seconds minimum interval between forced refreshes

let cachedReport: {
  capturedAtMs: number;
  lastForcedAtMs: number;
  data: CloudResourceMonitorReport;
} | null = null;

export function sanitizeCloudMonitorConfig(
  raw: Partial<CloudMonitorConfig> = {}
): CloudMonitorConfig {
  const merged = { ...DEFAULT_CLOUD_MONITOR_CONFIG, ...raw };
  const tier = merged.mongodb_cluster_tier || "M0_FREE";
  let defaultMongoLimit: number | null = M0_512MB_BYTES;
  if (tier === "M2_SHARED") defaultMongoLimit = 2 * 1024 * 1024 * 1024;
  else if (tier === "M5_SHARED") defaultMongoLimit = 5 * 1024 * 1024 * 1024;
  else if (tier === "M10_DEDICATED") defaultMongoLimit = 10 * 1024 * 1024 * 1024;
  else if (tier === "CUSTOM_PAID" && raw.mongodb_storage_limit_bytes === null) {
    defaultMongoLimit = null;
  }

  return {
    info_threshold_pct: Math.min(90, Math.max(10, Number(merged.info_threshold_pct) || 70)),
    warning_threshold_pct: Math.min(97, Math.max(20, Number(merged.warning_threshold_pct) || 85)),
    critical_threshold_pct: Math.min(100, Math.max(50, Number(merged.critical_threshold_pct) || 95)),
    r2_plan_type: merged.r2_plan_type === "paid_payg" ? "paid_payg" : "free_standard",
    r2_free_storage_bytes: Math.max(
      100 * 1024 * 1024,
      Number(merged.r2_free_storage_bytes) || TEN_GB_BYTES
    ),
    r2_free_class_a_ops_monthly: Math.max(
      1000,
      Number(merged.r2_free_class_a_ops_monthly) || 1_000_000
    ),
    r2_free_class_b_ops_monthly: Math.max(
      1000,
      Number(merged.r2_free_class_b_ops_monthly) || 10_000_000
    ),
    mongodb_cluster_tier: tier,
    mongodb_storage_limit_bytes:
      merged.mongodb_storage_limit_bytes === null
        ? null
        : Math.max(
            64 * 1024 * 1024,
            Number(merged.mongodb_storage_limit_bytes) || defaultMongoLimit || M0_512MB_BYTES
          ),
  };
}

export async function getCloudMonitorConfig(): Promise<CloudMonitorConfig> {
  try {
    await connectToDatabase();
    const doc = await SystemSetting.findOne({ key: MONITOR_CONFIG_KEY }).lean();
    if (!doc?.value) return { ...DEFAULT_CLOUD_MONITOR_CONFIG };
    return sanitizeCloudMonitorConfig(JSON.parse(doc.value));
  } catch {
    return { ...DEFAULT_CLOUD_MONITOR_CONFIG };
  }
}

export async function updateCloudMonitorConfig(
  patch: Partial<CloudMonitorConfig>,
  actor: { id: string; email: string }
): Promise<CloudMonitorConfig> {
  await connectToDatabase();
  const current = await getCloudMonitorConfig();
  const updated = sanitizeCloudMonitorConfig({ ...current, ...patch });

  await SystemSetting.findOneAndUpdate(
    { key: MONITOR_CONFIG_KEY },
    { $set: { value: JSON.stringify(updated) } },
    { upsert: true, new: true }
  );

  await AuditLog.create({
    action: "cloud_monitor_config_updated",
    entity_type: "system_setting",
    entity_id: MONITOR_CONFIG_KEY,
    actor_id: actor.id,
    metadata: {
      actor_email: actor.email,
      previous: current,
      updated,
    },
  }).catch(() => {});

  // Invalidate cached report so updated thresholds/quotas apply immediately
  cachedReport = null;
  return updated;
}

function evaluateStatusFromPct(
  pct: number | null,
  config: CloudMonitorConfig
): ProviderStatusState {
  if (pct === null || !Number.isFinite(pct)) return "healthy";
  if (pct >= config.critical_threshold_pct) return "critical";
  if (pct >= config.warning_threshold_pct) return "warning";
  if (pct >= config.info_threshold_pct) return "approaching_limit";
  return "healthy";
}

function getCurrentUtcBillingPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const daysInMonth = end.getUTCDate();
  const dayOfMonth = now.getUTCDate();
  return {
    start_iso: start.toISOString(),
    end_iso: end.toISOString(),
    label: start.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    elapsed_ratio: Math.min(1, Math.max(0.03, dayOfMonth / daysInMonth)),
  };
}

// ============================================================================
// 1. CLOUDFLARE R2 MONITORING
// ============================================================================

const R2_CLASS_A_ACTIONS = new Set([
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "UploadPart",
  "UploadPartCopy",
  "ListBuckets",
  "ListObjects",
  "ListObjectsV2",
  "ListMultipartUploads",
  "ListParts",
  "PutBucket",
  "PutBucketCors",
  "PutBucketEncryption",
  "PutBucketLifecycleConfiguration",
]);

const R2_CLASS_B_ACTIONS = new Set([
  "GetObject",
  "HeadObject",
  "HeadBucket",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketEncryption",
  "GetBucketLifecycleConfiguration",
]);

function extractCloudflareAccountId(): string | null {
  if (process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    return process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  }
  const endpoint = process.env.R2_ENDPOINT?.trim() || "";
  const m = endpoint.match(/^https?:\/\/([a-f0-9]{32})\.(?:[a-z0-9-]+\.)?r2\.cloudflarestorage\.com/i);
  return m ? m[1] : null;
}

async function fetchCloudflareR2GraphqlAnalytics(accountId: string, apiToken: string) {
  const period = getCurrentUtcBillingPeriod();
  const query = `
    query R2AccountMetrics($accountTag: string!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 500
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            sum {
              requests
            }
            dimensions {
              actionType
              bucketName
              storageClass
            }
          }
          r2StorageAdaptiveGroups(
            limit: 100
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_DESC]
          ) {
            max {
              payloadSize
              metadataSize
              objectCount
            }
            dimensions {
              bucketName
              storageClass
              datetime
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        start: period.start_iso,
        end: new Date().toISOString(),
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Cloudflare GraphQL API returned HTTP ${res.status}`);
  }
  const json: any = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Cloudflare GraphQL query error");
  }

  const acct = json?.data?.viewer?.accounts?.[0];
  const opsGroups: any[] = acct?.r2OperationsAdaptiveGroups || [];
  const storageGroups: any[] = acct?.r2StorageAdaptiveGroups || [];

  let classA = 0;
  let classB = 0;
  const opsByBucket: Record<string, { classA: number; classB: number }> = {};

  for (const g of opsGroups) {
    const reqs = Number(g?.sum?.requests || 0);
    const action = String(g?.dimensions?.actionType || "");
    const bName = String(g?.dimensions?.bucketName || "account");
    if (!opsByBucket[bName]) opsByBucket[bName] = { classA: 0, classB: 0 };

    if (R2_CLASS_A_ACTIONS.has(action)) {
      classA += reqs;
      opsByBucket[bName].classA += reqs;
    } else if (R2_CLASS_B_ACTIONS.has(action)) {
      classB += reqs;
      opsByBucket[bName].classB += reqs;
    }
  }

  const metadataByBucket: Record<string, number> = {};
  for (const sg of storageGroups) {
    const bName = String(sg?.dimensions?.bucketName || "");
    if (bName && metadataByBucket[bName] === undefined) {
      metadataByBucket[bName] = Number(sg?.max?.metadataSize || 0);
    }
  }

  return {
    available: true,
    class_a_ops: classA,
    class_b_ops: classB,
    ops_by_bucket: opsByBucket,
    metadata_by_bucket: metadataByBucket,
  };
}

export async function collectCloudflareR2Metrics(config: CloudMonitorConfig) {
  const period = getCurrentUtcBillingPeriod();
  const hasS3Creds = Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
  const accountId = extractCloudflareAccountId();
  const cfApiToken = (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();

  if (!hasS3Creds) {
    return {
      provider: "cloudflare_r2" as const,
      status: "configuration_required" as ProviderStatusState,
      configured: false,
      missing_env: ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
      optional_missing_env: cfApiToken ? [] : ["CLOUDFLARE_API_TOKEN"],
      captured_at: new Date().toISOString(),
      billing_period: period,
      error: "Cloudflare R2 S3 credentials are not configured.",
    };
  }

  try {
    const s3 = getR2Client();
    const primaryBucket = getR2BucketName();

    // 1. Discover all buckets in the R2 account
    let bucketList: Array<{ name: string; created_at?: string }> = [];
    try {
      const bRes = await s3.send(new ListBucketsCommand({}));
      bucketList = (bRes.Buckets || [])
        .filter((b) => Boolean(b.Name))
        .map((b) => ({
          name: b.Name!,
          created_at: b.CreationDate ? b.CreationDate.toISOString() : undefined,
        }));
    } catch {
      bucketList = [{ name: primaryBucket }];
    }
    if (!bucketList.some((b) => b.name === primaryBucket)) {
      bucketList.push({ name: primaryBucket });
    }

    // 2. Scan primary bucket via existing inventory engine + inspect other buckets via ListObjectsV2
    const [primaryInventory, graphqlData] = await Promise.all([
      scanStorageInventory({ saveSnapshot: false, triggeredBy: "cloud-monitor" }),
      accountId && cfApiToken
        ? fetchCloudflareR2GraphqlAnalytics(accountId, cfApiToken).catch((e) => ({
            available: false as const,
            error: String(e?.message || e),
          }))
        : Promise.resolve({
            available: false as const,
            reason: "CLOUDFLARE_API_TOKEN not configured for GraphQL Analytics API",
          }),
    ]);

    const bucketsSummary: Array<{
      name: string;
      is_primary_pos_bucket: boolean;
      created_at?: string;
      object_count: number;
      storage_bytes: number;
      standard_bytes: number;
      infrequent_access_bytes: number;
      metadata_bytes: number | null;
      class_a_ops: number | null;
      class_b_ops: number | null;
      last_modified?: string;
      purpose: string;
    }> = [];

    let accountTotalBytes = 0;
    let accountStandardBytes = 0;
    let accountIaBytes = 0;
    let accountTotalObjects = 0;

    // Primary bucket stats from primaryInventory
    let primaryStandardBytes = 0;
    let primaryIaBytes = 0;
    let primaryLatestMod = "";
    for (const obj of primaryInventory.objects) {
      primaryStandardBytes += obj.size_bytes;
      if (obj.last_modified && obj.last_modified > primaryLatestMod) {
        primaryLatestMod = obj.last_modified;
      }
    }

    for (const b of bucketList) {
      if (b.name === primaryBucket) {
        const bytes = primaryInventory.overview.total_bytes;
        const count = primaryInventory.overview.total_objects;
        accountTotalBytes += bytes;
        accountStandardBytes += primaryStandardBytes;
        accountIaBytes += primaryIaBytes;
        accountTotalObjects += count;

        bucketsSummary.push({
          name: b.name,
          is_primary_pos_bucket: true,
          created_at: b.created_at,
          object_count: count,
          storage_bytes: bytes,
          standard_bytes: primaryStandardBytes,
          infrequent_access_bytes: primaryIaBytes,
          metadata_bytes:
            graphqlData.available ? (graphqlData.metadata_by_bucket[b.name] ?? 0) : null,
          class_a_ops:
            graphqlData.available ? (graphqlData.ops_by_bucket[b.name]?.classA ?? 0) : null,
          class_b_ops:
            graphqlData.available ? (graphqlData.ops_by_bucket[b.name]?.classB ?? 0) : null,
          last_modified: primaryLatestMod || undefined,
          purpose: "AivraSol Pharmacy POS Cloud Backups, Releases, Migrations & Feedbacks",
        });
      } else {
        // Other bucket in same Cloudflare account
        try {
          const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
          const listRes = await s3.send(
            new ListObjectsV2Command({ Bucket: b.name, MaxKeys: 1000 })
          );
          const objs = listRes.Contents || [];
          let bBytes = 0;
          let bStd = 0;
          let bIa = 0;
          let latest = "";
          for (const o of objs) {
            const sz = o.Size || 0;
            bBytes += sz;
            if (o.StorageClass === "STANDARD_IA") bIa += sz;
            else bStd += sz;
            const iso = o.LastModified ? o.LastModified.toISOString() : "";
            if (iso > latest) latest = iso;
          }
          accountTotalBytes += bBytes;
          accountStandardBytes += bStd;
          accountIaBytes += bIa;
          accountTotalObjects += objs.length;

          bucketsSummary.push({
            name: b.name,
            is_primary_pos_bucket: false,
            created_at: b.created_at,
            object_count: objs.length,
            storage_bytes: bBytes,
            standard_bytes: bStd,
            infrequent_access_bytes: bIa,
            metadata_bytes:
              graphqlData.available ? (graphqlData.metadata_by_bucket[b.name] ?? 0) : null,
            class_a_ops:
              graphqlData.available ? (graphqlData.ops_by_bucket[b.name]?.classA ?? 0) : null,
            class_b_ops:
              graphqlData.available ? (graphqlData.ops_by_bucket[b.name]?.classB ?? 0) : null,
            last_modified: latest || undefined,
            purpose: "Shared Cloudflare Account Bucket (Non-POS Project)",
          });
        } catch {
          bucketsSummary.push({
            name: b.name,
            is_primary_pos_bucket: false,
            created_at: b.created_at,
            object_count: 0,
            storage_bytes: 0,
            standard_bytes: 0,
            infrequent_access_bytes: 0,
            metadata_bytes: null,
            class_a_ops: null,
            class_b_ops: null,
            purpose: "Shared Cloudflare Account Bucket",
          });
        }
      }
    }

    // 3. Per-Pharmacy Tenant Attribution vs Shared Global Infrastructure
    const pharmacyMap = new Map<
      string,
      {
        tenant_key: string;
        pharmacy_name: string;
        client_name: string;
        license_key: string;
        backup_objects: number;
        backup_bytes: number;
        migration_objects: number;
        migration_bytes: number;
        total_objects: number;
        total_bytes: number;
        protected_bytes: number;
        reclaimable_bytes: number;
        latest_activity_at?: string;
        attribution_source: "verified_db_record" | "object_key_prefix";
      }
    >();

    let tenantOwnedBytes = 0;
    let sharedGlobalBytes = 0;

    for (const item of primaryInventory.objects) {
      const isTenantCategory =
        item.category === "pharmacy_cloud_backups" ||
        item.category === "migration_source_uploads" ||
        item.category === "converted_migration_packages";

      if (isTenantCategory && (item.owner?.license_key || item.owner?.pharmacy_name || item.owner?.client_id)) {
        tenantOwnedBytes += item.size_bytes;
        const tenantKey =
          item.owner.license_id ||
          item.owner.license_key ||
          item.owner.client_id ||
          item.owner.pharmacy_name ||
          "unknown";
        const existing = pharmacyMap.get(tenantKey) || {
          tenant_key: tenantKey,
          pharmacy_name: item.owner.pharmacy_name || item.owner.client_name || "Attributed Pharmacy",
          client_name: item.owner.client_name || "—",
          license_key: item.owner.license_key || "—",
          backup_objects: 0,
          backup_bytes: 0,
          migration_objects: 0,
          migration_bytes: 0,
          total_objects: 0,
          total_bytes: 0,
          protected_bytes: 0,
          reclaimable_bytes: 0,
          latest_activity_at: undefined,
          attribution_source: item.db_reference.exists ? "verified_db_record" : "object_key_prefix",
        };

        if (item.category === "pharmacy_cloud_backups") {
          existing.backup_objects += 1;
          existing.backup_bytes += item.size_bytes;
        } else {
          existing.migration_objects += 1;
          existing.migration_bytes += item.size_bytes;
        }
        existing.total_objects += 1;
        existing.total_bytes += item.size_bytes;
        if (item.protected) existing.protected_bytes += item.size_bytes;
        if (item.cleanup_eligible) existing.reclaimable_bytes += item.size_bytes;
        if (
          item.last_modified &&
          (!existing.latest_activity_at || item.last_modified > existing.latest_activity_at)
        ) {
          existing.latest_activity_at = item.last_modified;
        }
        pharmacyMap.set(tenantKey, existing);
      } else {
        sharedGlobalBytes += item.size_bytes;
      }
    }

    // Add non-primary bucket bytes to shared/other infrastructure
    const otherBucketsBytes = Math.max(0, accountTotalBytes - primaryInventory.overview.total_bytes);
    sharedGlobalBytes += otherBucketsBytes;

    const tenantBreakdown = Array.from(pharmacyMap.values()).sort(
      (a, b) => b.total_bytes - a.total_bytes
    );

    // 4. Quota & Headroom Math (Standard storage vs 10 GB-month free tier)
    const freeAllowanceBytes = config.r2_free_storage_bytes;
    const usagePct =
      freeAllowanceBytes > 0
        ? Number(((accountStandardBytes / freeAllowanceBytes) * 100).toFixed(2))
        : null;
    const remainingHeadroomBytes =
      freeAllowanceBytes > 0 ? Math.max(0, freeAllowanceBytes - accountStandardBytes) : null;

    const status = evaluateStatusFromPct(usagePct, config);

    return {
      provider: "cloudflare_r2" as const,
      status,
      configured: true,
      account_id: accountId,
      plan_type: config.r2_plan_type,
      captured_at: new Date().toISOString(),
      billing_period: period,
      missing_env: [] as string[],
      optional_missing_env: cfApiToken ? ([] as string[]) : ["CLOUDFLARE_API_TOKEN"],
      metrics: {
        current_snapshot_bytes: accountTotalBytes,
        standard_storage_bytes: accountStandardBytes,
        infrequent_access_bytes: accountIaBytes,
        free_allowance_bytes: freeAllowanceBytes,
        remaining_headroom_bytes: remainingHeadroomBytes,
        usage_pct: usagePct,
        bucket_count: bucketsSummary.length,
        total_object_count: accountTotalObjects,
        reclaimable_bytes: primaryInventory.overview.reclaimable_bytes,
        reclaimable_objects: primaryInventory.overview.reclaimable_objects,
        protected_bytes: primaryInventory.overview.protected_total_bytes,
        tenant_owned_bytes: tenantOwnedBytes,
        shared_infrastructure_bytes: sharedGlobalBytes,
        class_a_ops: {
          used: graphqlData.available ? graphqlData.class_a_ops : null,
          free_allowance: config.r2_free_class_a_ops_monthly,
          remaining:
            graphqlData.available
              ? Math.max(0, config.r2_free_class_a_ops_monthly - graphqlData.class_a_ops)
              : null,
          usage_pct:
            graphqlData.available
              ? Number(
                  ((graphqlData.class_a_ops / config.r2_free_class_a_ops_monthly) * 100).toFixed(2)
                )
              : null,
          origin: (graphqlData.available ? "provider_api" : "unavailable") as MetricOrigin,
          note: graphqlData.available
            ? "Retrieved from Cloudflare GraphQL r2OperationsAdaptiveGroups for current UTC month."
            : "Requires CLOUDFLARE_API_TOKEN with Account Analytics Read permission. S3 API keys do not expose operation counters.",
        },
        class_b_ops: {
          used: graphqlData.available ? graphqlData.class_b_ops : null,
          free_allowance: config.r2_free_class_b_ops_monthly,
          remaining:
            graphqlData.available
              ? Math.max(0, config.r2_free_class_b_ops_monthly - graphqlData.class_b_ops)
              : null,
          usage_pct:
            graphqlData.available
              ? Number(
                  ((graphqlData.class_b_ops / config.r2_free_class_b_ops_monthly) * 100).toFixed(2)
                )
              : null,
          origin: (graphqlData.available ? "provider_api" : "unavailable") as MetricOrigin,
          note: graphqlData.available
            ? "Retrieved from Cloudflare GraphQL r2OperationsAdaptiveGroups for current UTC month."
            : "Requires CLOUDFLARE_API_TOKEN with Account Analytics Read permission.",
        },
        billing_note:
          "Cloudflare R2 bills storage in GB-month (average daily peak bytes over the UTC billing month). Current stored bytes represent a live S3 snapshot; remaining headroom against the 10 GB-month Standard free allowance is an approximate capacity indicator assuming steady storage.",
      },
      buckets: bucketsSummary,
      categories: Object.values(primaryInventory.categories).sort((a, b) => b.bytes - a.bytes),
      tenants: tenantBreakdown,
    };
  } catch (err: any) {
    return {
      provider: "cloudflare_r2" as const,
      status: "provider_unavailable" as ProviderStatusState,
      configured: true,
      captured_at: new Date().toISOString(),
      billing_period: period,
      missing_env: [] as string[],
      optional_missing_env: cfApiToken ? ([] as string[]) : ["CLOUDFLARE_API_TOKEN"],
      error: String(err?.message || "Failed to query Cloudflare R2"),
    };
  }
}

// ============================================================================
// 2. MONGODB ATLAS STORAGE MONITORING
// ============================================================================

const COLLECTION_FEATURE_MAP: Record<
  string,
  { group: string; purpose: string; tenant_scoped: boolean }
> = {
  analyticsevents: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Real-time POS sales, returns, expenses & stock sync events",
    tenant_scoped: true,
  },
  ownerportalstates: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Hydrated pharmacy Owner Portal dashboard state snapshots",
    tenant_scoped: true,
  },
  owneractionstates: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Owner Portal remote action queue & execution status",
    tenant_scoped: true,
  },
  ownercustomermetas: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Owner Portal customer Khata metadata",
    tenant_scoped: true,
  },
  analyticsbootstraps: {
    group: "Owner Portal & POS Telemetry",
    purpose: "One-time POS historical analytics bootstrap trackers",
    tenant_scoped: true,
  },
  historicaldailyanalytics: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Aggregated daily sales, profit & cash summaries per pharmacy",
    tenant_scoped: true,
  },
  historicalrecentsales: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Recent sale summaries synced for mobile/web Owner Portal",
    tenant_scoped: true,
  },
  historicaltopproducts: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Top selling medicines rankings per pharmacy",
    tenant_scoped: true,
  },
  inventorysnapshots: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Synced pharmacy inventory & batch expiry snapshots",
    tenant_scoped: true,
  },
  cloudexpenses: {
    group: "Owner Portal & POS Telemetry",
    purpose: "Pharmacy operating expenses logged via Owner Portal",
    tenant_scoped: true,
  },
  projects: {
    group: "Pharmacies & Licensing",
    purpose: "Pharmacy workspace projects & configuration profiles",
    tenant_scoped: true,
  },
  clients: {
    group: "Pharmacies & Licensing",
    purpose: "Pharmacy customer accounts, contacts & geo-locations",
    tenant_scoped: true,
  },
  licenses: {
    group: "Pharmacies & Licensing",
    purpose: "Issued software licenses, plans, expiry & seat limits",
    tenant_scoped: true,
  },
  licenseseats: {
    group: "Pharmacies & Licensing",
    purpose: "Activated POS terminal hardware seats & heartbeats",
    tenant_scoped: true,
  },
  licensecounters: {
    group: "Pharmacies & Licensing",
    purpose: "Sequential terminal & invoice numbering counters",
    tenant_scoped: true,
  },
  packages: {
    group: "Pharmacies & Licensing",
    purpose: "Generated .aivra activation packages",
    tenant_scoped: true,
  },
  businesstemplates: {
    group: "Pharmacies & Licensing",
    purpose: "Global business type templates",
    tenant_scoped: false,
  },
  clienttemplates: {
    group: "Pharmacies & Licensing",
    purpose: "Client-specific receipt & POS templates",
    tenant_scoped: true,
  },
  cloudbackups: {
    group: "Backups, Releases & Migration",
    purpose: "Encrypted R2 cloud backup catalog & verification metadata",
    tenant_scoped: true,
  },
  releases: {
    group: "Backups, Releases & Migration",
    purpose: "Published POS software releases & hot update manifests",
    tenant_scoped: false,
  },
  releaseinstalls: {
    group: "Backups, Releases & Migration",
    purpose: "POS terminal update download & installation telemetry",
    tenant_scoped: true,
  },
  migrationjobs: {
    group: "Backups, Releases & Migration",
    purpose: "Legacy POS database conversion jobs & audit summaries",
    tenant_scoped: true,
  },
  storagesnapshots: {
    group: "Backups, Releases & Migration",
    purpose: "Historical R2 storage inventory snapshots",
    tenant_scoped: false,
  },
  storagecleanupruns: {
    group: "Backups, Releases & Migration",
    purpose: "R2 storage cleanup execution logs",
    tenant_scoped: false,
  },
  aiusagelogs: {
    group: "AI Gateway & Aiva",
    purpose: "Per-request Aiva AI token, model, latency & status logs",
    tenant_scoped: true,
  },
  aimodelregistries: {
    group: "AI Gateway & Aiva",
    purpose: "Configured LLM models & routing priorities",
    tenant_scoped: false,
  },
  aicredentials: {
    group: "AI Gateway & Aiva",
    purpose: "Encrypted upstream AI provider API key pool",
    tenant_scoped: false,
  },
  aiorgpools: {
    group: "AI Gateway & Aiva",
    purpose: "AI provider organization rate-limit pools",
    tenant_scoped: false,
  },
  aipharmacyentitlements: {
    group: "AI Gateway & Aiva",
    purpose: "Per-pharmacy daily/monthly Aiva AI quota entitlements",
    tenant_scoped: true,
  },
  aialerts: {
    group: "AI Gateway & Aiva",
    purpose: "AI gateway rate-limit, key health & quota alerts",
    tenant_scoped: false,
  },
  billingusages: {
    group: "Billing & Subscriptions",
    purpose: "Metered POS invoice usage records per billing period",
    tenant_scoped: true,
  },
  billingadjustments: {
    group: "Billing & Subscriptions",
    purpose: "Manual billing credits & adjustments",
    tenant_scoped: true,
  },
  licensebillingperiods: {
    group: "Billing & Subscriptions",
    purpose: "Subscription billing periods & invoice tallies",
    tenant_scoped: true,
  },
  licensepayments: {
    group: "Billing & Subscriptions",
    purpose: "Recorded license renewal payments & receipts",
    tenant_scoped: true,
  },
  licenserenewalinvoices: {
    group: "Billing & Subscriptions",
    purpose: "Generated renewal vouchers & payment instructions",
    tenant_scoped: true,
  },
  renewalnotifications: {
    group: "Billing & Subscriptions",
    purpose: "Sent subscription renewal reminder logs",
    tenant_scoped: true,
  },
  profiles: {
    group: "Users & Authentication",
    purpose: "Admin portal user profiles",
    tenant_scoped: false,
  },
  userroles: {
    group: "Users & Authentication",
    purpose: "Admin RBAC role assignments",
    tenant_scoped: false,
  },
  portalusers: {
    group: "Users & Authentication",
    purpose: "Pharmacy Owner Portal user accounts",
    tenant_scoped: true,
  },
  portalinvites: {
    group: "Users & Authentication",
    purpose: "Owner Portal invitation tokens",
    tenant_scoped: true,
  },
  auditlogs: {
    group: "Audit, Feedback & System",
    purpose: "Immutable Super Admin & security audit trail",
    tenant_scoped: false,
  },
  feedbacks: {
    group: "Audit, Feedback & System",
    purpose: "Customer & operator feedback submissions",
    tenant_scoped: true,
  },
  systemsettings: {
    group: "Audit, Feedback & System",
    purpose: "Global portal & infrastructure configuration settings",
    tenant_scoped: false,
  },
  counters: {
    group: "Audit, Feedback & System",
    purpose: "Global sequence counters",
    tenant_scoped: false,
  },
};

export async function collectMongoDbAtlasMetrics(config: CloudMonitorConfig) {
  if (!process.env.MONGODB_URI) {
    return {
      provider: "mongodb_atlas" as const,
      status: "configuration_required" as ProviderStatusState,
      configured: false,
      missing_env: ["MONGODB_URI"],
      captured_at: new Date().toISOString(),
      error: "MONGODB_URI is not configured.",
    };
  }

  try {
    await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection is not active.");

    const [dbStats, helloInfo, listDbsResult, collectionsList] = await Promise.all([
      db.stats(),
      db.command({ hello: 1 }).catch(() => null),
      db
        .admin()
        .listDatabases()
        .catch(() => null),
      db.listCollections().toArray(),
    ]);

    // Fetch $collStats for each collection in parallel
    const collectionStatsRaw = await Promise.all(
      collectionsList.map(async (c) => {
        try {
          const res = await db
            .collection(c.name)
            .aggregate([{ $collStats: { storageStats: {} } }])
            .toArray();
          const st = res?.[0]?.storageStats;
          if (!st) return null;
          const meta = COLLECTION_FEATURE_MAP[c.name] || {
            group: "Other Collections",
            purpose: "Application collection",
            tenant_scoped: false,
          };
          const logicalBytes = Number(st.size || 0);
          const allocatedBytes = Number(st.storageSize || 0);
          const indexBytes = Number(st.totalIndexSize || 0);
          return {
            name: c.name,
            feature_group: meta.group,
            purpose: meta.purpose,
            tenant_scoped: meta.tenant_scoped,
            document_count: Number(st.count || 0),
            avg_obj_size_bytes: Number(st.avgObjSize || 0),
            logical_data_bytes: logicalBytes,
            allocated_storage_bytes: allocatedBytes,
            total_index_bytes: indexBytes,
            combined_logical_index_bytes: logicalBytes + indexBytes,
            combined_allocated_index_bytes: allocatedBytes + indexBytes,
            indexes_count: Number(st.nindexes || 0),
            index_sizes: (st.indexSizes || {}) as Record<string, number>,
          };
        } catch {
          return null;
        }
      })
    );

    const collections = collectionStatsRaw
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.combined_logical_index_bytes - a.combined_logical_index_bytes);

    // Group collections by application feature
    const groupMap = new Map<
      string,
      {
        group: string;
        collections_count: number;
        document_count: number;
        logical_data_bytes: number;
        allocated_storage_bytes: number;
        total_index_bytes: number;
        combined_bytes: number;
      }
    >();

    for (const c of collections) {
      const g = groupMap.get(c.feature_group) || {
        group: c.feature_group,
        collections_count: 0,
        document_count: 0,
        logical_data_bytes: 0,
        allocated_storage_bytes: 0,
        total_index_bytes: 0,
        combined_bytes: 0,
      };
      g.collections_count += 1;
      g.document_count += c.document_count;
      g.logical_data_bytes += c.logical_data_bytes;
      g.allocated_storage_bytes += c.allocated_storage_bytes;
      g.total_index_bytes += c.total_index_bytes;
      g.combined_bytes += c.combined_logical_index_bytes;
      groupMap.set(c.feature_group, g);
    }

    const featureGroups = Array.from(groupMap.values()).sort(
      (a, b) => b.combined_bytes - a.combined_bytes
    );

    const logicalDataBytes = Number(dbStats?.dataSize || 0);
    const allocatedStorageBytes = Number(dbStats?.storageSize || 0);
    const totalIndexBytes = Number(dbStats?.indexSize || 0);
    const logicalPlusIndexBytes = logicalDataBytes + totalIndexBytes;
    const allocatedPlusIndexBytes = allocatedStorageBytes + totalIndexBytes;

    const limitBytes = config.mongodb_storage_limit_bytes;
    const usagePct =
      limitBytes && limitBytes > 0
        ? Number(((logicalPlusIndexBytes / limitBytes) * 100).toFixed(2))
        : null;
    const allocatedUsagePct =
      limitBytes && limitBytes > 0
        ? Number(((allocatedPlusIndexBytes / limitBytes) * 100).toFixed(2))
        : null;
    const remainingBytes =
      limitBytes && limitBytes > 0 ? Math.max(0, limitBytes - logicalPlusIndexBytes) : null;

    const hasAtlasAdminCreds = Boolean(
      process.env.MONGODB_ATLAS_PUBLIC_KEY &&
        process.env.MONGODB_ATLAS_PRIVATE_KEY &&
        process.env.MONGODB_ATLAS_GROUP_ID
    );

    const databasesList = Array.isArray(listDbsResult?.databases)
      ? listDbsResult.databases.map((d: any) => ({
          name: String(d.name),
          size_on_disk_bytes: Number(d.sizeOnDisk || 0),
          empty: Boolean(d.empty),
        }))
      : [
          {
            name: db.databaseName,
            size_on_disk_bytes: allocatedPlusIndexBytes,
            empty: false,
          },
        ];

    const status = evaluateStatusFromPct(usagePct, config);

    return {
      provider: "mongodb_atlas" as const,
      status,
      configured: true,
      captured_at: new Date().toISOString(),
      missing_env: [] as string[],
      optional_missing_env: hasAtlasAdminCreds
        ? ([] as string[])
        : [
            "MONGODB_ATLAS_PUBLIC_KEY",
            "MONGODB_ATLAS_PRIVATE_KEY",
            "MONGODB_ATLAS_GROUP_ID",
          ],
      cluster: {
        database_name: db.databaseName,
        replica_set: helloInfo?.setName || "atlas-cluster",
        primary_host: helloInfo?.primary || mongoose.connection.host || "connected",
        node_count: Array.isArray(helloInfo?.hosts) ? helloInfo.hosts.length : 1,
        cloud_provider: helloInfo?.tags?.provider || "AWS",
        region: helloInfo?.tags?.region || "AP_SOUTH_1",
        workload_type: helloInfo?.tags?.workloadType || "OPERATIONAL",
        tier_label: config.mongodb_cluster_tier,
        tier_source: (hasAtlasAdminCreds ? "provider_api" : "configured_quota") as MetricOrigin,
      },
      metrics: {
        logical_data_bytes: logicalDataBytes,
        allocated_storage_bytes: allocatedStorageBytes,
        index_size_bytes: totalIndexBytes,
        logical_plus_index_bytes: logicalPlusIndexBytes,
        allocated_plus_index_bytes: allocatedPlusIndexBytes,
        storage_limit_bytes: limitBytes,
        remaining_bytes: remainingBytes,
        usage_pct: usagePct,
        allocated_usage_pct: allocatedUsagePct,
        databases_count: databasesList.length,
        collections_count: collections.length,
        total_documents: Number(dbStats?.objects || 0),
        quota_note:
          "MongoDB dbStats reports uncompressed logical dataSize, WiredTiger compressed storageSize, and indexSize separately. Both Logical + Index footprint and Allocated Disk + Index footprint are shown against the configured tier ceiling.",
      },
      databases: databasesList,
      feature_groups: featureGroups,
      collections,
    };
  } catch (err: any) {
    return {
      provider: "mongodb_atlas" as const,
      status: "provider_unavailable" as ProviderStatusState,
      configured: true,
      captured_at: new Date().toISOString(),
      missing_env: [] as string[],
      optional_missing_env: [],
      error: String(err?.message || "Failed to query MongoDB statistics"),
    };
  }
}

// ============================================================================
// 3. VERCEL USAGE & QUOTA MONITORING (Official API + FOCUS /v1/billing/charges)
// ============================================================================

async function collectInternalAppTrafficSummary() {
  const period = getCurrentUtcBillingPeriod();
  const startDate = new Date(period.start_iso);
  try {
    const [aiRequestsMonth, analyticsEventsMonth, billingUsageMonth] = await Promise.all([
      AiUsageLog.countDocuments({ created_at: { $gte: startDate } }).catch(() => 0),
      AnalyticsEvent.countDocuments({ created_at: { $gte: startDate } }).catch(() => 0),
      BillingUsage.countDocuments({ created_at: { $gte: startDate } }).catch(() => 0),
    ]);
    return {
      period_label: period.label,
      ai_gateway_requests_month: aiRequestsMonth,
      pos_analytics_sync_events_month: analyticsEventsMonth,
      billing_metering_events_month: billingUsageMonth,
      origin: "internal_telemetry" as MetricOrigin,
      note: "Application-level API activity recorded in MongoDB during the current UTC month. Shown as internal operational context; does not replace Vercel edge/function billing counters.",
    };
  } catch {
    return null;
  }
}

export async function collectVercelMetrics(config: CloudMonitorConfig) {
  const period = getCurrentUtcBillingPeriod();
  const token = (process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN || "").trim();
  const teamId = (process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || "").trim();
  const internalTraffic = await collectInternalAppTrafficSummary();

  if (!token) {
    return {
      provider: "vercel" as const,
      status: "configuration_required" as ProviderStatusState,
      configured: false,
      captured_at: new Date().toISOString(),
      billing_period: period,
      missing_env: ["VERCEL_API_TOKEN"],
      optional_missing_env: ["VERCEL_TEAM_ID"],
      runtime_context: {
        is_running_on_vercel: Boolean(process.env.VERCEL),
        vercel_env: process.env.VERCEL_ENV || "development",
        vercel_region: process.env.VERCEL_REGION || null,
        vercel_url: process.env.VERCEL_URL || "mediqoo.vercel.app",
      },
      internal_app_telemetry: internalTraffic,
      dashboard_url: "https://vercel.com/dashboard/usage",
      setup_note:
        "Add VERCEL_API_TOKEN (and optional VERCEL_TEAM_ID) to server environment variables to enable live Vercel project inventory and /v1/billing/charges FOCUS cost & usage streaming.",
    };
  }

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";

    const [accountRes, projectsRes, chargesRes] = await Promise.all([
      fetch(
        teamId
          ? `https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`
          : "https://api.vercel.com/v2/user",
        { headers, signal: AbortSignal.timeout(8000) }
      ).catch(() => null),
      fetch(`https://api.vercel.com/v9/projects${teamQuery ? `${teamQuery}&limit=50` : "?limit=50"}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
      fetch(
        `https://api.vercel.com/v1/billing/charges?from=${encodeURIComponent(
          period.start_iso
        )}&to=${encodeURIComponent(new Date().toISOString())}${
          teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""
        }`,
        { headers, signal: AbortSignal.timeout(10000) }
      ).catch(() => null),
    ]);

    if (accountRes && (accountRes.status === 401 || accountRes.status === 403)) {
      return {
        provider: "vercel" as const,
        status: "provider_unavailable" as ProviderStatusState,
        configured: true,
        captured_at: new Date().toISOString(),
        billing_period: period,
        missing_env: [],
        optional_missing_env: teamId ? [] : ["VERCEL_TEAM_ID"],
        internal_app_telemetry: internalTraffic,
        dashboard_url: "https://vercel.com/dashboard/usage",
        error: `Vercel API authentication failed (HTTP ${accountRes.status}). Verify VERCEL_API_TOKEN and VERCEL_TEAM_ID permissions.`,
      };
    }

    const accountJson: any = accountRes && accountRes.ok ? await accountRes.json().catch(() => null) : null;
    const projectsJson: any = projectsRes && projectsRes.ok ? await projectsRes.json().catch(() => null) : null;

    const accountName =
      accountJson?.name || accountJson?.user?.name || accountJson?.user?.username || "Vercel Account";
    const plan =
      accountJson?.billing?.plan ||
      accountJson?.user?.billing?.plan ||
      "hobby";

    const rawProjects: any[] = projectsJson?.projects || [];
    const projects = rawProjects.map((p: any) => {
      const latestDep = Array.isArray(p.latestDeployments) ? p.latestDeployments[0] : null;
      return {
        id: String(p.id),
        name: String(p.name),
        framework: p.framework || "nextjs",
        updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
        latest_deployment_state: latestDep?.readyState || latestDep?.state || "READY",
        latest_deployment_url: latestDep?.url || undefined,
      };
    });

    // Parse FOCUS v1.3 JSONL stream from /v1/billing/charges if supported for this plan/token
    let chargesAvailable = false;
    let chargesNote = "";
    let totalBilledCostUsd = 0;
    let totalEffectiveCostUsd = 0;
    const byService = new Map<
      string,
      {
        service_name: string;
        consumed_quantity: number;
        consumed_unit: string;
        billed_cost_usd: number;
        effective_cost_usd: number;
      }
    >();
    const byProject = new Map<
      string,
      {
        project_id: string;
        project_name: string;
        billed_cost_usd: number;
        effective_cost_usd: number;
        metrics: Array<{ service: string; quantity: number; unit: string }>;
      }
    >();

    if (chargesRes && chargesRes.ok) {
      const text = await chargesRes.text().catch(() => "");
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      chargesAvailable = true;
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          const service = String(row.ServiceName || row.ChargeDescription || "Vercel Resource");
          const qty = Number(row.ConsumedQuantity || 0);
          const unit = String(row.ConsumedUnit || "units");
          const billed = Number(row.BilledCost || 0);
          const effective = Number(row.EffectiveCost || 0);
          totalBilledCostUsd += billed;
          totalEffectiveCostUsd += effective;

          const curSvc = byService.get(service) || {
            service_name: service,
            consumed_quantity: 0,
            consumed_unit: unit,
            billed_cost_usd: 0,
            effective_cost_usd: 0,
          };
          curSvc.consumed_quantity += qty;
          curSvc.billed_cost_usd += billed;
          curSvc.effective_cost_usd += effective;
          byService.set(service, curSvc);

          const projId = String(
            row.Tags?.ProjectId || row.ProjectId || row.SubAccountId || "shared"
          );
          const projName = String(
            row.Tags?.ProjectName || row.ProjectName || row.SubAccountName || projId
          );
          const curProj = byProject.get(projId) || {
            project_id: projId,
            project_name: projName,
            billed_cost_usd: 0,
            effective_cost_usd: 0,
            metrics: [],
          };
          curProj.billed_cost_usd += billed;
          curProj.effective_cost_usd += effective;
          curProj.metrics.push({ service, quantity: qty, unit });
          byProject.set(projId, curProj);
        } catch {
          /* skip malformed JSONL line */
        }
      }
    } else if (chargesRes) {
      chargesNote = `Vercel /v1/billing/charges returned HTTP ${chargesRes.status} (Note: FOCUS billing charges API requires Pro/Enterprise billing permission or may not return charge rows on Hobby accounts).`;
    }

    return {
      provider: "vercel" as const,
      status: "healthy" as ProviderStatusState,
      configured: true,
      captured_at: new Date().toISOString(),
      billing_period: period,
      missing_env: [] as string[],
      optional_missing_env: teamId ? ([] as string[]) : ["VERCEL_TEAM_ID"],
      account: {
        name: accountName,
        team_id: teamId || null,
        plan,
      },
      runtime_context: {
        is_running_on_vercel: Boolean(process.env.VERCEL),
        vercel_env: process.env.VERCEL_ENV || "development",
        vercel_region: process.env.VERCEL_REGION || null,
        vercel_url: process.env.VERCEL_URL || "mediqoo.vercel.app",
      },
      charges_summary: {
        available: chargesAvailable,
        total_billed_cost_usd: Number(totalBilledCostUsd.toFixed(4)),
        total_effective_cost_usd: Number(totalEffectiveCostUsd.toFixed(4)),
        services: Array.from(byService.values()).sort(
          (a, b) => b.effective_cost_usd - a.effective_cost_usd || b.consumed_quantity - a.consumed_quantity
        ),
        project_usage: Array.from(byProject.values()).sort(
          (a, b) => b.effective_cost_usd - a.effective_cost_usd
        ),
        note:
          chargesNote ||
          "Retrieved from official Vercel /v1/billing/charges FOCUS endpoint for current billing period.",
      },
      projects,
      internal_app_telemetry: internalTraffic,
      dashboard_url: "https://vercel.com/dashboard/usage",
    };
  } catch (err: any) {
    return {
      provider: "vercel" as const,
      status: "provider_unavailable" as ProviderStatusState,
      configured: true,
      captured_at: new Date().toISOString(),
      billing_period: period,
      missing_env: [] as string[],
      optional_missing_env: [],
      internal_app_telemetry: internalTraffic,
      dashboard_url: "https://vercel.com/dashboard/usage",
      error: String(err?.message || "Failed to query Vercel API"),
    };
  }
}

// ============================================================================
// 4. HISTORICAL TRENDS & UNIFIED ALERTS
// ============================================================================

export interface CloudTrendPoint {
  timestamp: string;
  r2_bytes: number;
  r2_objects: number;
  mongodb_logical_index_bytes?: number;
  mongodb_allocated_index_bytes?: number;
  mongodb_documents?: number;
}

async function getAndRecordTrendHistory(
  r2Data: any,
  mongoData: any
): Promise<CloudTrendPoint[]> {
  try {
    await connectToDatabase();
    const [r2Snapshots, histSetting] = await Promise.all([
      StorageSnapshot.find({}).sort({ scanned_at: 1 }).limit(30).lean(),
      SystemSetting.findOne({ key: MONITOR_HISTORY_KEY }).lean(),
    ]);

    const storedPoints: CloudTrendPoint[] = histSetting?.value
      ? JSON.parse(histSetting.value)
      : [];

    const nowIso = new Date().toISOString();
    const r2Bytes = r2Data?.metrics?.current_snapshot_bytes ?? 0;
    const r2Objs = r2Data?.metrics?.total_object_count ?? 0;
    const mongoLogical = mongoData?.metrics?.logical_plus_index_bytes;
    const mongoAllocated = mongoData?.metrics?.allocated_plus_index_bytes;
    const mongoDocs = mongoData?.metrics?.total_documents;

    const lastPoint = storedPoints[storedPoints.length - 1];
    const shouldAppend =
      !lastPoint ||
      Date.now() - new Date(lastPoint.timestamp).getTime() > 30 * 60 * 1000 ||
      Math.abs((lastPoint.r2_bytes || 0) - r2Bytes) > 1024 * 100 ||
      Math.abs((lastPoint.mongodb_logical_index_bytes || 0) - (mongoLogical || 0)) > 1024 * 50;

    if (shouldAppend && (r2Bytes > 0 || mongoLogical)) {
      storedPoints.push({
        timestamp: nowIso,
        r2_bytes: r2Bytes,
        r2_objects: r2Objs,
        mongodb_logical_index_bytes: mongoLogical,
        mongodb_allocated_index_bytes: mongoAllocated,
        mongodb_documents: mongoDocs,
      });
      const trimmed = storedPoints.slice(-60);
      await SystemSetting.findOneAndUpdate(
        { key: MONITOR_HISTORY_KEY },
        { $set: { value: JSON.stringify(trimmed) } },
        { upsert: true }
      ).catch(() => {});
    }

    // Merge historical StorageSnapshots for earlier dates with storedPoints
    const combined: CloudTrendPoint[] = [];
    for (const s of r2Snapshots as any[]) {
      if (!s.scanned_at) continue;
      combined.push({
        timestamp: new Date(s.scanned_at).toISOString(),
        r2_bytes: Number(s.total_bytes || 0),
        r2_objects: Number(s.total_objects || 0),
      });
    }
    for (const p of storedPoints) {
      combined.push(p);
    }
    combined.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return combined.slice(-45);
  } catch {
    return [];
  }
}

export interface CloudAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  provider: "cloudflare_r2" | "mongodb_atlas" | "vercel";
  title: string;
  message: string;
  metric_pct?: number;
}

function buildAlerts(
  config: CloudMonitorConfig,
  r2: any,
  mongo: any,
  vercel: any
): CloudAlert[] {
  const alerts: CloudAlert[] = [];

  const checkThreshold = (
    provider: CloudAlert["provider"],
    id: string,
    label: string,
    pct: number | null | undefined,
    detail: string
  ) => {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return;
    if (pct >= config.critical_threshold_pct) {
      alerts.push({
        id,
        severity: "critical",
        provider,
        title: `Critical: ${label} at ${pct.toFixed(1)}%`,
        message: `${detail} Exceeds critical threshold (${config.critical_threshold_pct}%).`,
        metric_pct: pct,
      });
    } else if (pct >= config.warning_threshold_pct) {
      alerts.push({
        id,
        severity: "warning",
        provider,
        title: `Warning: ${label} at ${pct.toFixed(1)}%`,
        message: `${detail} Exceeds warning threshold (${config.warning_threshold_pct}%).`,
        metric_pct: pct,
      });
    } else if (pct >= config.info_threshold_pct) {
      alerts.push({
        id,
        severity: "info",
        provider,
        title: `Approaching Allowance: ${label} at ${pct.toFixed(1)}%`,
        message: `${detail} Exceeds informational threshold (${config.info_threshold_pct}%).`,
        metric_pct: pct,
      });
    }
  };

  // R2 checks
  if (r2.status === "configuration_required") {
    alerts.push({
      id: "r2-config-missing",
      severity: "warning",
      provider: "cloudflare_r2",
      title: "Cloudflare R2 Configuration Required",
      message: `Missing environment variables: ${(r2.missing_env || []).join(", ")}`,
    });
  } else if (r2.status === "provider_unavailable") {
    alerts.push({
      id: "r2-unavailable",
      severity: "warning",
      provider: "cloudflare_r2",
      title: "Cloudflare R2 API Unavailable",
      message: r2.error || "Unable to reach Cloudflare R2 endpoint.",
    });
  } else if (r2.metrics) {
    checkThreshold(
      "cloudflare_r2",
      "r2-storage-pct",
      "Cloudflare R2 Standard Storage",
      r2.metrics.usage_pct,
      "Current R2 Standard storage compared against configured free-tier/budget allowance."
    );
    checkThreshold(
      "cloudflare_r2",
      "r2-class-a-pct",
      "Cloudflare R2 Class A Operations",
      r2.metrics.class_a_ops?.usage_pct,
      "Monthly Class A write/list operations vs free-tier allowance."
    );
    checkThreshold(
      "cloudflare_r2",
      "r2-class-b-pct",
      "Cloudflare R2 Class B Operations",
      r2.metrics.class_b_ops?.usage_pct,
      "Monthly Class B read operations vs free-tier allowance."
    );
  }

  // MongoDB checks
  if (mongo.status === "configuration_required" || mongo.status === "provider_unavailable") {
    alerts.push({
      id: "mongo-unavailable",
      severity: "critical",
      provider: "mongodb_atlas",
      title: "MongoDB Atlas Telemetry Unavailable",
      message: mongo.error || "Could not retrieve MongoDB database statistics.",
    });
  } else if (mongo.metrics) {
    checkThreshold(
      "mongodb_atlas",
      "mongo-storage-pct",
      `MongoDB Atlas (${mongo.cluster?.tier_label || "Cluster"}) Storage`,
      mongo.metrics.usage_pct,
      "Combined logical data + index size compared against configured cluster storage limit."
    );
  }

  // Vercel checks
  if (vercel.status === "configuration_required") {
    alerts.push({
      id: "vercel-token-missing",
      severity: "info",
      provider: "vercel",
      title: "Vercel Billing API Token Not Configured",
      message:
        "Add VERCEL_API_TOKEN (and optional VERCEL_TEAM_ID) in environment variables to enable live Vercel project & FOCUS billing metrics.",
    });
  } else if (vercel.status === "provider_unavailable") {
    alerts.push({
      id: "vercel-unavailable",
      severity: "warning",
      provider: "vercel",
      title: "Vercel API Connection Issue",
      message: vercel.error || "Could not retrieve Vercel usage metrics.",
    });
  }

  return alerts;
}

export interface CloudResourceMonitorReport {
  captured_at: string;
  from_cache: boolean;
  cache_ttl_seconds: number;
  next_manual_refresh_allowed_at: string;
  config: CloudMonitorConfig;
  alerts: CloudAlert[];
  providers: {
    cloudflare_r2: Awaited<ReturnType<typeof collectCloudflareR2Metrics>>;
    mongodb_atlas: Awaited<ReturnType<typeof collectMongoDbAtlasMetrics>>;
    vercel: Awaited<ReturnType<typeof collectVercelMetrics>>;
  };
  trends: CloudTrendPoint[];
}

export async function getCloudResourceMonitorReport(options?: {
  forceRefresh?: boolean;
}): Promise<CloudResourceMonitorReport> {
  const now = Date.now();
  const force = Boolean(options?.forceRefresh);

  if (cachedReport) {
    const ageMs = now - cachedReport.capturedAtMs;
    const sinceLastForcedMs = now - cachedReport.lastForcedAtMs;

    if (!force && ageMs < CACHE_TTL_MS) {
      return {
        ...cachedReport.data,
        from_cache: true,
      };
    }

    // Protect cloud APIs from rapid repeated manual refresh clicks
    if (force && sinceLastForcedMs < MANUAL_REFRESH_COOLDOWN_MS) {
      return {
        ...cachedReport.data,
        from_cache: true,
      };
    }
  }

  const config = await getCloudMonitorConfig();

  const [r2, mongo, vercel] = await Promise.all([
    collectCloudflareR2Metrics(config),
    collectMongoDbAtlasMetrics(config),
    collectVercelMetrics(config),
  ]);

  const trends = await getAndRecordTrendHistory(r2, mongo);
  const alerts = buildAlerts(config, r2, mongo, vercel);

  const report: CloudResourceMonitorReport = {
    captured_at: new Date(now).toISOString(),
    from_cache: false,
    cache_ttl_seconds: Math.floor(CACHE_TTL_MS / 1000),
    next_manual_refresh_allowed_at: new Date(now + MANUAL_REFRESH_COOLDOWN_MS).toISOString(),
    config,
    alerts,
    providers: {
      cloudflare_r2: r2,
      mongodb_atlas: mongo,
      vercel,
    },
    trends,
  };

  cachedReport = {
    capturedAtMs: now,
    lastForcedAtMs: force ? now : cachedReport?.lastForcedAtMs || now,
    data: report,
  };

  return report;
}

