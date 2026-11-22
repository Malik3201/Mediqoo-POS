import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { sendWhatsAppTestMessage } from "@/lib/whatsapp/service";

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
    rateBucket: "test",
    rateMaxPerMin: 10,
    body,
  });
  if (!auth.ok) return auth.response;

  try {
    const res = await sendWhatsAppTestMessage({
      license: auth.identity.license,
      recipientOverride: typeof body?.recipient === "string" ? body.recipient : undefined,
      actorName: auth.operatorName,
    });

    if (!res.ok) {
      return whatsappJson({ ok: false, error: "test_failed", message: res.error }, res.status);
    }

    return whatsappJson({
      ok: true,
      message: res.message,
      providerMessageId: res.providerMessageId,
      maskedRecipient: res.maskedRecipient,
    });
  } catch (err: any) {
    console.error("[whatsapp/test POST]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Failed sending test message." }, 500);
  }
}
