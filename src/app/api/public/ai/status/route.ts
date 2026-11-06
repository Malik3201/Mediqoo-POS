import { NextRequest, NextResponse } from "next/server";
import { handleStatus } from "@/lib/ai/gateway";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";
import { extractRequestGeo } from "@/lib/geo-location";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`ai-status:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "too_many_concurrent", message: "Too many requests." }, { status: 429, headers: CORS });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request", message: "Invalid request." }, { status: 400, headers: CORS });
  }
  try {
    const res = await handleStatus(body);
    if (body?.license_key && body?.machine_id) {
      // Non-blocking background location capture from Vercel geo headers / body
      (async () => {
        try {
          await connectToDatabase();
          const lic = await License.findOne({ license_key: body.license_key }).lean();
          if (!lic) return;
          const client = lic.client_id ? await Client.findOne({ id: lic.client_id }).lean() : null;
          const geo = extractRequestGeo(req, body.location, client?.address || client?.name || lic.notes);
          if (geo) {
            await LicenseSeat.updateOne(
              { license_id: lic.id, machine_id: body.machine_id },
              { $set: { last_seen_at: new Date(), location: geo } }
            );
            if (client && client.location?.source !== "admin_manual") {
              await Client.updateOne({ id: client.id }, { $set: { location: geo } });
            }
          }
        } catch {
          // Ignore telemetry errors
        }
      })();
    }
    return NextResponse.json(res.body, { status: res.status, headers: CORS });
  } catch (e) {
    console.error("[ai/status] unexpected error:", (e as Error)?.message);
    return NextResponse.json({ ok: true, state: "unavailable", enabled: true, message: "AI is temporarily unavailable." }, { status: 200, headers: CORS });
  }
}

