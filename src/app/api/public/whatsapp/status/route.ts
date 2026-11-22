import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { refreshWhatsAppConnectionStatus } from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function GET(req: NextRequest) {
  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: false,
    rateBucket: "status",
    rateMaxPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  try {
    const res = await refreshWhatsAppConnectionStatus({
      licenseId: auth.identity.license.id,
      actorName: auth.operatorName,
    });
    return whatsappJson(res);
  } catch (err: any) {
    console.error("[whatsapp/status GET]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Could not check WhatsApp connection status." }, 500);
  }
}
