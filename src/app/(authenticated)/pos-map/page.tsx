"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MapPin,
  Building2,
  Monitor,
  Wifi,
  RefreshCw,
  Search,
  ExternalLink,
  Copy,
  Check,
  Navigation,
  Phone,
  Mail,
  User,
  KeyRound,
  ShieldCheck,
  Clock,
  Globe,
  Sparkles,
  ChevronRight,
  X,
  Edit3,
  Layers,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TerminalInfo = {
  id: string;
  terminal_number: number | null;
  role: string;
  hostname: string;
  machine_id: string;
  license_key: string;
  last_seen_version: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  is_active_today: boolean;
  location: {
    lat?: number;
    lng?: number;
    city?: string;
    region?: string;
    ip?: string;
    isp?: string;
    source?: string;
  } | null;
};

type LicenseInfo = {
  id: string;
  license_key: string;
  status: string;
  seats: number;
  seats_used: number;
  issued_at: string | null;
  expires_at: string | null;
  grace_until: string | null;
  project_name: string;
  billing_model: string;
  notes: string | null;
};

type PharmacyLocationItem = {
  id: string;
  name: string;
  status: string;
  activityStatus: "online" | "active_today" | "active" | "inactive";
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  timezone: string;
  created_at: string | null;
  lastSeenAt: string | null;
  onlineTerminalsCount: number;
  totalTerminalsCount: number;
  location: {
    lat: number;
    lng: number;
    rawLat: number;
    rawLng: number;
    city: string;
    region: string;
    country: string;
    ip: string | null;
    isp: string | null;
    address: string | null;
    source: string;
    accuracy: "exact" | "city" | "pending";
    updated_at: string | null;
  };
  licenses: LicenseInfo[];
  terminals: TerminalInfo[];
};

type CitySummary = {
  city: string;
  region: string;
  count: number;
  onlineCount: number;
  activeTodayCount: number;
  activeCount: number;
  terminalsCount: number;
  onlineTerminalsCount: number;
  lat: number;
  lng: number;
};

type AvailableCity = {
  city: string;
  region: string;
  lat: number;
  lng: number;
};

type MapSummary = {
  totalPharmacies: number;
  activePharmacies: number;
  onlineNowCount: number;
  activeTodayCount: number;
  totalTerminals: number;
  onlineTerminals: number;
  totalCities: number;
};

type MapStyle = "voyager" | "dark" | "satellite";

const TILE_LAYERS: Record<
  MapStyle,
  { name: string; url: string; attribution: string }
> = {
  voyager: {
    name: "Clean Map",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  dark: {
    name: "Dark Radar",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never synced";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "Just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function getSourceLabel(source: string): string {
  switch (source) {
    case "pos_address":
      return "POS Address + Geo";
    case "pos_ip":
      return "Live POS Network";
    case "vercel_geo":
      return "Live Edge Signal";
    case "admin_manual":
      return "Pinned by Admin";
    case "address_match":
      return "Pharmacy Address City";
    default:
      return "Awaiting POS Heartbeat";
  }
}

export default function PosLiveMapPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<MapSummary>({
    totalPharmacies: 0,
    activePharmacies: 0,
    onlineNowCount: 0,
    activeTodayCount: 0,
    totalTerminals: 0,
    onlineTerminals: 0,
    totalCities: 0,
  });
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [pharmacies, setPharmacies] = useState<PharmacyLocationItem[]>([]);
  const [availableCities, setAvailableCities] = useState<AvailableCity[]>([]);

  const [selectedCity, setSelectedCity] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "online" | "active_today" | "active" | "inactive"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(
    null
  );
  const [mapStyle, setMapStyle] = useState<MapStyle>("voyager");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Edit Location modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    clientId: "",
    pharmacyName: "",
    city: "",
    region: "",
    lat: "",
    lng: "",
    address: "",
  });
  const [savingLocation, setSavingLocation] = useState(false);

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const markerMapRef = useRef<Map<string, any>>(new Map());
  const [leafletReady, setLeafletReady] = useState(false);

  const fetchMapData = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);

      const res = await fetch("/api/admin/pos-locations", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to load POS map locations");
      }
      const data = await res.json();
      setSummary(data.summary);
      setCities(data.cities || []);
      setPharmacies(data.pharmacies || []);
      setAvailableCities(data.availableCities || []);
    } catch (err: any) {
      if (!isSilent) {
        toast.error(err?.message || "Could not load POS map data");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMapData(false);
    const interval = setInterval(() => {
      fetchMapData(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchMapData]);

  // Filtered pharmacies
  const filteredPharmacies = useMemo(() => {
    return pharmacies.filter((p) => {
      if (
        selectedCity !== "all" &&
        p.location.city.toLowerCase() !== selectedCity.toLowerCase()
      ) {
        return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "online" && p.activityStatus !== "online")
          return false;
        if (
          statusFilter === "active_today" &&
          p.activityStatus !== "online" &&
          p.activityStatus !== "active_today"
        )
          return false;
        if (statusFilter === "active" && p.activityStatus === "inactive")
          return false;
        if (statusFilter === "inactive" && p.activityStatus !== "inactive")
          return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = [
          p.name,
          p.location.city,
          p.location.region,
          p.address,
          p.contact_name,
          p.contact_phone,
          p.contact_email,
          p.location.ip,
          p.location.isp,
          ...p.licenses.map((l) => l.license_key),
          ...p.terminals.map((t) => t.hostname),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pharmacies, selectedCity, statusFilter, searchQuery]);

  const selectedPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || null,
    [pharmacies, selectedPharmacyId]
  );

  // Load Leaflet CSS & JS from CDN once
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ((window as any).L) {
      setLeafletReady(true);
      return;
    }

    const cssId = "leaflet-cdn-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const scriptId = "leaflet-cdn-js";
    const existingScript = document.getElementById(
      scriptId
    ) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => setLeafletReady(true));
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setLeafletReady(true);
    document.body.appendChild(script);
  }, []);

  // Initialize Leaflet Map instance
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || mapInstanceRef.current)
      return;
    const L = (window as any).L;
    if (!L) return;

    const map = L.map(mapContainerRef.current, {
      center: [30.8, 71.5], // Center of Pakistan
      zoom: 6,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const tileConfig = TILE_LAYERS[mapStyle];
    tileLayerRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxZoom: 19,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [leafletReady]);

  // Update map tile style when switched
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletReady) return;
    const L = (window as any).L;
    if (!L) return;

    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }
    const tileConfig = TILE_LAYERS[mapStyle];
    tileLayerRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
  }, [mapStyle, leafletReady]);

  // Render pharmacy markers on the map
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !leafletReady)
      return;
    const L = (window as any).L;
    if (!L) return;

    markersLayerRef.current.clearLayers();
    markerMapRef.current.clear();

    filteredPharmacies.forEach((pharmacy) => {
      const isSelected = pharmacy.id === selectedPharmacyId;
      const isOnline = pharmacy.activityStatus === "online";
      const isActiveToday = pharmacy.activityStatus === "active_today";
      const isActive = pharmacy.activityStatus === "active";

      // Color scheme based on live status
      const primaryColor = isOnline
        ? "#10b981" // Emerald
        : isActiveToday
        ? "#0ea5e9" // Sky Blue
        : isActive
        ? "#2563eb" // Royal Blue
        : "#64748b"; // Slate

      const ringColor = isOnline
        ? "rgba(16, 185, 129, 0.35)"
        : isActiveToday
        ? "rgba(14, 165, 233, 0.28)"
        : isActive
        ? "rgba(37, 99, 235, 0.25)"
        : "rgba(100, 116, 139, 0.2)";

      const scale = isSelected ? 1.22 : 1;
      const safeName = pharmacy.name
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const safeCity = pharmacy.location.city
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const html = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: scale(${scale}); transition: transform 0.2s ease;">
          ${
            isOnline
              ? `<span style="position: absolute; top: -4px; width: 46px; height: 46px; border-radius: 9999px; background: ${ringColor}; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>`
              : ""
          }
          <div style="
            position: relative;
            width: 38px;
            height: 38px;
            border-radius: 12px;
            background: ${primaryColor};
            border: ${isSelected ? "3px solid #ffffff" : "2.5px solid #ffffff"};
            box-shadow: 0 8px 20px -2px rgba(0,0,0,0.35), 0 0 0 ${
              isSelected ? "4px " + primaryColor : "2px " + ringColor
            };
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            cursor: pointer;
          ">
            <!-- Pharmacy Medical Cross + Store Icon -->
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 6v8" />
              <path d="M8 10h8" />
              <rect x="3" y="3" width="18" height="18" rx="4" />
            </svg>
            ${
              pharmacy.totalTerminalsCount > 0
                ? `<span style="
                    position: absolute;
                    top: -6px;
                    right: -6px;
                    min-width: 18px;
                    height: 18px;
                    padding: 0 4px;
                    border-radius: 999px;
                    background: #0f172a;
                    color: #fff;
                    font-size: 10px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1.5px solid #fff;
                  ">${pharmacy.totalTerminalsCount}</span>`
                : ""
            }
          </div>
          <!-- Pin pointer triangle -->
          <div style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 7px solid ${primaryColor};
            margin-top: -1px;
          "></div>
          <!-- Floating pharmacy label -->
          <div style="
            margin-top: 2px;
            padding: 2px 7px;
            border-radius: 6px;
            background: ${isSelected ? "#0f172a" : "rgba(15, 23, 42, 0.86)"};
            color: #ffffff;
            font-size: 10.5px;
            font-weight: 600;
            white-space: nowrap;
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            border: 1px solid rgba(255,255,255,0.15);
          ">
            ${safeName} <span style="opacity: 0.7; font-weight: 400;">· ${safeCity}</span>
          </div>
        </div>
      `;

      const icon = L.divIcon({
        className: "aivrasol-pharmacy-marker",
        html,
        iconSize: [150, 68],
        iconAnchor: [75, 45],
      });

      const marker = L.marker([pharmacy.location.lat, pharmacy.location.lng], {
        icon,
      });

      marker.on("click", () => {
        setSelectedPharmacyId(pharmacy.id);
        mapInstanceRef.current?.flyTo(
          [pharmacy.location.lat, pharmacy.location.lng],
          Math.max(mapInstanceRef.current.getZoom(), 13),
          { duration: 0.8 }
        );
      });

      marker.addTo(markersLayerRef.current);
      markerMapRef.current.set(pharmacy.id, marker);
    });
  }, [filteredPharmacies, selectedPharmacyId, leafletReady]);

  const handleFitAll = useCallback(() => {
    if (!mapInstanceRef.current || !leafletReady) return;
    const L = (window as any).L;
    if (!L || filteredPharmacies.length === 0) {
      mapInstanceRef.current.flyTo([30.8, 71.5], 6, { duration: 0.8 });
      return;
    }
    const bounds = L.latLngBounds(
      filteredPharmacies.map((p) => [p.location.lat, p.location.lng])
    );
    mapInstanceRef.current.flyToBounds(bounds.pad(0.22), {
      maxZoom: 13,
      duration: 0.9,
    });
  }, [filteredPharmacies, leafletReady]);

  const handleSelectCity = (city: CitySummary | "all") => {
    if (city === "all") {
      setSelectedCity("all");
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo([30.8, 71.5], 6, { duration: 0.8 });
      }
      return;
    }
    setSelectedCity(city.city);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([city.lat, city.lng], 12, {
        duration: 0.9,
      });
    }
  };

  const handleSelectPharmacy = (pharmacy: PharmacyLocationItem) => {
    setSelectedPharmacyId(pharmacy.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo(
        [pharmacy.location.lat, pharmacy.location.lng],
        14,
        { duration: 0.85 }
      );
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    toast.success(`${label} copied`);
    setTimeout(() => setCopiedText(null), 1800);
  };

  const openEditLocationModal = (pharmacy: PharmacyLocationItem) => {
    setEditForm({
      clientId: pharmacy.id,
      pharmacyName: pharmacy.name,
      city:
        pharmacy.location.city === "Awaiting POS Sync"
          ? ""
          : pharmacy.location.city,
      region: pharmacy.location.region || "Punjab",
      lat: String(pharmacy.location.rawLat ?? pharmacy.location.lat),
      lng: String(pharmacy.location.rawLng ?? pharmacy.location.lng),
      address: pharmacy.address || "",
    });
    setEditModalOpen(true);
  };

  const handleCityQuickSelect = (cityName: string) => {
    const found = availableCities.find(
      (c) => c.city.toLowerCase() === cityName.toLowerCase()
    );
    if (found) {
      setEditForm((prev) => ({
        ...prev,
        city: found.city,
        region: found.region,
        lat: String(found.lat),
        lng: String(found.lng),
      }));
    } else {
      setEditForm((prev) => ({ ...prev, city: cityName }));
    }
  };

  const handleSaveManualLocation = async (resetToAuto = false) => {
    if (!editForm.clientId) return;
    try {
      setSavingLocation(true);
      const res = await fetch("/api/admin/pos-locations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          resetToAuto
            ? { clientId: editForm.clientId, resetToAuto: true }
            : {
                clientId: editForm.clientId,
                city: editForm.city,
                region: editForm.region,
                lat: Number(editForm.lat),
                lng: Number(editForm.lng),
                address: editForm.address,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update location");
      }
      toast.success(
        resetToAuto
          ? "Switched back to automatic POS location detection"
          : `Location updated for ${editForm.pharmacyName}`
      );
      setEditModalOpen(false);
      await fetchMapData(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update location");
    } finally {
      setSavingLocation(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                POS Live Map & Footprint
              </h1>
              <p className="text-sm text-muted-foreground">
                Silent real-time geographical monitoring of active AivraSol
                Pharmacy POS installations across cities
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFitAll}
            className="gap-1.5"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit All Markers
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchMapData(true)}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh Live Data
          </Button>
        </div>
      </div>

      {/* Top Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setStatusFilter("all")}
          className={`cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md ${
            statusFilter === "all"
              ? "border-primary bg-primary/5"
              : "bg-card border-border"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total Pharmacies
            </span>
            <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
              <Building2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {loading ? "—" : summary.totalPharmacies}
            </span>
            <span className="text-xs text-muted-foreground">
              ({summary.activePharmacies} active licenses)
            </span>
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter(statusFilter === "online" ? "all" : "online")
          }
          className={`cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md ${
            statusFilter === "online"
              ? "border-emerald-500 bg-emerald-500/5"
              : "bg-card border-border"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Online Right Now
            </span>
            <div className="relative rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <Wifi className="h-4 w-4" />
              {summary.onlineNowCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {loading ? "—" : summary.onlineNowCount}
            </span>
            <span className="text-xs text-muted-foreground">
              ({summary.activeTodayCount} active in 24h)
            </span>
          </div>
        </div>

        <div
          onClick={() => handleSelectCity("all")}
          className="cursor-pointer rounded-xl border border-border bg-card p-4 transition-all hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cities Covered
            </span>
            <div className="rounded-lg bg-purple-500/10 p-2 text-purple-600 dark:text-purple-400">
              <Globe className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {loading ? "—" : summary.totalCities}
            </span>
            <span className="text-xs text-muted-foreground">
              cities with POS footprint
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              POS Terminals (Seats)
            </span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
              <Monitor className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {loading ? "—" : summary.totalTerminals}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {summary.onlineTerminals} online now
            </span>
          </div>
        </div>
      </div>

      {/* Main Interactive Map + Sidebar Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 Columns: Interactive Map */}
        <div className="lg:col-span-8 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {/* Map Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 bg-muted/30">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                Online Now
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500"></span>
                Active Today
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
                Active License
              </span>
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-500"></span>
                Offline / Inactive
              </span>
            </div>

            {/* Map Style Switcher */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              {(Object.keys(TILE_LAYERS) as MapStyle[]).map((styleKey) => (
                <button
                  key={styleKey}
                  type="button"
                  onClick={() => setMapStyle(styleKey)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    mapStyle === styleKey
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {TILE_LAYERS[styleKey].name}
                </button>
              ))}
            </div>
          </div>

          {/* Map Canvas */}
          <div className="relative h-[540px] w-full bg-slate-900/5">
            <div ref={mapContainerRef} className="h-full w-full z-0" />

            {/* Active City Filter Pill Overlay */}
            {selectedCity !== "all" && (
              <div className="absolute left-4 top-4 z-[400] flex items-center gap-2 rounded-full border border-border bg-background/95 px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                <span>
                  City: <strong>{selectedCity}</strong> (
                  {filteredPharmacies.length} pharmacies)
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectCity("all")}
                  className="ml-1 rounded-full p-0.5 hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right 4 Columns: City Breakdown OR Selected Pharmacy Complete Details */}
        <div className="lg:col-span-4 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm h-[595px]">
          {selectedPharmacy ? (
            /* ── Selected Pharmacy Complete Detail View ── */
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        selectedPharmacy.activityStatus === "online"
                          ? "bg-emerald-500 animate-pulse"
                          : selectedPharmacy.activityStatus === "active_today"
                          ? "bg-sky-500"
                          : selectedPharmacy.activityStatus === "active"
                          ? "bg-blue-600"
                          : "bg-slate-400"
                      }`}
                    />
                    <h2 className="truncate text-base font-bold">
                      {selectedPharmacy.name}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0 text-primary" />
                    <span>
                      {selectedPharmacy.location.city},{" "}
                      {selectedPharmacy.location.region}
                    </span>
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedPharmacyId(null)}
                  className="h-8 px-2 text-xs gap-1 shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                  Cities List
                </Button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                {/* Status & Sync Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 p-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      POS Status
                    </div>
                    <div className="mt-0.5 font-semibold capitalize">
                      {selectedPharmacy.activityStatus === "online"
                        ? "Online Right Now"
                        : selectedPharmacy.activityStatus === "active_today"
                        ? "Active Today"
                        : selectedPharmacy.activityStatus === "active"
                        ? "Active License"
                        : "Offline / Inactive"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Last Heartbeat
                    </div>
                    <div className="mt-0.5 text-xs font-medium">
                      {formatRelativeTime(selectedPharmacy.lastSeenAt)}
                    </div>
                  </div>
                </div>

                {/* Location & Coordinates Card */}
                <div className="rounded-xl border border-border p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Location & Coordinates
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {getSourceLabel(selectedPharmacy.location.source)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted/40 p-2">
                      <span className="text-muted-foreground block text-[10px]">
                        City / Province
                      </span>
                      <span className="font-semibold">
                        {selectedPharmacy.location.city}
                      </span>
                      <span className="text-muted-foreground block text-[11px]">
                        {selectedPharmacy.location.region}
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-2">
                      <span className="text-muted-foreground block text-[10px]">
                        Coordinates (Lat, Lng)
                      </span>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono font-medium text-[11px]">
                          {selectedPharmacy.location.rawLat.toFixed(4)},{" "}
                          {selectedPharmacy.location.rawLng.toFixed(4)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              `${selectedPharmacy.location.rawLat}, ${selectedPharmacy.location.rawLng}`,
                              "Coordinates"
                            )
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedPharmacy.address && (
                    <div className="text-xs">
                      <span className="text-muted-foreground block text-[10px]">
                        Registered Address
                      </span>
                      <span className="font-medium">
                        {selectedPharmacy.address}
                      </span>
                    </div>
                  )}

                  {(selectedPharmacy.location.ip ||
                    selectedPharmacy.location.isp) && (
                    <div className="text-xs flex items-center justify-between border-t border-border/60 pt-2">
                      <span className="text-muted-foreground">
                        Network / ISP:
                      </span>
                      <span className="font-mono text-[11px]">
                        {selectedPharmacy.location.ip || "—"}{" "}
                        {selectedPharmacy.location.isp
                          ? `(${selectedPharmacy.location.isp})`
                          : ""}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={`https://www.google.com/maps?q=${selectedPharmacy.location.rawLat},${selectedPharmacy.location.rawLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in Google Maps
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditLocationModal(selectedPharmacy)}
                      className="h-8 text-xs gap-1"
                    >
                      <Edit3 className="h-3 w-3" />
                      Pin / Edit
                    </Button>
                  </div>
                </div>

                {/* Contact & Owner Information */}
                <div className="rounded-xl border border-border p-3.5 space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                    Client & Contact Info
                  </span>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" /> Contact Person
                      </span>
                      <span className="font-medium">
                        {selectedPharmacy.contact_name || "Not specified"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" /> Phone
                      </span>
                      {selectedPharmacy.contact_phone ? (
                        <a
                          href={`tel:${selectedPharmacy.contact_phone}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {selectedPharmacy.contact_phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" /> Email
                      </span>
                      <span className="font-medium truncate max-w-[180px]">
                        {selectedPharmacy.contact_email || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Licenses */}
                <div className="rounded-xl border border-border p-3.5 space-y-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                    Licenses ({selectedPharmacy.licenses.length})
                  </span>
                  {selectedPharmacy.licenses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No license issued yet.
                    </p>
                  ) : (
                    selectedPharmacy.licenses.map((lic) => (
                      <div
                        key={lic.id}
                        className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-mono font-semibold">
                            <KeyRound className="h-3.5 w-3.5 text-primary" />
                            <span>{lic.license_key}</span>
                            <button
                              type="button"
                              onClick={() =>
                                copyToClipboard(lic.license_key, "License key")
                              }
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {copiedText === lic.license_key ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                          <Badge
                            variant={
                              lic.status === "active" ? "default" : "secondary"
                            }
                            className="text-[10px] capitalize"
                          >
                            {lic.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{lic.project_name}</span>
                          <span>
                            Seats: {lic.seats_used} / {lic.seats}
                          </span>
                        </div>
                        {lic.expires_at && (
                          <div className="text-[11px] text-muted-foreground">
                            Expires:{" "}
                            {new Date(lic.expires_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Connected POS Terminals (Seats) */}
                <div className="rounded-xl border border-border p-3.5 space-y-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                    Registered POS Terminals (
                    {selectedPharmacy.terminals.length})
                  </span>
                  {selectedPharmacy.terminals.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No terminal has connected yet.
                    </p>
                  ) : (
                    selectedPharmacy.terminals.map((term) => (
                      <div
                        key={term.id}
                        className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                term.is_online
                                  ? "bg-emerald-500"
                                  : term.is_active_today
                                  ? "bg-sky-500"
                                  : "bg-slate-400"
                              }`}
                            />
                            <span>
                              {term.hostname || "POS Counter"}
                              {term.terminal_number
                                ? ` (#${term.terminal_number})`
                                : ""}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase"
                          >
                            {term.role}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            Version:{" "}
                            {term.last_seen_version
                              ? `v${term.last_seen_version}`
                              : "—"}
                          </span>
                          <span>{formatRelativeTime(term.last_seen_at)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── City-Wise Breakdown View ("Kis City me Kitny Hyn") ── */
            <div className="flex h-full flex-col">
              <div className="border-b border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold">
                      City-Wise POS Breakdown
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Click any city to zoom & filter pharmacies
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {cities.length} Cities
                  </Badge>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-border/60">
                <button
                  type="button"
                  onClick={() => handleSelectCity("all")}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                    selectedCity === "all" ? "bg-primary/5 font-semibold" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        All Cities (Full Map)
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {summary.totalTerminals} total terminals
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default">{summary.totalPharmacies}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>

                {cities.map((c) => {
                  const isActiveCity =
                    selectedCity.toLowerCase() === c.city.toLowerCase();
                  const pct =
                    summary.totalPharmacies > 0
                      ? Math.round((c.count / summary.totalPharmacies) * 100)
                      : 0;

                  return (
                    <button
                      key={c.city}
                      type="button"
                      onClick={() => handleSelectCity(c)}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        isActiveCity ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm truncate">
                              {c.city}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {c.region}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>
                              {c.terminalsCount}{" "}
                              {c.terminalsCount === 1
                                ? "terminal"
                                : "terminals"}
                            </span>
                            {c.onlineCount > 0 && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                {c.onlineCount} online
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                              {c.count}{" "}
                              {c.count === 1 ? "Pharmacy" : "Pharmacies"}
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>

                      {/* Subtle share bar */}
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(pct, 6)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Complete Searchable Pharmacy Directory */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold">
              All Pharmacies & Locations Directory ({filteredPharmacies.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Click any pharmacy row to locate it on the map and inspect its
              full terminal & license details
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search pharmacy, city, phone, license..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "online", label: "Online Now" },
                  { id: "active_today", label: "24h Active" },
                  { id: "active", label: "Active" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    statusFilter === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Pharmacy</th>
                <th className="px-4 py-3 font-semibold">City & Region</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Terminals</th>
                <th className="px-4 py-3 font-semibold">Coordinates</th>
                <th className="px-4 py-3 font-semibold">Last Active</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredPharmacies.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No pharmacies match the current filter.
                  </td>
                </tr>
              ) : (
                filteredPharmacies.map((pharmacy) => {
                  const isSelected = pharmacy.id === selectedPharmacyId;
                  return (
                    <tr
                      key={pharmacy.id}
                      onClick={() => handleSelectPharmacy(pharmacy)}
                      className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                              pharmacy.activityStatus === "online"
                                ? "bg-emerald-500"
                                : pharmacy.activityStatus === "active_today"
                                ? "bg-sky-500"
                                : pharmacy.activityStatus === "active"
                                ? "bg-blue-600"
                                : "bg-slate-400"
                            }`}
                          />
                          <div>
                            <div className="font-semibold">{pharmacy.name}</div>
                            {pharmacy.address && (
                              <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                                {pharmacy.address}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {pharmacy.location.city}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pharmacy.location.region}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="text-xs font-medium">
                          {pharmacy.contact_name || "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pharmacy.contact_phone ||
                            pharmacy.contact_email ||
                            "—"}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-xs">
                            {pharmacy.totalTerminalsCount} PC
                            {pharmacy.totalTerminalsCount === 1 ? "" : "s"}
                          </Badge>
                          {pharmacy.onlineTerminalsCount > 0 && (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                              {pharmacy.onlineTerminalsCount} Online
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        <div>
                          {pharmacy.location.rawLat.toFixed(4)},{" "}
                          {pharmacy.location.rawLng.toFixed(4)}
                        </div>
                        <div className="text-[10px] font-sans">
                          {getSourceLabel(pharmacy.location.source)}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {formatRelativeTime(pharmacy.lastSeenAt)}
                      </td>

                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectPharmacy(pharmacy)}
                            className="h-8 text-xs gap-1"
                          >
                            <Navigation className="h-3.5 w-3.5" />
                            Locate
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditLocationModal(pharmacy)}
                            className="h-8 text-xs"
                          >
                            Edit Pin
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Pin Pharmacy Location Dialog */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Set Location — {editForm.pharmacyName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Quick Pick City (Pakistan)</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={editForm.city}
                onChange={(e) => handleCityQuickSelect(e.target.value)}
              >
                <option value="">-- Select a City or type below --</option>
                {availableCities.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city} ({c.region})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">City Name</Label>
                <Input
                  value={editForm.city}
                  onChange={(e) =>
                    setEditForm({ ...editForm, city: e.target.value })
                  }
                  placeholder="e.g. Lahore"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Province / Region</Label>
                <Input
                  value={editForm.region}
                  onChange={(e) =>
                    setEditForm({ ...editForm, region: e.target.value })
                  }
                  placeholder="e.g. Punjab"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Latitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={editForm.lat}
                  onChange={(e) =>
                    setEditForm({ ...editForm, lat: e.target.value })
                  }
                  placeholder="31.5204"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Longitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={editForm.lng}
                  onChange={(e) =>
                    setEditForm({ ...editForm, lng: e.target.value })
                  }
                  placeholder="74.3587"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Full Pharmacy Address</Label>
              <Input
                value={editForm.address}
                onChange={(e) =>
                  setEditForm({ ...editForm, address: e.target.value })
                }
                placeholder="Main Boulevard, Gulberg III, Lahore"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSaveManualLocation(true)}
                disabled={savingLocation}
                className="text-xs gap-1 text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to Auto-Detect
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleSaveManualLocation(false)}
                  disabled={savingLocation}
                >
                  {savingLocation ? "Saving..." : "Save Location"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

