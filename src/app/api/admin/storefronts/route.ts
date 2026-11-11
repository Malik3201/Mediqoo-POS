import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import dbConnect from "@/lib/db";
import Client from "@/models/Client";
import License from "@/models/License";
import Project from "@/models/Project";
import OwnerPortalState from "@/models/OwnerPortalState";
import AuditLog from "@/models/AuditLog";
import {
  callStorefrontManageApi,
  callStorefrontSyncApi,
  getStorefrontPublicPreviewUrl,
  sanitizePortalProductForStorefront,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";
import { syncPosProjectLogoToStorefront } from "@/lib/storefront/pos-logo-sync";

const FALLBACK_PHARMACIES = [
  {
    pharmacy_id: "pharm-alshifa-001",
    name: "Al-Shifa Pharmacy & Wellness",
    company: "Al-Shifa Healthcare Pvt Ltd",
    email: "owner@alshifapharmacy.pk",
    phone: "+92 300 4112233",
    city: "Lahore",
    address: "Main Boulevard Gulberg III, Lahore",
    license_id: "LIC-ALSHIFA-2026",
    license_key: "AIVR-ALSH-2026-PRO1",
    plan: "Enterprise POS + Cloud",
    pos_products_count: 1840,
  },
  {
    pharmacy_id: "pharm-citymed-002",
    name: "CityMed Care Pharmacy",
    company: "CityMed Retail Pharmacies",
    email: "ops@citymed.pk",
    phone: "+92 321 8997766",
    city: "Karachi",
    address: "Clifton Block 5, Karachi",
    license_id: "LIC-CITYMED-2026",
    license_key: "AIVR-CITY-2026-STD2",
    plan: "Standard POS + Cloud",
    pos_products_count: 1120,
  },
  {
    pharmacy_id: "pharm-healthplus-003",
    name: "HealthPlus Clinical Pharmacy",
    company: "HealthPlus Diagnostics & Pharma",
    email: "info@healthplus.pk",
    phone: "+92 333 5556677",
    city: "Islamabad",
    address: "F-10 Markaz, Islamabad",
    license_id: "LIC-HEALTHPLUS-2026",
    license_key: "AIVR-HLTH-2026-PRO3",
    plan: "Enterprise POS + Cloud",
    pos_products_count: 2310,
  },
  {
    pharmacy_id: "pharm-medix-004",
    name: "Medix 24/7 Community Pharmacy",
    company: "Medix Care Group",
    email: "care@medix.pk",
    phone: "+92 345 2223344",
    city: "Faisalabad",
    address: "D Ground People's Colony, Faisalabad",
    license_id: "LIC-MEDIX-2026",
    license_key: "AIVR-MEDX-2026-STD4",
    plan: "Standard POS",
    pos_products_count: 940,
  },
];

const CURATED_APPROVED_STARTER_PRODUCTS = [
  {
    pos_product_id: "POS-MED-101",
    sku_code: "PAN-ADV-500",
    name: "Panadol Advance 500mg Tablets",
    generic_name: "Paracetamol",
    strength: "500mg",
    dosage_form: "Tablet",
    brand_name: "Haleon Pakistan",
    packing_label: "Pack of 20 Tablets",
    unit_label: "Pack",
    category_name: "OTC & Pain Relief",
    public_description: "Fast-absorbing paracetamol optizorb formulation for headache, fever, and body pain.",
    public_selling_price_pkr: 165,
    compare_at_price_pkr: 180,
    available_qty: 45,
    is_featured: true,
    requires_prescription: false,
    is_controlled_substance: false,
  },
  {
    pos_product_id: "POS-MED-102",
    sku_code: "AUG-625-TAB",
    name: "Augmentin 625mg Film-Coated Tablets",
    generic_name: "Amoxicillin + Clavulanic Acid",
    strength: "625mg",
    dosage_form: "Tablet",
    brand_name: "GSK Pakistan",
    packing_label: "Pack of 6 Tablets",
    unit_label: "Pack",
    category_name: "Prescription Medicines",
    public_description: "Broad-spectrum penicillin antibiotic. Valid physician prescription required upon dispense.",
    public_selling_price_pkr: 495,
    compare_at_price_pkr: null,
    available_qty: 18,
    is_featured: true,
    requires_prescription: true,
    is_controlled_substance: false,
  },
  {
    pos_product_id: "POS-MED-103",
    sku_code: "CAC-1000-EFF",
    name: "CaC-1000 Plus Orange Effervescent Tablets",
    generic_name: "Calcium + Vitamin D3 + Vitamin C + Vitamin B6",
    strength: "1000mg",
    dosage_form: "Effervescent Tablet",
    brand_name: "Haleon",
    packing_label: "Tube of 10 Tablets",
    unit_label: "Tube",
    category_name: "Vitamins & Supplements",
    public_description: "Daily bone strength and immunity support effervescent calcium supplement.",
    public_selling_price_pkr: 420,
    compare_at_price_pkr: 450,
    available_qty: 30,
    is_featured: true,
    requires_prescription: false,
    is_controlled_substance: false,
  },
  {
    pos_product_id: "POS-MED-104",
    sku_code: "SURBEX-Z-30",
    name: "Surbex-Z High Potency Zinc & B-Complex",
    generic_name: "Vitamin B-Complex + Vitamin C + Zinc + Vitamin E",
    strength: "High Potency",
    dosage_form: "Tablet",
    brand_name: "Abbott Laboratories",
    packing_label: "Bottle of 30 Tablets",
    unit_label: "Bottle",
    category_name: "Vitamins & Supplements",
    public_description: "Comprehensive daily multivitamin with Zinc for immunity, energy, and recovery.",
    public_selling_price_pkr: 580,
    compare_at_price_pkr: null,
    available_qty: 24,
    is_featured: true,
    requires_prescription: false,
    is_controlled_substance: false,
  },
  {
    pos_product_id: "POS-MED-105",
    sku_code: "RISE-20-CAP",
    name: "Risek 20mg Capsules",
    generic_name: "Omeprazole",
    strength: "20mg",
    dosage_form: "Capsule",
    brand_name: "Getz Pharma",
    packing_label: "Pack of 14 Capsules",
    unit_label: "Pack",
    category_name: "OTC & Pain Relief",
    public_description: "Proton pump inhibitor for acid reflux, heartburn, and gastric ulcer relief.",
    public_selling_price_pkr: 410,
    compare_at_price_pkr: null,
    available_qty: 36,
    is_featured: false,
    requires_prescription: false,
    is_controlled_substance: false,
  },
  {
    pos_product_id: "POS-MED-106",
    sku_code: "ACCU-CHEK-50",
    name: "Accu-Chek Active Blood Glucose Test Strips",
    generic_name: "Capillary Blood Glucose Strips",
    strength: "50 Strips",
    dosage_form: "Diagnostic Strip",
    brand_name: "Roche Diabetes Care",
    packing_label: "Box of 50 Strips",
    unit_label: "Box",
    category_name: "Medical Devices & First Aid",
    public_description: "Accurate home blood glucose monitoring strips compatible with Accu-Chek Active meters.",
    public_selling_price_pkr: 2850,
    compare_at_price_pkr: 3100,
    available_qty: 4, // low_stock
    is_featured: true,
    requires_prescription: false,
    is_controlled_substance: false,
  },
];

async function loadExistingPharmacies() {
  try {
    await dbConnect();
    const [clients, licenses, projects, portalStates] = await Promise.all([
      Client.find({}).lean(),
      License.find({}).lean(),
      Project.find({}).lean(),
      OwnerPortalState.find({}, { client_id: 1, "products_intelligence.items": 1 }).lean(),
    ]);

    if (!clients || clients.length === 0) {
      return process.env.NODE_ENV === "production" ? [] : FALLBACK_PHARMACIES;
    }

    const mapped = clients.map((c: any) => {
      const clientProjects = projects.filter((p: any) => p.client_id === c.id);
      const projectIds = new Set(clientProjects.map((p: any) => p.id));
      // Strictly match License by verified relational IDs (client_id or project_id), NEVER by name similarity!
      const lic: any = licenses.find(
        (l: any) => l.client_id === c.id || projectIds.has(l.project_id)
      );
      const portalState: any = portalStates.find((ps: any) => ps.client_id === c.id);
      const syncedCount = Array.isArray(portalState?.products_intelligence?.items)
        ? portalState.products_intelligence.items.length
        : 0;
      const derivedCity =
        c.location?.city ||
        (c.address ? String(c.address).split(",").pop()?.trim() || "Pakistan" : "Pakistan");

      // Prefer verified pharmacy business identity from Project (`branding.store_name` or `Project.name`)
      // over `Client.name`, which often stores the owner/contact person's personal name.
      const primaryProject: any = clientProjects[0] || null;
      const projectBusinessName =
        (typeof primaryProject?.branding?.store_name === "string" &&
          primaryProject.branding.store_name.trim()) ||
        (typeof primaryProject?.name === "string" && primaryProject.name.trim()) ||
        "";
      const verifiedBusinessName = projectBusinessName || c.name;

      return {
        pharmacy_id: c.id,
        project_id: primaryProject?.id || null,
        name: verifiedBusinessName,
        company: verifiedBusinessName,
        contact_name: c.contact_name || c.name || "",
        email: c.contact_email || "",
        phone: c.contact_phone || "",
        city: derivedCity,
        address: c.address || c.location?.address || "",
        license_id: lic?.id || null,
        license_key: lic?.license_key || null,
        plan: lic ? `${lic.status === "active" ? "Active" : lic.status} POS License` : "Unlicensed",
        pos_products_count: syncedCount,
      };
    });

    return mapped;
  } catch {
    return process.env.NODE_ENV === "production" ? [] : FALLBACK_PHARMACIES;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const url = new URL(req.url);
  const slugToCheck = url.searchParams.get("check_slug");
  if (slugToCheck !== null) {
    const slugRes = await callStorefrontManageApi(
      `/api/v1/manage/storefronts/check-slug?slug=${encodeURIComponent(slugToCheck)}`,
      { method: "GET", actor }
    );
    return NextResponse.json(slugRes.data, { status: slugRes.status });
  }

  const statusFilter = url.searchParams.get("status") || "all";
  const searchQuery = url.searchParams.get("q") || "";

  const [overviewRes, listRes, pharmacies] = await Promise.all([
    callStorefrontManageApi("/api/v1/manage/overview", { method: "GET", actor }),
    callStorefrontManageApi(
      `/api/v1/manage/storefronts?status=${encodeURIComponent(statusFilter)}&q=${encodeURIComponent(searchQuery)}`,
      { method: "GET", actor }
    ),
    loadExistingPharmacies(),
  ]);

  const storefronts = (listRes.data?.storefronts || []).map((sf: any) => {
    const urls = getStorefrontPublicPreviewUrl(sf.slug, sf.primary_domain);
    return {
      ...sf,
      public_url: urls.publicUrl,
      preview_url: urls.localPreviewUrl,
    };
  });

  const assignedPharmacyIds = new Set(storefronts.map((s: any) => s.pharmacy_id));

  return NextResponse.json({
    ok: true,
    overview: overviewRes.data?.overview || null,
    storefronts,
    pharmacies: pharmacies.map((p) => ({
      ...p,
      has_storefront: assignedPharmacyIds.has(p.pharmacy_id),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const body = await req.json();

  const createRes = await callStorefrontManageApi("/api/v1/manage/storefronts", {
    method: "POST",
    actor,
    body,
  });

  if (!createRes.ok || !createRes.data?.storefront) {
    return NextResponse.json(createRes.data, { status: createRes.status });
  }

  const createdSf = createRes.data.storefront;

  // Automatically sync POS project logo onto newly provisioned website if available
  try {
    await syncPosProjectLogoToStorefront({
      storefrontId: createdSf.id,
      pharmacyId: createdSf.pharmacy_id,
      actor,
    });
  } catch {
    // Non-blocking if POS logo is absent
  }

  // Optionally publish initial approved catalog items (either from OwnerPortalState or curated starter set)
  // Note: NEVER automatically publishes all 41,441 master medicines!
  if (body.seed_approved_starter_catalog === true) {
    let sourceItems: any[] = [];
    try {
      await dbConnect();
      const portalState: any = await OwnerPortalState.findOne({
        client_id: createdSf.pharmacy_id,
      }).lean();
      if (
        Array.isArray(portalState?.products_intelligence?.items) &&
        portalState.products_intelligence.items.length > 0
      ) {
        // Take only up to 12 top approved items from pharmacy's own POS intelligence
        sourceItems = portalState.products_intelligence.items.slice(0, 12);
      }
    } catch {
      // Fallback to curated starter items
    }

    if (sourceItems.length === 0) {
      sourceItems = CURATED_APPROVED_STARTER_PRODUCTS;
    }

    const sanitizedItems = sourceItems.map((item, idx) =>
      sanitizePortalProductForStorefront({
        ...item,
        source_revision: 1,
        is_featured: idx < 4,
      })
    );

    await callStorefrontSyncApi("/api/v1/sync/catalog-delta", {
      method: "POST",
      actor: {
        storefrontId: createdSf.id,
        pharmacyId: createdSf.pharmacy_id,
        branchId: "main",
        licenseId: createdSf.license_id || undefined,
      },
      body: {
        contract_version: "aivrasol-storefront-sync/v1",
        idempotency_key: `init_catalog_${createdSf.id}_${Date.now()}`,
        source_cursor: null,
        next_cursor: "cur_init_1",
        tenant_identity: {
          pharmacy_id: createdSf.pharmacy_id,
          storefront_id: createdSf.id,
          license_id: createdSf.license_id || undefined,
        },
        branch_identity: {
          branch_id: "main",
        },
        items: sanitizedItems,
      },
    });
  }

  // Best-effort update of License features and MongoDB AuditLog
  try {
    await dbConnect();
    if (body.license_id) {
      await License.updateOne(
        { id: body.license_id },
        {
          $set: {
            "features.storefront_enabled": Boolean(createdSf.website_enabled),
            "features.storefront_slug": createdSf.slug,
            "features.storefront_domain": createdSf.primary_domain,
          },
        }
      );
    }
    await AuditLog.create({
      id: `audit_sf_${Date.now()}`,
      action: "CREATE",
      entity_type: "Storefront",
      entity_id: createdSf.id,
      user_email: auth.actor.email,
      changes: {
        pharmacy_id: createdSf.pharmacy_id,
        pharmacy_name: createdSf.pharmacy_name,
        slug: createdSf.slug,
        primary_domain: createdSf.primary_domain,
        status: createdSf.status,
      },
    });
  } catch {
    // Non-blocking if MongoDB is offline in local test mode
  }

  // Re-fetch updated storefront record
  const detailsRes = await callStorefrontManageApi(
    `/api/v1/manage/storefronts/${encodeURIComponent(createdSf.id)}`,
    { method: "GET", actor }
  );

  const urls = getStorefrontPublicPreviewUrl(createdSf.slug, createdSf.primary_domain);
  return NextResponse.json(
    {
      ok: true,
      storefront: {
        ...(detailsRes.data?.storefront || createdSf),
        public_url: urls.publicUrl,
        preview_url: urls.localPreviewUrl,
      },
    },
    { status: 201 }
  );
}

