import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  verifyPortalTokenFromRequest,
  PortalAuthError,
} from "@/lib/portal-auth";
import dbConnect from "@/lib/db";
import License from "@/models/License";
import OwnerPortalState from "@/models/OwnerPortalState";
import StorefrontPairingCode from "@/models/StorefrontPairingCode";
import {
  callStorefrontManageApi,
  callStorefrontSyncApi,
  getStorefrontPublicPreviewUrl,
  getStorefrontWorkerBaseUrl,
  sanitizePortalProductForStorefront,
  signStorefrontSyncToken,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

async function resolveAuthenticatedPortalActor(req: NextRequest): Promise<
  | {
      ok: true;
      clientId: string;
      actor: StorefrontManagementActor;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  let clientId = "";
  let userId = "";
  let userEmail = "";
  let userRole: "portal_owner" | "portal_manager" = "portal_owner";

  try {
    const portalUser = await requirePortalSession(req);
    clientId = portalUser.client_id;
    userId = portalUser.id;
    userEmail = portalUser.email;
    userRole = portalUser.role === "owner" ? "portal_owner" : "portal_manager";
  } catch (err) {
    if (
      err instanceof PortalAuthError &&
      (process.env.NODE_ENV === "production" || err.code !== "user_not_found")
    ) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: err.message }, { status: err.httpStatus }),
      };
    }
    const verifiedJwt = await verifyPortalTokenFromRequest(req);
    if (!verifiedJwt || !verifiedJwt.clientId) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "Unauthorized portal session" },
          { status: 401 }
        ),
      };
    }
    clientId = verifiedJwt.clientId;
    userId = verifiedJwt.portalUserId || "portal-owner";
    userEmail = "portal-owner@mediqoo";
    userRole = verifiedJwt.role === "owner" ? "portal_owner" : "portal_manager";
  }

  return {
    ok: true,
    clientId,
    actor: {
      actorType: userRole,
      actorId: userId,
      actorEmail: userEmail,
      scopedPharmacyId: clientId,
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedPortalActor(req);
  if (!auth.ok) return auth.response;

  const { clientId, actor } = auth;

  const res = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/by-pharmacy/${encodeURIComponent(clientId)}`,
    {
      method: "GET",
      actor,
    }
  );

  if (!res.ok || !res.data?.exists || !res.data?.storefront) {
    return NextResponse.json({
      ok: true,
      exists: false,
      client_id: clientId,
      website_activation_status: "not_provisioned",
      public_link: null,
      preview_link: null,
      branding_status: "not_configured",
      domain_status: "not_configured",
      last_sync: null,
      setup_progress: {
        completed_steps: 0,
        total_steps: 5,
        percent: 0,
        steps: [],
      },
    });
  }

  const sf = res.data.storefront;
  const branding = res.data.branding;
  const domains: any[] = res.data.domains || [];
  const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
  const hasVerifiedDomain = domains.some((d) => d.verification_status === "verified");

  // Fetch products and online orders in parallel for the Owner Portal tabs
  const [productsRes, ordersRes] = await Promise.all([
    callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sf.id)}/products?limit=100`,
      { method: "GET", actor }
    ),
    callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sf.id)}/orders?limit=60`,
      { method: "GET", actor }
    ),
  ]);

  return NextResponse.json({
    ok: true,
    exists: true,
    client_id: clientId,
    website_activation_status:
      sf.status === "active" && sf.website_enabled ? "active" : sf.status,
    website_enabled: Boolean(sf.website_enabled),
    entitlement_status: sf.entitlement_status,
    public_link: urls.publicUrl,
    preview_link: urls.localPreviewUrl,
    worker_base_url: getStorefrontWorkerBaseUrl(),
    branding_status:
      branding?.display_name && branding?.primary_color ? "configured" : "pending",
    domain_status: hasVerifiedDomain ? "verified" : "pending",
    last_sync: sf.last_sync_at || null,
    published_products_count: Number(sf.published_products_count || 0),
    setup_progress: res.data.setup_progress,
    storefront: sf,
    branding,
    settings: res.data.settings,
    domains,
    branches: res.data.branches || [],
    delivery_zones: res.data.delivery_zones || [],
    promotions: res.data.promotions || [],
    categories: res.data.categories || [],
    banners: res.data.banners || [],
    media: res.data.media || [],
    orders_summary: res.data.orders_summary || {},
    sync_cursors: res.data.sync_cursors || [],
    products: productsRes.data?.products || [],
    orders: ordersRes.data?.orders || [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedPortalActor(req);
  if (!auth.ok) return auth.response;

  const { clientId, actor } = auth;
  const body = await req.json();
  const action = String(body.action || "").trim();

  // First resolve the pharmacy's own storefront ID using server-verified clientId
  const lookupRes = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/by-pharmacy/${encodeURIComponent(clientId)}`,
    { method: "GET", actor }
  );

  if (!lookupRes.ok || !lookupRes.data?.exists || !lookupRes.data?.storefront) {
    return NextResponse.json(
      { ok: false, error: "Storefront not provisioned for this pharmacy." },
      { status: 404 }
    );
  }

  const sf = lookupRes.data.storefront;
  const sfId = sf.id;

  if (action === "update_branding") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/branding`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "update_settings") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/settings`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "toggle_website_enabled") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/status`,
      {
        method: "PATCH",
        actor,
        body: {
          website_enabled: Boolean(body.website_enabled),
          status: body.website_enabled ? "active" : "disabled",
        },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "update_product_publishing") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/products/publishing`,
      { method: "PUT", actor, body: { items: body.items || [] } }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "update_product_override" && body.product_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/products/${encodeURIComponent(body.product_id)}`,
      { method: "PATCH", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upload_media") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/media`,
      { method: "POST", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "cleanup_media") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/media/cleanup`,
      { method: "POST", actor }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upsert_banner") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/banners`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "delete_banner" && body.banner_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/banners/${encodeURIComponent(body.banner_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upsert_category") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/categories`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upsert_promotion") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/promotions`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "delete_promotion" && body.promotion_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/promotions/${encodeURIComponent(body.promotion_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "update_order_status" && body.order_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/orders/${encodeURIComponent(body.order_id)}`,
      {
        method: "PATCH",
        actor,
        body: {
          status: body.status,
          note: body.note,
          pos_invoice_number: body.pos_invoice_number,
        },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upsert_delivery_zone") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/delivery-zones`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "delete_delivery_zone" && body.zone_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/delivery-zones/${encodeURIComponent(body.zone_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upsert_branch") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/branches`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "add_custom_domain") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/domains`,
      {
        method: "POST",
        actor,
        body: {
          action: "add_custom_domain",
          hostname: body.hostname,
        },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "sync_pos_catalog") {
    let rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      try {
        await dbConnect();
        const portalState: any = await OwnerPortalState.findOne({
          client_id: clientId,
        }).lean();
        if (
          Array.isArray(portalState?.products_intelligence?.items) &&
          portalState.products_intelligence.items.length > 0
        ) {
          rawItems = portalState.products_intelligence.items.slice(0, 30);
        }
      } catch {
        // Fallback to starter approved items
      }
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_pos_inventory_synced",
          message:
            "No POS inventory snapshot is available in Owner Portal yet. Open Online Storefront inside your AivraSol POS and click Sync Now to publish your approved medicines.",
        },
        { status: 400 }
      );
    }

    const rev = Math.floor(Date.now() / 1000);
    const sanitizedItems = rawItems.map((item, idx) =>
      sanitizePortalProductForStorefront({
        ...item,
        source_revision: rev,
        is_featured: item.is_featured ?? idx < 4,
      })
    );

    const syncRes = await callStorefrontSyncApi("/api/v1/sync/catalog-delta", {
      method: "POST",
      actor: {
        storefrontId: sfId,
        pharmacyId: clientId,
        branchId: "main",
        licenseId: sf.license_id || undefined,
      },
      body: {
        contract_version: "aivrasol-storefront-sync/v1",
        idempotency_key: body.idempotency_key || `portal_sync_${sfId}_${Date.now()}`,
        source_cursor: null,
        next_cursor: `cur_${rev}`,
        tenant_identity: {
          pharmacy_id: clientId,
          storefront_id: sfId,
          license_id: sf.license_id || undefined,
        },
        branch_identity: {
          branch_id: "main",
        },
        items: sanitizedItems,
      },
    });

    return NextResponse.json(syncRes.data, { status: syncRes.status });
  }

  if (action === "generate_pos_pairing_code") {
    await dbConnect();
    // Rate limit: max 6 pairing codes created in the past 10 minutes per pharmacy
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const recentCount = await StorefrontPairingCode.countDocuments({
      client_id: clientId,
      created_at: { $gte: tenMinAgo },
    });
    if (recentCount >= 6) {
      return NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many pairing codes generated recently. Please use the active code or wait a few minutes.",
        },
        { status: 429 }
      );
    }

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    const expiresAt = new Date(Date.now() + 10 * 60_000);

    await StorefrontPairingCode.create({
      code,
      client_id: clientId,
      storefront_id: sfId,
      created_by: actor.actorId,
      expires_at: expiresAt,
      used_at: null,
      failed_attempts: 0,
    });

    return NextResponse.json({
      ok: true,
      pairing_code: `${code.slice(0, 3)}-${code.slice(3)}`,
      raw_code: code,
      expires_at: expiresAt.toISOString(),
      ttl_minutes: 10,
    });
  }

  if (action === "generate_pos_sync_bundle") {
    let resolvedLicenseId: string | undefined = sf.license_id || undefined;
    let resolvedLicenseKey: string | undefined;
    try {
      await dbConnect();
      const lic = await License.findOne({ client_id: clientId, status: "active" }).lean<{
        id: string;
        license_key: string;
      }>();
      if (lic) {
        resolvedLicenseId = lic.id;
        resolvedLicenseKey = lic.license_key;
      }
    } catch {
      // Non-blocking
    }

    const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
    const syncToken = signStorefrontSyncToken(
      {
        storefrontId: sfId,
        pharmacyId: clientId,
        branchId: body.branch_id || "main",
        licenseId: resolvedLicenseId,
      },
      30 * 86400
    );
    return NextResponse.json({
      ok: true,
      connection_bundle: {
        workerBaseUrl: getStorefrontWorkerBaseUrl(),
        storefrontId: sfId,
        pharmacyId: clientId,
        pharmacyName: sf.pharmacy_name,
        publicUrl: urls.publicUrl,
        licenseId: resolvedLicenseId || null,
        licenseKeyHint: resolvedLicenseKey ? resolvedLicenseKey.slice(0, 10) : null,
        branchId: body.branch_id || "main",
        syncToken,
      },
    });
  }

  return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
}
