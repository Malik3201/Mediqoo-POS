import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import CloudBackup from "@/models/CloudBackup";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// 250 MB encrypted file size limit
const MAX_UPLOAD_SIZE = 250 * 1024 * 1024;
// 30 Minutes TTL
const PRESIGNED_URL_EXPIRES_IN = 30 * 60;

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const {
      license_key,
      machine_id,
      backup_type,
      period_key,
      original_filename,
      format,
      backup_version,
      app_version,
      schema_version,
      source_created_at,
      size_bytes,
      checksum_sha256,
      terminal_role,
      terminal_number,
    } = body;

    if (!license_key || !machine_id) {
      return NextResponse.json({ error: "missing_credentials" }, { status: 400, headers: CORS });
    }

    if (!size_bytes || typeof size_bytes !== "number") {
      return NextResponse.json({ error: "missing_size" }, { status: 400, headers: CORS });
    }

    if (size_bytes > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: "backup_too_large" }, { status: 413, headers: CORS });
    }

    if (!backup_type || !["manual", "day_end", "weekly", "month_end"].includes(backup_type)) {
      return NextResponse.json({ error: "invalid_backup_type" }, { status: 400, headers: CORS });
    }

    if (format !== "aivrasol-backup" || !backup_version || !original_filename) {
      return NextResponse.json({ error: "invalid_format_metadata" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();

    // 1. Authorize POS
    const license = await License.findOne({ license_key }).lean();
    if (!license) {
      return NextResponse.json({ error: "license_not_found" }, { status: 401, headers: CORS });
    }

    const seat = await LicenseSeat.findOne({ license_id: license.id, machine_id }).lean();
    if (!seat) {
      return NextResponse.json({ error: "unregistered_machine" }, { status: 401, headers: CORS });
    }

    // 2. Feature Entitlement
    if (license.features?.cloud_backup !== true) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Cloud Backup is not enabled for this license." },
        { status: 403, headers: CORS }
      );
    }

    // 3. Operational Status Validation
    // For uploads, we derive effective status to ensure they aren't blocked.
    // If active or grace -> allowed.
    let effective_status = license.status;
    const now = new Date();
    if (effective_status === "active" && license.expires_at) {
      if (now > new Date(license.expires_at)) {
        const graceUntil = license.grace_until ? new Date(license.grace_until) : new Date(license.expires_at);
        if (now > graceUntil) {
          effective_status = "blocked";
        } else {
          effective_status = "grace";
        }
      }
    }
    if (["blocked", "suspended", "revoked"].includes(effective_status)) {
      return NextResponse.json(
        { error: "license_inactive", message: `License is currently ${effective_status}. Backups cannot be uploaded.` },
        { status: 403, headers: CORS }
      );
    }

    // 4. Determine object key
    // backups/<client_id>/<license_id>/<uuid>.aivrabak
    // (We'll generate the UUID inside CloudBackup schema but we can generate it now to use as object_key)
    const crypto = require("crypto");
    const backupId = crypto.randomUUID();
    const objectKey = `backups/${license.client_id}/${license.id}/${backupId}.aivrabak`;

    // 5. Check if scheduled idempotency applies
    if (backup_type !== "manual" && period_key) {
      const existing = await CloudBackup.findOne({
        license_id: license.id,
        backup_type,
        period_key,
        status: "uploaded",
      }).lean();
      if (existing) {
        return NextResponse.json({ error: "duplicate_period_backup" }, { status: 409, headers: CORS });
      }
    }

    // 6. Create Pending Metadata Record
    const backupRecord = await CloudBackup.create({
      id: backupId,
      client_id: license.client_id,
      license_id: license.id,
      backup_type,
      period_key: period_key || null,
      status: "pending_upload",
      object_key: objectKey,
      original_filename: String(original_filename).slice(0, 200), // sanitize length
      format,
      backup_version,
      app_version,
      schema_version,
      created_at: new Date(),
      size_bytes,
      checksum_sha256,
      terminal_role,
      terminal_number,
      source_created_at: source_created_at ? new Date(source_created_at) : undefined,
    });

    // 7. Generate Signed PUT URL
    const s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: objectKey,
      ContentType: "application/octet-stream",
      // Include checksum as custom metadata if client provides it
      ...(checksum_sha256 ? { Metadata: { "client-sha256": checksum_sha256 } } : {})
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });

    return NextResponse.json({
      ok: true,
      backup_id: backupRecord.id,
      upload_url: uploadUrl,
      expires_at: new Date(Date.now() + PRESIGNED_URL_EXPIRES_IN * 1000).toISOString(),
    }, { headers: CORS });

  } catch (error: any) {
    // Only catch schema unique violation explicitly if period duplicate races
    if (error.code === 11000) {
      return NextResponse.json({ error: "duplicate_period_backup" }, { status: 409, headers: CORS });
    }
    console.error("Backup upload-session error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: CORS });
  }
}
