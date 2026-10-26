import connectToDatabase from "@/lib/db";
import CloudBackup from "@/models/CloudBackup";
import AuditLog from "@/models/AuditLog";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const MAX_RETAINED_BACKUPS = 2;

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

/**
 * Enforces cloud backup retention for a specific license.
 * Keeps only the newest 2 successful ('uploaded') backups.
 * Deletes older backup objects from R2 storage and marks records as deleted.
 */
export async function enforceBackupRetention(
  licenseId: string,
  existingS3?: S3Client | null
): Promise<{ kept: number; deleted: number; errors: number }> {
  await connectToDatabase();

  // Find all active uploaded backups for this license, newest first
  const backups = await CloudBackup.find({
    license_id: licenseId,
    status: "uploaded",
  })
    .sort({ uploaded_at: -1, created_at: -1 })
    .lean();

  if (backups.length <= MAX_RETAINED_BACKUPS) {
    return { kept: backups.length, deleted: 0, errors: 0 };
  }

  const s3 = existingS3 || getS3Client();
  const bucketName = process.env.R2_BUCKET_NAME;

  const toKeep = backups.slice(0, MAX_RETAINED_BACKUPS);
  const toDelete = backups.slice(MAX_RETAINED_BACKUPS);

  let deletedCount = 0;
  let errorCount = 0;

  for (const oldBackup of toDelete) {
    try {
      // 1. Delete object from R2 Cloud Object Storage if S3 is configured
      if (s3 && bucketName && oldBackup.object_key) {
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
          // Still proceed with metadata update so stale records don't show
        }
      }

      // 2. Mark metadata status as 'deleted' with timestamp
      await CloudBackup.updateOne(
        { id: oldBackup.id },
        {
          $set: {
            status: "deleted",
            deleted_at: new Date(),
          },
        }
      );

      // 3. Create AuditLog entry
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
            reason: `Retention policy exceeded (${MAX_RETAINED_BACKUPS} newest backups kept)`,
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
 * Idempotent: can be run anytime safely to prune backups > 2 per license.
 */
export async function cleanupAllLicensesBackups(): Promise<{
  licensesProcessed: number;
  totalDeleted: number;
  totalKept: number;
  errors: number;
}> {
  await connectToDatabase();

  // Find distinct license IDs with uploaded backups
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
