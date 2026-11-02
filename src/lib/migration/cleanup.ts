/**
 * Durable, idempotent storage cleanup for Mediqoo legacy-migration jobs.
 *
 * Ownership model (never touches unrelated pharmacy cloud backups):
 *   - uploaded legacy sources : uploads/migration-sources/{jobId}/...
 *   - generated packages      : migrations/{jobId}/...
 *
 * Triggers:
 *   1. Inline, right after a verified successful conversion (convertJob).
 *   2. Periodic server-side sweeper: GET /api/cron/migration-cleanup (Vercel cron)
 *      + opportunistic throttled sweep when admins list jobs.
 *   3. Cloudflare R2 lifecycle rule on the source prefix as a secondary safety net.
 */
import fs from "fs";
import os from "os";
import path from "path";
import connectToDatabase from "../db";
import MigrationJob, { IMigrationJob } from "../../models/MigrationJob";
import { checkR2Object, deleteR2Object, getR2Client, getR2BucketName } from "../r2";
import { GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

export const MIGRATION_SOURCE_PREFIX = "uploads/migration-sources/";
export const MIGRATION_OUTPUT_PREFIX = "migrations/";
export const MIGRATION_TEMP_DIR = path.join(os.tmpdir(), "mediqoo_migrations");

const envHours = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
};
/** Failed / needs-review source retention for manual retry (default 24h). */
export const FAILED_SOURCE_RETENTION_HOURS = () => envHours("MIGRATION_FAILED_SOURCE_RETENTION_HOURS", 24);
/** Cancelled job source retention (default 0 = delete immediately). */
export const CANCELLED_SOURCE_RETENTION_HOURS = () => envHours("MIGRATION_CANCELLED_SOURCE_RETENTION_HOURS", 0);
/** Uploads that never reach analysis/conversion (default 24h). */
export const ABANDONED_UPLOAD_HOURS = () => envHours("MIGRATION_ABANDONED_UPLOAD_HOURS", 24);
/** Generated encrypted package retention (default 7 days). */
export const OUTPUT_RETENTION_DAYS = () => envHours("MIGRATION_OUTPUT_RETENTION_DAYS", 7);
const MAX_CLEANUP_ATTEMPTS = 12;
const STALE_RUNNING_HOURS = 3;

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);

export function isOwnedSourceKey(job: Pick<IMigrationJob, "id">, key?: string): key is string {
  return Boolean(key) && key!.startsWith(`${MIGRATION_SOURCE_PREFIX}${job.id}/`) && !key!.includes("..");
}
export function isOwnedOutputKey(job: Pick<IMigrationJob, "id">, key?: string): key is string {
  return Boolean(key) && key!.startsWith(`${MIGRATION_OUTPUT_PREFIX}${job.id}/`) && !key!.includes("..");
}

/** Removes every local temp/plaintext artifact belonging to the job. */
export function cleanupLocalJobArtifacts(jobId: string): number {
  let removed = 0;
  try {
    if (!fs.existsSync(MIGRATION_TEMP_DIR)) return 0;
    for (const f of fs.readdirSync(MIGRATION_TEMP_DIR)) {
      if (!f.startsWith(jobId)) continue;
      try {
        fs.rmSync(path.join(MIGRATION_TEMP_DIR, f), { recursive: true, force: true });
        removed++;
      } catch {}
    }
  } catch {}
  return removed;
}

/** Mark the source for deletion after `hours` (0 = due now). Does not delete. */
export function scheduleSourceDeletion(job: IMigrationJob, hours: number, reason: string) {
  const current = job.source_cleanup?.status;
  if (current === "deleted") return;
  job.source_cleanup = {
    ...(job.source_cleanup || {}),
    status: hours > 0 ? "retained" : "pending",
    delete_after: hoursFromNow(hours),
    attempts: job.source_cleanup?.attempts || 0,
    failure_reason: undefined,
    reason,
  } as any;
}

/**
 * Deletes the uploaded legacy source object after strict ownership + identity checks.
 * Idempotent: an already-missing object is recorded as deleted.
 */
export async function deleteJobSource(job: IMigrationJob, actor: string, reason: string): Promise<boolean> {
  const key = job.source_object_key;
  const sc: any = { ...(job.source_cleanup || {}) };
  sc.attempts = (sc.attempts || 0) + 1;
  sc.last_attempt_at = new Date();
  try {
    if (!isOwnedSourceKey(job, key)) {
      // Local test path or foreign key → never delete; nothing in R2 owned by this job.
      sc.status = "not_applicable";
      sc.failure_reason = "Source key is not inside this job's migration prefix; deletion refused.";
      job.source_cleanup = sc;
      return false;
    }
    const head = await checkR2Object(key);
    if (head) {
      if (job.source_file_size && head.size !== job.source_file_size) {
        sc.status = "failed";
        sc.failure_reason = `Identity check failed: R2 size ${head.size} ≠ recorded ${job.source_file_size}. Not deleted.`;
        job.source_cleanup = sc;
        return false;
      }
      await deleteR2Object(key);
      const after = await checkR2Object(key);
      if (after) throw new Error("Object still present after delete");
    }
    sc.status = "deleted";
    sc.deleted_at = new Date();
    sc.failure_reason = undefined;
    sc.reason = reason;
    job.source_cleanup = sc;
    job.audit_events.push({ timestamp: new Date(), actor, action: "SOURCE_DELETED", details: `${reason}. ${head ? `Deleted ${key} (${head.size} bytes)` : "Object already absent"}` });
    return true;
  } catch (err: any) {
    sc.status = "failed";
    sc.failure_reason = String(err?.message || err);
    job.source_cleanup = sc;
    job.audit_events.push({ timestamp: new Date(), actor, action: "SOURCE_DELETE_FAILED", details: sc.failure_reason });
    return false;
  }
}

export async function deleteJobOutput(job: IMigrationJob, actor: string, reason: string): Promise<boolean> {
  const key = job.output_backup?.object_key;
  if (!job.output_backup || job.output_backup.deleted_at) return true;
  if (!isOwnedOutputKey(job, key)) return false;
  try {
    await deleteR2Object(key);
    (job.output_backup as any).deleted_at = new Date();
    job.markModified("output_backup");
    job.audit_events.push({ timestamp: new Date(), actor, action: "OUTPUT_DELETED", details: `${reason}: ${key}` });
    return true;
  } catch (err: any) {
    job.audit_events.push({ timestamp: new Date(), actor, action: "OUTPUT_DELETE_FAILED", details: String(err?.message || err) });
    return false;
  }
}

/**
 * Periodic sweeper (idempotent, retry-safe). Reconciles DB state with R2.
 */
export async function runMigrationCleanupSweep(actor = "system:migration-cleanup") {
  await connectToDatabase();
  const now = new Date();
  const summary = { sourcesDeleted: 0, sourceFailures: 0, outputsExpired: 0, abandonedExpired: 0, staleFailed: 0, scheduled: 0 };

  // a) Crashed/stale running jobs → failed with retention
  const stale = await MigrationJob.find({ status: { $in: ["analyzing", "converting", "validating"] }, updated_at: { $lt: new Date(now.getTime() - STALE_RUNNING_HOURS * 3600_000) } });
  for (const job of stale) {
    job.status = "failed";
    job.stage = "Interrupted — worker stopped before completion";
    job.error_message = job.error_message || "Conversion process did not finish (server restart/timeout).";
    scheduleSourceDeletion(job, FAILED_SOURCE_RETENTION_HOURS(), "Interrupted job retry window");
    cleanupLocalJobArtifacts(job.id);
    await job.save();
    summary.staleFailed++;
  }

  // b) Abandoned uploads (never analyzed/converted)
  const abandoned = await MigrationJob.find({ status: "uploaded", created_at: { $lt: new Date(now.getTime() - ABANDONED_UPLOAD_HOURS() * 3600_000) } });
  for (const job of abandoned) {
    job.status = "cancelled";
    job.stage = "Expired — upload abandoned before analysis";
    scheduleSourceDeletion(job, 0, "Abandoned upload expiry");
    await job.save();
    summary.abandonedExpired++;
  }

  // c) Failed / needs_review / cancelled / completed jobs that have no cleanup schedule yet
  const unscheduled = await MigrationJob.find({
    status: { $in: ["failed", "needs_review", "cancelled", "completed"] },
    $or: [{ "source_cleanup.status": { $exists: false } }, { "source_cleanup.status": null }],
  });
  for (const job of unscheduled) {
    const hours = job.status === "completed" ? 0 : job.status === "cancelled" ? CANCELLED_SOURCE_RETENTION_HOURS() : FAILED_SOURCE_RETENTION_HOURS();
    scheduleSourceDeletion(job, hours, `Sweeper reconciliation (${job.status})`);
    await job.save();
    summary.scheduled++;
  }

  // d) Due source deletions (incl. retries of previous failures)
  const due = await MigrationJob.find({
    "source_cleanup.status": { $in: ["pending", "retained", "failed"] },
    "source_cleanup.delete_after": { $lte: now },
    $or: [{ "source_cleanup.attempts": { $lt: MAX_CLEANUP_ATTEMPTS } }, { "source_cleanup.attempts": { $exists: false } }],
    status: { $nin: ["analyzing", "converting", "validating"] },
  });
  for (const job of due) {
    // Completed jobs: only delete source when the encrypted output is still verifiably present.
    if (job.status === "completed") {
      const outKey = job.output_backup?.object_key;
      const head = outKey && !job.output_backup?.deleted_at ? await checkR2Object(outKey).catch(() => null) : null;
      if (!job.output_backup?.verified_at || (!head && !job.output_backup?.deleted_at)) {
        job.source_cleanup = { ...(job.source_cleanup as any), status: "failed", failure_reason: "Encrypted output not verified/present; source retained.", last_attempt_at: new Date(), attempts: (job.source_cleanup?.attempts || 0) + 1 } as any;
        await job.save();
        summary.sourceFailures++;
        continue;
      }
    }
    const ok = await deleteJobSource(job, actor, `Scheduled cleanup (${job.status})`);
    cleanupLocalJobArtifacts(job.id);
    await job.save();
    if (ok) summary.sourcesDeleted++;
    else if (job.source_cleanup?.status === "failed") summary.sourceFailures++;
  }

  // e) Expired generated packages
  const expired = await MigrationJob.find({ "output_backup.expires_at": { $lte: now }, "output_backup.deleted_at": { $exists: false } });
  for (const job of expired) {
    if (await deleteJobOutput(job, actor, "Retention period expired")) summary.outputsExpired++;
    await job.save();
  }

  return summary;
}

let lastOpportunisticSweep = 0;
/** Throttled, non-blocking sweep used from admin endpoints (cron remains the primary trigger). */
export function triggerOpportunisticSweep() {
  if (Date.now() - lastOpportunisticSweep < 15 * 60_000) return;
  lastOpportunisticSweep = Date.now();
  runMigrationCleanupSweep("system:opportunistic-sweep").catch((e) => console.warn("[migration-cleanup] sweep failed:", e?.message));
}

/**
 * Secondary safety net: R2 lifecycle expiry on the migration SOURCE prefix only.
 * Merges with existing bucket rules (never removes other rules).
 */
export async function ensureMigrationSourceLifecycleRule(days = Number(process.env.MIGRATION_R2_SOURCE_EXPIRY_DAYS) || 3) {
  const client = getR2Client();
  const Bucket = getR2BucketName();
  const RULE_ID = "mediqoo-migration-source-expiry";
  let rules: any[] = [];
  try {
    const res = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
    rules = res.Rules || [];
  } catch (err: any) {
    const code = err?.name || err?.Code;
    if (code !== "NoSuchLifecycleConfiguration" && err?.$metadata?.httpStatusCode !== 404) throw err;
  }
  const existing = rules.find((r) => r.ID === RULE_ID);
  if (existing && existing.Expiration?.Days === days && existing.Filter?.Prefix === MIGRATION_SOURCE_PREFIX) return { changed: false };
  const others = rules.filter((r) => r.ID !== RULE_ID);
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket,
      LifecycleConfiguration: {
        Rules: [
          ...others,
          {
            ID: RULE_ID,
            Status: "Enabled",
            Filter: { Prefix: MIGRATION_SOURCE_PREFIX },
            Expiration: { Days: days },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    })
  );
  return { changed: true };
}

