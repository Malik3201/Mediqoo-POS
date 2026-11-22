import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import CloudBackup from "@/models/CloudBackup";
import WhatsAppIntegration from "@/models/WhatsAppIntegration";
import AuditLog from "@/models/AuditLog";
import { decryptRecoverySecret } from "@/lib/backup-crypto";
import { maskPhoneNumber } from "@/lib/whatsapp/crypto";
import { resolveCloudServicesState, type CloudServicesSummary } from "@/lib/cloud-services";

export const dynamic = "force-dynamic";

/**
 * Safely checks whether an existing encrypted recovery secret is intact without ever
 * returning plaintext, rotating, or overwriting it.
 */
function inspectRecoveryState(license: any): {
  hasRecoverySecret: boolean;
  recoveryConflict: boolean;
  recoveryUpdatedAt: Date | null;
} {
  const rec = license?.backup_recovery_secret;
  if (!rec?.encrypted_value) {
    return { hasRecoverySecret: false, recoveryConflict: false, recoveryUpdatedAt: null };
  }
  try {
    const plain = decryptRecoverySecret(rec.encrypted_value, rec.iv, rec.tag);
    if (!plain || plain.trim().length < 10) {
      return { hasRecoverySecret: true, recoveryConflict: true, recoveryUpdatedAt: rec.updated_at || null };
    }
    return { hasRecoverySecret: true, recoveryConflict: false, recoveryUpdatedAt: rec.updated_at || null };
  } catch {
    return { hasRecoverySecret: true, recoveryConflict: true, recoveryUpdatedAt: rec.updated_at || null };
  }
}

async function buildCloudServicesResponse(license: any): Promise<CloudServicesSummary> {
  const [waDoc, backupCount] = await Promise.all([
    WhatsAppIntegration.findOne({ license_id: license.id })
      .select(
        "enabled connection_status sender_number recipients last_successful_message_at last_error api_url instance_id token_mask"
      )
      .lean()
      .catch(() => null),
    CloudBackup.countDocuments({ license_id: license.id, status: "uploaded" }).catch(() => 0),
  ]);

  const w: any = waDoc;
  const waConfigured = Boolean(w?.api_url && w?.instance_id && w?.token_mask);
  const recoveryInfo = inspectRecoveryState(license);

  return resolveCloudServicesState({
    features: license.features,
    hasRecoverySecret: recoveryInfo.hasRecoverySecret,
    recoveryConflict: recoveryInfo.recoveryConflict,
    recoveryUpdatedAt: recoveryInfo.recoveryUpdatedAt,
    backupCount,
    whatsappAlerts: w
      ? {
          status: waConfigured ? w.connection_status || "waiting_for_qr" : "not_configured",
          configured: waConfigured,
          enabled: Boolean(w.enabled),
          maskedSender: w.sender_number ? maskPhoneNumber(w.sender_number) : null,
          recipientCount: Array.isArray(w.recipients) ? w.recipients.length : 0,
          lastSuccessfulMessageAt: w.last_successful_message_at || null,
          lastError: w.last_error || null,
        }
      : null,
  });
}

/**
 * GET /api/admin/licenses/[id]/cloud-services
 * Returns safe consolidated Cloud Services state for a single license (zero secrets exposed).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const state = await buildCloudServicesResponse(license);
    return NextResponse.json({
      ok: true,
      license_version: license.license_version || 1,
      ...state,
    });
  } catch (error: any) {
    console.error("Cloud Services GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/licenses/[id]/cloud-services
 * Controlled server-side orchestration to enable or disable Cloud Services atomically.
 *
 * - Reuses existing authoritative License feature flags:
 *   `features.cloud_dashboard`, `features.cloud_backup`, `features.whatsapp_alerts`
 * - Increments `license_version` atomically so POS signed license-status updates immediately.
 * - NEVER rotates or overwrites an existing recovery secret.
 * - NEVER deletes cloud data, backups, recovery secret, or WhatsApp config on disable.
 * - NEVER marks WhatsApp as falsely Connected when GREEN-API setup/QR is not completed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Invalid request body: 'enabled' boolean is required" },
        { status: 400 }
      );
    }

    const enabled: boolean = body.enabled;
    await connectToDatabase();

    const existing = await License.findOne({ id }).lean();
    if (!existing) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    const alreadyMatches =
      existing.features?.cloud_dashboard === enabled &&
      existing.features?.cloud_backup === enabled &&
      existing.features?.whatsapp_alerts === enabled;

    let licenseDoc: any = existing;
    let changed = false;

    if (!alreadyMatches) {
      const updated = await License.findOneAndUpdate(
        { id },
        {
          $set: {
            "features.cloud_dashboard": enabled,
            "features.cloud_backup": enabled,
            "features.whatsapp_alerts": enabled,
          },
          $inc: { license_version: 1 },
        },
        { new: true }
      ).lean();

      if (!updated) {
        return NextResponse.json({ error: "License update failed" }, { status: 500 });
      }
      licenseDoc = updated;
      changed = true;

      try {
        await AuditLog.create({
          action: enabled ? "cloud_services_enabled" : "cloud_services_disabled",
          actor_id: token.sub || (token as any).id,
          actor_email: token.email,
          entity_type: "license",
          entity_id: licenseDoc.id,
          metadata: {
            client_id: licenseDoc.client_id,
            project_id: licenseDoc.project_id,
            cloud_dashboard: enabled,
            cloud_backup: enabled,
            whatsapp_alerts: enabled,
            preserved_recovery_secret: Boolean(licenseDoc.backup_recovery_secret?.encrypted_value),
          },
        });
      } catch (auditErr) {
        console.warn("AuditLog failed on cloud-services mutation:", auditErr);
      }
    }

    const state = await buildCloudServicesResponse(licenseDoc);

    return NextResponse.json({
      ok: true,
      changed,
      license_version: licenseDoc.license_version || 1,
      cloud_dashboard_enabled: licenseDoc.features?.cloud_dashboard === true,
      cloud_backup_enabled: licenseDoc.features?.cloud_backup === true,
      whatsapp_alerts_available: licenseDoc.features?.whatsapp_alerts === true,
      ...state,
    });
  } catch (error: any) {
    console.error("Cloud Services POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
