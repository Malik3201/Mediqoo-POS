import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import CloudBackup from "@/models/CloudBackup";
import AuditLog from "@/models/AuditLog";
import { decryptRecoverySecret } from "@/lib/backup-crypto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await connectToDatabase();

    const license = await License.findOne({ id }).lean();
    if (!license) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    // 1. Fetch latest 2 uploaded backups for this license
    const backups = await CloudBackup.find({
      license_id: license.id,
      status: "uploaded",
    })
      .sort({ uploaded_at: -1, created_at: -1 })
      .limit(2)
      .lean();

    // 2. Check if recovery secret exists
    if (!license.backup_recovery_secret?.encrypted_value) {
      return NextResponse.json({
        ok: true,
        has_secret: false,
        recovery_secret: null,
        backups: backups.map((b) => ({
          id: b.id,
          original_filename: b.original_filename,
          size_bytes: b.size_bytes,
          uploaded_at: b.uploaded_at,
          created_at: b.created_at,
          app_version: b.app_version,
          backup_type: b.backup_type,
        })),
      });
    }

    // 3. Decrypt the recovery secret
    let plainSecret = "";
    try {
      plainSecret = decryptRecoverySecret(
        license.backup_recovery_secret.encrypted_value,
        license.backup_recovery_secret.iv,
        license.backup_recovery_secret.tag
      );
    } catch (decryptErr) {
      console.error("Failed to decrypt recovery secret for admin reveal:", decryptErr);
      return NextResponse.json(
        { error: "decryption_failed", message: "Failed to decrypt secret with server key." },
        { status: 500 }
      );
    }

    // 4. Audit Log (Requirement 12: Do NOT log actual secret value)
    try {
      await AuditLog.create({
        action: "backup_secret_revealed",
        actor_id: token.sub || (token as any).id,
        actor_email: token.email,
        entity_type: "license",
        entity_id: license.id,
        metadata: {
          client_id: license.client_id,
          project_id: license.project_id,
          action_detail: "Admin revealed pharmacy backup recovery secret",
        },
      });
    } catch (auditErr) {
      console.warn("AuditLog creation failed on secret reveal:", auditErr);
    }

    return NextResponse.json({
      ok: true,
      has_secret: true,
      recovery_secret: plainSecret,
      updated_at: license.backup_recovery_secret.updated_at,
      backups: backups.map((b) => ({
        id: b.id,
        original_filename: b.original_filename,
        size_bytes: b.size_bytes,
        uploaded_at: b.uploaded_at,
        created_at: b.created_at,
        app_version: b.app_version,
        backup_type: b.backup_type,
      })),
    });

  } catch (error: any) {
    console.error("Admin backup-secret route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
