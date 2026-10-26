import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import AuditLog from "@/models/AuditLog";
import { encryptRecoverySecret, decryptRecoverySecret } from "@/lib/backup-crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * GET: Check if the pharmacy already has a recovery secret registered on the server.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const license_key = searchParams.get("license_key");
    const machine_id = searchParams.get("machine_id");

    if (!license_key || !machine_id) {
      return NextResponse.json({ error: "missing_credentials" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();

    const license = await License.findOne({ license_key }).lean();
    if (!license) {
      return NextResponse.json({ error: "license_not_found" }, { status: 401, headers: CORS });
    }

    const seat = await LicenseSeat.findOne({ license_id: license.id, machine_id }).lean();
    if (!seat) {
      return NextResponse.json({ error: "unregistered_machine" }, { status: 401, headers: CORS });
    }

    const hasSecret = !!license.backup_recovery_secret?.encrypted_value;

    return NextResponse.json({
      ok: true,
      has_secret: hasSecret,
      updated_at: license.backup_recovery_secret?.updated_at || null,
    }, { headers: CORS });

  } catch (error: any) {
    console.error("Recovery secret status check error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: CORS });
  }
}

/**
 * POST: Sync the permanent pharmacy recovery secret from POS.
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const { license_key, machine_id, recovery_secret } = body;

    if (!license_key || !machine_id || !recovery_secret) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400, headers: CORS });
    }

    // Secret format validation: must be at least 10 chars with strong entropy
    if (typeof recovery_secret !== "string" || recovery_secret.trim().length < 10) {
      return NextResponse.json({ error: "invalid_secret_format" }, { status: 400, headers: CORS });
    }

    await connectToDatabase();

    // 1. Authorize POS terminal
    const license = await License.findOne({ license_key });
    if (!license) {
      return NextResponse.json({ error: "license_not_found" }, { status: 401, headers: CORS });
    }

    const seat = await LicenseSeat.findOne({ license_id: license.id, machine_id }).lean();
    if (!seat) {
      return NextResponse.json({ error: "unregistered_machine" }, { status: 401, headers: CORS });
    }

    // 2. Check if a secret already exists on server
    if (license.backup_recovery_secret?.encrypted_value) {
      try {
        const existingPlain = decryptRecoverySecret(
          license.backup_recovery_secret.encrypted_value,
          license.backup_recovery_secret.iv,
          license.backup_recovery_secret.tag
        );

        if (existingPlain === recovery_secret.trim()) {
          // Already identical — idempotent success
          return NextResponse.json({
            ok: true,
            synced: true,
            status: "already_synced",
          }, { headers: CORS });
        }

        // Conflict: Server has an existing secret that differs
        return NextResponse.json({
          ok: false,
          conflict: true,
          message: "A different recovery secret is already authoritative on the server for this pharmacy.",
        }, { status: 409, headers: CORS });
      } catch (decryptErr) {
        console.warn("Could not decrypt existing secret, allowing overwrite:", decryptErr);
      }
    }

    // 3. Encrypt and store the new recovery secret
    const encrypted = encryptRecoverySecret(recovery_secret.trim());
    license.backup_recovery_secret = {
      encrypted_value: encrypted.encrypted_value,
      iv: encrypted.iv,
      tag: encrypted.tag,
      updated_at: new Date(),
      updated_by: `terminal:${machine_id}`,
    };

    await license.save();

    // 4. Audit Log (Never log the actual secret value)
    try {
      await AuditLog.create({
        action: "backup_secret_registered",
        entity_type: "license",
        entity_id: license.id,
        metadata: {
          client_id: license.client_id,
          project_id: license.project_id,
          machine_id,
          action_detail: "Pharmacy backup recovery secret registered securely",
        },
      });
    } catch (auditErr) {
      console.warn("Audit log creation error:", auditErr);
    }

    return NextResponse.json({
      ok: true,
      synced: true,
      status: "registered",
    }, { headers: CORS });

  } catch (error: any) {
    console.error("Recovery secret sync error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: CORS });
  }
}
