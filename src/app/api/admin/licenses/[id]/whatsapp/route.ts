import { NextRequest, NextResponse } from "next/server";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import {
  getRecentWhatsAppDeliveries,
  getWhatsAppIntegration,
  sanitizeIntegrationForClient,
} from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminRequest(req);
    const { id } = await params;
    await connectToDatabase();

    const license: any = await License.findOne({ id }).select("id license_key client_id project_id").lean();
    if (!license) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    const integration = await getWhatsAppIntegration(license.id);
    const settings = await sanitizeIntegrationForClient(integration, license.id);
    const recentDeliveries = integration ? await getRecentWhatsAppDeliveries(license.id, 15) : [];

    // Strict redaction for Super Admin: NEVER expose API token, only masked sender/recipients/tokenMask
    return NextResponse.json({
      ok: true,
      licenseId: license.id,
      status: settings.connectionStatus,
      statusMessage: settings.statusMessage,
      configured: settings.configured,
      enabled: settings.enabled,
      provider: settings.provider,
      planTier: settings.planTier,
      maskedSender: settings.maskedSenderNumber,
      tokenMask: settings.tokenMask,
      recipientCount: settings.recipients.length,
      lastVerifiedAt: settings.lastVerifiedAt,
      lastSuccessfulMessageAt: settings.lastSuccessfulMessageAt,
      lastError: settings.lastError,
      recentDeliveries,
    });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/licenses/[id]/whatsapp GET]", err?.message);
    return NextResponse.json({ error: "Failed loading WhatsApp integration status" }, { status: 500 });
  }
}
