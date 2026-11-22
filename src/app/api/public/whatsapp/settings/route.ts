import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import {
  getWhatsAppIntegration,
  sanitizeIntegrationForClient,
  saveWhatsAppSettings,
  type SaveWhatsAppSettingsInput,
} from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function GET(req: NextRequest) {
  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: false,
    rateBucket: "settings-get",
    rateMaxPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  try {
    const integration = await getWhatsAppIntegration(auth.identity.license.id);
    const settings = await sanitizeIntegrationForClient(integration, auth.identity.license.id);
    return whatsappJson({
      ok: true,
      seatRole: auth.identity.seat?.role || "client",
      canManage: auth.identity.seat?.role === "main",
      settings,
    });
  } catch (err: any) {
    console.error("[whatsapp/settings GET]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Could not load WhatsApp settings." }, 500);
  }
}

export async function PUT(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return whatsappJson({ ok: false, error: "invalid_json", message: "Invalid JSON body." }, 400);
  }

  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: true,
    rateBucket: "settings-put",
    rateMaxPerMin: 20,
    body,
  });
  if (!auth.ok) return auth.response;

  try {
    const input: SaveWhatsAppSettingsInput = {
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      planTier: body?.planTier === "business" || body?.planTier === "developer" ? body.planTier : undefined,
      apiUrl: typeof body?.apiUrl === "string" ? body.apiUrl : undefined,
      instanceId: typeof body?.instanceId === "string" ? body.instanceId : undefined,
      apiToken: typeof body?.apiToken === "string" ? body.apiToken : undefined,
      recipients: Array.isArray(body?.recipients) ? body.recipients : undefined,
      verifyRecipients: Boolean(body?.verifyRecipients),
      timezone: typeof body?.timezone === "string" ? body.timezone : undefined,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      preferences: body?.preferences && typeof body.preferences === "object" ? body.preferences : undefined,
      thresholds: body?.thresholds && typeof body.thresholds === "object" ? body.thresholds : undefined,
      schedule: body?.schedule && typeof body.schedule === "object" ? body.schedule : undefined,
    };

    const res = await saveWhatsAppSettings({
      licenseId: auth.identity.license.id,
      input,
      actorName: auth.operatorName,
    });

    if (!res.ok) {
      return whatsappJson({ ok: false, error: "validation_error", message: res.error }, res.status);
    }

    return whatsappJson({
      ok: true,
      settings: res.settings,
      warnings: res.warnings,
    });
  } catch (err: any) {
    console.error("[whatsapp/settings PUT]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Failed saving WhatsApp settings." }, 500);
  }
}
