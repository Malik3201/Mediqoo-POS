import { NextRequest, NextResponse } from "next/server";
import { verifyDeviceIdentity, type VerifiedIdentity } from "@/lib/ai/license";
import { clientIp, rateLimit } from "@/lib/ai/rate-limit";

export const WHATSAPP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-License-Key, X-Machine-Id, X-Operator-Name, X-Operator-Role, X-App-Version",
};

export function whatsappOptionsResponse() {
  return new NextResponse(null, { status: 204, headers: WHATSAPP_CORS_HEADERS });
}

export function whatsappJson(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...WHATSAPP_CORS_HEADERS, ...(extraHeaders || {}) },
  });
}

export async function authenticatePosWhatsAppRequest(
  req: NextRequest,
  options: {
    requireMainSeat?: boolean;
    rateBucket: string;
    rateMaxPerMin?: number;
    body?: Record<string, unknown> | null;
  }
): Promise<
  | { ok: true; identity: VerifiedIdentity; operatorName: string }
  | { ok: false; response: NextResponse }
> {
  const rl = rateLimit(
    `wa:${options.rateBucket}:${clientIp(req)}`,
    options.rateMaxPerMin ?? 60,
    60_000
  );
  if (!rl.ok) {
    return {
      ok: false,
      response: whatsappJson(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many WhatsApp requests. Please slow down.",
          retryAfterSeconds: rl.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(rl.retryAfterSeconds) }
      ),
    };
  }

  const licenseKey =
    req.headers.get("x-license-key") ||
    (typeof options.body?.license_key === "string" ? options.body.license_key : "");
  const machineId =
    req.headers.get("x-machine-id") ||
    (typeof options.body?.machine_id === "string" ? options.body.machine_id : "");

  const verified = await verifyDeviceIdentity(licenseKey, machineId);
  if (!verified.ok) {
    return {
      ok: false,
      response: whatsappJson(
        {
          ok: false,
          error: verified.error,
          message:
            verified.error === "license_blocked"
              ? "Your POS license is currently inactive or blocked."
              : "Device authorization failed. Re-verify your POS activation.",
        },
        verified.status
      ),
    };
  }

  if (options.requireMainSeat && verified.identity.seat?.role !== "main") {
    return {
      ok: false,
      response: whatsappJson(
        {
          ok: false,
          error: "main_seat_required",
          message: "WhatsApp Owner Alerts are managed from Main POS by an authorized Admin.",
        },
        403
      ),
    };
  }

  const operatorName =
    (req.headers.get("x-operator-name") || "").trim().slice(0, 80) ||
    (typeof options.body?.operator_name === "string" ? options.body.operator_name.trim().slice(0, 80) : "") ||
    "Main POS Admin";

  return { ok: true, identity: verified.identity, operatorName };
}
