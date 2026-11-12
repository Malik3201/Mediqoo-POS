import { NextRequest, NextResponse } from "next/server";
import { webcrypto } from "node:crypto";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";
import { isCloudDashboardEnabled } from "@/lib/status";
import { extractRequestGeo } from "@/lib/geo-location";

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
        const endOfExpiryDay = new Date(expiresAt);
        endOfExpiryDay.setHours(23, 59, 59, 999);

        if (now > endOfExpiryDay) {
          const graceUntil = license.grace_until ? new Date(license.grace_until) : endOfExpiryDay;
          const endOfGraceDay = new Date(graceUntil);
          endOfGraceDay.setHours(23, 59, 59, 999);

          if (now > endOfGraceDay) {
            effective_status = "blocked";
          } else {
            effective_status = "grace";
          }
        }
      }
    } else if (effective_status === "suspended" || effective_status === "revoked") {
      // Keep as suspended/revoked
    }

    // Update seat heartbeat, version, hostname, and silent geolocation
    const updateFields: any = { last_seen_at: now };
    if (body.app_version && typeof body.app_version === "string") {
      updateFields.last_seen_version = body.app_version;
    }
    if (body.hostname && typeof body.hostname === "string") {
      updateFields.hostname = body.hostname;
    }

    try {
      const client = license.client_id
        ? await Client.findOne({ id: license.client_id }).lean()
        : null;
      const geo = extractRequestGeo(
        req,
        body.location,
        client?.address || client?.name || license.notes
      );
      if (geo) {
        updateFields.location = geo;
        if (client && client.location?.source !== "admin_manual") {
          await Client.updateOne(
            { id: client.id },
            {
              $set: {
                location: geo,
                ...(!client.address && geo.address ? { address: geo.address } : {}),
              },
            }
          );
        }
      }
    } catch {
      // Never block license status check on telemetry
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
        billingConfirmedCount = summary.accruedUsageCount;
        billingConfirmedAmount = summary.accruedUsageAmount;
        billingOutstanding = summary.accountOutstanding;
      } catch (e) {
        // Non-critical: billing summary is informational
      }
    }

    // ── Online Orders entitlement (strictly Super-Admin controlled) ──
    let onlineOrdersEnabled = false;
    const isOperational =
      effective_status !== "blocked" &&
      effective_status !== "suspended" &&
      effective_status !== "revoked";

    if (isOperational) {
      if (typeof license.features?.online_orders === "boolean") {
        onlineOrdersEnabled = license.features.online_orders === true;
      } else {
        // One-time backfill for existing pharmacies from authoritative Storefront Worker status
        try {
          const Project = (await import("@/models/Project")).default;
          const {
            callStorefrontManageApi,
            getStorefrontConfigStatus,
            isStorefrontRecordOnlineOrdersActive,
          } = await import("@/lib/storefront/client");

          let resolvedClientId = String(license.client_id || "").trim();
          if (!resolvedClientId && license.project_id) {
            const proj = await Project.findOne({ id: license.project_id }).select({ client_id: 1 }).lean<{ client_id?: string }>();
            if (proj?.client_id) resolvedClientId = String(proj.client_id).trim();
          }

          if (resolvedClientId && getStorefrontConfigStatus().configured) {
            const sfRes = await callStorefrontManageApi(
              `/api/v1/manage/storefronts/by-pharmacy/${encodeURIComponent(resolvedClientId)}`,
              {
                method: "GET",
                actor: {
                  actorType: "portal_owner",
                  actorId: `lic_status_${seat.id}`,
                  actorEmail: "pos-license-status@aivrasol",
                  scopedPharmacyId: resolvedClientId,
                },
              }
            );
            if (sfRes.ok) {
              onlineOrdersEnabled = Boolean(
                sfRes.data?.exists && isStorefrontRecordOnlineOrdersActive(sfRes.data?.storefront)
              );
              await License.updateOne(
                { id: license.id, "features.online_orders": { $exists: false } },
                { $set: { "features.online_orders": onlineOrdersEnabled } }
              );
            }
          }
        } catch {
          // Non-blocking: default to false if Worker unreachable and feature not explicitly enabled
          onlineOrdersEnabled = false;
        }
      }
    }

    const payload = {
      cloud_dashboard_enabled: isCloudDashboardEnabled(license),
      cloud_backup_enabled: license.features?.cloud_backup === true,
      online_orders_enabled: onlineOrdersEnabled,
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
