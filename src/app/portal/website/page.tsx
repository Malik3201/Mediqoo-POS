"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Globe,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Package,
  Sparkles,
  AlertCircle,
  Lock,
  Palette,
  ShoppingBag,
  Truck,
  MapPin,
  Settings,
  Megaphone,
  Upload,
  Search,
  Star,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Check,
  Copy,
  FileText,
  CreditCard,
} from "lucide-react";
import {
  optimizeImageForStorefront,
  type MediaAssetPurpose,
} from "@/lib/storefront/image-optimizer";

type PortalWebsiteTab =
  | "overview"
  | "branding"
  | "products"
  | "promotions"
  | "orders"
  | "delivery"
  | "contact"
  | "settings";

export default function PortalMyWebsitePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortalWebsiteTab>("overview");
  const [saving, setSaving] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Branding Form State
  const [brandingForm, setBrandingForm] = useState({
    display_name: "",
    tagline: "",
    theme_preset: "emerald_clinical",
    primary_color: "#009A4D",
    secondary_color: "#0F172A",
    accent_color: "#10B981",
    hero_title: "",
    hero_subtitle: "",
    about_title: "",
    about_content: "",
    footer_tagline: "",
    logo_url: "",
    show_verified_license_badge: true,
  });

  // Settings & Delivery Form State
  const [settingsForm, setSettingsForm] = useState({
    catalog_mode: "inventory_first",
    hide_out_of_stock: false,
    show_stock_badges: true,
    allow_rx_inquiries: true,
    whatsapp_order_assist_enabled: true,
    delivery_enabled: true,
    pickup_enabled: true,
    standard_delivery_fee_pkr: 150,
    free_delivery_threshold_pkr: 2000,
    minimum_order_value_pkr: 300,
    estimated_delivery_minutes: 45,
    announcement_bar_enabled: true,
    announcement_bar_text: "",
    seo_title: "",
    seo_description: "",
    legal_disclaimer_text: "",
    pharmacist_supervision_note: "",
    maintenance_mode: false,
    maintenance_message: "",
    mon_sat_hours: "09:00 AM - 11:00 PM",
    sun_hours: "10:00 AM - 10:00 PM",
    is_24_hours: false,
  });

  // Catalog Management State
  const [productSearch, setProductSearch] = useState("");
  const [productFilterStatus, setProductFilterStatus] = useState("all");
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [overridePriceInput, setOverridePriceInput] = useState("");
  const [publicDescInput, setPublicDescInput] = useState("");

  // Promotions & Banners State
  const [newPromo, setNewPromo] = useState({
    title: "",
    description: "",
    code: "",
    badge_text: "Special Offer",
    promotion_type: "percentage",
    discount_value: 10,
    min_order_pkr: 1000,
  });
  const [newBanner, setNewBanner] = useState({
    title: "",
    subtitle: "",
    badge_text: "Featured Healthcare",
    cta_label: "Shop Now",
    placement: "secondary",
    image_url: "",
  });

  // Delivery Zone Form State
  const [newZone, setNewZone] = useState({
    zone_name: "",
    city: "",
    fee_pkr: 150,
    free_above_pkr: 2000,
    min_order_pkr: 300,
    estimated_minutes: 45,
  });

  // Branch Form State
  const [newBranch, setNewBranch] = useState({
    branch_code: "MAIN",
    branch_name: "",
    address_line: "",
    city: "",
    contact_phone: "",
    whatsapp_phone: "",
    pickup_supported: true,
    delivery_supported: true,
  });

  // Custom Domain State
  const [customDomainInput, setCustomDomainInput] = useState("");
  const [posBundleJson, setPosBundleJson] = useState<string>("");

  function resolvePortalMediaUrl(rawUrl: string | null | undefined): string {
    if (!rawUrl) return "";
    if (!rawUrl.startsWith("/api/v1/public/media/")) return rawUrl;
    const workerBase = (data?.worker_base_url || "http://localhost:8787").replace(/\/+$/, "");
    const primaryDomain = data?.storefront?.primary_domain || "";
    return `${workerBase}${rawUrl}${primaryDomain ? `?hostname=${encodeURIComponent(primaryDomain)}` : ""}`;
  }

  // Orders Filter State
  const [orderViewMode, setOrderViewMode] = useState<"active" | "history" | "all">("active");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  // Image Upload Compression Info
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lastUploadStats, setLastUploadStats] = useState<string | null>(null);
  const [connectPosOpen, setConnectPosOpen] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<{
    pairing_code: string;
    expires_at: string;
  } | null>(null);

  const notify = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => {
      setActionToast((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  const loadWebsiteStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/website", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load website status");
      }
      setData(json);

      if (json.branding) {
        const b = json.branding;
        setBrandingForm({
          display_name: b.display_name || json.storefront?.pharmacy_name || "",
          tagline: b.tagline || "",
          theme_preset: b.theme_preset || "emerald_clinical",
          primary_color: b.primary_color || "#009A4D",
          secondary_color: b.secondary_color || "#0F172A",
          accent_color: b.accent_color || "#10B981",
          hero_title: b.hero_title || "",
          hero_subtitle: b.hero_subtitle || "",
          about_title: b.about_title || "",
          about_content: b.about_content || "",
          footer_tagline: b.footer_tagline || "",
          logo_url: b.logo_url || "",
          show_verified_license_badge: Number(b.show_verified_license_badge ?? 1) === 1,
        });
      }

      if (json.settings) {
        const s = json.settings;
        const hrs = s.opening_hours || {};
        setSettingsForm({
          catalog_mode: s.catalog_mode || "inventory_first",
          hide_out_of_stock: Number(s.hide_out_of_stock || 0) === 1,
          show_stock_badges: Number(s.show_stock_badges ?? 1) === 1,
          allow_rx_inquiries: Number(s.allow_rx_inquiries ?? 1) === 1,
          whatsapp_order_assist_enabled: Number(s.whatsapp_order_assist_enabled ?? 1) === 1,
          delivery_enabled: Number(s.delivery_enabled ?? 1) === 1,
          pickup_enabled: Number(s.pickup_enabled ?? 1) === 1,
          standard_delivery_fee_pkr: Number(s.standard_delivery_fee_pkr ?? 150),
          free_delivery_threshold_pkr: Number(s.free_delivery_threshold_pkr ?? 2000),
          minimum_order_value_pkr: Number(s.minimum_order_value_pkr ?? 300),
          estimated_delivery_minutes: Number(s.estimated_delivery_minutes ?? 45),
          announcement_bar_enabled: Number(s.announcement_bar_enabled ?? 1) === 1,
          announcement_bar_text: s.announcement_bar_text || "",
          seo_title: s.seo_title || "",
          seo_description: s.seo_description || "",
          legal_disclaimer_text: s.legal_disclaimer_text || "",
          pharmacist_supervision_note: s.pharmacist_supervision_note || "",
          maintenance_mode: Number(s.maintenance_mode || 0) === 1,
          maintenance_message: s.maintenance_message || "",
          mon_sat_hours: hrs.mon_sat || "09:00 AM - 11:00 PM",
          sun_hours: hrs.sun || "10:00 AM - 10:00 PM",
          is_24_hours: Boolean(hrs.is_24_hours),
        });
      }
    } catch (err: any) {
      setError(err.message || "Unable to load website configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWebsiteStatus();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab") as PortalWebsiteTab | null;
      if (
        tabParam &&
        [
          "overview",
          "branding",
          "products",
          "promotions",
          "orders",
          "delivery",
          "contact",
          "settings",
        ].includes(tabParam)
      ) {
        setActiveTab(tabParam);
      }
      const onOpenOrders = () => {
        setActiveTab("orders");
        void loadWebsiteStatus();
      };
      window.addEventListener("mediqoo:open-website-orders", onOpenOrders);
      return () => {
        window.removeEventListener("mediqoo:open-website-orders", onOpenOrders);
      };
    }
  }, []);

  async function postWebsiteAction(action: string, extraBody: Record<string, any> = {}) {
    setSaving(true);
    try {
      const res = await fetch("/api/portal/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraBody }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.message || json.error || `Action ${action} failed`);
      }
      await loadWebsiteStatus();
      return json;
    } catch (err: any) {
      notify(`Error: ${err.message}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleWebPImageUpload(
    file: File,
    purpose: MediaAssetPurpose,
    entityId?: string,
    onUrlReady?: (url: string) => void
  ) {
    setUploadingImage(true);
    setLastUploadStats(null);
    try {
      const optimized = await optimizeImageForStorefront(file, purpose);
      const res = await postWebsiteAction("upload_media", {
        payload: {
          asset_purpose: purpose,
          original_filename: file.name,
          mime_type: optimized.mimeType,
          byte_size: optimized.byteSize,
          width: optimized.width,
          height: optimized.height,
          sha256_hex: optimized.sha256Hex,
          base64_data: optimized.base64Data,
          entity_type:
            purpose === "product"
              ? "product"
              : purpose === "logo"
              ? "branding_logo"
              : purpose === "banner"
              ? "banner"
              : undefined,
          entity_id: entityId,
        },
      });
      const publicUrl = res?.media?.public_url || optimized.previewDataUrl;
      if (onUrlReady && publicUrl) {
        onUrlReady(publicUrl);
      }
      const kb = (optimized.byteSize / 1024).toFixed(1);
      setLastUploadStats(
        `Optimized to WebP (${optimized.width}×${optimized.height}px, ${kb} KB, ${
          res?.deduplicated ? "deduplicated existing R2 object" : `${optimized.compressionRatio}% smaller`
        })`
      );
      notify(`Uploaded optimized WebP ${purpose} image (${kb} KB)`);
    } catch (err: any) {
      notify(err.message || "Image optimization failed");
    } finally {
      setUploadingImage(false);
    }
  }

  const products: any[] = data?.products || [];
  const orders: any[] = data?.orders || [];
  const promotions: any[] = data?.promotions || [];
  const banners: any[] = data?.banners || [];
  const deliveryZones: any[] = data?.delivery_zones || [];
  const branches: any[] = data?.branches || [];
  const domains: any[] = data?.domains || [];

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (productFilterStatus === "published" && p.publish_status !== "published") return false;
      if (productFilterStatus === "unpublished" && p.publish_status === "published") return false;
      if (productFilterStatus === "featured" && !p.is_featured) return false;
      if (!productSearch.trim()) return true;
      const q = productSearch.toLowerCase();
      return (
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.generic_name || "").toLowerCase().includes(q) ||
        String(p.category_name || "").toLowerCase().includes(q) ||
        String(p.sku_code || "").toLowerCase().includes(q)
      );
    });
  }, [products, productFilterStatus, productSearch]);

  const isHistoryOrder = (st: string) =>
    ["completed", "delivered", "collected", "cancelled", "rejected"].includes(
      String(st || "").toLowerCase()
    );

  const orderMetrics = useMemo(() => {
    let pendingNew = 0;
    let inProgress = 0;
    let completed = 0;
    let cancelled = 0;
    let fulfilledValuePkr = 0;
    let pendingValuePkr = 0;
    for (const o of orders) {
      const st = String(o.status || "").toLowerCase();
      const val = Number(o.total_pkr || 0);
      if (st === "pending_confirmation" || st === "pending") {
        pendingNew++;
        pendingValuePkr += val;
      } else if (["confirmed", "preparing", "out_for_delivery", "ready_for_pickup"].includes(st)) {
        inProgress++;
        pendingValuePkr += val;
      } else if (["completed", "delivered", "collected"].includes(st)) {
        completed++;
        fulfilledValuePkr += val;
      } else if (st === "cancelled" || st === "rejected") {
        cancelled++;
      }
    }
    return {
      pendingNew,
      inProgress,
      activeTotal: pendingNew + inProgress,
      completed,
      cancelled,
      fulfilledValuePkr,
      pendingValuePkr,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const st = String(o.status || "").toLowerCase();
      if (orderViewMode === "active" && isHistoryOrder(st)) return false;
      if (orderViewMode === "history" && !isHistoryOrder(st)) return false;
      if (orderStatusFilter !== "all") {
        if (orderStatusFilter === "pending_confirmation") {
          if (st !== "pending_confirmation" && st !== "pending") return false;
        } else if (orderStatusFilter === "delivered") {
          if (st !== "delivered" && st !== "completed") return false;
        } else if (st !== orderStatusFilter) {
          return false;
        }
      }
      if (!orderSearch.trim()) return true;
      const q = orderSearch.toLowerCase();
      return (
        String(o.order_number || "").toLowerCase().includes(q) ||
        String(o.customer_name || "").toLowerCase().includes(q) ||
        String(o.customer_phone || "").toLowerCase().includes(q) ||
        String(o.pos_invoice_number || "").toLowerCase().includes(q)
      );
    });
  }, [orders, orderViewMode, orderStatusFilter, orderSearch]);

  const copyWebsiteLink = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify("Copied live website link to clipboard");
    } catch {
      notify("Could not copy link automatically");
    }
  };

  if (loading && !data) {
    return (
      <div className="p-6 text-slate-600 flex items-center gap-3">
        <RefreshCw className="h-5 w-5 animate-spin text-emerald-600" />
        <span className="font-medium">Loading your pharmacy website management suite...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      </div>
    );
  }

  const exists = Boolean(data?.exists);
  const sf = data?.storefront;
  const progress = data?.setup_progress || {
    completed_steps: 0,
    total_steps: 5,
    percent: 0,
    steps: [],
  };

  return (
    <div className="space-y-6 p-4 md:p-6 text-slate-900" data-testid="owner-portal-website-suite">
      {/* Connect POS Modal */}
      {connectPosOpen && exists && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Connect Your AivraSol POS</h3>
              </div>
              <button
                type="button"
                onClick={() => setConnectPosOpen(false)}
                className="text-xs font-bold text-slate-400 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-emerald-900">
                Option 1 (Recommended): Automatic License Connection
              </div>
              <p>
                Open <strong>AivraSol Pharmacy POS</strong> → <strong>Online Storefront</strong> and click{" "}
                <strong>Connect Website</strong>. Your POS automatically verifies its licensed identity for{" "}
                <strong>{sf?.pharmacy_name}</strong> and connects without entering technical IDs.
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-900">Option 2: Short-Lived Pairing Code</div>
                  <p className="text-slate-500">
                    Single-use 10-minute code bound exclusively to {sf?.pharmacy_name}.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const res = await postWebsiteAction("generate_pos_pairing_code");
                    if (res?.pairing_code) {
                      setPairingInfo({
                        pairing_code: res.pairing_code,
                        expires_at: res.expires_at,
                      });
                      notify("Generated 10-minute POS pairing code");
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold shrink-0"
                >
                  Generate Code
                </button>
              </div>

              {pairingInfo && (
                <div className="rounded-xl bg-white border border-emerald-300 p-3 text-center space-y-1">
                  <div className="text-2xl font-mono font-extrabold tracking-widest text-emerald-700">
                    {pairingInfo.pairing_code}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Expires at {new Date(pairingInfo.expires_at).toLocaleTimeString()} • Single use only
                  </div>
                </div>
              )}
            </div>

            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-700">
                Fallback: Manual Connection Bundle
              </summary>
              <div className="mt-2 space-y-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const res = await postWebsiteAction("generate_pos_sync_bundle");
                    if (res?.connection_bundle) {
                      const str = JSON.stringify(res.connection_bundle, null, 2);
                      setPosBundleJson(str);
                      try {
                        await navigator.clipboard.writeText(str);
                        notify("Copied fallback connection bundle");
                      } catch {
                        notify("Generated fallback connection bundle");
                      }
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
                >
                  Generate & Copy Fallback Bundle
                </button>
                {posBundleJson && (
                  <textarea
                    readOnly
                    rows={4}
                    value={posBundleJson}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2 font-mono text-[10px]"
                  />
                )}
              </div>
            </details>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {actionToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 border border-slate-700">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{actionToast}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
              My Pharmacy Website
            </h1>
            <p className="text-xs md:text-sm text-slate-500">
              Manage your branded customer website, POS product catalog, online orders, and delivery settings
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {exists && (
            <button
              type="button"
              onClick={() => setConnectPosOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 shadow-xs transition"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Connect POS
            </button>
          )}
          {exists && (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                await postWebsiteAction("sync_pos_catalog");
                notify("POS catalog synchronized to website");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-800 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} />
              Sync POS Products
            </button>
          )}
          {exists && (data.public_link || data.preview_link) && (
            <button
              type="button"
              onClick={() => copyWebsiteLink(data.public_link || data.preview_link)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 shadow-xs transition"
            >
              <Copy className="h-3.5 w-3.5 text-slate-600" />
              Copy Link
            </button>
          )}
          {exists && (data.public_link || data.preview_link) && (
            <a
              href={data.public_link || data.preview_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#009A4D] hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition"
            >
              Open Website <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={loadWebsiteStatus}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 shadow-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {!exists ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center max-w-2xl mx-auto my-8 shadow-xs">
          <Globe className="h-12 w-12 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">
            Your Pharmacy Online Storefront is Ready for Activation
          </h2>
          <p className="text-sm text-slate-600 mt-2">
            Connect your existing AivraSol POS catalog to your own branded pharmacy
            website without managing a separate inventory system. Contact AivraSol Support or your
            account manager to enable your storefront entitlement.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800">
            <Clock className="h-3.5 w-3.5" /> Status: Not Yet Activated for Tenant ({data?.client_id})
          </div>
        </div>
      ) : (
        <>
          {/* Clean Website Link Presentation Bar */}
          <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Website Link
                </span>
                <span className="inline-flex items-center rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-mono font-bold text-emerald-800">
                  Slug: {sf.slug}
                </span>
                <span className="text-[11px] text-slate-500">
                  Custom domain ready via Settings &amp; Domains
                </span>
              </div>
              <div className="font-mono text-xs sm:text-sm font-bold text-emerald-700 break-all">
                {data.public_link || data.preview_link}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => copyWebsiteLink(data.public_link || data.preview_link)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 transition"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Link
              </button>
              <a
                href={data.public_link || data.preview_link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-bold text-white transition"
              >
                Open Website <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* 8-Tab Navigation Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            {(
              [
                { id: "overview", label: "Overview", icon: Sparkles },
                { id: "branding", label: "Appearance & Branding", icon: Palette },
                { id: "products", label: `Products (${products.length})`, icon: Package },
                {
                  id: "orders",
                  label: `Online Orders (${orders.length})`,
                  icon: ShoppingBag,
                  badge: orderMetrics.pendingNew,
                },
                { id: "promotions", label: "Promotions & Banners", icon: Megaphone },
                { id: "delivery", label: "Delivery & Pickup", icon: Truck },
                { id: "contact", label: "Branches & Hours", icon: MapPin },
                { id: "settings", label: "Settings & Domains", icon: Settings },
              ] as Array<{ id: PortalWebsiteTab; label: string; icon: any; badge?: number }>
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`portal-tab-${tab.id}`}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                    active
                      ? "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{tab.label}</span>
                  {Boolean(tab.badge && tab.badge > 0) && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* =============================================================== */}
          {/* TAB 1: WEBSITE OVERVIEW                                         */}
          {/* =============================================================== */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs uppercase font-semibold tracking-wider text-slate-500">
                    Website Activation Status
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    {data.website_activation_status === "active" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Active & Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700">
                        <AlertCircle className="h-3.5 w-3.5" />{" "}
                        {String(data.website_activation_status).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Slug: <strong className="font-mono text-slate-800">{sf.slug}</strong>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs uppercase font-semibold tracking-wider text-slate-500">
                    Published Catalog
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-slate-900">
                    {data.published_products_count}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Total synced items: <strong>{products.length}</strong>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs uppercase font-semibold tracking-wider text-slate-500">
                    Online Orders Received
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-emerald-700">
                    {Number(data?.orders_summary?.total_orders || orders.length)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Active attention: <strong>{orderMetrics.activeTotal}</strong>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs uppercase font-semibold tracking-wider text-slate-500">
                    Online Order Value
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-slate-900">
                    PKR {Number(data?.orders_summary?.active_revenue_pkr || 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Last POS Sync:{" "}
                    {data.last_sync ? new Date(data.last_sync).toLocaleTimeString() : "Ready"}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 space-y-5 shadow-xs">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" /> Website Link &amp; Custom Domain Readiness
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Share your live pharmacy website link directly with customers or connect your own custom domain
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-500">Live Website Link</div>
                        <span className="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          /s/{sf.slug}
                        </span>
                      </div>
                      <div className="font-mono text-xs sm:text-sm font-bold text-emerald-700 break-all">
                        {data.public_link || data.preview_link}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => copyWebsiteLink(data.public_link || data.preview_link)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700"
                        >
                          <Copy className="h-3 w-3" /> Copy Link
                        </button>
                        <a
                          href={data.public_link || data.preview_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-[#009A4D] hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white"
                        >
                          Open Website <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                      <div className="text-xs font-medium text-slate-500">Custom Domain Support</div>
                      <div className="text-xs font-bold text-slate-900">
                        {data.domain_status === "verified" &&
                        !String(sf.primary_domain || "").endsWith(".aivrasol.pk")
                          ? `Connected: ${sf.primary_domain}`
                          : "Ready for Custom Pharmacy Domain"}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Your storefront works immediately via your live pharmacy slug link above, and can be mapped to your own custom domain anytime in{" "}
                        <button
                          type="button"
                          onClick={() => setActiveTab("settings")}
                          className="font-bold text-emerald-700 hover:underline"
                        >
                          Settings &amp; Domains
                        </button>
                        .
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-slate-700 flex items-start gap-3">
                    <Lock className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900">
                        POS Accounting & Cost Privacy Guaranteed
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        Your purchase costs, Weighted Average Cost (WAC), gross/net profit, supplier
                        invoices, and customer Khata balances remain strictly inside your POS and never
                        touch the public website database.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Setup Progress Checklist */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Website Setup Progress</h2>
                      <p className="text-xs text-slate-500">
                        {progress.completed_steps} of {progress.total_steps} milestones completed
                      </p>
                    </div>
                    <span className="text-lg font-bold text-emerald-700">{progress.percent}%</span>
                  </div>

                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-[#009A4D] transition-all"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>

                  <div className="space-y-3 pt-2">
                    {(progress.steps || []).map((step: any) => (
                      <div
                        key={step.id}
                        className="flex items-start justify-between gap-2 text-xs border-b border-slate-100 pb-2.5 last:border-0"
                      >
                        <div className="flex items-start gap-2">
                          {step.completed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="font-semibold text-slate-800">{step.label}</div>
                            <div className="text-[11px] text-slate-500">{step.detail}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 2: APPEARANCE & BRANDING + LIVE PREVIEW                     */}
          {/* =============================================================== */}
          {activeTab === "branding" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Pharmacy Identity, Colors & Hero Content
                    </h2>
                    <p className="text-xs text-slate-500">
                      Customize how your pharmacy brand appears to online customers
                    </p>
                  </div>
                </div>

                {/* Logo Upload with Browser WebP Compression */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {brandingForm.logo_url ? (
                      <img
                        src={resolvePortalMediaUrl(brandingForm.logo_url)}
                        alt="Logo"
                        className="w-14 h-14 rounded-xl object-contain bg-white border border-slate-200 p-1"
                      />
                    ) : (
                      <div
                        className="w-14 h-14 rounded-xl text-white font-extrabold flex items-center justify-center text-lg"
                        style={{ backgroundColor: brandingForm.primary_color }}
                      >
                        {(brandingForm.display_name || "PH").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-bold text-slate-900">Pharmacy Logo (WebP Auto-Compressed)</div>
                      <div className="text-[11px] text-slate-500">
                        Automatically resized to ≤500px and compressed to WebP before upload
                      </div>
                      {lastUploadStats && (
                        <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                          {lastUploadStats}
                        </div>
                      )}
                    </div>
                  </div>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3.5 py-2 text-xs font-bold hover:bg-slate-800">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{uploadingImage ? "Optimizing…" : "Upload Logo"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          void handleWebPImageUpload(f, "logo", sf.id, (url) =>
                            setBrandingForm((prev) => ({ ...prev, logo_url: url }))
                          );
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Public Display Name
                    </label>
                    <input
                      type="text"
                      value={brandingForm.display_name}
                      onChange={(e) =>
                        setBrandingForm((p) => ({ ...p, display_name: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Pharmacy Tagline
                    </label>
                    <input
                      type="text"
                      value={brandingForm.tagline}
                      onChange={(e) => setBrandingForm((p) => ({ ...p, tagline: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Theme Preset
                    </label>
                    <select
                      value={brandingForm.theme_preset}
                      onChange={(e) => {
                        const preset = e.target.value;
                        const presetColors: Record<string, { p: string; s: string }> = {
                          emerald_clinical: { p: "#009A4D", s: "#0F172A" },
                          royal_medical_blue: { p: "#0284C7", s: "#0F172A" },
                          teal_wellness: { p: "#0D9488", s: "#134E4A" },
                          classic_navy: { p: "#1E3A8A", s: "#0F172A" },
                        };
                        const c = presetColors[preset] || presetColors.emerald_clinical;
                        setBrandingForm((prev) => ({
                          ...prev,
                          theme_preset: preset,
                          primary_color: c.p,
                          secondary_color: c.s,
                        }));
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                    >
                      <option value="emerald_clinical">Emerald Clinical</option>
                      <option value="royal_medical_blue">Royal Medical Blue</option>
                      <option value="teal_wellness">Teal Wellness</option>
                      <option value="classic_navy">Classic Healthcare Navy</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Primary Brand Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.primary_color}
                        onChange={(e) =>
                          setBrandingForm((p) => ({ ...p, primary_color: e.target.value }))
                        }
                        className="h-9 w-12 rounded border border-slate-200 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={brandingForm.primary_color}
                        onChange={(e) =>
                          setBrandingForm((p) => ({ ...p, primary_color: e.target.value }))
                        }
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Secondary Banner Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandingForm.secondary_color}
                        onChange={(e) =>
                          setBrandingForm((p) => ({ ...p, secondary_color: e.target.value }))
                        }
                        className="h-9 w-12 rounded border border-slate-200 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={brandingForm.secondary_color}
                        onChange={(e) =>
                          setBrandingForm((p) => ({ ...p, secondary_color: e.target.value }))
                        }
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Homepage Hero Headline
                  </label>
                  <input
                    type="text"
                    value={brandingForm.hero_title}
                    onChange={(e) => setBrandingForm((p) => ({ ...p, hero_title: e.target.value }))}
                    placeholder={`Genuine Medicines & Healthcare from ${brandingForm.display_name}`}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Homepage Hero Subtitle
                  </label>
                  <textarea
                    rows={2}
                    value={brandingForm.hero_subtitle}
                    onChange={(e) =>
                      setBrandingForm((p) => ({ ...p, hero_subtitle: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    About Pharmacy Story
                  </label>
                  <textarea
                    rows={3}
                    value={brandingForm.about_content}
                    onChange={(e) =>
                      setBrandingForm((p) => ({ ...p, about_content: e.target.value }))
                    }
                    placeholder="Share your pharmacy's history, cold-chain assurance, and pharmacist supervision commitment..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await postWebsiteAction("update_branding", { payload: brandingForm });
                    notify("Saved website branding & appearance");
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#009A4D] hover:bg-emerald-700 text-white text-xs font-bold shadow-xs"
                >
                  {saving ? "Saving Branding…" : "Save Appearance & Branding"}
                </button>
              </div>

              {/* Live Visual Preview Card */}
              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs sticky top-6">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Live Theme Preview
                    </span>
                    <span className="font-mono text-xs text-emerald-700">{sf.primary_domain}</span>
                  </div>

                  <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50">
                    <div
                      className="text-white text-[10px] py-1.5 px-3 font-medium flex justify-between"
                      style={{ backgroundColor: brandingForm.primary_color }}
                    >
                      <span>{settingsForm.announcement_bar_text || "Verified Community Pharmacy"}</span>
                      <span>{sf.city}</span>
                    </div>
                    <div className="bg-white p-3.5 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-9 h-9 rounded-xl text-white font-extrabold text-xs flex items-center justify-center"
                          style={{ backgroundColor: brandingForm.primary_color }}
                        >
                          {(brandingForm.display_name || "PH").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            {brandingForm.display_name || sf.pharmacy_name}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {brandingForm.tagline || sf.city}
                          </div>
                        </div>
                      </div>
                      <span
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white"
                        style={{ backgroundColor: brandingForm.primary_color }}
                      >
                        🛒 Cart (0)
                      </span>
                    </div>
                    <div
                      className="p-5 text-white space-y-2"
                      style={{
                        background: `linear-gradient(135deg, ${brandingForm.primary_color} 0%, ${brandingForm.secondary_color} 100%)`,
                      }}
                    >
                      <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/20">
                        Licensed Pharmacy
                      </span>
                      <div className="text-base font-extrabold leading-snug">
                        {brandingForm.hero_title || `Welcome to ${brandingForm.display_name}`}
                      </div>
                      <div className="text-[11px] text-white/85">
                        {brandingForm.hero_subtitle ||
                          "Order genuine medicines synced directly from our pharmacy POS."}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 3: PRODUCTS & CATALOG MANAGEMENT                            */}
          {/* =============================================================== */}
          {activeTab === "products" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search synced POS medicines by name, generic salt, SKU, or category..."
                    className="w-full rounded-xl border border-slate-200 pl-9 pr-4 py-2 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "published", "unpublished", "featured"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setProductFilterStatus(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize border ${
                        productFilterStatus === st
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 border-slate-200"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[11px]">
                        <th className="py-3 px-4">Medicine</th>
                        <th className="py-3 px-3">Category</th>
                        <th className="py-3 px-3">POS Price</th>
                        <th className="py-3 px-3">Website Override</th>
                        <th className="py-3 px-3">Stock Status</th>
                        <th className="py-3 px-3">Visibility</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.map((prod) => {
                        const isPublished = prod.publish_status === "published";
                        const isControlled = Number(prod.is_controlled_substance || 0) === 1;
                        return (
                          <tr key={prod.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                {prod.primary_image_url ? (
                                  <img
                                    src={resolvePortalMediaUrl(prod.primary_image_url)}
                                    alt={prod.name}
                                    className="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white p-0.5"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-[10px]">
                                    {String(prod.dosage_form || "MED").slice(0, 3).toUpperCase()}
                                  </div>
                                )}
                                <div>
                                  <div className="font-bold text-slate-900">{prod.name}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {prod.generic_name || prod.sku_code}
                                    {Number(prod.requires_prescription || 0) === 1 && (
                                      <span className="ml-1.5 px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 font-bold text-[10px]">
                                        Rx
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-slate-600">{prod.category_name}</td>
                            <td className="py-3 px-3 font-semibold text-slate-800">
                              PKR {Number(prod.public_selling_price_pkr || 0).toLocaleString()}
                            </td>
                            <td className="py-3 px-3">
                              {prod.override_price_pkr !== null &&
                              prod.override_price_pkr !== undefined ? (
                                <span className="font-bold text-emerald-700">
                                  PKR {Number(prod.override_price_pkr).toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-slate-400">Uses POS Price</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  prod.availability_status === "in_stock"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : prod.availability_status === "low_stock"
                                    ? "bg-amber-50 text-amber-800"
                                    : "bg-red-50 text-red-700"
                                }`}
                              >
                                {prod.availability_status} ({prod.available_qty})
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              {isControlled ? (
                                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold">
                                  Blocked (Controlled)
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={async () => {
                                    const nextStatus = isPublished ? "unpublished" : "published";
                                    await postWebsiteAction("update_product_override", {
                                      product_id: prod.id,
                                      payload: { publish_status: nextStatus },
                                    });
                                    notify(`${prod.name} marked ${nextStatus}`);
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                    isPublished
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : "bg-slate-100 text-slate-600 border border-slate-200"
                                  }`}
                                >
                                  {isPublished ? (
                                    <>
                                      <Eye className="h-3 w-3" /> Published
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="h-3 w-3" /> Hidden
                                    </>
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right space-x-1.5">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={async () => {
                                  await postWebsiteAction("update_product_override", {
                                    product_id: prod.id,
                                    payload: { is_featured: !prod.is_featured },
                                  });
                                  notify(`Updated featured status for ${prod.name}`);
                                }}
                                title="Toggle Featured"
                                className={`p-1.5 rounded-lg border ${
                                  prod.is_featured
                                    ? "bg-amber-50 border-amber-300 text-amber-600"
                                    : "border-slate-200 text-slate-400"
                                }`}
                              >
                                <Star className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProduct(prod);
                                  setOverridePriceInput(
                                    prod.override_price_pkr !== null &&
                                      prod.override_price_pkr !== undefined
                                      ? String(prod.override_price_pkr)
                                      : ""
                                  );
                                  setPublicDescInput(prod.public_description || "");
                                }}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 font-bold hover:bg-slate-100"
                              >
                                Edit / Photo
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Edit Product Website Details & Photo Modal */}
              {editingProduct && (
                <div
                  className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
                  onClick={() => setEditingProduct(null)}
                >
                  <div
                    className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Website Override: {editingProduct.name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          POS Retail Price: PKR {editingProduct.public_selling_price_pkr}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingProduct(null)}
                        className="text-slate-400 hover:text-slate-700 font-bold"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Product WebP Photo Upload */}
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                      <div className="text-xs">
                        <div className="font-bold text-slate-800">Medicine Package Image</div>
                        <div className="text-[11px] text-slate-500">
                          Browser-optimized WebP (target 40–90 KB, sharp medicine label text)
                        </div>
                      </div>
                      <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3 py-1.5 text-xs font-bold">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{uploadingImage ? "Uploading…" : "Upload Photo"}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              void handleWebPImageUpload(f, "product", editingProduct.id, (url) => {
                                setEditingProduct((prev: any) =>
                                  prev ? { ...prev, primary_image_url: url } : null
                                );
                              });
                            }
                          }}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Website Price Override (PKR) — Leave blank to use POS Selling Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={overridePriceInput}
                        onChange={(e) => setOverridePriceInput(e.target.value)}
                        placeholder={`Default POS Price: ${editingProduct.public_selling_price_pkr}`}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Customer-Safe Website Description & Usage Note
                      </label>
                      <textarea
                        rows={3}
                        value={publicDescInput}
                        onChange={(e) => setPublicDescInput(e.target.value)}
                        placeholder="Add patient-friendly information, storage notes, or pack details..."
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingProduct(null)}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          await postWebsiteAction("update_product_override", {
                            product_id: editingProduct.id,
                            payload: {
                              override_price_pkr:
                                overridePriceInput.trim() === ""
                                  ? null
                                  : Number(overridePriceInput),
                              public_description: publicDescInput.trim(),
                            },
                          });
                          setEditingProduct(null);
                          notify("Saved website product overrides");
                        }}
                        className="px-4 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-bold"
                      >
                        Save Product Changes
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 4: ONLINE ORDERS MANAGEMENT                                 */}
          {/* =============================================================== */}
          {activeTab === "orders" && (
            <div className="space-y-4" data-testid="portal-orders-management">
              {/* Order Summary KPIs (Kept strictly separate from finalized POS sales revenue) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">New / Pending</div>
                  <div className="mt-1 text-xl font-extrabold text-amber-600">
                    {orderMetrics.pendingNew}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">In Progress</div>
                  <div className="mt-1 text-xl font-extrabold text-sky-700">
                    {orderMetrics.inProgress}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">Completed</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-700">
                    {orderMetrics.completed}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Cancelled / Rejected
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-rose-600">
                    {orderMetrics.cancelled}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Fulfilled Order Value
                  </div>
                  <div className="mt-1 text-base font-extrabold text-emerald-700">
                    PKR {orderMetrics.fulfilledValuePkr.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Pending Order Value
                  </div>
                  <div className="mt-1 text-base font-extrabold text-slate-800">
                    PKR {orderMetrics.pendingValuePkr.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Active Orders vs Order History + Search + Status Filters */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200">
                    {(
                      [
                        { id: "active", label: `Active Orders (${orderMetrics.activeTotal})` },
                        {
                          id: "history",
                          label: `Order History (${orderMetrics.completed + orderMetrics.cancelled})`,
                        },
                        { id: "all", label: `All (${orders.length})` },
                      ] as const
                    ).map((vm) => (
                      <button
                        key={vm.id}
                        type="button"
                        onClick={() => setOrderViewMode(vm.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                          orderViewMode === vm.id
                            ? "bg-white text-slate-900 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {vm.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-72">
                    <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Search Order #, customer, phone, POS invoice..."
                      className="w-full rounded-xl border border-slate-200 pl-8 pr-3 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      "all",
                      "pending_confirmation",
                      "confirmed",
                      "preparing",
                      "out_for_delivery",
                      "ready_for_pickup",
                      "delivered",
                      "collected",
                      "cancelled",
                      "rejected",
                    ].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setOrderStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold capitalize border ${
                          orderStatusFilter === st
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {st.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    Showing {filteredOrders.length} orders
                  </span>
                </div>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center space-y-2">
                  <ShoppingBag className="h-8 w-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-800">No Online Orders in This View</p>
                  <p className="text-xs text-slate-500">
                    Customer orders placed on your pharmacy website appear here and in your POS Online Orders Inbox immediately.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto shadow-xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[11px]">
                        <th className="py-3 px-4">Order #</th>
                        <th className="py-3 px-3">Customer &amp; Destination</th>
                        <th className="py-3 px-3">Fulfillment</th>
                        <th className="py-3 px-3">Total</th>
                        <th className="py-3 px-3">Payment Status</th>
                        <th className="py-3 px-3">POS Invoice / Handoff</th>
                        <th className="py-3 px-4 text-right">Fulfillment Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOrders.map((ord) => {
                        const isPickup = String(ord.fulfillment_type || "") === "pickup";
                        const paymentSt =
                          ord.payment_status ||
                          (String(ord.payment_method || "cod").toLowerCase().includes("cod")
                            ? "pending_cod"
                            : "unpaid");
                        return (
                          <tr key={ord.id} className="hover:bg-slate-50/70 align-top">
                            <td className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => setSelectedOrder(ord)}
                                className="font-mono font-bold text-emerald-700 hover:underline text-left"
                              >
                                {ord.order_number}
                              </button>
                              <div className="text-[10px] text-slate-400">
                                {new Date(ord.created_at).toLocaleString()}
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedOrder(ord)}
                                className="mt-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 underline"
                              >
                                View Items ({Array.isArray(ord.items) ? ord.items.length : "Details"})
                              </button>
                            </td>
                            <td className="py-3 px-3 max-w-[230px]">
                              <div className="font-bold text-slate-900">{ord.customer_name}</div>
                              <div className="text-slate-600 font-mono text-[11px]">
                                {ord.customer_phone}
                              </div>
                              {!isPickup && ord.delivery_address && (
                                <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                                  {ord.delivery_address}
                                  {ord.delivery_city ? `, ${ord.delivery_city}` : ""}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  isPickup
                                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                                    : "bg-sky-50 text-sky-700 border border-sky-200"
                                }`}
                              >
                                {isPickup ? "Counter Pickup" : "Home Delivery"}
                              </span>
                              {Number(ord.requires_prescription || 0) === 1 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-[10px]">
                                  Rx
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-extrabold text-slate-900">
                                PKR {Number(ord.total_pkr).toLocaleString()}
                              </div>
                              {Number(ord.delivery_fee_pkr || 0) > 0 && (
                                <div className="text-[10px] text-slate-500">
                                  Incl. PKR {Number(ord.delivery_fee_pkr).toLocaleString()} delivery
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <select
                                value={paymentSt}
                                disabled={saving}
                                onChange={async (e) => {
                                  const nextPay = e.target.value;
                                  await postWebsiteAction("update_order_status", {
                                    order_id: ord.id,
                                    status: ord.status,
                                    payment_status: nextPay,
                                    note: `Payment status updated to ${nextPay} in Owner Portal`,
                                  });
                                  notify(`Payment status for ${ord.order_number} set to ${nextPay}`);
                                }}
                                className={`rounded-xl border px-2 py-1 text-[11px] font-bold ${
                                  paymentSt === "paid"
                                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                    : paymentSt === "partially_paid"
                                    ? "bg-sky-50 border-sky-200 text-sky-800"
                                    : paymentSt === "refunded"
                                    ? "bg-rose-50 border-rose-200 text-rose-700"
                                    : "bg-amber-50 border-amber-200 text-amber-800"
                                }`}
                              >
                                <option value="pending_cod">COD Pending</option>
                                <option value="partially_paid">Partially Paid</option>
                                <option value="unpaid">Unpaid</option>
                                <option value="paid">Paid</option>
                                <option value="refunded">Refunded</option>
                              </select>
                              {String(ord.payment_method || "cod").toLowerCase().includes("cod") && (
                                <div className="mt-1 text-[10px] font-mono text-slate-600">
                                  Paid: PKR {Number(ord.cod_paid_amount_pkr || 0).toLocaleString()} • Due: PKR{" "}
                                  {Number(
                                    ord.cod_balance_due_pkr !== null && ord.cod_balance_due_pkr !== undefined
                                      ? ord.cod_balance_due_pkr
                                      : paymentSt === "paid"
                                      ? 0
                                      : Math.max(
                                          0,
                                          Number(ord.total_pkr || 0) - Number(ord.cod_paid_amount_pkr || 0)
                                        )
                                  ).toLocaleString()}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                  {ord.pos_handoff_status || "unread"}
                                </span>
                                {ord.pos_invoice_number && (
                                  <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono font-bold text-[10px]">
                                    POS #{ord.pos_invoice_number}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <select
                                value={ord.status}
                                disabled={saving}
                                onChange={async (e) => {
                                  const nextSt = e.target.value;
                                  await postWebsiteAction("update_order_status", {
                                    order_id: ord.id,
                                    status: nextSt,
                                    note: `Updated to ${nextSt} by Pharmacy Owner`,
                                  });
                                  notify(`Order ${ord.order_number} updated to ${nextSt}`);
                                }}
                                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800"
                              >
                                <option value="pending_confirmation">Pending Confirmation</option>
                                {ord.status === "pending" && <option value="pending">Pending</option>}
                                <option value="confirmed">Confirmed</option>
                                <option value="preparing">Preparing</option>
                                {isPickup ? (
                                  <>
                                    <option value="ready_for_pickup">Ready for Pickup</option>
                                    <option value="collected">Collected</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="out_for_delivery">Out for Delivery</option>
                                    <option value="delivered">Delivered</option>
                                  </>
                                )}
                                {ord.status === "completed" && (
                                  <option value="completed">Completed</option>
                                )}
                                <option value="cancelled">Cancelled</option>
                                <option value="rejected">Rejected</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Order Details Drawer / Modal */}
              {selectedOrder && (
                <div
                  className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                  onClick={() => setSelectedOrder(null)}
                >
                  <div
                    className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[88vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-extrabold font-mono text-slate-900">
                            Order #{selectedOrder.order_number}
                          </h3>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {String(selectedOrder.status || "").replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Placed {new Date(selectedOrder.created_at).toLocaleString()} •{" "}
                          {selectedOrder.fulfillment_type === "pickup"
                            ? "Counter Pickup"
                            : "Home Delivery"}
                          {selectedOrder.pos_invoice_number
                            ? ` • POS Invoice #${selectedOrder.pos_invoice_number}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(null)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100"
                      >
                        Close
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                        <div className="font-bold text-slate-500 uppercase text-[10px]">
                          Customer &amp; Contact
                        </div>
                        <div className="font-bold text-slate-900">{selectedOrder.customer_name}</div>
                        <div className="font-mono text-slate-700">{selectedOrder.customer_phone}</div>
                        {selectedOrder.customer_notes && (
                          <div className="text-slate-600 pt-1">
                            <strong>Note:</strong> {selectedOrder.customer_notes}
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                        <div className="font-bold text-slate-500 uppercase text-[10px]">
                          {selectedOrder.fulfillment_type === "pickup"
                            ? "Pickup Branch"
                            : "Delivery Destination"}
                        </div>
                        {selectedOrder.fulfillment_type === "pickup" ? (
                          <div className="text-slate-800 font-semibold">
                            Counter Pickup ({selectedOrder.branch_id || "Main Branch"})
                          </div>
                        ) : (
                          <>
                            <div className="text-slate-800 font-semibold">
                              {selectedOrder.delivery_address || "Address not specified"}
                            </div>
                            <div className="text-slate-600">
                              {[selectedOrder.delivery_area, selectedOrder.delivery_city]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                            {selectedOrder.delivery_instructions && (
                              <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                <strong>Rider Instructions:</strong>{" "}
                                {selectedOrder.delivery_instructions}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="py-2 px-3">Medicine</th>
                            <th className="py-2 px-3">Selling Unit</th>
                            <th className="py-2 px-3 text-right">Qty</th>
                            <th className="py-2 px-3 text-right">Unit Price</th>
                            <th className="py-2 px-3 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map(
                            (it: any, idx: number) => {
                              const unitLabel =
                                it.selling_unit_label ||
                                it.selling_unit_name ||
                                it.packing_label ||
                                "Unit";
                              const mult = Number(it.unit_multiplier || 1);
                              return (
                                <tr key={it.id || idx}>
                                  <td className="py-2.5 px-3">
                                    <div className="font-bold text-slate-900">
                                      {it.product_name}
                                    </div>
                                    <div className="font-mono text-[10px] text-slate-400">
                                      POS ID: {it.pos_product_id || "—"}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold text-slate-700">
                                      {unitLabel}
                                      {mult > 1 ? ` (×${mult} base)` : ""}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-bold">
                                    {it.quantity}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    PKR {Number(it.unit_price_pkr || 0).toLocaleString()}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-bold">
                                    PKR {Number(it.line_total_pkr || 0).toLocaleString()}
                                  </td>
                                </tr>
                              );
                            }
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                      <div className="text-slate-600 space-y-1">
                        <div>
                          Payment:{" "}
                          <strong className="uppercase">
                            {selectedOrder.payment_method || "COD"}
                          </strong>{" "}
                          • Status:{" "}
                          <strong className="uppercase">
                            {String(selectedOrder.payment_status || "pending_cod").replace(/_/g, " ")}
                          </strong>
                        </div>
                        {String(selectedOrder.payment_method || "cod")
                          .toLowerCase()
                          .includes("cod") && (
                          <div className="font-mono text-[11px] text-slate-700">
                            COD Paid: PKR{" "}
                            {Number(selectedOrder.cod_paid_amount_pkr || 0).toLocaleString()} •
                            Remaining COD Due: PKR{" "}
                            {Number(
                              selectedOrder.cod_balance_due_pkr !== null &&
                                selectedOrder.cod_balance_due_pkr !== undefined
                                ? selectedOrder.cod_balance_due_pkr
                                : selectedOrder.payment_status === "paid"
                                ? 0
                                : Math.max(
                                    0,
                                    Number(selectedOrder.total_pkr || 0) -
                                      Number(selectedOrder.cod_paid_amount_pkr || 0)
                                  )
                            ).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="text-right space-y-0.5">
                        <div>
                          Subtotal: PKR {Number(selectedOrder.subtotal_pkr || 0).toLocaleString()}
                          {Number(selectedOrder.delivery_fee_pkr || 0) > 0
                            ? ` + Delivery: PKR ${Number(
                                selectedOrder.delivery_fee_pkr
                              ).toLocaleString()}`
                            : ""}
                          {Number(selectedOrder.discount_pkr || 0) > 0
                            ? ` − Promo: PKR ${Number(selectedOrder.discount_pkr).toLocaleString()}`
                            : ""}
                        </div>
                        <div className="text-sm font-extrabold text-emerald-700">
                          Grand Total: PKR {Number(selectedOrder.total_pkr || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Synced POS COD Collection History (when present) */}
                    {(() => {
                      let codEntries: any[] = [];
                      try {
                        if (typeof selectedOrder.cod_collections_json === "string" && selectedOrder.cod_collections_json) {
                          const parsed = JSON.parse(selectedOrder.cod_collections_json);
                          if (Array.isArray(parsed)) codEntries = parsed;
                        } else if (Array.isArray(selectedOrder.cod_collections)) {
                          codEntries = selectedOrder.cod_collections;
                        }
                      } catch {
                        codEntries = [];
                      }
                      if (codEntries.length === 0) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                          <div className="font-bold uppercase text-[10px] text-slate-500">
                            POS COD Collection &amp; Reversal Ledger
                          </div>
                          <div className="divide-y divide-slate-200/70">
                            {codEntries.map((ce: any, idx: number) => {
                              const amt = Number(ce.amount || 0);
                              const isRev = Boolean(ce.is_reversal || amt < 0);
                              return (
                                <div key={ce.id || idx} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <span className="font-mono font-bold text-slate-800">
                                      {ce.number || ce.id}
                                    </span>{" "}
                                    <span className="uppercase font-semibold text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200">
                                      {ce.method || "cash"}
                                    </span>
                                    {ce.reference ? (
                                      <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                                        Ref: {ce.reference}
                                      </span>
                                    ) : null}
                                    {ce.operator_name ? (
                                      <span className="ml-1.5 text-[11px] text-slate-500">
                                        • {ce.operator_name}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className={`font-mono font-bold ${isRev ? "text-rose-700" : "text-emerald-700"}`}>
                                    {isRev ? "−" : "+"}PKR {Math.abs(amt).toLocaleString()}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Synced Order Status Timeline */}
                    {Array.isArray(selectedOrder.history) && selectedOrder.history.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
                        <div className="font-bold uppercase text-[10px] text-slate-500">
                          Order Status Audit Trail
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedOrder.history.map((h: any, idx: number) => (
                            <span
                              key={h.id || idx}
                              className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700"
                              title={h.note || undefined}
                            >
                              <strong>{String(h.to_status || h.new_status || "").replace(/_/g, " ")}</strong>{" "}
                              ({new Date(h.created_at).toLocaleString()})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 5: PROMOTIONS & BANNERS                                     */}
          {/* =============================================================== */}
          {activeTab === "promotions" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Promo Codes & Discounts */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">
                  Promotional Codes & Seasonal Discounts
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <input
                    type="text"
                    value={newPromo.title}
                    onChange={(e) => setNewPromo((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Offer Title (e.g. 10% Off Wellness)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={newPromo.code}
                    onChange={(e) =>
                      setNewPromo((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                    }
                    placeholder="Promo Code (e.g. CARE10)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono uppercase"
                  />
                  <select
                    value={newPromo.promotion_type}
                    onChange={(e) => setNewPromo((p) => ({ ...p, promotion_type: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="percentage">Percentage Discount (%)</option>
                    <option value="fixed_amount">Fixed Amount Off (PKR)</option>
                  </select>
                  <input
                    type="number"
                    value={newPromo.discount_value}
                    onChange={(e) =>
                      setNewPromo((p) => ({ ...p, discount_value: Number(e.target.value) }))
                    }
                    placeholder="Discount Value"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={saving || !newPromo.title}
                    onClick={async () => {
                      await postWebsiteAction("upsert_promotion", { payload: newPromo });
                      setNewPromo({
                        title: "",
                        description: "",
                        code: "",
                        badge_text: "Special Offer",
                        promotion_type: "percentage",
                        discount_value: 10,
                        min_order_pkr: 1000,
                      });
                      notify("Created pharmacy promotion");
                    }}
                    className="sm:col-span-2 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-bold"
                  >
                    + Add Promotion
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {promotions.map((p) => (
                    <div key={p.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900">{p.title}</span>
                        {p.code && (
                          <span className="ml-2 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-bold">
                            {p.code}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await postWebsiteAction("delete_promotion", { promotion_id: p.id });
                          notify("Deleted promotion");
                        }}
                        className="text-red-600 hover:underline font-semibold"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Homepage Banners */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">Homepage Promotional Banners</h2>
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <input
                    type="text"
                    value={newBanner.title}
                    onChange={(e) => setNewBanner((b) => ({ ...b, title: e.target.value }))}
                    placeholder="Banner Headline (e.g. Winter Immunity & Flu Care)"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={newBanner.subtitle}
                    onChange={(e) => setNewBanner((b) => ({ ...b, subtitle: e.target.value }))}
                    placeholder="Banner Subtitle"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload WebP Banner</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            void handleWebPImageUpload(f, "banner", undefined, (url) =>
                              setNewBanner((b) => ({ ...b, image_url: url }))
                            );
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={saving || !newBanner.title}
                      onClick={async () => {
                        await postWebsiteAction("upsert_banner", { payload: newBanner });
                        setNewBanner({
                          title: "",
                          subtitle: "",
                          badge_text: "Featured Healthcare",
                          cta_label: "Shop Now",
                          placement: "secondary",
                          image_url: "",
                        });
                        notify("Added promotional banner");
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                    >
                      Save Banner
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {banners.map((b) => (
                    <div key={b.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900">{b.title}</span>
                        <span className="ml-2 text-slate-400">({b.placement})</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await postWebsiteAction("delete_banner", { banner_id: b.id });
                          notify("Removed banner");
                        }}
                        className="text-red-600 hover:underline font-semibold"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 6: DELIVERY & PICKUP SETTINGS                               */}
          {/* =============================================================== */}
          {activeTab === "delivery" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">
                  Fulfillment Rules & Delivery Charges
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={settingsForm.delivery_enabled}
                      onChange={(e) =>
                        setSettingsForm((s) => ({ ...s, delivery_enabled: e.target.checked }))
                      }
                    />
                    <span>Enable Home Delivery</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={settingsForm.pickup_enabled}
                      onChange={(e) =>
                        setSettingsForm((s) => ({ ...s, pickup_enabled: e.target.checked }))
                      }
                    />
                    <span>Enable Counter Pickup</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Standard Delivery Fee (PKR)
                    </label>
                    <input
                      type="number"
                      value={settingsForm.standard_delivery_fee_pkr}
                      onChange={(e) =>
                        setSettingsForm((s) => ({
                          ...s,
                          standard_delivery_fee_pkr: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Free Delivery Above (PKR)
                    </label>
                    <input
                      type="number"
                      value={settingsForm.free_delivery_threshold_pkr}
                      onChange={(e) =>
                        setSettingsForm((s) => ({
                          ...s,
                          free_delivery_threshold_pkr: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Minimum Order Value (PKR)
                    </label>
                    <input
                      type="number"
                      value={settingsForm.minimum_order_value_pkr}
                      onChange={(e) =>
                        setSettingsForm((s) => ({
                          ...s,
                          minimum_order_value_pkr: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Estimated Delivery Time (Minutes)
                    </label>
                    <input
                      type="number"
                      value={settingsForm.estimated_delivery_minutes}
                      onChange={(e) =>
                        setSettingsForm((s) => ({
                          ...s,
                          estimated_delivery_minutes: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await postWebsiteAction("update_settings", { payload: settingsForm });
                    notify("Saved delivery & pickup settings");
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#009A4D] text-white text-xs font-bold"
                >
                  Save Delivery Configuration
                </button>
              </div>

              {/* Delivery Zones CRUD */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">Neighborhood Delivery Zones</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <input
                    type="text"
                    value={newZone.zone_name}
                    onChange={(e) => setNewZone((z) => ({ ...z, zone_name: e.target.value }))}
                    placeholder="Zone / Area Name"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="number"
                    value={newZone.fee_pkr}
                    onChange={(e) => setNewZone((z) => ({ ...z, fee_pkr: Number(e.target.value) }))}
                    placeholder="Fee PKR"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={saving || !newZone.zone_name}
                    onClick={async () => {
                      await postWebsiteAction("upsert_delivery_zone", {
                        payload: { ...newZone, city: sf.city },
                      });
                      setNewZone({
                        zone_name: "",
                        city: "",
                        fee_pkr: 150,
                        free_above_pkr: 2000,
                        min_order_pkr: 300,
                        estimated_minutes: 45,
                      });
                      notify("Added delivery zone");
                    }}
                    className="rounded-xl bg-slate-900 text-white text-xs font-bold py-2 px-3"
                  >
                    + Add Zone
                  </button>
                </div>

                <div className="divide-y divide-slate-100 text-xs">
                  {deliveryZones.map((z) => (
                    <div key={z.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900">{z.zone_name}</span>
                        <span className="text-slate-500 ml-2">
                          PKR {z.fee_pkr} • ~{z.estimated_minutes} mins
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await postWebsiteAction("delete_delivery_zone", { zone_id: z.id });
                          notify("Removed delivery zone");
                        }}
                        className="text-red-600 font-semibold"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 7: CONTACT, OPENING HOURS & BRANCHES                        */}
          {/* =============================================================== */}
          {activeTab === "contact" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">Pharmacy Opening Hours</h2>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={settingsForm.is_24_hours}
                    onChange={(e) =>
                      setSettingsForm((s) => ({ ...s, is_24_hours: e.target.checked }))
                    }
                  />
                  <span>Open 24 Hours / 7 Days</span>
                </label>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Monday – Saturday Hours
                  </label>
                  <input
                    type="text"
                    value={settingsForm.mon_sat_hours}
                    onChange={(e) =>
                      setSettingsForm((s) => ({ ...s, mon_sat_hours: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Sunday Hours
                  </label>
                  <input
                    type="text"
                    value={settingsForm.sun_hours}
                    onChange={(e) => setSettingsForm((s) => ({ ...s, sun_hours: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await postWebsiteAction("update_settings", {
                      payload: {
                        ...settingsForm,
                        opening_hours: {
                          mon_sat: settingsForm.mon_sat_hours,
                          sun: settingsForm.sun_hours,
                          is_24_hours: settingsForm.is_24_hours,
                        },
                      },
                    });
                    notify("Updated pharmacy opening hours");
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#009A4D] text-white text-xs font-bold"
                >
                  Save Opening Hours
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">Pharmacy Branches</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <input
                    type="text"
                    value={newBranch.branch_name}
                    onChange={(e) => setNewBranch((b) => ({ ...b, branch_name: e.target.value }))}
                    placeholder="Branch Name"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={newBranch.contact_phone}
                    onChange={(e) => setNewBranch((b) => ({ ...b, contact_phone: e.target.value }))}
                    placeholder="Branch Phone"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={newBranch.address_line}
                    onChange={(e) => setNewBranch((b) => ({ ...b, address_line: e.target.value }))}
                    placeholder="Street Address"
                    className="sm:col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={saving || !newBranch.branch_name}
                    onClick={async () => {
                      await postWebsiteAction("upsert_branch", {
                        payload: {
                          ...newBranch,
                          branch_code: `BR_${Date.now().toString().slice(-4)}`,
                          city: sf.city,
                        },
                      });
                      setNewBranch({
                        branch_code: "MAIN",
                        branch_name: "",
                        address_line: "",
                        city: "",
                        contact_phone: "",
                        whatsapp_phone: "",
                        pickup_supported: true,
                        delivery_supported: true,
                      });
                      notify("Saved pharmacy branch");
                    }}
                    className="sm:col-span-2 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                  >
                    + Add Branch Location
                  </button>
                </div>

                <div className="divide-y divide-slate-100 text-xs">
                  {branches.map((b) => (
                    <div key={b.id} className="py-2.5">
                      <div className="font-bold text-slate-900">{b.branch_name}</div>
                      <div className="text-slate-500">
                        {b.address_line}, {b.city} • {b.contact_phone}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 8: WEBSITE SETTINGS, SEO & CUSTOM DOMAINS                   */}
          {/* =============================================================== */}
          {activeTab === "settings" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">
                  Website Visibility, Maintenance & SEO
                </h2>

                <div className="space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={settingsForm.maintenance_mode}
                      onChange={(e) =>
                        setSettingsForm((s) => ({ ...s, maintenance_mode: e.target.checked }))
                      }
                    />
                    <span>Enable Temporary Maintenance Mode</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={settingsForm.whatsapp_order_assist_enabled}
                      onChange={(e) =>
                        setSettingsForm((s) => ({
                          ...s,
                          whatsapp_order_assist_enabled: e.target.checked,
                        }))
                      }
                    />
                    <span>Enable Post-Checkout WhatsApp Order Sharing</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Top Announcement Bar Text
                  </label>
                  <input
                    type="text"
                    value={settingsForm.announcement_bar_text}
                    onChange={(e) =>
                      setSettingsForm((s) => ({ ...s, announcement_bar_text: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    SEO Page Title
                  </label>
                  <input
                    type="text"
                    value={settingsForm.seo_title}
                    onChange={(e) => setSettingsForm((s) => ({ ...s, seo_title: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    SEO Meta Description
                  </label>
                  <textarea
                    rows={2}
                    value={settingsForm.seo_description}
                    onChange={(e) =>
                      setSettingsForm((s) => ({ ...s, seo_description: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    await postWebsiteAction("update_settings", { payload: settingsForm });
                    notify("Saved website settings & SEO metadata");
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#009A4D] text-white text-xs font-bold"
                >
                  Save Settings & SEO
                </button>
              </div>

              {/* Domains & Custom Domain Connection */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
                <h2 className="text-base font-bold text-slate-900">
                  Subdomain & Custom Domain Configuration
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customDomainInput}
                    onChange={(e) => setCustomDomainInput(e.target.value.toLowerCase())}
                    placeholder="e.g. www.alshifapharmacy.pk"
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
                  />
                  <button
                    type="button"
                    disabled={saving || !customDomainInput.trim()}
                    onClick={async () => {
                      await postWebsiteAction("add_custom_domain", {
                        hostname: customDomainInput.trim(),
                      });
                      setCustomDomainInput("");
                      notify("Registered custom domain for DNS verification");
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                  >
                    Connect Domain
                  </button>
                </div>

                <div className="divide-y divide-slate-100 text-xs">
                  {domains.map((d) => (
                    <div key={d.id} className="py-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900">{d.hostname}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            d.verification_status === "verified"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {d.verification_status}
                        </span>
                      </div>
                      {d.domain_type === "custom_domain" && d.verification_token && (
                        <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-[10px] text-slate-600">
                          DNS CNAME → storefront.aivrasol.pk | TXT _aivrasol-verify →{" "}
                          {d.verification_token}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* POS Terminal Sync Connection Bundle */}
                <div className="pt-4 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        POS Terminal Sync & Order Inbox Connection
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Generate an authenticated HMAC sync bundle to paste into AivraSol POS (Billing → Online Orders → Connection Config).
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        const res = await postWebsiteAction("generate_pos_sync_bundle");
                        if (res?.connection_bundle) {
                          const str = JSON.stringify(res.connection_bundle, null, 2);
                          setPosBundleJson(str);
                          try {
                            await navigator.clipboard.writeText(str);
                            notify("Copied POS Connection Bundle to clipboard");
                          } catch {
                            notify("Generated POS Connection Bundle below");
                          }
                        }
                      }}
                      className="shrink-0 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                    >
                      Generate POS Bundle
                    </button>
                  </div>
                  {posBundleJson && (
                    <textarea
                      readOnly
                      rows={5}
                      value={posBundleJson}
                      className="w-full rounded-xl border border-emerald-200 bg-emerald-50/40 p-2.5 font-mono text-[11px] text-slate-800"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
