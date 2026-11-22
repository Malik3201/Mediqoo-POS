import { NextRequest } from "next/server";
import {
  authenticatePosWhatsAppRequest,
  whatsappJson,
  whatsappOptionsResponse,
} from "@/lib/whatsapp/http";
import { processAlertEventsBatch } from "@/lib/whatsapp/service";
import type { IncomingWhatsAppAlertEvent } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_EVENTS_PER_BATCH = 50;

export async function OPTIONS() {
  return whatsappOptionsResponse();
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return whatsappJson({ ok: false, error: "invalid_json", message: "Invalid JSON body." }, 400);
  }

  const auth = await authenticatePosWhatsAppRequest(req, {
    requireMainSeat: false,
    rateBucket: "events",
    rateMaxPerMin: 30,
    body,
  });
  if (!auth.ok) return auth.response;

  const rawEvents = Array.isArray(body?.events) ? body.events : null;
  if (!rawEvents || rawEvents.length === 0) {
    return whatsappJson({ ok: false, error: "empty_events", message: "events array is required." }, 400);
  }
  if (rawEvents.length > MAX_EVENTS_PER_BATCH) {
    return whatsappJson(
      {
        ok: false,
        error: "batch_too_large",
        message: `Maximum ${MAX_EVENTS_PER_BATCH} alert events allowed per batch.`,
      },
      400
    );
  }

  try {
    const summary = await processAlertEventsBatch({
      license: auth.identity.license,
      events: rawEvents as IncomingWhatsAppAlertEvent[],
    });

    return whatsappJson({
      ok: true,
      accepted: summary.accepted,
      duplicates: summary.duplicates,
      ignored: summary.ignored,
      failed: summary.failed,
      paused: summary.paused,
      connectionStatus: summary.connectionStatus,
      results: summary.results,
    });
  } catch (err: any) {
    console.error("[whatsapp/events POST]", err?.message);
    return whatsappJson({ ok: false, error: "server_error", message: "Failed processing alert events." }, 500);
  }
}
