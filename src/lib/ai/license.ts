import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";

export type EffectiveLicenseStatus = "active" | "grace" | "blocked" | "suspended" | "revoked";

/**
 * Same effective-status rules the existing /api/public/license-status route uses
 * (expiry end-of-day + grace window), re-expressed here so the AI Gateway honours the
 * EXISTING licensing system without duplicating or altering it.
 */
export function deriveEffectiveLicenseStatus(license: any, now: Date = new Date()): EffectiveLicenseStatus {
  const status = license?.status;
  if (status === "suspended") return "suspended";
  if (status === "revoked") return "revoked";
  if (status !== "active") return "blocked";
  if (license.expires_at) {
    const endOfExpiryDay = new Date(license.expires_at);
    endOfExpiryDay.setHours(23, 59, 59, 999);
    if (now > endOfExpiryDay) {
      const graceUntil = license.grace_until ? new Date(license.grace_until) : endOfExpiryDay;
      const endOfGraceDay = new Date(graceUntil);
      endOfGraceDay.setHours(23, 59, 59, 999);
      return now > endOfGraceDay ? "blocked" : "grace";
    }
  }
  return "active";
}

export interface VerifiedIdentity {
  license: any;
  seat: any;
  client: any | null;
  effectiveStatus: EffectiveLicenseStatus;
}

/**
 * Verifies the device identity exactly like the existing license-status endpoint:
 * license_key + machine_id must match a registered seat. The tenant (license/client)
 * is derived ONLY from this lookup — never from a renderer-supplied tenant id.
 */
export async function verifyDeviceIdentity(
  licenseKey: unknown,
  machineId: unknown
): Promise<{ ok: true; identity: VerifiedIdentity } | { ok: false; status: number; error: "unauthorized" | "license_blocked" }> {
  if (typeof licenseKey !== "string" || typeof machineId !== "string" || !licenseKey || !machineId) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (licenseKey.length > 128 || machineId.length > 256) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  await connectToDatabase();
  const license: any = await License.findOne({ license_key: licenseKey }).lean();
  if (!license) return { ok: false, status: 401, error: "unauthorized" };
  const seat: any = await LicenseSeat.findOne({ license_id: license.id, machine_id: machineId }).lean();
  if (!seat) return { ok: false, status: 403, error: "unauthorized" };

  const client: any = await Client.findOne({ id: license.client_id }).lean();
  const effectiveStatus = deriveEffectiveLicenseStatus(license);
  if (effectiveStatus === "blocked" || effectiveStatus === "suspended" || effectiveStatus === "revoked") {
    return { ok: false, status: 403, error: "license_blocked" };
  }
  if (client && client.status && client.status !== "active") {
    return { ok: false, status: 403, error: "license_blocked" };
  }
  return { ok: true, identity: { license, seat, client, effectiveStatus } };
}

