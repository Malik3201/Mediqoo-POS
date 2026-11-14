import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { searchMasterCatalog, loadMasterCatalogItems } from "@/lib/master-catalog";
import { callStorefrontManageApi, type StorefrontManagementActor } from "@/lib/storefront/client";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));

  const results = searchMasterCatalog(q, limit);
  return NextResponse.json({
    ok: true,
    query: q,
    count: results.length,
    results,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const action = body.action || "import_batch";

  if (action === "import_batch") {
    const offset = Math.max(0, Number(body.offset || 0));
    const limit = Math.min(200, Math.max(10, Number(body.limit || 50)));

    const allItems = loadMasterCatalogItems();
    const slice = allItems.slice(offset, offset + limit);

    if (slice.length === 0) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        offset,
        hasMore: false,
        totalCatalog: allItems.length,
      });
    }

    const payload = slice.map((item) => ({
      master_catalog_id: item.master_catalog_id,
      master_catalog_name: item.master_catalog_name,
      brand: item.brand_name,
      generic: item.generic_name,
      strength: item.strength,
      dosage_form: item.dosage_form,
      manufacturer: item.manufacturer,
      pack_size: item.pack_size,
      pack_unit: item.pack_unit,
      barcode: item.barcode,
    }));

    const actor: StorefrontManagementActor = {
      actorType: "super_admin",
      actorId: auth.actor.id,
      actorEmail: auth.actor.email,
      scopedPharmacyId: null,
    };

    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/import", {
      method: "POST",
      actor,
      body: { items: payload },
    });

    return NextResponse.json({
      ok: res.data?.ok ?? true,
      imported: slice.length,
      nextOffset: offset + slice.length,
      hasMore: offset + slice.length < allItems.length,
      totalCatalog: allItems.length,
      workerResponse: res.data,
    });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
