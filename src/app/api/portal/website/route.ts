import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  verifyPortalTokenFromRequest,
  PortalAuthError,
} from "@/lib/portal-auth";
import dbConnect from "@/lib/db";
import License from "@/models/License";
import Client from "@/models/Client";
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
import { syncPosProjectLogoToStorefront } from "@/lib/storefront/pos-logo-sync";
import {
  resolveMapsShareLink,
  reverseGeocodeCoords,
  searchPlacesInPakistan,
} from "@/lib/storefront/maps-link-resolver";

/**
 * Prevents an upstream Storefront Worker 401/403 error from being forwarded
 * as a 401 to the Owner Portal browser (which could look like a portal logout).
 */
function safeUpstreamStatus(status: number): number {
  if (status === 401 || status === 403) return 502;
  return status;
}

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

// ---------------------------------------------------------------------------
// Worker request budget: cache the pharmacy → storefront lookup (by-pharmacy) per
// serverless instance for 10 min so a notifications poll costs 1 Worker request, not 2.
// Keyed by the server-verified clientId only (never by client-supplied input).
// ---------------------------------------------------------------------------
const STOREFRONT_LOOKUP_TTL_MS = 10 * 60_000;
type CachedStorefrontLookup = {
  expiresAt: number;
  storefront: { id: string; slug?: string; pharmacy_name?: string } | null;
};
const storefrontLookupCache = new Map<string, CachedStorefrontLookup>();

function rememberStorefrontLookup(clientId: string, sf: any | null): void {
  storefrontLookupCache.set(clientId, {
    expiresAt: Date.now() + STOREFRONT_LOOKUP_TTL_MS,
    storefront: sf && sf.id ? { id: String(sf.id), slug: sf.slug, pharmacy_name: sf.pharmacy_name } : null,
  });
  if (storefrontLookupCache.size > 2000) {
    const now = Date.now();
    for (const [key, entry] of storefrontLookupCache) {
      if (entry.expiresAt <= now) storefrontLookupCache.delete(key);
    }
  }
}

function readStorefrontLookup(clientId: string): CachedStorefrontLookup | null {
  const entry = storefrontLookupCache.get(clientId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    storefrontLookupCache.delete(clientId);
    return null;
  }
  return entry;
}

function notProvisionedResponse(clientId: string) {
  return NextResponse.json({
    ok: true,
    exists: false,
    client_id: clientId,
    website_activation_status: "not_provisioned",
    active_attention_count: 0,
    recent_orders: [],
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

function parseOrdersVersionParam(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{1,15}$/.test(trimmed) ? trimmed : null;
}

async function respondNotificationsOnly(
  req: NextRequest,
  actor: StorefrontManagementActor,
  sf: { id: string; slug?: string; pharmacy_name?: string },
  onNotFound?: () => void
) {
  const v = parseOrdersVersionParam(req.nextUrl.searchParams.get("v"));
  const notifRes = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/${encodeURIComponent(sf.id)}/orders/notifications${v ? `?v=${v}` : ""}`,
    { method: "GET", actor }
  );
  if (notifRes.status === 404 && onNotFound) onNotFound();
  return NextResponse.json({
    ok: true,
    exists: true,
    storefront_id: sf.id,
    slug: sf.slug,
    pharmacy_name: sf.pharmacy_name,
    // New Worker: may include `unchanged: true` + `orders_version` (client keeps its state).
    ...(notifRes.data || {
      active_attention_count: 0,
      pending_confirmation_count: 0,
      recent_orders: [],
    }),
  });
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedPortalActor(req);
  if (!auth.ok) return auth.response;

  const { clientId, actor } = auth;
  const notificationsOnly = req.nextUrl.searchParams.get("notifications_only") === "1";

  // Fast path: notifications poll with a cached storefront lookup → 1 Worker request.
  if (notificationsOnly) {
    const cached = readStorefrontLookup(clientId);
    if (cached) {
      if (!cached.storefront) return notProvisionedResponse(clientId);
      return respondNotificationsOnly(req, actor, cached.storefront, () =>
        storefrontLookupCache.delete(clientId)
      );
    }
  }

  const res = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/by-pharmacy/${encodeURIComponent(clientId)}`,
    {
      method: "GET",
      actor,
    }
  );

  if (!res.ok || !res.data?.exists || !res.data?.storefront) {
    // Only cache a definitive "no storefront" answer (not transient upstream errors).
    if (res.ok && res.data && res.data.exists === false) rememberStorefrontLookup(clientId, null);
    return notProvisionedResponse(clientId);
  }

  const sf = res.data.storefront;
  rememberStorefrontLookup(clientId, sf);

  // Lightweight polling mode for Owner Portal global layout new-order badge & toast notifications
  if (notificationsOnly) {
    return respondNotificationsOnly(req, actor, sf, () => storefrontLookupCache.delete(clientId));
  }

  let branding = res.data.branding;
  // Auto-sync pharmacy's POS logo onto website if branding has no logo yet
  if (!branding?.logo_url && !branding?.logo_media_id) {
    const syncedLogo = await syncPosProjectLogoToStorefront({
      storefrontId: sf.id,
      pharmacyId: clientId,
      actor,
    });
    if (syncedLogo.synced && syncedLogo.logo_url) {
      branding = {
        ...(branding || {}),
        logo_url: syncedLogo.logo_url,
      };
    }
  }
  const domains: any[] = res.data.domains || [];
  const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
  const hasVerifiedDomain = domains.some((d) => d.verification_status === "verified");

  // Worker budget: try the aggregate dashboard endpoint first (1 request instead of 6).
  // Any piece missing from the aggregate (or a non-ok/404 aggregate on an older Worker)
  // falls back to the individual endpoint, so the response shape stays identical.
  const sfPath = `/api/v1/manage/storefronts/${encodeURIComponent(sf.id)}`;
  const dashRes = await callStorefrontManageApi(`${sfPath}/dashboard`, { method: "GET", actor });
  const dash: any = dashRes.ok && dashRes.data && dashRes.data.ok !== false ? dashRes.data : null;

  const pickArray = (...candidates: any[]): any[] | undefined => {
    for (const c of candidates) if (Array.isArray(c)) return c;
    return undefined;
  };
  const dashProducts = dash
    ? pickArray(dash.products, dash.products_summary?.products, dash.products_summary?.items)
    : undefined;
  const dashOrders = dash ? pickArray(dash.orders, dash.orders_summary?.orders) : undefined;
  const dashNotifications =
    dash && (dash.order_notifications || dash.notifications) && typeof (dash.order_notifications || dash.notifications) === "object"
      ? dash.order_notifications || dash.notifications
      : undefined;
  const dashReviews = dash ? pickArray(dash.reviews) : undefined;
  const dashDoctors = dash ? pickArray(dash.doctors) : undefined;
  const dashServices = dash ? pickArray(dash.services, dash.custom_services) : undefined;

  const fetchIfMissing = (present: unknown, path: string) =>
    present !== undefined
      ? Promise.resolve(null)
      : callStorefrontManageApi(`${sfPath}${path}`, { method: "GET", actor });

  // Fetch any pieces the aggregate did not provide, in parallel
  const [productsRes, ordersRes, notifRes, reviewsRes, doctorsRes, servicesRes] = await Promise.all([
    fetchIfMissing(dashProducts, "/products?limit=100"),
    fetchIfMissing(dashOrders, "/orders?limit=100"),
    fetchIfMissing(dashNotifications, "/orders/notifications"),
    fetchIfMissing(dashReviews, "/reviews"),
    fetchIfMissing(dashDoctors, "/doctors"),
    fetchIfMissing(dashServices, "/services"),
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
    order_notifications: dashNotifications ?? notifRes?.data ?? null,
    sync_cursors: res.data.sync_cursors || [],
    products: dashProducts ?? productsRes?.data?.products ?? [],
    orders: dashOrders ?? ordersRes?.data?.orders ?? [],
    reviews: dashReviews ?? reviewsRes?.data?.reviews ?? [],
    doctors: dashDoctors ?? doctorsRes?.data?.doctors ?? [],
    custom_services: dashServices ?? servicesRes?.data?.services ?? [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedPortalActor(req);
  if (!auth.ok) return auth.response;

  const { clientId, actor } = auth;
  const body = await req.json();
  const action = String(body.action || "").trim();

  // Lightweight server-side map & location helpers (do not require Worker round-trip)
  if (action === "resolve_maps_link") {
    const rawUrl = String(body.url || body.input || "").trim();
    const resolved = await resolveMapsShareLink(rawUrl);
    if (!resolved.ok) {
      return NextResponse.json(
        { ok: false, error: resolved.error, message: resolved.error },
        { status: 400 }
      );
    }
    return NextResponse.json(resolved);
  }

  if (action === "search_place") {
    const query = String(body.query || "").trim();
    const results = await searchPlacesInPakistan(query, 6);
    return NextResponse.json({ ok: true, results });
  }

  if (action === "reverse_geocode") {
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const result = await reverseGeocodeCoords(lat, lng);
    return NextResponse.json({ ok: true, result });
  }

  if (action === "approx_ip_location") {
    const rawLat = req.headers.get("x-vercel-ip-latitude");
    const rawLng = req.headers.get("x-vercel-ip-longitude");
    const rawCity = req.headers.get("x-vercel-ip-city");
    const lat = rawLat ? Number(rawLat) : NaN;
    const lng = rawLng ? Number(rawLng) : NaN;

    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.01) {
      return NextResponse.json({
        ok: true,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        city: rawCity ? decodeURIComponent(rawCity) : "",
        source: "edge_ip",
      });
    }

    // Fallback for local dev or when edge geo headers are absent
    try {
      const ipRes = await fetch("https://ipwho.is/", {
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });
      if (ipRes.ok) {
        const ipData: any = await ipRes.json();
        const ipLat = Number(ipData?.latitude);
        const ipLng = Number(ipData?.longitude);
        if (ipData?.success !== false && Number.isFinite(ipLat) && Number.isFinite(ipLng)) {
          return NextResponse.json({
            ok: true,
            latitude: Number(ipLat.toFixed(6)),
            longitude: Number(ipLng.toFixed(6)),
            city: String(ipData?.city || "").trim(),
            source: "ip_fallback",
          });
        }
      }
    } catch {
      /* fall back to Pakistan default */
    }

    return NextResponse.json({
      ok: true,
      latitude: 31.5204,
      longitude: 74.3587,
      city: "Lahore",
      source: "default",
    });
  }

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
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_settings") {
    const payload = { ...(body.payload || body) };
    if (payload.auto_sync_all_products && !payload.publishing_mode) {
      payload.publishing_mode = "in_stock_approved";
    }
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/settings`,
      { method: "PUT", actor, body: payload }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
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
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_product_publishing" || action === "batch_publish_products") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/products/publishing`,
      { method: "PUT", actor, body: { items: body.items || [] } }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_product_override" && body.product_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/products/${encodeURIComponent(body.product_id)}`,
      { method: "PATCH", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "assign_product_image") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/products/${encodeURIComponent(body.pos_product_id || body.product_id)}/assign-image`,
      { method: "POST", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "browse_shared_library") {
    const q = body.query ? String(body.query).trim() : "";
    const res = await callStorefrontManageApi(
      `/api/v1/manage/central-library/medicines?has_image=1&limit=30&q=${encodeURIComponent(q)}`,
      { actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "batch_match_catalog") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/batch-match", {
      method: "POST",
      actor,
      body: { storefront_id: sfId, batch_size: body.batch_size || 100, offset: body.offset || 0 },
    });
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upload_media") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/media`,
      { method: "POST", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "sync_pos_logo") {
    const syncLogoRes = await syncPosProjectLogoToStorefront({
      storefrontId: sfId,
      pharmacyId: clientId,
      actor,
    });
    if (!syncLogoRes.synced) {
      return NextResponse.json(
        {
          ok: false,
          error: syncLogoRes.reason || "no_pos_logo_found",
          message:
            "No POS logo is configured on this pharmacy project yet. You can upload any logo image directly.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      logo_url: syncLogoRes.logo_url,
      byte_size: syncLogoRes.byte_size,
    });
  }

  if (action === "cleanup_media") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/media/cleanup`,
      { method: "POST", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_banner") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/banners`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_banner" && body.banner_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/banners/${encodeURIComponent(body.banner_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_category") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/categories`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_promotion") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/promotions`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_promotion" && body.promotion_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/promotions/${encodeURIComponent(body.promotion_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_order_status" && body.order_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/orders/${encodeURIComponent(body.order_id)}`,
      {
        method: "PATCH",
        actor,
        body: {
          status: body.status,
          payment_status: body.payment_status,
          note: body.note,
          pos_invoice_number: body.pos_invoice_number,
        },
      }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_delivery_zone") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/delivery-zones`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_delivery_zone" && body.zone_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/delivery-zones/${encodeURIComponent(body.zone_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_location") {
    const payload = body.payload || body;
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/location`,
      { method: "PUT", actor, body: payload }
    );
    if (res.ok && res.data?.ok) {
      // Best-effort mirror address/city/phone back to Owner Portal MongoDB state so Profile stays in sync
      try {
        await dbConnect();
        const addr = typeof payload.address_line === "string" ? payload.address_line.trim() : "";
        const city = typeof payload.city === "string" ? payload.city.trim() : "";
        const phone = typeof payload.contact_phone === "string" ? payload.contact_phone.trim() : "";
        const clientPatch: Record<string, any> = { updated_at: new Date() };
        const statePatch: Record<string, any> = {};
        if (addr) {
          clientPatch.address = addr;
          statePatch.pharmacy_address = addr;
        }
        if (city) clientPatch.city = city;
        if (phone) {
          clientPatch.contact_phone = phone;
          statePatch.pharmacy_phone = phone;
        }
        await Client.updateOne({ id: clientId }, { $set: clientPatch });
        if (Object.keys(statePatch).length > 0) {
          await OwnerPortalState.updateMany({ client_id: clientId }, { $set: statePatch });
        }
      } catch {
        /* non-blocking */
      }
    }
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_branch") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/branches`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "update_review" && body.review_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/reviews/${encodeURIComponent(body.review_id)}`,
      {
        method: "PATCH",
        actor,
        body: {
          status: body.status,
          owner_reply: body.owner_reply,
        },
      }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "publish_all_reviews") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/reviews/publish-all`,
      { method: "POST", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_review" && body.review_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/reviews/${encodeURIComponent(body.review_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_doctor") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/doctors`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_doctor" && body.doctor_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/doctors/${encodeURIComponent(body.doctor_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "upsert_service") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/services`,
      { method: "PUT", actor, body: body.payload || body }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
  }

  if (action === "delete_service" && body.service_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(sfId)}/services/${encodeURIComponent(body.service_id)}`,
      { method: "DELETE", actor }
    );
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
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
    return NextResponse.json(res.data, { status: safeUpstreamStatus(res.status) });
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
    const sanitizedItems = rawItems
      .map((item, idx) =>
        sanitizePortalProductForStorefront({
          ...item,
          source_revision: rev,
          is_featured: item.is_featured ?? idx < 4,
        })
      )
      .filter((it) => Boolean(it.pos_product_id && it.product_identity?.name));

    if (sanitizedItems.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_pos_product_identity",
          message:
            "Every published website item must preserve an authentic POS product ID. Open AivraSol POS → Online Storefront and click Sync Now.",
        },
        { status: 400 }
      );
    }

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

    return NextResponse.json(syncRes.data, { status: safeUpstreamStatus(syncRes.status) });
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
