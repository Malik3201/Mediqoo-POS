import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { scanStorageInventory } from "@/lib/storage/inventory";
import { getStorageConfig, updateStorageConfig } from "@/lib/storage/config";
import StorageSnapshot from "@/models/StorageSnapshot";
import StorageCleanupRun from "@/models/StorageCleanupRun";
import CloudBackup from "@/models/CloudBackup";
import Release from "@/models/Release";
import MigrationJob from "@/models/MigrationJob";
import AuditLog from "@/models/AuditLog";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";
import OwnerCustomerMeta from "@/models/OwnerCustomerMeta";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";

const M0_LIMIT_BYTES = 512 * 1024 * 1024; // 512 MB MongoDB Atlas M0 free tier
const DETAIL_RETENTION_DAYS = 35;

let cachedMongoTelemetry: { timestamp: number; data: any } | null = null;

async function getMongoAndPortalTelemetry(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedMongoTelemetry &&
    Date.now() - cachedMongoTelemetry.timestamp < 10 * 60_000
  ) {
    return cachedMongoTelemetry.data;
  }

  const db = mongoose.connection.db;
  const [
    dbStats,
    analyticsTotal,
    compactedEvents,
    portalStatesCount,
    actionStatesCount,
    customerMetasCount,
    renewalVouchersCount,
    latestCompactedDoc,
  ] = await Promise.all([
    db ? db.stats().catch(() => null) : Promise.resolve(null),
    AnalyticsEvent.estimatedDocumentCount().catch(() => 0),
    AnalyticsEvent.countDocuments({ "payload.items_archived": true }).catch(() => 0),
    OwnerPortalState.countDocuments({}).catch(() => 0),
    OwnerActionState.countDocuments({}).catch(() => 0),
    OwnerCustomerMeta.countDocuments({}).catch(() => 0),
    LicenseRenewalInvoice.countDocuments({}).catch(() => 0),
    OwnerPortalState.findOne({ last_retention_compaction_at: { $exists: true } })
      .sort({ last_retention_compaction_at: -1 })
      .select("last_retention_compaction_at")
      .lean<any>()
      .catch(() => null),
  ]);

  const dataSizeBytes = Number(dbStats?.dataSize || 0);
  const storageSizeBytes = Number(dbStats?.storageSize || 0);
  const indexSizeBytes = Number(dbStats?.indexSize || 0);
  const totalFootprintBytes = dataSizeBytes + indexSizeBytes;
  const usagePct = Number(((totalFootprintBytes / M0_LIMIT_BYTES) * 100).toFixed(2));

  const telemetry = {
    captured_at: new Date().toISOString(),
    data_size_bytes: dataSizeBytes,
    storage_size_bytes: storageSizeBytes,
    index_size_bytes: indexSizeBytes,
    total_footprint_bytes: totalFootprintBytes,
    m0_limit_bytes: M0_LIMIT_BYTES,
    remaining_headroom_bytes: Math.max(0, M0_LIMIT_BYTES - totalFootprintBytes),
    usage_pct: usagePct,
    collections_count: Number(dbStats?.collections || 0),
    total_documents: Number(dbStats?.objects || 0),
    detail_retention_days: DETAIL_RETENTION_DAYS,
    portal_counts: {
      analytics_events_total: analyticsTotal,
      recent_detail_events: Math.max(0, analyticsTotal - compactedEvents),
      compacted_events: compactedEvents,
      portal_states: portalStatesCount,
      action_states: actionStatesCount,
      customer_metas: customerMetasCount,
      renewal_vouchers: renewalVouchersCount,
      last_retention_compaction_at:
        latestCompactedDoc?.last_retention_compaction_at || null,
    },
  };

  cachedMongoTelemetry = { timestamp: Date.now(), data: telemetry };
  return telemetry;
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const latestSnapshot = await StorageSnapshot.findOne({}).sort({ scanned_at: -1 }).lean();
    const snapshotAgeMs = latestSnapshot?.scanned_at
      ? Date.now() - new Date(latestSnapshot.scanned_at).getTime()
      : Infinity;

    // Save a new snapshot if forced or if last snapshot is older than 15 minutes
    const shouldSaveSnapshot = forceRefresh || snapshotAgeMs > 15 * 60_000;

    const [inventory, cleanupHistory, snapshots, mongodbTelemetry] = await Promise.all([
      scanStorageInventory({
        saveSnapshot: shouldSaveSnapshot,
        triggeredBy: forceRefresh ? auth.actor.email : "admin:view",
      }),
      StorageCleanupRun.find({}).sort({ started_at: -1 }).limit(25).lean(),
      StorageSnapshot.find({}).sort({ scanned_at: -1 }).limit(15).lean(),
      getMongoAndPortalTelemetry(forceRefresh),
    ]);

    const activeRun = cleanupHistory.find((r: any) => r.status === "running") || null;

    return NextResponse.json({
      ok: true,
      inventory,
      mongodb_telemetry: mongodbTelemetry,
      cleanupStatus: activeRun ? "running" : "idle",
      activeRun,
      cleanupHistory,
      snapshots,
    });
  } catch (err: any) {
    console.error("[api/admin/storage] GET error:", err);
    return NextResponse.json({ error: err.message || "Failed to load storage inventory" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const body = await req.json();

    // Action 1: Pin / Unpin a pharmacy CloudBackup
    if (body.action === "pin_backup") {
      const { backupId, pinned, reason } = body;
      if (!backupId || typeof pinned !== "boolean") {
        return NextResponse.json({ error: "backupId and pinned boolean are required" }, { status: 400 });
      }
      const updated = await CloudBackup.findOneAndUpdate(
        { id: backupId },
        {
          $set: {
            pinned,
            pinned_at: pinned ? new Date() : undefined,
            pinned_by: pinned ? auth.actor.email : undefined,
            pinned_reason: pinned ? String(reason || "Pinned by Super Admin") : undefined,
          },
        },
        { new: true }
      ).lean();
      if (!updated) {
        return NextResponse.json({ error: "Backup record not found" }, { status: 404 });
      }
      await AuditLog.create({
        action: pinned ? "cloud_backup_pinned" : "cloud_backup_unpinned",
        entity_type: "cloud_backup",
        entity_id: backupId,
        actor_id: auth.actor.id,
        metadata: { actor_email: auth.actor.email, pinned, reason },
      }).catch(() => {});
      return NextResponse.json({ ok: true, backup: updated });
    }

    // Action 2: Approve / Unapprove cleanup or toggle protection on a Release
    if (body.action === "update_release_retention") {
      const { releaseId, cleanup_approved, protected: isProt } = body;
      if (!releaseId) {
        return NextResponse.json({ error: "releaseId is required" }, { status: 400 });
      }
      const patch: any = {};
      if (typeof cleanup_approved === "boolean") patch.cleanup_approved = cleanup_approved;
      if (typeof isProt === "boolean") patch.protected = isProt;
      const updated = await Release.findOneAndUpdate({ id: releaseId }, { $set: patch }, { new: true }).lean();
      if (!updated) {
        return NextResponse.json({ error: "Release not found" }, { status: 404 });
      }
      await AuditLog.create({
        action: "release_retention_updated",
        entity_type: "release",
        entity_id: releaseId,
        actor_id: auth.actor.id,
        metadata: { actor_email: auth.actor.email, ...patch },
      }).catch(() => {});
      return NextResponse.json({ ok: true, release: updated });
    }

    // Action 3: Extend migration package expiry or toggle protection
    if (body.action === "update_migration_retention") {
      const { jobId, extend_days, protect_output, protect_source, restore_confirmed } = body;
      const job = await MigrationJob.findOne({ id: jobId });
      if (!job) {
        return NextResponse.json({ error: "Migration job not found" }, { status: 404 });
      }
      if (typeof extend_days === "number" && extend_days > 0 && job.output_backup) {
        const baseMs = Math.max(
          Date.now(),
          job.output_backup.expires_at ? new Date(job.output_backup.expires_at).getTime() : Date.now()
        );
        job.output_backup.expires_at = new Date(baseMs + Math.min(90, extend_days) * 86400_000);
        job.markModified("output_backup");
      }
      if (typeof protect_output === "boolean" && job.output_backup) {
        job.output_backup.protected = protect_output;
        job.markModified("output_backup");
      }
      if (typeof protect_source === "boolean") {
        job.source_cleanup = {
          ...(job.source_cleanup || { status: "retained" }),
          protected: protect_source,
        } as any;
        job.markModified("source_cleanup");
      }
      if (restore_confirmed === true && job.output_backup) {
        job.output_backup.restore_confirmed_at = new Date();
        job.markModified("output_backup");
      }
      await job.save();
      return NextResponse.json({ ok: true, job });
    }

    // Action 4: Trigger Owner Portal bounded line-item retention compaction (MongoDB Atlas M0 optimization)
    if (body.action === "run_portal_retention_compaction") {
      const retentionCutoff = new Date(
        Date.now() - DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      const updateRes = await AnalyticsEvent.updateMany(
        {
          occurred_at: { $lt: retentionCutoff },
          "payload.items_archived": { $ne: true },
          $or: [
            { "payload.items.0": { $exists: true } },
            { "payload.lines.0": { $exists: true } },
          ],
        },
        {
          $set: { "payload.items_archived": true },
          $unset: { "payload.items": "", "payload.lines": "" },
        }
      );

      await OwnerPortalState.updateMany(
        {},
        { $set: { last_retention_compaction_at: new Date() } }
      );

      await AuditLog.create({
        action: "portal_retention_compaction_executed",
        entity_type: "analytics_event",
        entity_id: "global",
        actor_id: auth.actor.id,
        metadata: {
          actor_email: auth.actor.email,
          retention_days: DETAIL_RETENTION_DAYS,
          compacted_count: updateRes.modifiedCount || 0,
        },
      }).catch(() => {});

      const mongodbTelemetry = await getMongoAndPortalTelemetry(true);
      return NextResponse.json({
        ok: true,
        compacted_count: updateRes.modifiedCount || 0,
        mongodb_telemetry: mongodbTelemetry,
      });
    }

    // Default Action: Update StorageConfig budget / thresholds / retention policies
    const config = await updateStorageConfig(body.config || body, auth.actor);
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    console.error("[api/admin/storage] PATCH error:", err);
    return NextResponse.json({ error: err.message || "Failed to update storage settings" }, { status: 500 });
  }
}

