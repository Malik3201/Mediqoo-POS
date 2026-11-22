import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { requestWhatsAppQr } from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: true,
    rateBucket: "connect-qr",
    rateMaxPerMin: 20,
    body,
  });
  if (!auth.ok) return auth.response;

  try {
    const res = await requestWhatsAppQr({
      licenseId: auth.identity.license.id,
      actorName: auth.operatorName,
    });
    if (!res.ok) {
      return whatsappJson({ ok: false, error: "qr_failed", message: res.error }, res.status);
    }
    return whatsappJson(res);
  } catch (err: any) {
    console.error("[whatsapp/connect/qr POST]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Could not request WhatsApp QR code." }, 500);
  }
}
