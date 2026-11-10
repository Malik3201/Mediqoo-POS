"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Globe,
  CheckCircle2,
  PauseCircle,
  AlertTriangle,
  Clock,
  Package,
  RefreshCw,
  Plus,
  ExternalLink,
  ShieldCheck,
  Activity,
  Server,
  Search,
  Sparkles,
  Lock,
  ArrowRight,
  Eye,
  Power,
  Ban,
  Check,
  XCircle,
  FileText,
  Palette,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type ActiveTab = "overview" | "directory" | "create" | "details";

const THEME_OPTIONS = [
  {
    id: "emerald_clinical",
    name: "Emerald Clinical",
    primary: "#059669",
    desc: "Clean clinical emerald & slate for modern community pharmacies",
  },
  {
    id: "royal_blue_care",
    name: "Royal Blue Care",
    primary: "#0284c7",
    desc: "Hospital-grade medical blue with high-contrast readability",
  },
  {
    id: "teal_wellness",
    name: "Teal Wellness",
    primary: "#0d9488",
    desc: "Warm wellness & family pharmacy aesthetic",
  },
  {
    id: "amber_vitality",
    name: "Amber Vitality",
    primary: "#d97706",
    desc: "High-visibility retail pharmacy & health mart theme",
  },
];

export default function PharmacyWebsitesAdminPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [storefronts, setStorefronts] = useState<any[]>([]);
  const [pharmacies, setPharmacies] = useState<any[]>([]);
  const [platformStatus, setPlatformStatus] = useState<any>(null);

  // Directory filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Create / Activate Website form state
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [slugStatus, setSlugStatus] = useState<{
    checking: boolean;
    available?: boolean;
    normalized?: string;
    primary_domain?: string;
    reason?: string;
  }>({ checking: false });
  const [activateImmediately, setActivateImmediately] = useState(true);
  const [entitlementStatus, setEntitlementStatus] = useState("active");
  const [pilotAccess, setPilotAccess] = useState(true);
  const [themePreset, setThemePreset] = useState("emerald_clinical");
  const [primaryColor, setPrimaryColor] = useState("#059669");
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("Licensed Community Pharmacy • Genuine Medicines");
  const [heroTitle, setHeroTitle] = useState("");
  const [city, setCity] = useState("Lahore");
  const [addressLine, setAddressLine] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [drugLicenseNo, setDrugLicenseNo] = useState("");
  const [pharmacistName, setPharmacistName] = useState("");
  const [ownerCanPublish, setOwnerCanPublish] = useState(true);
  const [publishingMode, setPublishingMode] = useState("manual_only");
  const [seedApprovedCatalog, setSeedApprovedCatalog] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Website Details state
  const [selectedStorefrontId, setSelectedStorefrontId] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsData, setDetailsData] = useState<any>(null);
  const [renameSlugValue, setRenameSlugValue] = useState("");
  const [newCustomDomain, setNewCustomDomain] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, statusRes] = await Promise.all([
        fetch("/api/admin/storefronts", { cache: "no-store" }),
        fetch("/api/admin/storefronts/status", { cache: "no-store" }).catch(() => null),
      ]);
      if (statusRes && statusRes.ok) {
        const stJson = await statusRes.json().catch(() => null);
        if (stJson?.ok) setPlatformStatus(stJson);
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Failed to load Pharmacy Websites");
      }
      setOverview(data.overview);
      setStorefronts(data.storefronts || []);
      setPharmacies(data.pharmacies || []);

      // Default select first unassigned pharmacy in Create form
      const unassigned = (data.pharmacies || []).find((p: any) => !p.has_storefront);
      if (unassigned && !selectedPharmacyId) {
        handleSelectPharmacy(unassigned);
      }
    } catch (err: any) {
      setError(err.message || "Error loading storefront data");
    } finally {
      setLoading(false);
    }
  }, [selectedPharmacyId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleSelectPharmacy = (pharm: any) => {
    setSelectedPharmacyId(pharm.pharmacy_id);
    setDisplayName(pharm.name || "");
    setHeroTitle(`Genuine Medicines Delivered from ${pharm.name}`);
    setCity(pharm.city || "Lahore");
    setAddressLine(pharm.address || "");
    setContactPhone(pharm.phone || "");
    const suggestedSlug = String(pharm.name || "")
      .toLowerCase()
      .replace(/pharmacy|wellness|care|clinical|pvt|ltd/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24);
    if (suggestedSlug.length >= 3) {
      setSlugInput(suggestedSlug);
    }
  };

  // Live slug check
  useEffect(() => {
    const trimmed = slugInput.trim();
    if (!trimmed) {
      setSlugStatus({ checking: false });
      return;
    }
    const timer = setTimeout(async () => {
      setSlugStatus({ checking: true });
      try {
        const res = await fetch(
          `/api/admin/storefronts?check_slug=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        setSlugStatus({
          checking: false,
          available: Boolean(data.available),
          normalized: data.normalized_slug,
          primary_domain: data.primary_domain,
          reason: data.reason,
        });
      } catch {
        setSlugStatus({ checking: false, available: false, reason: "Unable to verify slug" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [slugInput]);

  const loadStorefrontDetails = useCallback(async (storefrontId: string) => {
    setSelectedStorefrontId(storefrontId);
    setActiveTab("details");
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/admin/storefronts/${encodeURIComponent(storefrontId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.storefront) {
        setDetailsData(data);
        setRenameSlugValue(data.storefront.slug || "");
      } else {
        setBannerNotice({
          type: "error",
          text: data.message || "Failed to load website details",
        });
      }
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message || "Failed to load website details" });
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const handleCreateWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerNotice(null);
    const chosenPharm = pharmacies.find((p) => p.pharmacy_id === selectedPharmacyId);
    if (!chosenPharm && !displayName.trim()) {
      setBannerNotice({ type: "error", text: "Please select a pharmacy first." });
      return;
    }

    setSubmittingCreate(true);
    try {
      const res = await fetch("/api/admin/storefronts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacy_id: selectedPharmacyId || `pharm-${slugInput.trim()}`,
          license_id: chosenPharm?.license_id || null,
          pharmacy_name: displayName.trim() || chosenPharm?.name || "AivraSol Pharmacy",
          display_name: displayName.trim() || chosenPharm?.name,
          slug: slugInput.trim(),
          activate_immediately: activateImmediately,
          entitlement_status: entitlementStatus,
          pilot_access: pilotAccess,
          theme_preset: themePreset,
          primary_color: primaryColor,
          tagline,
          hero_title: heroTitle,
          city,
          address_line: addressLine,
          contact_phone: contactPhone,
          whatsapp_phone: contactPhone,
          drug_sale_license_no: drugLicenseNo,
          pharmacist_name: pharmacistName,
          owner_can_publish: ownerCanPublish,
          publishing_mode: publishingMode,
          seed_approved_starter_catalog: seedApprovedCatalog,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Could not create pharmacy website");
      }

      const liveUrl =
        data.storefront.public_url || `https://${data.storefront.primary_domain}`;
      setBannerNotice({
        type: "success",
        text: `Activated ${data.storefront.pharmacy_name} (${liveUrl})`,
      });
      await fetchDashboardData();
      await loadStorefrontDetails(data.storefront.id);
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message || "Error creating website" });
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleStatusChange = async (
    storefrontId: string,
    updates: {
      status: string;
      website_enabled: boolean;
      entitlement_status?: string;
      suspended_reason?: string;
      disabled_reason?: string;
    }
  ) => {
    setActionBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch(`/api/admin/storefronts/${encodeURIComponent(storefrontId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "status",
          ...updates,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to update website status");
      }
      setBannerNotice({
        type: "success",
        text: `Updated website status to '${updates.status.toUpperCase()}'`,
      });
      await fetchDashboardData();
      if (selectedStorefrontId === storefrontId) {
        await loadStorefrontDetails(storefrontId);
      }
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleSyncApprovedCatalog = async (storefrontId: string) => {
    setActionBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch(`/api/admin/storefronts/${encodeURIComponent(storefrontId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_approved_catalog",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to sync approved catalog");
      }
      setBannerNotice({
        type: "success",
        text: `Synced ${data.items_applied} approved products (${data.published_products_count} published live). Private cost/WAC/supplier fields stripped.`,
      });
      await fetchDashboardData();
      await loadStorefrontDetails(storefrontId);
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleRenameSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStorefrontId || !renameSlugValue.trim()) return;
    setActionBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch(
        `/api/admin/storefronts/${encodeURIComponent(selectedStorefrontId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename_slug",
            new_slug: renameSlugValue.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to rename slug");
      }
      setBannerNotice({
        type: "success",
        text: `Slug renamed to '${data.slug}'. Safe 301 redirect registered from ${data.redirect_from} -> ${data.primary_domain}.`,
      });
      await fetchDashboardData();
      await loadStorefrontDetails(selectedStorefrontId);
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStorefrontId || !newCustomDomain.trim()) return;
    setActionBusy(true);
    setBannerNotice(null);
    try {
      const res = await fetch(
        `/api/admin/storefronts/${encodeURIComponent(selectedStorefrontId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_custom_domain",
            hostname: newCustomDomain.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to add custom domain");
      }
      setNewCustomDomain("");
      setBannerNotice({
        type: "success",
        text: `Added custom domain '${data.domain.hostname}' (pending DNS verification).`,
      });
      await loadStorefrontDetails(selectedStorefrontId);
    } catch (err: any) {
      setBannerNotice({ type: "error", text: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    if (!selectedStorefrontId) return;
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/admin/storefronts/${encodeURIComponent(selectedStorefrontId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: "domain_verify",
            domain_id: domainId,
            verification_status: "verified",
          }),
        }
      );
      if (res.ok) {
        setBannerNotice({ type: "success", text: "Custom domain verified and activated." });
        await loadStorefrontDetails(selectedStorefrontId);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleProductVisibility = async (product: any) => {
    if (!selectedStorefrontId) return;
    const nextPublishStatus =
      product.publish_status === "published" ? "unpublished" : "published";
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/admin/storefronts/${encodeURIComponent(selectedStorefrontId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: "publishing",
            items: [
              {
                pos_product_id: product.pos_product_id,
                name: product.name,
                generic_name: product.generic_name,
                strength: product.strength,
                dosage_form: product.dosage_form,
                brand_name: product.brand_name,
                packing_label: product.packing_label,
                unit_label: product.unit_label,
                category_name: product.category_name,
                public_selling_price_pkr: product.public_selling_price_pkr,
                availability_status: product.availability_status,
                available_qty: product.available_qty,
                publish_status: nextPublishStatus,
                requires_prescription: Boolean(product.requires_prescription),
                is_controlled_substance: Boolean(product.is_controlled_substance),
                is_featured: Boolean(product.is_featured),
              },
            ],
          }),
        }
      );
      if (res.ok) {
        await loadStorefrontDetails(selectedStorefrontId);
        await fetchDashboardData();
      }
    } finally {
      setActionBusy(false);
    }
  };

  const filteredStorefronts = useMemo(() => {
    return storefronts.filter((sf) => {
      if (statusFilter !== "all" && sf.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          String(sf.pharmacy_name || "").toLowerCase().includes(q) ||
          String(sf.slug || "").toLowerCase().includes(q) ||
          String(sf.primary_domain || "").toLowerCase().includes(q) ||
          String(sf.city || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [storefronts, statusFilter, searchQuery]);

  const statusBadge = (status: string, enabled: boolean) => {
    if (status === "suspended") {
      return (
        <Badge className="bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/20">
          <Ban className="w-3 h-3 mr-1" /> Suspended
        </Badge>
      );
    }
    if (status === "active" && enabled) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Active
        </Badge>
      );
    }
    if (status === "pending_setup") {
      return (
        <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/20">
          <Clock className="w-3 h-3 mr-1" /> Pending Setup
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        <PauseCircle className="w-3 h-3 mr-1" /> Disabled
      </Badge>
    );
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Top Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Pharmacy Websites</h1>
              <p className="text-sm text-muted-foreground">
                Multi-Tenant Storefront SaaS • Cloudflare Workers + D1 + R2 Free-Tier Engine
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={activeTab === "overview" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("overview")}
          >
            <Activity className="h-4 w-4 mr-1.5" /> Overview
          </Button>
          <Button
            variant={activeTab === "directory" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("directory")}
          >
            <Layers className="h-4 w-4 mr-1.5" /> Website Directory ({storefronts.length})
          </Button>
          <Button
            variant={activeTab === "create" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("create")}
            className={
              activeTab === "create"
                ? ""
                : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
            }
          >
            <Plus className="h-4 w-4 mr-1.5" /> Create / Activate Website
          </Button>
          {selectedStorefrontId && (
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("details")}
            >
              <ShieldCheck className="h-4 w-4 mr-1.5" /> Website Details
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={fetchDashboardData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Notice Banner */}
      {bannerNotice && (
        <div
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            bannerNotice.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerNotice.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{bannerNotice.text}</span>
          </div>
          <button
            onClick={() => setBannerNotice(null)}
            className="text-xs underline opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Protected Storefront Platform Status Section (Cloudflare Infrastructure Health) */}
      {platformStatus && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4 text-emerald-600" />
                Storefront Platform Status
              </CardTitle>
              <CardDescription className="text-xs">
                Cloudflare Workers + D1 + R2 infrastructure health • Last checked:{" "}
                {platformStatus.last_checked
                  ? new Date(platformStatus.last_checked).toLocaleTimeString()
                  : "—"}
                {platformStatus.worker_url ? ` • Endpoint: ${platformStatus.worker_url}` : ""}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchDashboardData} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Check Health
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-muted-foreground font-medium">Cloudflare Worker</div>
                <div
                  className={`mt-1 font-bold flex items-center gap-1.5 ${
                    platformStatus.worker_status === "connected"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {platformStatus.worker_status === "connected" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                    </>
                  ) : platformStatus.worker_status === "not_configured" ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" /> Not Configured
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5" /> Disconnected
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-muted-foreground font-medium">D1 Database</div>
                <div
                  className={`mt-1 font-bold flex items-center gap-1.5 ${
                    platformStatus.d1_status === "available"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {platformStatus.d1_status === "available" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Available
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5" /> Unavailable
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-muted-foreground font-medium">R2 Media Storage</div>
                <div
                  className={`mt-1 font-bold flex items-center gap-1.5 ${
                    platformStatus.r2_status === "available"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {platformStatus.r2_status === "available" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Available
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5" /> Unavailable
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-muted-foreground font-medium">Website API</div>
                <div
                  className={`mt-1 font-bold flex items-center gap-1.5 ${
                    platformStatus.website_api_status === "working"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {platformStatus.website_api_status === "working" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Working
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" /> Error
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-muted-foreground font-medium">Active Websites</div>
                <div className="mt-1 font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {platformStatus.active_websites ?? 0}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    of {platformStatus.total_websites ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {(platformStatus.missing_env_vars?.length > 0 ||
              platformStatus.setup_guidance?.length > 0 ||
              platformStatus.error_detail) && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs space-y-1.5 text-amber-900 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Cloudflare Infrastructure Setup Guidance
                </div>
                {platformStatus.error_detail && <p>{platformStatus.error_detail}</p>}
                {platformStatus.missing_env_vars?.length > 0 && (
                  <p>
                    Missing server environment variables:{" "}
                    <span className="font-mono font-semibold">
                      {platformStatus.missing_env_vars.join(", ")}
                    </span>
                  </p>
                )}
                {Array.isArray(platformStatus.setup_guidance) &&
                  platformStatus.setup_guidance.map((step: string, idx: number) => (
                    <p key={idx} className="text-muted-foreground dark:text-amber-200/80">
                      {step}
                    </p>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: OVERVIEW                                                       */}
      {/* ===================================================================== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Primary KPI Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Total Enabled
                </CardDescription>
                <CardTitle className="text-2xl font-bold text-emerald-600">
                  {overview?.total_enabled_websites ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Of {overview?.total_storefronts ?? 0} provisioned
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Active Websites
                </CardDescription>
                <CardTitle className="text-2xl font-bold">
                  {overview?.active_websites ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Resolving live subdomains
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Disabled / Paused
                </CardDescription>
                <CardTitle className="text-2xl font-bold">
                  {overview?.disabled_websites ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Suspended: {overview?.suspended_websites ?? 0}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Pending Setup
                </CardDescription>
                <CardTitle className="text-2xl font-bold text-amber-600">
                  {overview?.pending_setup ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Awaiting initial catalog</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Public Products
                </CardDescription>
                <CardTitle className="text-2xl font-bold text-sky-600">
                  {overview?.total_public_products ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Explicitly approved items</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-medium">
                  Orders Summary
                </CardDescription>
                <CardTitle className="text-2xl font-bold">
                  {overview?.orders_summary?.total_orders ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  PKR {(overview?.orders_summary?.total_order_value_pkr ?? 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Cloud Usage & Free-Tier Guardrails + Security Boundaries */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Server className="h-4 w-4 text-sky-600" /> Cloudflare Free-Tier Usage &
                      Capacity Monitor
                    </CardTitle>
                    <CardDescription>
                      Shared multi-tenant Worker + D1 + R2 budget across all active pharmacy
                      storefronts (Target: ~100 pharmacies on $0/mo Free Tier)
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                    $0 / mo Billable Guard Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border p-3.5 bg-muted/20">
                    <div className="text-xs text-muted-foreground">Worker Dynamic Requests</div>
                    <div className="mt-1 text-xl font-bold">
                      {(
                        overview?.cloud_usage_summary?.today_worker_requests ?? 0
                      ).toLocaleString()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        / 100,000 day
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width: `${Math.max(
                            2,
                            Math.min(
                              100,
                              overview?.cloud_usage_summary?.headroom_pct
                                ?.workers_requests_daily_pct || 1
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Static assets served free & unlimited via Workers Static Assets
                    </div>
                  </div>

                  <div className="rounded-lg border p-3.5 bg-muted/20">
                    <div className="text-xs text-muted-foreground">D1 Rows Read (Today UTC)</div>
                    <div className="mt-1 text-xl font-bold">
                      {(overview?.cloud_usage_summary?.today_d1_rows_read ?? 0).toLocaleString()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        / 5,000,000 day
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-sky-500"
                        style={{
                          width: `${Math.max(
                            2,
                            Math.min(
                              100,
                              overview?.cloud_usage_summary?.headroom_pct?.d1_reads_daily_pct || 1
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Composite `(storefront_id, publish_status)` indexes prevent table scans
                    </div>
                  </div>

                  <div className="rounded-lg border p-3.5 bg-muted/20">
                    <div className="text-xs text-muted-foreground">D1 Rows Written & R2 Media</div>
                    <div className="mt-1 text-xl font-bold">
                      {(
                        overview?.cloud_usage_summary?.today_d1_rows_written ?? 0
                      ).toLocaleString()}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        / 100,000 day
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-indigo-500"
                        style={{
                          width: `${Math.max(
                            2,
                            Math.min(
                              100,
                              overview?.cloud_usage_summary?.headroom_pct?.d1_writes_daily_pct || 1
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      R2 Objects: {overview?.cloud_usage_summary?.r2_media_objects ?? 0} (Free 10
                      GB)
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4 text-emerald-600" /> POS & Tenant Boundary
                </CardTitle>
                <CardDescription>Enforced multi-tenant security invariants</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Zero Private Financial Exposure:</strong> `cost_price`, `cost_wac`,
                    `gross_profit`, `supplier_name`, `khata`, and `pin` are stripped and blocked at
                    the Worker API boundary.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Explicit Catalog Approval:</strong> Never publishes all 41,441 master
                    medicines; only approved pharmacy products appear.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Cross-Tenant Cache Isolation:</strong> Responses emit `Vary: Host,
                    Origin, X-Storefront-Host` and tenant-scoped `ETag` headers.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Directory Preview */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Provisioned Pharmacy Storefronts</CardTitle>
                <CardDescription>
                  Click any pharmacy website to inspect configuration, domains, catalog sync, or
                  open its live customer storefront.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setActiveTab("create")}>
                <Plus className="h-4 w-4 mr-1.5" /> Activate Pharmacy Website
              </Button>
            </CardHeader>
            <CardContent>
              {storefronts.length === 0 ? (
                <div className="text-center py-10 border border-dashed rounded-lg">
                  <Globe className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="font-medium">No pharmacy websites activated yet</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Select an existing pharmacy to provision its `*.aivrasol.pk` subdomain and
                    isolated catalog.
                  </p>
                  <Button size="sm" onClick={() => setActiveTab("create")}>
                    <Plus className="h-4 w-4 mr-1.5" /> Activate First Pharmacy Website
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2.5 px-3">Pharmacy</th>
                        <th className="py-2.5 px-3">Storefront Slug</th>
                        <th className="py-2.5 px-3">Website URL</th>
                        <th className="py-2.5 px-3">Website Status</th>
                        <th className="py-2.5 px-3">Domain Status</th>
                        <th className="py-2.5 px-3">Published Products</th>
                        <th className="py-2.5 px-3">Last Sync</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {storefronts.map((sf) => (
                        <tr key={sf.id} className="hover:bg-muted/30">
                          <td className="py-3 px-3">
                            <div className="font-medium">{sf.pharmacy_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {sf.city} • ID: {sf.pharmacy_id}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-xs">{sf.slug}</td>
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sky-600">{sf.public_url}</span>
                              <a
                                href={sf.preview_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                              >
                                Open Live Runtime Preview <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            {statusBadge(sf.status, sf.website_enabled)}
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              variant="outline"
                              className={
                                sf.domain_status === "verified"
                                  ? "border-emerald-500/40 text-emerald-600"
                                  : "border-amber-500/40 text-amber-600"
                              }
                            >
                              {sf.domain_status === "verified" ? "Verified SSL" : "Pending DNS"}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 font-semibold">
                            {sf.published_products_count ?? 0}
                          </td>
                          <td className="py-3 px-3 text-xs text-muted-foreground">
                            {sf.last_sync_at
                              ? new Date(sf.last_sync_at).toLocaleString()
                              : "Never synced"}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => loadStorefrontDetails(sf.id)}
                              >
                                Manage
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <a href={sf.preview_url} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: WEBSITE DIRECTORY                                              */}
      {/* ===================================================================== */}
      {activeTab === "directory" && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Website Directory</CardTitle>
                <CardDescription>
                  Manage all pharmacy websites, subdomains, entitlements, and catalog sync states
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-64">
                  <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search pharmacy, slug, city..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
                <select
                  aria-label="Filter by website status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                  <option value="pending_setup">Pending Setup</option>
                  <option value="suspended">Suspended</option>
                </select>
                <Button size="sm" onClick={() => setActiveTab("create")}>
                  <Plus className="h-4 w-4 mr-1" /> New Website
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 px-3">Pharmacy</th>
                    <th className="py-3 px-3">Storefront Slug</th>
                    <th className="py-3 px-3">Website URL</th>
                    <th className="py-3 px-3">Website Status</th>
                    <th className="py-3 px-3">Domain Status</th>
                    <th className="py-3 px-3">Published Products</th>
                    <th className="py-3 px-3">Last Sync</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredStorefronts.map((sf) => (
                    <tr key={sf.id} className="hover:bg-muted/30">
                      <td className="py-3 px-3">
                        <div className="font-medium">{sf.pharmacy_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {sf.city} • {sf.entitlement_status?.toUpperCase()}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs">{sf.slug}</td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-sky-600">{sf.public_url}</div>
                        <a
                          href={sf.preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                        >
                          Preview Live Shell <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="py-3 px-3">{statusBadge(sf.status, sf.website_enabled)}</td>
                      <td className="py-3 px-3">
                        <Badge
                          variant="outline"
                          className={
                            sf.domain_status === "verified"
                              ? "border-emerald-500/40 text-emerald-600"
                              : "border-amber-500/40 text-amber-600"
                          }
                        >
                          {sf.domain_status === "verified" ? "Verified" : "Pending"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 font-semibold">
                        {sf.published_products_count ?? 0}
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {sf.last_sync_at
                          ? new Date(sf.last_sync_at).toLocaleString()
                          : "No sync yet"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadStorefrontDetails(sf.id)}
                          >
                            Details
                          </Button>
                          {sf.status === "active" && sf.website_enabled ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-amber-600"
                              disabled={actionBusy}
                              onClick={() =>
                                handleStatusChange(sf.id, {
                                  status: "disabled",
                                  website_enabled: false,
                                  disabled_reason: "Paused by Super Admin",
                                })
                              }
                            >
                              Disable
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-emerald-600"
                              disabled={actionBusy}
                              onClick={() =>
                                handleStatusChange(sf.id, {
                                  status: "active",
                                  website_enabled: true,
                                  entitlement_status: "active",
                                })
                              }
                            >
                              Enable
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredStorefronts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No matching pharmacy websites found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: CREATE / ACTIVATE WEBSITE                                      */}
      {/* ===================================================================== */}
      {activeTab === "create" && (
        <form onSubmit={handleCreateWebsite} className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Select Existing Pharmacy & Slug */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  1. Select Existing Pharmacy & Assign Unique Subdomain
                </CardTitle>
                <CardDescription>
                  Bind the storefront to a verified pharmacy tenant identity (`Client.id` &
                  `License.id`)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="select-pharmacy">Select Existing Pharmacy</Label>
                  <select
                    id="select-pharmacy"
                    value={selectedPharmacyId}
                    onChange={(e) => {
                      const p = pharmacies.find((item) => item.pharmacy_id === e.target.value);
                      if (p) handleSelectPharmacy(p);
                      else setSelectedPharmacyId(e.target.value);
                    }}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">-- Choose a Pharmacy --</option>
                    {pharmacies.map((p) => (
                      <option
                        key={p.pharmacy_id}
                        value={p.pharmacy_id}
                        disabled={p.has_storefront}
                      >
                        {p.name} ({p.city}) — ID: {p.pharmacy_id}{" "}
                        {p.has_storefront ? "[Website Already Active]" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="storefront-slug">Storefront Subdomain Slug</Label>
                    <div className="flex items-center">
                      <Input
                        id="storefront-slug"
                        value={slugInput}
                        onChange={(e) => setSlugInput(e.target.value.toLowerCase())}
                        placeholder="alshifa"
                        className="rounded-r-none font-mono"
                        required
                      />
                      <span className="inline-flex items-center px-3 h-9 border border-l-0 rounded-r-md bg-muted text-xs font-mono text-muted-foreground">
                        .aivrasol.pk
                      </span>
                    </div>
                    {slugInput && (
                      <div className="text-xs mt-1">
                        {slugStatus.checking ? (
                          <span className="text-muted-foreground">Checking availability...</span>
                        ) : slugStatus.available ? (
                          <span className="text-emerald-600 flex items-center gap-1 font-medium">
                            <Check className="h-3.5 w-3.5" /> Available:{" "}
                            {slugStatus.primary_domain}
                          </span>
                        ) : (
                          <span className="text-red-600 flex items-center gap-1">
                            <XCircle className="h-3.5 w-3.5" /> {slugStatus.reason}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pharmacy-display-name">Public Pharmacy Display Name</Label>
                    <Input
                      id="pharmacy-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Al-Shifa Pharmacy & Wellness"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pharmacy-city">City</Label>
                    <Input
                      id="pharmacy-city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Lahore"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pharmacy-phone">Contact / WhatsApp Phone</Label>
                    <Input
                      id="pharmacy-phone"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+92 300 4112233"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pharmacy-license">Drug Sale License No.</Label>
                    <Input
                      id="pharmacy-license"
                      value={drugLicenseNo}
                      onChange={(e) => setDrugLicenseNo(e.target.value)}
                      placeholder="DRAP-PB-LHR-2026"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pharmacy-address">Branch Address</Label>
                    <Input
                      id="pharmacy-address"
                      value={addressLine}
                      onChange={(e) => setAddressLine(e.target.value)}
                      placeholder="Main Boulevard Gulberg III, Lahore"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pharmacist-name">Qualified Supervising Pharmacist</Label>
                    <Input
                      id="pharmacist-name"
                      value={pharmacistName}
                      onChange={(e) => setPharmacistName(e.target.value)}
                      placeholder="Dr. Muhammad Usman (Pharm.D)"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Initial Branding & Theme */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Palette className="h-4 w-4 text-emerald-600" /> 2. Configure Initial Branding &
                  Theme
                </CardTitle>
                <CardDescription>
                  Customize the customer-facing appearance for this pharmacy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {THEME_OPTIONS.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => {
                        setThemePreset(t.id);
                        setPrimaryColor(t.primary);
                      }}
                      className={`text-left rounded-lg border p-3 transition-all ${
                        themePreset === t.id
                          ? "border-emerald-600 bg-emerald-500/5 ring-1 ring-emerald-600"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{t.name}</span>
                        <span
                          className="h-4 w-4 rounded-full border"
                          style={{ backgroundColor: t.primary }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="hero-title">Hero Banner Headline</Label>
                    <Input
                      id="hero-title"
                      value={heroTitle}
                      onChange={(e) => setHeroTitle(e.target.value)}
                      placeholder="Genuine Medicines Delivered in Lahore"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tagline-input">Storefront Tagline</Label>
                    <Input
                      id="tagline-input"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Entitlement, Pilot Access & Publishing Permissions */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  3. Entitlement, Pilot & Publishing Rules
                </CardTitle>
                <CardDescription>
                  Control feature activation and catalog publishing boundaries
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activateImmediately}
                    onChange={(e) => setActivateImmediately(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Enable Website Immediately</div>
                    <div className="text-xs text-muted-foreground">
                      Subdomain resolves to live storefront right after provisioning
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pilotAccess}
                    onChange={(e) => setPilotAccess(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Grant Pilot Program Access</div>
                    <div className="text-xs text-muted-foreground">
                      Enables early-adopter cohort telemetry and priority sync
                    </div>
                  </div>
                </label>

                <div className="space-y-1.5 pt-2 border-t">
                  <Label htmlFor="entitlement-select">Subscription Entitlement Status</Label>
                  <select
                    id="entitlement-select"
                    value={entitlementStatus}
                    onChange={(e) => setEntitlementStatus(e.target.value)}
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="active">Active Subscription</option>
                    <option value="pilot">Pilot Entitlement</option>
                    <option value="grace_period">Grace Period</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="publishing-mode-select">Catalog Publishing Mode</Label>
                  <select
                    id="publishing-mode-select"
                    value={publishingMode}
                    onChange={(e) => setPublishingMode(e.target.value)}
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="manual_only">Manual Approval Only (Recommended)</option>
                    <option value="in_stock_approved">Auto-Sync Approved In-Stock Items</option>
                  </select>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t">
                  <input
                    type="checkbox"
                    checked={ownerCanPublish}
                    onChange={(e) => setOwnerCanPublish(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Allow Pharmacy Owner to Publish Products</div>
                    <div className="text-xs text-muted-foreground">
                      Grants `can_publish_products` permission to Owner Portal role
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t">
                  <input
                    type="checkbox"
                    checked={seedApprovedCatalog}
                    onChange={(e) => setSeedApprovedCatalog(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Publish Initial Approved Starter Catalog</div>
                    <div className="text-xs text-muted-foreground">
                      Publishes 6 curated OTC/Rx items (stripping all private cost/WAC/supplier
                      fields) so the storefront is immediately testable
                    </div>
                  </div>
                </label>

                <div className="pt-4">
                  <Button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={submittingCreate || slugStatus.available === false}
                  >
                    {submittingCreate ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Provisioning Tenant...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" /> Activate Pharmacy Website
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: WEBSITE DETAILS                                                */}
      {/* ===================================================================== */}
      {activeTab === "details" && (
        <div className="space-y-6">
          {detailsLoading || !detailsData?.storefront ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                Loading website configuration and telemetry...
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Top Details Summary Bar */}
              <Card className="border-emerald-500/30">
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-bold">
                          {detailsData.storefront.pharmacy_name}
                        </h2>
                        {statusBadge(
                          detailsData.storefront.status,
                          detailsData.storefront.website_enabled
                        )}
                        <Badge variant="outline">
                          Entitlement: {detailsData.storefront.entitlement_status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                        <span>Storefront ID: {detailsData.storefront.id}</span>
                        <span>•</span>
                        <span>Pharmacy ID: {detailsData.storefront.pharmacy_id}</span>
                        <span>•</span>
                        <span>Primary Domain: {detailsData.storefront.primary_domain}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={detailsData.storefront.preview_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Eye className="h-4 w-4 mr-1.5" /> Open Live Storefront (
                          {detailsData.storefront.primary_domain})
                        </a>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionBusy}
                        onClick={() => handleSyncApprovedCatalog(detailsData.storefront.id)}
                      >
                        <RefreshCw className={`h-4 w-4 mr-1.5 ${actionBusy ? "animate-spin" : ""}`} />
                        Sync Approved Catalog
                      </Button>

                      {detailsData.storefront.status === "active" &&
                      detailsData.storefront.website_enabled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/40 text-amber-600"
                          disabled={actionBusy}
                          onClick={() =>
                            handleStatusChange(detailsData.storefront.id, {
                              status: "disabled",
                              website_enabled: false,
                              disabled_reason: "Temporarily paused by Super Admin",
                            })
                          }
                        >
                          <PauseCircle className="h-4 w-4 mr-1.5" /> Pause / Disable
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={actionBusy}
                          onClick={() =>
                            handleStatusChange(detailsData.storefront.id, {
                              status: "active",
                              website_enabled: true,
                              entitlement_status: "active",
                            })
                          }
                        >
                          <Power className="h-4 w-4 mr-1.5" /> Activate Website
                        </Button>
                      )}

                      {detailsData.storefront.status !== "suspended" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actionBusy}
                          onClick={() =>
                            handleStatusChange(detailsData.storefront.id, {
                              status: "suspended",
                              website_enabled: false,
                              entitlement_status: "suspended",
                              suspended_reason: "Suspended by Super Admin policy enforcement",
                            })
                          }
                        >
                          <Ban className="h-4 w-4 mr-1.5" /> Suspend
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-3">
                {/* Domains & Safe Slug Rename */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Domain & Subdomain Resolution</CardTitle>
                    <CardDescription>
                      Manage primary `*.aivrasol.pk` slug (with 301 redirect) and custom domains
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form onSubmit={handleRenameSlug} className="space-y-2">
                      <Label className="text-xs">Rename Subdomain Slug (Auto-301 Redirect)</Label>
                      <div className="flex gap-2">
                        <Input
                          value={renameSlugValue}
                          onChange={(e) => setRenameSlugValue(e.target.value.toLowerCase())}
                          className="h-8 font-mono text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline" disabled={actionBusy}>
                          Rename
                        </Button>
                      </div>
                    </form>

                    <form onSubmit={handleAddCustomDomain} className="space-y-2 pt-2 border-t">
                      <Label className="text-xs">Register Custom Domain</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="shop.pharmacyname.pk"
                          value={newCustomDomain}
                          onChange={(e) => setNewCustomDomain(e.target.value.toLowerCase())}
                          className="h-8 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline" disabled={actionBusy}>
                          Add
                        </Button>
                      </div>
                    </form>

                    <div className="space-y-2 pt-2 border-t">
                      <div className="text-xs font-medium text-muted-foreground">
                        Registered Hostnames
                      </div>
                      {(detailsData.domains || []).map((dom: any) => (
                        <div
                          key={dom.id}
                          className="flex items-center justify-between rounded border p-2 text-xs"
                        >
                          <div>
                            <div className="font-mono font-medium">{dom.hostname}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {dom.domain_type}{" "}
                              {dom.redirect_to_hostname
                                ? `→ 301 to ${dom.redirect_to_hostname}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={
                                dom.verification_status === "verified"
                                  ? "text-emerald-600 border-emerald-500/30"
                                  : "text-amber-600 border-amber-500/30"
                              }
                            >
                              {dom.verification_status}
                            </Badge>
                            {dom.verification_status !== "verified" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-emerald-600"
                                onClick={() => handleVerifyDomain(dom.id)}
                              >
                                Verify
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Sync Health & Setup Progress */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Sync Health & Setup Progress</CardTitle>
                    <CardDescription>
                      POS-to-Storefront catalog delta status and readiness checklist
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Setup Completion</span>
                      <span className="font-bold text-emerald-600">
                        {detailsData.setup_progress?.percent ?? 100}%
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {(detailsData.setup_progress?.steps || []).map((step: any) => (
                        <div key={step.id} className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            {step.completed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-amber-500" />
                            )}
                            {step.label}
                          </span>
                          <span className="text-muted-foreground">{step.detail}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 border-t space-y-1.5">
                      <div className="font-medium">Recent Sync Events</div>
                      {(detailsData.sync_health?.recent_events || []).length === 0 ? (
                        <p className="text-muted-foreground">No sync deltas received yet.</p>
                      ) : (
                        (detailsData.sync_health.recent_events as any[])
                          .slice(0, 4)
                          .map((ev: any) => (
                            <div
                              key={ev.id}
                              className="flex items-center justify-between rounded bg-muted/40 px-2.5 py-1.5"
                            >
                              <div>
                                <span className="font-mono">{ev.next_cursor}</span> • Applied{" "}
                                {ev.items_applied}/{ev.items_received}
                              </div>
                              <Badge variant="outline" className="text-[10px]">
                                {ev.status}
                              </Badge>
                            </div>
                          ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Audit History */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Tenant Audit History
                    </CardTitle>
                    <CardDescription>
                      Immutable log of provisioning, domain, and status actions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 text-xs">
                      {(detailsData.audit_logs || []).map((log: any) => (
                        <div key={log.id} className="rounded border p-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-emerald-600">
                              {log.action}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(log.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-muted-foreground">{log.summary}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Approved Public Catalog Table */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-4 w-4 text-sky-600" /> Approved Storefront Catalog (
                      {(detailsData.products || []).length} items)
                    </CardTitle>
                    <CardDescription>
                      Only items with status `published` appear on the public website. Cost, WAC,
                      margin, and supplier data are never stored in D1.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionBusy}
                    onClick={() => handleSyncApprovedCatalog(detailsData.storefront.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync Starter Catalog
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2 px-3">Product Name</th>
                          <th className="py-2 px-3">Generic / Strength</th>
                          <th className="py-2 px-3">Category</th>
                          <th className="py-2 px-3">Public Price (PKR)</th>
                          <th className="py-2 px-3">Availability</th>
                          <th className="py-2 px-3">Compliance</th>
                          <th className="py-2 px-3">Publish Status</th>
                          <th className="py-2 px-3 text-right">Toggle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(detailsData.products || []).map((prod: any) => (
                          <tr key={prod.id} className="hover:bg-muted/30">
                            <td className="py-2.5 px-3">
                              <div className="font-medium">{prod.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">
                                POS ID: {prod.pos_product_id} • {prod.packing_label}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-xs">
                              {prod.generic_name || "—"} {prod.strength ? `(${prod.strength})` : ""}
                            </td>
                            <td className="py-2.5 px-3 text-xs">{prod.category_name}</td>
                            <td className="py-2.5 px-3 font-semibold">
                              Rs. {Number(prod.public_selling_price_pkr).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant="outline" className="text-xs">
                                {prod.availability_status}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3">
                              {Number(prod.requires_prescription) === 1 ? (
                                <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs">
                                  Rx Required
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">OTC</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {prod.publish_status === "published" ? (
                                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                                  Published
                                </Badge>
                              ) : (
                                <Badge variant="secondary">{prod.publish_status}</Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={actionBusy}
                                onClick={() => handleToggleProductVisibility(prod)}
                              >
                                {prod.publish_status === "published" ? "Unpublish" : "Publish"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {(detailsData.products || []).length === 0 && (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-muted-foreground">
                              No products synced yet. Click &ldquo;Sync Starter Catalog&rdquo; to
                              publish approved items.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Online Orders & Media Observability */}
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Online Orders ({(detailsData.orders || []).length})
                    </CardTitle>
                    <CardDescription>
                      Tenant-isolated customer orders and POS handoff reconciliation status
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(detailsData.orders || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground py-4">
                        No online orders placed for this pharmacy storefront yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-left uppercase text-muted-foreground">
                              <th className="py-2 px-2">Order #</th>
                              <th className="py-2 px-2">Customer</th>
                              <th className="py-2 px-2">Fulfillment</th>
                              <th className="py-2 px-2">Total</th>
                              <th className="py-2 px-2">Status</th>
                              <th className="py-2 px-2">POS Handoff</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(detailsData.orders || []).map((ord: any) => (
                              <tr key={ord.id}>
                                <td className="py-2 px-2 font-mono font-semibold">
                                  {ord.order_number}
                                </td>
                                <td className="py-2 px-2">
                                  {ord.customer_name} ({ord.customer_phone})
                                </td>
                                <td className="py-2 px-2 capitalize">{ord.fulfillment_type}</td>
                                <td className="py-2 px-2 font-bold">
                                  PKR {Number(ord.total_pkr).toLocaleString()}
                                </td>
                                <td className="py-2 px-2">
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    {ord.status}
                                  </Badge>
                                </td>
                                <td className="py-2 px-2 font-mono text-[11px]">
                                  {ord.pos_handoff_status || "unread"}
                                  {ord.pos_invoice_number ? ` (${ord.pos_invoice_number})` : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Media & R2 Usage</CardTitle>
                    <CardDescription>
                      Optimized WebP assets and content-hash deduplication
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Media Assets</span>
                      <span className="font-bold">{(detailsData.media || []).length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Active Promotions</span>
                      <span className="font-bold">{(detailsData.promotions || []).length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivery Zones</span>
                      <span className="font-bold">{(detailsData.delivery_zones || []).length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Active Branches</span>
                      <span className="font-bold">{(detailsData.branches || []).length}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

