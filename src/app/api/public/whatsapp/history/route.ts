import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { getRecentWhatsAppDeliveries } from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function GET(req: NextRequest) {
  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: false,
    rateBucket: "history",
    rateMaxPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  try {
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 25);
    const items = await getRecentWhatsAppDeliveries(auth.identity.license.id, Number.isFinite(limitParam) ? limitParam : 25);
    return whatsappJson({ ok: true, items });
  } catch (err: any) {
    console.error("[whatsapp/history GET]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Could not load recent WhatsApp alerts." }, 500);
  }
}
