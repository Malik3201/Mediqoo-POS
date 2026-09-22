import { NextRequest, NextResponse } from "next/server";
import { webcrypto } from "node:crypto";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import { isCloudDashboardEnabled } from "@/lib/status";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const cryptoWeb = webcrypto as any;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function ed25519Sign(seedInput: string, message: Uint8Array) {
  const ed = await import("@noble/ed25519");
  const { sha512 } = await import("@noble/hashes/sha2.js");
  (ed as any).hashes ||= {};
  (ed as any).hashes.sha512 = sha512;

  const hex = seedInput.replace(/[^0-9a-fA-F]/g, "");
  const seed =
    hex.length >= 64
      ? hexToBytes(hex).slice(0, 32)
      : new Uint8Array(
          await cryptoWeb.subtle.digest(
            "SHA-256",
            toBytes(seedInput) as unknown as BufferSource,
          ),
        );
  if (seed.length !== 32) throw new Error("Signing seed must be 32 bytes");
  const publicKey = ed.getPublicKey(seed);
  const signature = ed.sign(message, seed);
  return { publicKey, signature };
}

function canonicalSerialize(payload: any): string {
  // Extract keys and sort them to guarantee stable JSON representation
  const sortedPayload: any = {};
  Object.keys(payload).sort().forEach(key => {
    sortedPayload[key] = payload[key];
  });
  return JSON.stringify(sortedPayload);
}

async function signPayload(payload: any) {
  const seedInput = process.env.LICENSE_STATUS_SIGNING_SEED;
  if (!seedInput) {
    throw new Error("Server configuration error: missing LICENSE_STATUS_SIGNING_SEED");
  }

  const dataString = canonicalSerialize(payload);
  const dataBytes = toBytes(dataString);
  const { signature } = await ed25519Sign(seedInput, dataBytes);
  
  return {
    format: "aivrasol-license-status/1",
    metadata: payload,
    signature: b64encode(signature as Uint8Array),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.license_key || !body.machine_id) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    const license = await License.findOne({ license_key: body.license_key }).lean();
    if (!license) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS }
      );
    }

    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: body.machine_id,
    }).lean();

    if (!seat) {
      return NextResponse.json(
        { error: "unregistered_machine" },
        { status: 403, headers: CORS }
      );
    }

    // Calculate effective operational status
    const now = new Date();
    let effective_status = license.status;

    if (effective_status === "active") {
      if (license.expires_at) {
        const expiresAt = new Date(license.expires_at);
        if (now > expiresAt) {
          const graceUntil = license.grace_until ? new Date(license.grace_until) : expiresAt;
          if (now > graceUntil) {
            effective_status = "blocked";
          } else {
            effective_status = "grace";
          }
        }
      }
    } else if (effective_status === "suspended" || effective_status === "revoked") {
      // Keep as suspended/revoked
    }

    // Update seat heartbeat and version
    const updateFields: any = { last_seen_at: now };
    if (body.app_version && typeof body.app_version === "string") {
      updateFields.last_seen_version = body.app_version;
    }
    await LicenseSeat.updateOne({ _id: seat._id }, { $set: updateFields });

    // ── Billing summary (for per_invoice signed display on POS) ──
    let billingConfirmedCount = 0;
    let billingConfirmedAmount = 0;
    let billingOutstanding = 0;
    let billingCycleStart: string | null = null;
    let billingCycleEnd: string | null = null;

    if (license.billing?.model === "per_invoice" && license.billing?.enabled) {
      try {
        const BillingUsage = (await import("@/models/BillingUsage")).default;
        const LicenseBillingPeriod = (await import("@/models/LicenseBillingPeriod")).default;
        const LicensePayment = (await import("@/models/LicensePayment")).default;
        const BillingAdjustment = (await import("@/models/BillingAdjustment")).default;
        const { getLicenseBillingSummary } = await import("@/lib/billing");
        
        const summary = await getLicenseBillingSummary(
          license.id,
          { LicenseBillingPeriod, BillingUsage, BillingAdjustment, LicensePayment }
        );

        if (summary.currentPeriod) {
          billingCycleStart = (summary.currentPeriod as any).period_start?.toISOString?.() 
            || new Date((summary.currentPeriod as any).period_start).toISOString();
          billingCycleEnd = (summary.currentPeriod as any).period_end?.toISOString?.() 
            || new Date((summary.currentPeriod as any).period_end).toISOString();
        }
        billingConfirmedCount = summary.usageCount;
        billingConfirmedAmount = summary.usageAmount;
        billingOutstanding = summary.outstanding;
      } catch (e) {
        // Non-critical: billing summary is informational
      }
    }

    const payload = {
      cloud_dashboard_enabled: isCloudDashboardEnabled(license),
      cloud_backup_enabled: license.features?.cloud_backup === true,
      effective_status,
      expires_at: license.expires_at ? license.expires_at.toISOString() : null,
      grace_until: license.grace_until ? license.grace_until.toISOString() : null,
      issued_at: license.issued_at ? license.issued_at.toISOString() : null,
      license_id: license.id,
      license_version: license.license_version || 1,
      machine_id: seat.machine_id,
      seat_id: seat.id,
      billing_model: license.billing?.model || "fixed",
      billing_rate_per_invoice: license.billing?.rate_per_invoice || 0,
      billing_confirmed_count: billingConfirmedCount,
      billing_confirmed_amount: billingConfirmedAmount,
      billing_outstanding: billingOutstanding,
      billing_cycle_start: billingCycleStart,
      billing_cycle_end: billingCycleEnd,
    };

    const signedResponse = await signPayload(payload);

    return NextResponse.json(signedResponse, { headers: CORS });
  } catch (e: any) {
    console.error("License status API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS }
    );
  }
}
