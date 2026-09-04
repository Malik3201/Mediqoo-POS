import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import CloudBackup from "@/models/CloudBackup";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const { license_key, machine_id } = body;
    const { id } = await params;

    if (!license_key || !machine_id) {
      return NextResponse.json({ error: "missing_credentials" }, { status: 400, headers: CORS });
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

    // 2. Fetch Backup Record
    const backup = await CloudBackup.findOne({ id }).lean();
    if (!backup) {
      return NextResponse.json({ error: "backup_session_not_found" }, { status: 404, headers: CORS });
    }

    // 3. Verify Ownership
    if (backup.license_id !== license.id || backup.client_id !== license.client_id) {
      return NextResponse.json({ error: "unauthorized_backup_access" }, { status: 403, headers: CORS });
    }

    // 4. Idempotency Check
    if (backup.status === "uploaded") {
      return NextResponse.json({
        ok: true,
        already_uploaded: true,
        backup_id: backup.id,
        size_bytes: backup.size_bytes,
        uploaded_at: backup.uploaded_at
      }, { headers: CORS });
    }

    // 5. Verify Object in Storage via HeadObject
    const s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    let headResponse;
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: backup.object_key,
      });
      headResponse = await s3.send(headCommand);
    } catch (headError: any) {
      console.error("HeadObject failed:", headError);
      return NextResponse.json(
        { error: "object_verification_failed", message: "Could not verify backup file in storage bucket. It may not have been uploaded." },
        { status: 400, headers: CORS }
      );
    }

    // 6. Optionally verify size matches
    // Note: headResponse.ContentLength is the actual bytes stored.
    // We update our metadata to reflect truth from storage.
    const actualSize = headResponse.ContentLength || backup.size_bytes;
    
    // We could strictly reject if actualSize !== backup.size_bytes, but it's safer 
    // to just log the correct size so metadata reflects reality.
    // The POS is responsible for uploading exactly what it hashed.

    // 7. Mark Uploaded
    const updated = await CloudBackup.findOneAndUpdate(
      { id, status: "pending_upload" },
      {
        $set: {
          status: "uploaded",
          uploaded_at: new Date(),
          size_bytes: actualSize
        }
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
       // It may have been updated concurrently or deleted
       const check = await CloudBackup.findOne({ id }).lean();
       if (check?.status === "uploaded") {
         return NextResponse.json({
           ok: true,
           already_uploaded: true,
           backup_id: check.id,
         }, { headers: CORS });
       }
       return NextResponse.json({ error: "backup_state_conflict" }, { status: 409, headers: CORS });
    }

    return NextResponse.json({
      ok: true,
      backup_id: updated.id,
      size_bytes: updated.size_bytes,
      uploaded_at: updated.uploaded_at,
    }, { headers: CORS });

  } catch (error: any) {
    console.error("Backup complete error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: CORS });
  }
}
