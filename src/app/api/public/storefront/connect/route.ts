import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";
import Project from "@/models/Project";
import StorefrontPairingCode from "@/models/StorefrontPairingCode";
import {
  callStorefrontManageApi,
  getStorefrontConfigStatus,
  getStorefrontPublicPreviewUrl,
  signStorefrontSyncToken,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// In-memory per-instance rate limit guard against brute-force pairing/connect attempts
const attemptBuckets = new Map<string, { count: number; resetAt: number }>();

function checkConnectRateLimit(key: string, maxPerMin = 20): boolean {
  const now = Date.now();
  const cur = attemptBuckets.get(key);
  if (!cur || now > cur.resetAt) {
    attemptBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (cur.count >= maxPerMin) return false;
  cur.count += 1;
  return true;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/public/storefront/connect
 *
 * Authenticates a real activated POS terminal using its verified `license_key` + `machine_id`
 * (and optional single-use Owner Portal `pairing_code`), resolves the authoritative `client_id`
 * from MongoDB (`License` -> `Client`), and returns scoped connection credentials ONLY if
 * Super Admin has provisioned and enabled a website for that exact pharmacy identity.
 */
export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const licenseKey = String(body?.license_key || "").trim();
    const machineId = String(body?.machine_id || "").trim();
    const rawPairingCode = String(body?.pairing_code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!licenseKey || !machineId) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_license_identity",
          message: "Active POS license and registered terminal identity are required.",
        },
        { status: 400, headers: CORS }
      );
    }

    if (!checkConnectRateLimit(`${ip}:${licenseKey.slice(0, 12)}`, 20)) {
      return NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many connection attempts. Please wait a minute and try again.",
        },
        { status: 429, headers: CORS }
      );
    }

    await connectToDatabase();

    // 1. Verify active POS License
    const license = await License.findOne({ license_key: licenseKey }).lean<{
      id: string;
      client_id: string;
      project_id: string;
      status: string;
      features?: Record<string, any>;
    }>();

    if (!license) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_license",
          message: "POS license key was not recognized.",
        },
        { status: 401, headers: CORS }
      );
    }

    if (license.status !== "active" && license.status !== "trial") {
      return NextResponse.json(
        {
          ok: false,
          error: "license_inactive",
          message: `POS license is currently ${license.status}.`,
        },
        { status: 403, headers: CORS }
      );
    }

    if (license.features?.online_orders === false) {
      return NextResponse.json(
        {
          ok: true,
          connected: false,
          status: "disabled_by_admin",
          license_id: license.id,
          message: "Online Orders feature is not enabled for this pharmacy license by Super Admin.",
        },
        { status: 200, headers: CORS }
      );
    }

    // 2. Verify registered physical terminal seat on this license
    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: machineId,
    }).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json(
        {
          ok: false,
          error: "unregistered_machine",
          message: "This POS terminal is not registered under the active pharmacy license.",
        },
        { status: 403, headers: CORS }
      );
    }

    // 3. Resolve authoritative client_id strictly from relational IDs (never by name!)
    let verifiedClientId = String(license.client_id || "").trim();
    if (!verifiedClientId && license.project_id) {
      const proj = await Project.findOne({ id: license.project_id }).lean<{ client_id: string }>();
      if (proj?.client_id) verifiedClientId = proj.client_id;
    }

    if (!verifiedClientId) {
      return NextResponse.json(
        {
          ok: false,
          error: "client_identity_missing",
          message: "No verified client identity is linked to this license.",
        },
        { status: 403, headers: CORS }
      );
    }

    const [clientDoc, projDoc] = await Promise.all([
      Client.findOne({ id: verifiedClientId }).lean<{
        id: string;
        name: string;
      }>(),
      license.project_id
        ? Project.findOne({ id: license.project_id }).lean<{
            id: string;
            name?: string;
            branding?: { store_name?: string };
          }>()
        : Project.findOne({ client_id: verifiedClientId }).lean<{
            id: string;
            name?: string;
            branding?: { store_name?: string };
          }>(),
    ]);
    const verifiedPharmacyName =
      (projDoc?.branding?.store_name && projDoc.branding.store_name.trim()) ||
      (projDoc?.name && projDoc.name.trim()) ||
      clientDoc?.name ||
      "Pharmacy";

    // 4. Optional single-use pairing code verification (strictly bound to verifiedClientId)
    if (rawPairingCode) {
      const pairing = await StorefrontPairingCode.findOne({ code: rawPairingCode });
      if (!pairing || pairing.used_at || pairing.expires_at.getTime() < Date.now()) {
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_or_expired_pairing_code",
            message: "Pairing code is invalid, expired, or has already been used.",
          },
          { status: 400, headers: CORS }
        );
      }
      if (pairing.client_id !== verifiedClientId) {
        pairing.failed_attempts = (pairing.failed_attempts || 0) + 1;
        await pairing.save();
        return NextResponse.json(
          {
            ok: false,
            error: "pharmacy_identity_mismatch",
            message:
              "Security block: This pairing code belongs to a different pharmacy and cannot be used on this POS.",
          },
          { status: 403, headers: CORS }
        );
      }
      pairing.used_at = new Date();
      pairing.used_by_machine_id = machineId;
      await pairing.save();
    }

    // 5. Check Worker configuration
    const cfg = getStorefrontConfigStatus();
    if (!cfg.configured || !cfg.workerBaseUrl) {
      return NextResponse.json(
        {
          ok: true,
          connected: false,
          status: "platform_not_configured",
          pharmacy_id: verifiedClientId,
          pharmacy_name: verifiedPharmacyName,
          license_id: license.id,
          message:
            "Storefront cloud infrastructure is not yet connected on the server. Complete Cloudflare Worker setup in Super Admin → Pharmacy Websites.",
        },
        { status: 200, headers: CORS }
      );
    }

    // 6. Query Storefront Worker strictly by verifiedClientId
    const actor: StorefrontManagementActor = {
      actorType: "portal_owner",
      actorId: `pos_seat_${seat.id}`,
      actorEmail: "pos-terminal@mediqoo",
      scopedPharmacyId: verifiedClientId,
    };

    const sfRes = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/by-pharmacy/${encodeURIComponent(verifiedClientId)}`,
      { method: "GET", actor }
    );

    if (!sfRes.ok || !sfRes.data?.exists || !sfRes.data?.storefront) {
      return NextResponse.json(
        {
          ok: true,
          connected: false,
          status: "not_provisioned",
          pharmacy_id: verifiedClientId,
          pharmacy_name: verifiedPharmacyName,
          license_id: license.id,
          message: `Online Storefront Not Connected — No website has been activated for ${verifiedPharmacyName} yet. Activate it in Super Admin → Pharmacy Websites.`,
        },
        { status: 200, headers: CORS }
      );
    }

    const sf = sfRes.data.storefront;
    const sfSettings = sfRes.data.settings;
    if (sf.pharmacy_id !== verifiedClientId) {
      return NextResponse.json(
        {
          ok: false,
          error: "tenant_identity_mismatch",
          message: "Storefront pharmacy identity mismatch blocked.",
        },
        { status: 403, headers: CORS }
      );
    }

    if (
      sf.status !== "active" ||
      Number(sf.website_enabled) !== 1 ||
      sf.entitlement_status === "suspended" ||
      sf.entitlement_status === "expired" ||
      sf.entitlement_status === "none"
    ) {
      return NextResponse.json(
        {
          ok: true,
          connected: false,
          status: sf.entitlement_status === "suspended" ? "suspended" : sf.status || "disabled",
          pharmacy_id: verifiedClientId,
          pharmacy_name: sf.pharmacy_name || verifiedPharmacyName,
          license_id: license.id,
          message: `Website for ${sf.pharmacy_name || verifiedPharmacyName} is currently ${sf.status || "disabled"}. Enable it in Super Admin → Pharmacy Websites.`,
        },
        { status: 200, headers: CORS }
      );
    }

    const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
    const syncToken = signStorefrontSyncToken(
      {
        storefrontId: sf.id,
        pharmacyId: verifiedClientId,
        branchId: String(body?.branch_id || "main"),
        licenseId: license.id,
      },
      30 * 86400
    );

    return NextResponse.json(
      {
        ok: true,
        connected: true,
        status: "connected",
        pharmacy_id: verifiedClientId,
        pharmacy_name: sf.pharmacy_name || verifiedPharmacyName,
        license_id: license.id,
        storefront_id: sf.id,
        slug: sf.slug,
        public_url: urls.publicUrl,
        worker_base_url: cfg.workerBaseUrl,
        sync_token: syncToken,
        published_products_count: Number(sf.published_products_count || 0),
        last_sync_at: sf.last_catalog_sync_at || null,
        auto_sync_all_products: Boolean(
          sfSettings?.auto_sync_all_products ||
          sfSettings?.publishing_mode === "in_stock_approved"
        ),
        publishing_mode: sfSettings?.publishing_mode || "manual_only",
      },
      { status: 200, headers: CORS }
    );
  } catch (err: any) {
    console.error("[StorefrontConnectAPI] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Unable to complete storefront connection check right now.",
      },
      { status: 500, headers: CORS }
    );
  }
}

