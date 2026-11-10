import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import dbConnect from "@/lib/db";
import OwnerPortalState from "@/models/OwnerPortalState";
import AuditLog from "@/models/AuditLog";
import {
  callStorefrontManageApi,
  callStorefrontSyncApi,
  getStorefrontPublicPreviewUrl,
  getStorefrontWorkerBaseUrl,
  sanitizePortalProductForStorefront,
  signStorefrontSyncToken,
  CURATED_APPROVED_STARTER_PRODUCTS,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const [detailsRes, productsRes, ordersRes] = await Promise.all([
    callStorefrontManageApi(`/api/v1/manage/storefronts/${encodeURIComponent(id)}`, {
      method: "GET",
      actor,
    }),
    callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/products?limit=60`,
      { method: "GET", actor }
    ),
    callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/orders?limit=30`,
      { method: "GET", actor }
    ),
  ]);

  if (!detailsRes.ok || !detailsRes.data?.storefront) {
    return NextResponse.json(detailsRes.data, { status: detailsRes.status });
  }

  const sf = detailsRes.data.storefront;
  const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);

  return NextResponse.json({
    ...detailsRes.data,
    storefront: {
      ...sf,
      public_url: urls.publicUrl,
      preview_url: urls.localPreviewUrl,
    },
    products: productsRes.data?.products || [],
    orders: ordersRes.data?.orders || [],
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const body = await req.json();
  const section = body.section || "status";

  if (section === "status") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        actor,
        body,
      }
    );
    try {
      await dbConnect();
      await AuditLog.create({
        id: `audit_sf_status_${Date.now()}`,
        action: "UPDATE",
        entity_type: "Storefront",
        entity_id: id,
        user_email: auth.actor.email,
        changes: body,
      });
    } catch {
      // Non-blocking
    }
    return NextResponse.json(res.data, { status: res.status });
  }

  if (section === "branding") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/branding`,
      {
        method: "PUT",
        actor,
        body,
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (section === "settings") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/settings`,
      {
        method: "PUT",
        actor,
        body,
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (section === "domain_verify" && body.domain_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/domains/${encodeURIComponent(body.domain_id)}`,
      {
        method: "PATCH",
        actor,
        body: { verification_status: body.verification_status || "verified" },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (section === "publishing") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/products/publishing`,
      {
        method: "PUT",
        actor,
        body: { items: body.items || [] },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (section === "order_status" && body.order_id) {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/orders/${encodeURIComponent(body.order_id)}`,
      {
        method: "PATCH",
        actor,
        body: { status: body.status, note: body.note },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  return NextResponse.json({ ok: false, error: "invalid_section" }, { status: 400 });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const body = await req.json();

  if (body.action === "rename_slug" || body.action === "add_custom_domain") {
    const res = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}/domains`,
      {
        method: "POST",
        actor,
        body,
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (body.action === "sync_approved_catalog") {
    const detailsRes = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}`,
      { method: "GET", actor }
    );
    if (!detailsRes.ok || !detailsRes.data?.storefront) {
      return NextResponse.json(detailsRes.data, { status: detailsRes.status });
    }
    const sf = detailsRes.data.storefront;

    let rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      try {
        await dbConnect();
        const portalState: any = await OwnerPortalState.findOne({
          client_id: sf.pharmacy_id,
        }).lean();
        if (
          Array.isArray(portalState?.products_intelligence?.items) &&
          portalState.products_intelligence.items.length > 0
        ) {
          rawItems = portalState.products_intelligence.items.slice(0, 15);
        }
      } catch {
        // Fallback
      }
    }

    if (rawItems.length === 0 && body.useStarterCatalog === true) {
      rawItems = CURATED_APPROVED_STARTER_PRODUCTS;
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_approved_products",
          message:
            "No synced POS products found for this pharmacy yet. Connect POS to this storefront and run Sync Now.",
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
        storefrontId: sf.id,
        pharmacyId: sf.pharmacy_id,
        branchId: "main",
        licenseId: sf.license_id || undefined,
      },
      body: {
        contract_version: "aivrasol-storefront-sync/v1",
        idempotency_key: body.idempotency_key || `manual_sync_${sf.id}_${Date.now()}`,
        source_cursor: null,
        next_cursor: `cur_${rev}`,
        tenant_identity: {
          pharmacy_id: sf.pharmacy_id,
          storefront_id: sf.id,
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

  if (body.action === "generate_pos_sync_bundle") {
    const detailsRes = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/${encodeURIComponent(id)}`,
      { method: "GET", actor }
    );
    if (!detailsRes.ok || !detailsRes.data?.storefront) {
      return NextResponse.json(detailsRes.data, { status: detailsRes.status });
    }
    const sf = detailsRes.data.storefront;
    const syncToken = signStorefrontSyncToken(
      {
        storefrontId: sf.id,
        pharmacyId: sf.pharmacy_id,
        branchId: body.branch_id || "main",
        licenseId: sf.license_id || undefined,
      },
      30 * 86400
    );
    const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
    return NextResponse.json({
      ok: true,
      connection_bundle: {
        workerBaseUrl: getStorefrontWorkerBaseUrl(),
        storefrontId: sf.id,
        pharmacyId: sf.pharmacy_id,
        licenseId: sf.license_id || null,
        pharmacyName: sf.pharmacy_name || sf.display_name || "",
        publicUrl: urls.publicUrl,
        branchId: body.branch_id || "main",
        syncToken,
      },
    });
  }

  return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
}

