/**
 * Server-Side Bridge from AivraSol Super Admin & Owner Portal to the Storefront Cloudflare Worker API
 *
 * Security Guarantees:
 * - Signs short-lived HMAC-SHA256 `sfm1.` management tokens and `sfs1.` sync tokens.
 * - For Super Admin requests, `scopedPharmacyId` is `null` (platform-wide management).
 * - For Owner Portal requests, `scopedPharmacyId` is strictly bound to the authenticated
 *   `PortalUser.client_id` from the server session — never trusting client parameters.
 * - Strips all private POS financial, cost, WAC, margin, and supplier fields before any
 *   product publishing payload leaves the server.
 */

import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";

export interface StorefrontManagementActor {
  actorType: "super_admin" | "portal_owner" | "portal_manager";
  actorId: string;
  actorEmail: string;
  scopedPharmacyId: string | null;
}

export interface StorefrontSyncActor {
  storefrontId: string;
  pharmacyId: string;
  branchId?: string;
  licenseId?: string;
}

const DEV_FALLBACK_WORKER_URL = "http://localhost:8787";
const DEV_FALLBACK_ADMIN_SECRET = "aivrasol-storefront-dev-admin-secret-2026";
const DEV_FALLBACK_SYNC_SECRET = "aivrasol-storefront-dev-sync-secret-2026";

export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export interface StorefrontConfigStatus {
  configured: boolean;
  isProduction: boolean;
  workerUrlConfigured: boolean;
  adminSecretConfigured: boolean;
  syncSecretConfigured: boolean;
  workerBaseUrl: string;
  missingEnvVars: string[];
}

export function getStorefrontConfigStatus(): StorefrontConfigStatus {
  const isProd = isProductionDeployment();
  const rawUrl = (process.env.STOREFRONT_WORKER_URL || "").trim().replace(/\/+$/, "");
  const hasUrl = Boolean(rawUrl && !rawUrl.includes("localhost"));
  const hasAdminSecret = Boolean((process.env.STOREFRONT_ADMIN_SECRET || "").trim());
  const hasSyncSecret = Boolean((process.env.STOREFRONT_SYNC_SECRET || "").trim());

  const missingEnvVars: string[] = [];
  if (isProd) {
    if (!hasUrl) missingEnvVars.push("STOREFRONT_WORKER_URL");
    if (!hasAdminSecret) missingEnvVars.push("STOREFRONT_ADMIN_SECRET");
    if (!hasSyncSecret) missingEnvVars.push("STOREFRONT_SYNC_SECRET");
  }

  const effectiveUrl = isProd ? rawUrl : rawUrl || DEV_FALLBACK_WORKER_URL;

  return {
    configured: isProd ? missingEnvVars.length === 0 : Boolean(effectiveUrl),
    isProduction: isProd,
    workerUrlConfigured: isProd ? hasUrl : Boolean(effectiveUrl),
    adminSecretConfigured: isProd ? hasAdminSecret : true,
    syncSecretConfigured: isProd ? hasSyncSecret : true,
    workerBaseUrl: effectiveUrl,
    missingEnvVars,
  };
}

export function getStorefrontWorkerBaseUrl(): string {
  return getStorefrontConfigStatus().workerBaseUrl;
}

export function getStorefrontPublicPreviewUrl(slug: string, primaryDomain?: string): {
  publicUrl: string;
  localPreviewUrl: string;
} {
  const baseUrl = getStorefrontWorkerBaseUrl();
  const configuredCustomBase = (process.env.STOREFRONT_PUBLIC_BASE_DOMAIN || "").trim().toLowerCase();

  // Only return a direct custom hostname if the pharmacy connected a real non-placeholder custom domain,
  // OR if `STOREFRONT_PUBLIC_BASE_DOMAIN` is explicitly configured in DNS.
  const hasVerifiedCustomDomain = Boolean(
    primaryDomain &&
      !primaryDomain.endsWith(".aivrasol.pk") &&
      !primaryDomain.endsWith(".workers.dev") &&
      !primaryDomain.includes("localhost")
  );
  const hasConfiguredWildcardDomain = Boolean(
    configuredCustomBase && primaryDomain && primaryDomain.endsWith(`.${configuredCustomBase}`)
  );

  if (hasVerifiedCustomDomain || hasConfiguredWildcardDomain) {
    return {
      publicUrl: `https://${primaryDomain}`,
      localPreviewUrl: baseUrl ? `${baseUrl}/s/${encodeURIComponent(slug)}` : `https://${primaryDomain}`,
    };
  }

  if (baseUrl) {
    const cleanWorkerUrl = `${baseUrl}/s/${encodeURIComponent(slug)}`;
    return {
      publicUrl: cleanWorkerUrl,
      localPreviewUrl: cleanWorkerUrl,
    };
  }

  return {
    publicUrl: "",
    localPreviewUrl: "",
  };
}

function getAdminSecret(): string {
  if (isProductionDeployment()) {
    return (process.env.STOREFRONT_ADMIN_SECRET || "").trim();
  }
  return (process.env.STOREFRONT_ADMIN_SECRET || "").trim() || DEV_FALLBACK_ADMIN_SECRET;
}

function getSyncSecret(): string {
  if (isProductionDeployment()) {
    return (process.env.STOREFRONT_SYNC_SECRET || "").trim();
  }
  return (process.env.STOREFRONT_SYNC_SECRET || "").trim() || DEV_FALLBACK_SYNC_SECRET;
}

export function signStorefrontManagementToken(
  actor: StorefrontManagementActor,
  ttlSeconds = 300
): string {
  const payload = {
    t: actor.actorType,
    id: actor.actorId,
    em: actor.actorEmail,
    ph: actor.scopedPharmacyId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const bodyB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const sig = crypto
    .createHmac("sha256", getAdminSecret())
    .update(bodyB64)
    .digest("hex");
  return `sfm1.${bodyB64}.${sig}`;
}

export function signStorefrontSyncToken(
  actor: StorefrontSyncActor,
  ttlSeconds = 900
): string {
  const payload = {
    sf: actor.storefrontId,
    ph: actor.pharmacyId,
    br: actor.branchId || "main",
    lic: actor.licenseId || undefined,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const bodyB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const sig = crypto
    .createHmac("sha256", getSyncSecret())
    .update(bodyB64)
    .digest("hex");
  return `sfs1.${bodyB64}.${sig}`;
}

let autoSpawnAttempted = false;

async function ensureLocalWorkerRunning(baseUrl: string): Promise<void> {
  if (!baseUrl.includes("localhost:8787") && !baseUrl.includes("127.0.0.1:8787")) {
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) return;
  } catch {
    // Worker not reachable yet; spawn local dev server once in development
    if (!autoSpawnAttempted && process.env.NODE_ENV !== "production") {
      autoSpawnAttempted = true;
      try {
        const storefrontDir = path.resolve(process.cwd(), "../aivrasol-storefront");
        const tsxCli = path.resolve(
          process.cwd(),
          "../aivrasol-pos/node_modules/tsx/dist/cli.mjs"
        );
        const devServerScript = path.join(storefrontDir, "src/worker/dev-server.ts");
        const child = spawn(process.execPath, [tsxCli, devServerScript], {
          cwd: storefrontDir,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        await new Promise((r) => setTimeout(r, 900));
      } catch (spawnErr) {
        console.warn("[StorefrontBridge] Could not auto-start local worker:", spawnErr);
      }
    }
  }
}

export async function callStorefrontManageApi<T = any>(
  endpointPath: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    actor: StorefrontManagementActor;
    body?: unknown;
  }
): Promise<{ status: number; ok: boolean; data: T }> {
  const cfg = getStorefrontConfigStatus();
  if (!cfg.configured || !cfg.workerBaseUrl) {
    return {
      status: 503,
      ok: false,
      data: {
        ok: false,
        error: "worker_not_configured",
        missing_env_vars: cfg.missingEnvVars,
        message:
          "Storefront Cloudflare Worker is not configured yet. Set STOREFRONT_WORKER_URL, STOREFRONT_ADMIN_SECRET, and STOREFRONT_SYNC_SECRET in server environment variables.",
      } as unknown as T,
    };
  }
  const baseUrl = cfg.workerBaseUrl;
  await ensureLocalWorkerRunning(baseUrl);

  const token = signStorefrontManagementToken(options.actor);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${endpointPath}`, {
    method: options.method || "GET",
    headers,
    body: bodyStr,
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as T;
  return {
    status: res.status,
    ok: res.ok,
    data,
  };
}

export async function callStorefrontSyncApi<T = any>(
  endpointPath: string,
  options: {
    method?: "GET" | "POST";
    actor: StorefrontSyncActor;
    body?: unknown;
  }
): Promise<{ status: number; ok: boolean; data: T }> {
  const cfg = getStorefrontConfigStatus();
  if (!cfg.configured || !cfg.workerBaseUrl) {
    return {
      status: 503,
      ok: false,
      data: {
        ok: false,
        error: "worker_not_configured",
        missing_env_vars: cfg.missingEnvVars,
        message: "Storefront Cloudflare Worker is not configured yet.",
      } as unknown as T,
    };
  }
  const baseUrl = cfg.workerBaseUrl;
  await ensureLocalWorkerRunning(baseUrl);

  const token = signStorefrontSyncToken(options.actor);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${endpointPath}`, {
    method: options.method || "GET",
    headers,
    body: bodyStr,
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as T;
  return {
    status: res.status,
    ok: res.ok,
    data,
  };
}

/**
 * Strictly sanitizes a POS / OwnerPortalState product item into a public catalog delta item.
 * Never allows `cost_wac`, `cost_price`, `margin_pct`, `gross_profit_30d`, `last_purchase_cost`,
 * `last_supplier_name`, or controlled substances to be published.
 */
export function sanitizePortalProductForStorefront(raw: Record<string, any>) {
  const posProductId = String(raw.pos_product_id || raw.product_id || raw.id || "").trim();
  const name = String(raw.product_name || raw.name || "").trim();
  const categoryName = String(raw.category || raw.category_name || "General Medicines").trim();

  const isControlled = Boolean(
    raw.is_controlled_substance ||
      raw.is_controlled ||
      /narcotic|controlled|schedule\s*g|psychotropic/i.test(categoryName)
  );
  const requiresRx = Boolean(
    isControlled ||
      raw.requires_prescription ||
      /prescription|antibiotic|rx|insulin|cardiac/i.test(categoryName)
  );

  const currentStock = Math.max(
    0,
    Number(raw.available_base_qty ?? raw.current_stock ?? raw.available_qty ?? 0)
  );
  const reorderLevel = Math.max(2, Number(raw.reorder_level ?? 5));
  const availability =
    currentStock <= 0
      ? "out_of_stock"
      : currentStock <= reorderLevel
      ? "low_stock"
      : "in_stock";

  const retailPrice = Math.max(
    0,
    Number(raw.sale_price ?? raw.public_selling_price_pkr ?? raw.retail_price ?? 0)
  );

  const baseUnitLabel = String(raw.base_unit_label || raw.unit_label || raw.unit || "Unit").trim() || "Unit";
  const packingLabel = String(raw.packing_label || raw.pack_size || baseUnitLabel).trim() || baseUnitLabel;

  // Build genuine inventory-compatible selling units only from configured POS units/packings (never invent conversions)
  let sellingUnits: Array<{
    unit_id: string;
    unit_name: string;
    label: string;
    multiplier: number;
    price_pkr: number;
    compare_at_price_pkr: number | null;
    is_default: boolean;
    sort_order: number;
  }> = [];

  if (Array.isArray(raw.selling_units) && raw.selling_units.length > 0) {
    sellingUnits = raw.selling_units
      .map((u: any, idx: number) => ({
        unit_id: String(u.unit_id || `unit_${idx}`).trim(),
        unit_name: String(u.unit_name || u.label || baseUnitLabel).trim(),
        label: String(u.label || u.unit_name || baseUnitLabel).trim(),
        multiplier: Math.max(1, Math.round(Number(u.multiplier || 1))),
        price_pkr: Math.max(0, Number(u.price_pkr ?? retailPrice)),
        compare_at_price_pkr:
          u.compare_at_price_pkr !== null && u.compare_at_price_pkr !== undefined
            ? Number(u.compare_at_price_pkr)
            : null,
        is_default: Boolean(u.is_default ?? idx === 0),
        sort_order: Number(u.sort_order ?? idx),
      }))
      .filter((u: any) => u.multiplier >= 1 && Number.isFinite(u.price_pkr));
  } else {
    sellingUnits.push({
      unit_id: `base_${baseUnitLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "unit"}`,
      unit_name: baseUnitLabel,
      label: baseUnitLabel,
      multiplier: 1,
      price_pkr: retailPrice,
      compare_at_price_pkr: raw.compare_at_price_pkr ? Number(raw.compare_at_price_pkr) : null,
      is_default: true,
      sort_order: 0,
    });
    if (Array.isArray(raw.packings)) {
      raw.packings.forEach((p: any, idx: number) => {
        const mult = Math.round(Number(p?.multiplier || 0));
        const pName = String(p?.name || "").trim();
        if (!pName || !Number.isFinite(mult) || mult <= 1) return;
        const unitPrice =
          p?.price !== undefined && p?.price !== null && Number(p.price) > 0
            ? Number(p.price)
            : Number((retailPrice * mult).toFixed(2));
        sellingUnits.push({
          unit_id: String(p?.id || `pack_${pName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${mult}`),
          unit_name: pName,
          label: `${pName} (${mult} ${baseUnitLabel}${mult > 1 ? "s" : ""})`,
          multiplier: mult,
          price_pkr: unitPrice,
          compare_at_price_pkr: null,
          is_default: false,
          sort_order: idx + 1,
        });
      });
    }
  }

  return {
    pos_product_id: posProductId,
    source_revision: Number(raw.source_revision || 1),
    public_selling_price_pkr: retailPrice,
    compare_at_price_pkr: raw.compare_at_price_pkr ? Number(raw.compare_at_price_pkr) : null,
    website_visibility: isControlled
      ? ("unpublished" as const)
      : ((raw.publish_status || raw.website_visibility || "published") as
          | "published"
          | "unpublished"
          | "draft"),
    availability: availability as "in_stock" | "low_stock" | "out_of_stock",
    available_qty: currentStock,
    available_base_qty: currentStock,
    is_featured: isControlled ? false : Boolean(raw.is_featured),
    max_order_qty: Math.max(1, Number(raw.max_order_qty || 20)),
    selling_units: sellingUnits,
    product_identity: {
      sku_code: raw.sku || raw.sku_code ? String(raw.sku || raw.sku_code) : undefined,
      barcode: raw.barcode ? String(raw.barcode) : undefined,
      name,
      generic_name: raw.generic_name ? String(raw.generic_name) : undefined,
      strength: raw.strength ? String(raw.strength) : undefined,
      dosage_form: raw.dosage_form ? String(raw.dosage_form) : undefined,
      brand_name: raw.brand_name || raw.manufacturer ? String(raw.brand_name || raw.manufacturer) : undefined,
      packing_label: packingLabel,
      unit_label: baseUnitLabel,
      base_unit_label: baseUnitLabel,
      category_name: categoryName,
      public_description: raw.public_description ? String(raw.public_description) : undefined,
      primary_image_url: raw.primary_image_url ? String(raw.primary_image_url) : undefined,
      requires_prescription: requiresRx,
      is_controlled_substance: isControlled,
    },
  };
}

export const CURATED_APPROVED_STARTER_PRODUCTS = [
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
    available_qty: 4,
    is_featured: true,
    requires_prescription: false,
    is_controlled_substance: false,
  },
];

