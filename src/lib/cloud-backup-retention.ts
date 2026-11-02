import connectToDatabase from "@/lib/db";
import CloudBackup from "@/models/CloudBackup";
import AuditLog from "@/models/AuditLog";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getStorageConfig } from "@/lib/storage/config";

const MIN_VALID_BACKUP_BYTES = 64;

function getS3Client(): S3Client | null {
  if (!process.env.R2_ENDPOINT || !process.env.R2_BUCKET_NAME) {
    return null;
  }
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
}

async function verifyObjectInR2(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return (res.ContentLength || 0) >= MIN_VALID_BACKUP_BYTES;
  } catch {
    return false;
  }
}

/**
 * Enforces cloud backup retention for a specific license.
 * - Always retains at least the newest `backup_min_verified_retained` (minimum 2) independently verified recoverable backups in R2.
 * - Never deletes pinned backups or backups with active restore locks.
 * - Optionally retains up to `backup_rolling_auto_retained` additional automatic backups within the rolling window.
 * - If a pharmacy has fewer than 2 verified backups in R2, preserves all available copies.
 */
export async function enforceBackupRetention(
  licenseId: string,
  existingS3?: S3Client | null
): Promise<{ kept: number; deleted: number; errors: number }> {
  await connectToDatabase();
  const config = await getStorageConfig();
  const minVerified = Math.max(2, config.backup_min_verified_retained);
  const rollingAutoLimit = Math.max(0, config.backup_rolling_auto_retained);
  const rollingCutoffMs = Date.now() - config.backup_rolling_window_days * 86400_000;

  // Find all active uploaded backups for this license, newest first
  const backups = await CloudBackup.find({
    license_id: licenseId,
    status: "uploaded",
  })
    .sort({ uploaded_at: -1, created_at: -1 })
    .lean();

  if (backups.length <= minVerified) {
    return { kept: backups.length, deleted: 0, errors: 0 };
  }

  const s3 = existingS3 || getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!s3 || !bucketName) {
    return { kept: backups.length, deleted: 0, errors: 0 };
  }

  // Verify the protected recovery set in R2 first
  const verifiedTop: any[] = [];
  const candidatesAfterTop: any[] = [];

  for (const b of backups) {
    if (verifiedTop.length < minVerified) {
      const ok = b.object_key ? await verifyObjectInR2(s3, bucketName, b.object_key) : false;
      if (ok) {
        verifiedTop.push(b);
      } else {
        // Unverified / missing in R2 does NOT count toward the 2 required verified backups
        candidatesAfterTop.push(b);
      }
    } else {
      candidatesAfterTop.push(b);
    }
  }

  // Critical safety rule: If fewer than 2 verified recoverable backups exist in R2, preserve all valid copies!
  if (verifiedTop.length < 2) {
    return { kept: backups.length, deleted: 0, errors: 0 };
  }

  const nowMs = Date.now();
  let rollingKept = 0;
  const toKeep: any[] = [...verifiedTop];
  const toDelete: any[] = [];

  for (const b of candidatesAfterTop) {
    const isPinned = Boolean((b as any).pinned);
    const isRestoreActive = Boolean(
      (b as any).restore_active_until && new Date((b as any).restore_active_until).getTime() > nowMs
    );
    const bTimeMs = new Date(b.uploaded_at || b.created_at || 0).getTime();

    if (isPinned || isRestoreActive) {
      toKeep.push(b);
      continue;
    }

    if (
      b.backup_type !== "manual" &&
      rollingKept < rollingAutoLimit &&
      bTimeMs >= rollingCutoffMs
    ) {
      rollingKept++;
      toKeep.push(b);
      continue;
    }

    toDelete.push(b);
  }

  let deletedCount = 0;
  let errorCount = 0;

  for (const oldBackup of toDelete) {
    try {
      if (oldBackup.object_key) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: oldBackup.object_key,
            })
          );
        } catch (s3Err: any) {
          console.warn(
            `Failed to delete R2 storage object for backup ${oldBackup.id} (${oldBackup.object_key}):`,
            s3Err?.message || s3Err
          );
          errorCount++;
          continue; // Do not mark deleted if R2 deletion threw an error
        }
      }

      await CloudBackup.updateOne(
        { id: oldBackup.id },
        {
          $set: {
            status: "deleted",
            deleted_at: new Date(),
          },
        }
      );

      try {
        await AuditLog.create({
          action: "cloud_backup_retention_deleted",
          entity_type: "cloud_backup",
          entity_id: oldBackup.id,
          metadata: {
            license_id: licenseId,
            client_id: oldBackup.client_id,
            object_key: oldBackup.object_key,
            size_bytes: oldBackup.size_bytes,
            created_at: oldBackup.created_at,
            uploaded_at: oldBackup.uploaded_at,
            reason: `Retention policy enforced (${verifiedTop.length} verified backups kept)`,
          },
        });
      } catch (auditErr) {
        console.warn("AuditLog creation failed for retention deletion:", auditErr);
      }

      deletedCount++;
    } catch (e: any) {
      console.error(`Error deleting old backup ${oldBackup.id}:`, e);
      errorCount++;
    }
  }

  return {
    kept: toKeep.length,
    deleted: deletedCount,
    errors: errorCount,
  };
}

/**
 * Maintenance job: Runs retention cleanup across ALL licenses.
 */
export async function cleanupAllLicensesBackups(): Promise<{
  licensesProcessed: number;
  totalDeleted: number;
  totalKept: number;
  errors: number;
}> {
  await connectToDatabase();

  const licenseIds = await CloudBackup.distinct("license_id", {
    status: "uploaded",
  });

  const s3 = getS3Client();
  let totalDeleted = 0;
  let totalKept = 0;
  let totalErrors = 0;

  for (const licId of licenseIds) {
    if (!licId) continue;
    try {
      const res = await enforceBackupRetention(licId, s3);
      totalDeleted += res.deleted;
      totalKept += res.kept;
      totalErrors += res.errors;
    } catch (licErr) {
      console.error(`Retention cleanup failed for license ${licId}:`, licErr);
      totalErrors++;
    }
  }

  return {
    licensesProcessed: licenseIds.length,
    totalDeleted,
    totalKept,
    errors: totalErrors,
  };
}
