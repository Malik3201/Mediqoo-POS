"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Compass,
  Crosshair,
  ExternalLink,
  Globe,
  Info,
  Layers,
  Link2,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  Search,
  Trash2,
} from "lucide-react";
import { PortalActionButton } from "@/components/portal/PortalUI";

export interface PortalLocationSavePayload {
  address_line: string;
  city: string;
  contact_phone: string;
  whatsapp_phone: string;
  latitude: number | null;
  longitude: number | null;
  clear_coordinates?: boolean;
}

interface PortalLocationCardProps {
  pharmacyName: string;
  initialAddress: string;
  initialCity: string;
  initialPhone: string;
  initialWhatsapp: string;
  initialLatitude: number | null | undefined;
  initialLongitude: number | null | undefined;
  saving: boolean;
  onSave: (payload: PortalLocationSavePayload) => Promise<void>;
  onNotify: (msg: string) => void;
}

interface PlaceSuggestion {
  display_name: string;
  short_name: string;
  city: string;
  latitude: number;
  longitude: number;
}

type MapTileMode = "street" | "satellite";
type PreviewTab = "picker" | "google";

const TILE_CONFIG: Record<MapTileMode, { url: string; attribution: string }> = {
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
};

const PAKISTAN_DEFAULT_CENTER: [number, number] = [31.5204, 74.3587]; // Lahore default fallback

/**
 * Fast client-side coordinate extractor for raw coordinates & full map URLs.
 * Short share links (maps.app.goo.gl, goo.gl/maps, share.google, g.co) are
 * automatically forwarded to our server-side resolver (`resolve_maps_link`).
 */
export function parseCoordinatesFromInput(
  raw: string
): { lat: number; lng: number } | null {
  const input = (raw || "").trim();
  if (!input) return null;

  const variants = [input];
  try {
    const decoded = decodeURIComponent(input);
    if (decoded !== input) variants.push(decoded);
  } catch {
    // Ignore malformed URI components
  }

  const patterns: RegExp[] = [
    /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/i,
    /[?&](?:q|query|ll|sll|destination|center)=(?:loc:)?(-?\d{1,2}\.\d{2,})(?:%2C|,|\s|\+)+(-?\d{1,3}\.\d{2,})/i,
    /\/(?:search|place|dir\/[^/]*)\/(-?\d{1,2}\.\d{3,})(?:%2C|,|\+)+(-?\d{1,3}\.\d{3,})/i,
    /@(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
  ];

  for (const text of variants) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1] && m?.[2]) {
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180 &&
          !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
        ) {
          return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
        }
      }
    }
  }
  return null;
}

function looksLikeMapLink(raw: string): boolean {
  const t = (raw || "").trim();
  return (
    /https?:\/\//i.test(t) ||
    /(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|google\.com\/maps|g\.co\/kgs|share\.google|maps\.apple\.com|osm\.org|openstreetmap\.org)/i.test(
      t
    )
  );
}

/**
 * Loads Leaflet CSS & JS from CDN once (with jsDelivr fallback if unpkg is slow/blocked).
 */
function ensureLeafletLoaded(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if ((window as any).L) return Promise.resolve((window as any).L);

  return new Promise((resolve, reject) => {
    const cssId = "aivrasol-leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.onerror = () => {
        link.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
      };
      document.head.appendChild(link);
    }

    const loadScript = (src: string, onFail?: () => void) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        if ((window as any).L) resolve((window as any).L);
        else if (onFail) onFail();
        else reject(new Error("Leaflet failed to initialize"));
      };
      script.onerror = () => {
        if (onFail) onFail();
        else reject(new Error("Failed to load interactive map library"));
      };
      document.head.appendChild(script);
    };

    const existing = document.getElementById("aivrasol-leaflet-js") as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).L) {
        resolve((window as any).L);
        return;
      }
      existing.addEventListener("load", () => resolve((window as any).L), { once: true });
      existing.addEventListener("error", () => {
        loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
      }, { once: true });
      return;
    }

    const primary = document.createElement("script");
    primary.id = "aivrasol-leaflet-js";
    primary.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    primary.async = true;
    primary.onload = () => {
      if ((window as any).L) resolve((window as any).L);
      else loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
    };
    primary.onerror = () => {
      loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
    };
    document.head.appendChild(primary);
  });
}

function buildPharmacyMarkerIcon(L: any) {
  return L.divIcon({
    className: "aivrasol-pin-marker",
    html: `
      <div style="position:relative;width:36px;height:44px;display:flex;align-items:flex-start;justify-content:center;cursor:grab;">
        <div style="width:34px;height:34px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:#059669;border:3px solid #ffffff;box-shadow:0 8px 18px rgba(15,23,42,0.38);display:flex;align-items:center;justify-content:center;">
          <div style="width:10px;height:10px;border-radius:9999px;background:#ffffff;transform:rotate(45deg);"></div>
        </div>
      </div>
    `,
    iconSize: [36, 44],
    iconAnchor: [18, 40],
  });
}

export function PortalLocationCard({
  pharmacyName,
  initialAddress,
  initialCity,
  initialPhone,
  initialWhatsapp,
  initialLatitude,
  initialLongitude,
  saving,
  onSave,
  onNotify,
}: PortalLocationCardProps) {
  const [addressLine, setAddressLine] = useState(initialAddress || "");
  const [city, setCity] = useState(initialCity || "Lahore");
  const [contactPhone, setContactPhone] = useState(initialPhone || "");
  const [whatsappPhone, setWhatsappPhone] = useState(initialWhatsapp || "");
  const [latInput, setLatInput] = useState(
    initialLatitude !== null && initialLatitude !== undefined
      ? String(initialLatitude)
      : ""
  );
  const [lngInput, setLngInput] = useState(
    initialLongitude !== null && initialLongitude !== undefined
      ? String(initialLongitude)
      : ""
  );

  const [mapsPasteInput, setMapsPasteInput] = useState("");
  const [resolvingLink, setResolvingLink] = useState(false);
  const [fetchingGps, setFetchingGps] = useState(false);
  const [locatingCity, setLocatingCity] = useState(false);
  const [gpsPermissionBlocked, setGpsPermissionBlocked] = useState(false);

  const [placeSearchInput, setPlaceSearchInput] = useState("");
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("picker");
  const [tileMode, setTileMode] = useState<MapTileMode>("street");
  const [leafletReady, setLeafletReady] = useState(false);
  const [leafletFailed, setLeafletFailed] = useState(false);

  const [statusNote, setStatusNote] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Interactive Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    setAddressLine(initialAddress || "");
    setCity(initialCity || "Lahore");
    setContactPhone(initialPhone || "");
    setWhatsappPhone(initialWhatsapp || "");
    setLatInput(
      initialLatitude !== null && initialLatitude !== undefined
        ? String(initialLatitude)
        : ""
    );
    setLngInput(
      initialLongitude !== null && initialLongitude !== undefined
        ? String(initialLongitude)
        : ""
    );
  }, [
    initialAddress,
    initialCity,
    initialPhone,
    initialWhatsapp,
    initialLatitude,
    initialLongitude,
  ]);

  const parsedCoords = useMemo(() => {
    if (!latInput.trim() || !lngInput.trim()) return null;
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
  }, [latInput, lngInput]);

  const mapQuery = useMemo(() => {
    if (parsedCoords) {
      return `${parsedCoords.lat},${parsedCoords.lng}`;
    }
    const parts = [pharmacyName, addressLine, city, "Pakistan"]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    return parts.join(", ") || "Lahore, Pakistan";
  }, [parsedCoords, pharmacyName, addressLine, city]);

  const embedMapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(
    mapQuery
  )}&z=${parsedCoords ? 17 : 14}&output=embed`;

  const googleMapsOpenUrl = parsedCoords
    ? `https://www.google.com/maps/search/?api=1&query=${parsedCoords.lat},${parsedCoords.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

  const googleDirectionsUrl = parsedCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${parsedCoords.lat},${parsedCoords.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapQuery)}`;

  const callLocationHelper = useCallback(async (body: Record<string, any>) => {
    const res = await fetch("/api/portal/website", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: "Invalid server response" }));
    return { ok: res.ok && Boolean(json?.ok), status: res.status, data: json };
  }, []);

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      try {
        const res = await callLocationHelper({
          action: "reverse_geocode",
          latitude: lat,
          longitude: lng,
        });
        const info = res.data?.result;
        if (!info) return;
        if (info.address_line) {
          setAddressLine((curr) => (curr.trim() ? curr : info.address_line));
        }
        if (info.city) {
          setCity((curr) =>
            !curr.trim() || curr.trim().toLowerCase() === "pakistan" ? info.city : curr
          );
        }
      } catch {
        // Reverse geocode is best-effort only
      }
    },
    [callLocationHelper]
  );

  // Sync pin & map camera helper
  const placePinOnMap = useCallback(
    (lat: number, lng: number, zoom = 17, shouldReverseGeocode = true) => {
      const cleanLat = Number(lat.toFixed(6));
      const cleanLng = Number(lng.toFixed(6));
      setLatInput(String(cleanLat));
      setLngInput(String(cleanLng));
      if (mapInstanceRef.current) {
        const L = (window as any).L;
        mapInstanceRef.current.setView([cleanLat, cleanLng], zoom, { animate: true });
        if (L) {
          if (markerRef.current) {
            markerRef.current.setLatLng([cleanLat, cleanLng]);
          } else {
            const m = L.marker([cleanLat, cleanLng], {
              draggable: true,
              icon: buildPharmacyMarkerIcon(L),
            }).addTo(mapInstanceRef.current);
            m.on("dragend", () => {
              const pos = m.getLatLng();
              const dLat = Number(pos.lat.toFixed(6));
              const dLng = Number(pos.lng.toFixed(6));
              setLatInput(String(dLat));
              setLngInput(String(dLng));
              setStatusNote({
                tone: "success",
                text: `Pin moved to (${dLat}, ${dLng}). Click Save Pharmacy Location to publish on your website.`,
              });
              void reverseGeocode(dLat, dLng);
            });
            markerRef.current = m;
          }
        }
      }
      if (shouldReverseGeocode) {
        void reverseGeocode(cleanLat, cleanLng);
      }
    },
    [reverseGeocode]
  );

  // Load Leaflet once when interactive picker tab is visible
  useEffect(() => {
    if (previewTab !== "picker") return;
    let alive = true;
    ensureLeafletLoaded()
      .then(() => {
        if (alive) {
          setLeafletReady(true);
          setLeafletFailed(false);
        }
      })
      .catch(() => {
        if (alive) {
          setLeafletFailed(true);
          setPreviewTab("google");
        }
      });
    return () => {
      alive = false;
    };
  }, [previewTab]);

  // Initialize Leaflet interactive map instance
  useEffect(() => {
    if (previewTab !== "picker" || !leafletReady || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const initialCenter: [number, number] = parsedCoords
      ? [parsedCoords.lat, parsedCoords.lng]
      : PAKISTAN_DEFAULT_CENTER;
    const initialZoom = parsedCoords ? 17 : 12;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const cfg = TILE_CONFIG[tileMode];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(map);

    if (parsedCoords) {
      const m = L.marker([parsedCoords.lat, parsedCoords.lng], {
        draggable: true,
        icon: buildPharmacyMarkerIcon(L),
      }).addTo(map);
      m.on("dragend", () => {
        const pos = m.getLatLng();
        const dLat = Number(pos.lat.toFixed(6));
        const dLng = Number(pos.lng.toFixed(6));
        setLatInput(String(dLat));
        setLngInput(String(dLng));
        setStatusNote({
          tone: "success",
          text: `Pin moved to (${dLat}, ${dLng}). Click Save Pharmacy Location to publish on your website.`,
        });
        void reverseGeocode(dLat, dLng);
      });
      markerRef.current = m;
    }

    // Tap / Click anywhere on the map to place the exact pharmacy pin!
    map.on("click", (e: any) => {
      const cLat = Number(e.latlng.lat.toFixed(6));
      const cLng = Number(e.latlng.lng.toFixed(6));
      setLatInput(String(cLat));
      setLngInput(String(cLng));
      if (markerRef.current) {
        markerRef.current.setLatLng([cLat, cLng]);
      } else {
        const m = L.marker([cLat, cLng], {
          draggable: true,
          icon: buildPharmacyMarkerIcon(L),
        }).addTo(map);
        m.on("dragend", () => {
          const pos = m.getLatLng();
          const dLat = Number(pos.lat.toFixed(6));
          const dLng = Number(pos.lng.toFixed(6));
          setLatInput(String(dLat));
          setLngInput(String(dLng));
          setStatusNote({
            tone: "success",
            text: `Pin moved to (${dLat}, ${dLng}). Click Save Pharmacy Location to publish on your website.`,
          });
          void reverseGeocode(dLat, dLng);
        });
        markerRef.current = m;
      }
      setStatusNote({
        tone: "success",
        text: `Exact pin placed at (${cLat}, ${cLng}). Drag the pin to fine-tune, then click Save Pharmacy Location.`,
      });
      void reverseGeocode(cLat, cLng);
    });

    mapInstanceRef.current = map;

    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 180);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTab, leafletReady]);

  // Switch Street / Satellite tiles without destroying the map
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletReady) return;
    const L = (window as any).L;
    if (!L) return;
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_CONFIG[tileMode];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
  }, [tileMode, leafletReady]);

  // Keep Leaflet marker synced when user types lat/lng manually or clears pin
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletReady) return;
    const L = (window as any).L;
    if (!L) return;

    if (!parsedCoords) {
      if (markerRef.current) {
        mapInstanceRef.current.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }

    if (markerRef.current) {
      const cur = markerRef.current.getLatLng();
      if (
        Math.abs(cur.lat - parsedCoords.lat) > 0.00001 ||
        Math.abs(cur.lng - parsedCoords.lng) > 0.00001
      ) {
        markerRef.current.setLatLng([parsedCoords.lat, parsedCoords.lng]);
        mapInstanceRef.current.setView([parsedCoords.lat, parsedCoords.lng], Math.max(mapInstanceRef.current.getZoom(), 16));
      }
    } else {
      const m = L.marker([parsedCoords.lat, parsedCoords.lng], {
        draggable: true,
        icon: buildPharmacyMarkerIcon(L),
      }).addTo(mapInstanceRef.current);
      m.on("dragend", () => {
        const pos = m.getLatLng();
        const dLat = Number(pos.lat.toFixed(6));
        const dLng = Number(pos.lng.toFixed(6));
        setLatInput(String(dLat));
        setLngInput(String(dLng));
        void reverseGeocode(dLat, dLng);
      });
      markerRef.current = m;
      mapInstanceRef.current.setView([parsedCoords.lat, parsedCoords.lng], 17);
    }
  }, [parsedCoords, leafletReady, reverseGeocode]);

  // Check browser geolocation permission state once (non-blocking)
  useEffect(() => {
    if (typeof navigator === "undefined" || !(navigator as any).permissions?.query) return;
    let alive = true;
    (navigator as any).permissions
      .query({ name: "geolocation" })
      .then((perm: any) => {
        if (!alive) return;
        setGpsPermissionBlocked(perm?.state === "denied");
        if (perm) {
          perm.onchange = () => {
            if (alive) setGpsPermissionBlocked(perm.state === "denied");
          };
        }
      })
      .catch(() => {
        /* Safari / unsupported browsers */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleCenterOnMyCity() {
    setLocatingCity(true);
    setStatusNote({
      tone: "info",
      text: "Detecting your city area on the interactive map…",
    });
    try {
      const res = await callLocationHelper({ action: "approx_ip_location" });
      if (res.ok && res.data?.latitude && res.data?.longitude) {
        const lat = Number(res.data.latitude);
        const lng = Number(res.data.longitude);
        const detectedCity = String(res.data.city || "").trim();
        setPreviewTab("picker");
        setTileMode("satellite");
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lng], 14, { animate: true });
        }
        if (detectedCity && (!city.trim() || city.trim().toLowerCase() === "pakistan")) {
          setCity(detectedCity);
        }
        setStatusNote({
          tone: "info",
          text: `Map centered near ${
            detectedCity || "your area"
          }. Zoom in on Satellite view and tap/click directly on your pharmacy building to set the exact pin!`,
        });
      } else {
        setStatusNote({
          tone: "error",
          text: "Could not detect city automatically. Search your area above or tap directly on the map.",
        });
      }
    } catch {
      setStatusNote({
        tone: "error",
        text: "Could not detect city automatically. Search your area above or tap directly on the map.",
      });
    } finally {
      setLocatingCity(false);
    }
  }

  function handleFetchCurrentGps() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setGpsPermissionBlocked(true);
      setStatusNote({
        tone: "error",
        text: "Browser GPS requires HTTPS. Tap your pharmacy directly on the Interactive Map below or paste your Google Maps share link.",
      });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsPermissionBlocked(true);
      setStatusNote({
        tone: "error",
        text: "Browser GPS is unavailable on this device. Tap your shop on the Interactive Map or paste your Google Maps share link below.",
      });
      return;
    }

    setFetchingGps(true);
    setStatusNote({
      tone: "info",
      text: "Requesting device location… (Accept the browser prompt if shown)",
    });

    const onSuccess = (pos: GeolocationPosition) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      setFetchingGps(false);
      setGpsPermissionBlocked(false);
      placePinOnMap(lat, lng, 17, true);
      setStatusNote({
        tone: "success",
        text: `Live location locked (${lat}, ${lng} · ±${Math.round(
          pos.coords.accuracy || 20
        )}m). Fine-tune the pin on the map if needed, then click Save Pharmacy Location.`,
      });
    };

    const onFinalError = (err: GeolocationPositionError) => {
      setFetchingGps(false);
      if (err.code === err.PERMISSION_DENIED) {
        setGpsPermissionBlocked(true);
        setStatusNote({
          tone: "error",
          text: "Your browser or Windows/Phone settings are blocking GPS without showing a popup. No problem — tap your shop directly on the Interactive Map (Satellite view), paste any Google Maps share link, or allow Location in your browser address bar.",
        });
      } else if (err.code === err.TIMEOUT) {
        setStatusNote({
          tone: "error",
          text: "GPS timed out on this device. Tap your pharmacy directly on the Interactive Map or paste your Google Maps share link below.",
        });
      } else {
        setStatusNote({
          tone: "error",
          text: "Could not read GPS from this device. Tap your pharmacy on the Interactive Map or paste your Google Maps share link below.",
        });
      }
    };

    // First try high-accuracy GPS; if hardware GPS unavailable/times out on desktop, auto-fallback to Wi-Fi/network accuracy!
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onFinalError(err);
          return;
        }
        navigator.geolocation.getCurrentPosition(onSuccess, onFinalError, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  async function resolveAndApplyMapsInput(rawValue?: string) {
    const text = (rawValue ?? mapsPasteInput).trim();
    if (!text) return;

    // 1. Instant local parse if full URL or raw coordinates
    const localParsed = parseCoordinatesFromInput(text);
    if (localParsed) {
      placePinOnMap(localParsed.lat, localParsed.lng, 17, true);
      setMapsPasteInput("");
      setStatusNote({
        tone: "success",
        text: `Exact pin applied (${localParsed.lat}, ${localParsed.lng}). Verify on the map and click Save Pharmacy Location.`,
      });
      return;
    }

    // 2. Server-side resolution for short share links (maps.app.goo.gl, goo.gl/maps, share.google, g.co, etc.)
    if (looksLikeMapLink(text)) {
      setResolvingLink(true);
      setStatusNote({
        tone: "info",
        text: "Resolving Google Maps share link and extracting exact pin coordinates…",
      });
      try {
        const res = await callLocationHelper({
          action: "resolve_maps_link",
          url: text,
        });
        if (res.ok && typeof res.data?.latitude === "number" && typeof res.data?.longitude === "number") {
          const lat = Number(res.data.latitude);
          const lng = Number(res.data.longitude);
          if (res.data.address_hint) {
            setAddressLine((curr) => (curr.trim() ? curr : String(res.data.address_hint)));
          }
          if (res.data.city_hint) {
            setCity((curr) =>
              !curr.trim() || curr.trim().toLowerCase() === "pakistan"
                ? String(res.data.city_hint)
                : curr
            );
          }
          placePinOnMap(lat, lng, 17, !res.data.address_hint);
          setMapsPasteInput("");
          setStatusNote({
            tone: "success",
            text: `Google Maps link resolved${
              res.data.place_name ? ` (${res.data.place_name})` : ""
            } → exact pin (${lat.toFixed(6)}, ${lng.toFixed(
              6
            )}). Verify on the map and click Save Pharmacy Location.`,
          });
        } else {
          setStatusNote({
            tone: "error",
            text:
              res.data?.message ||
              res.data?.error ||
              "Could not extract coordinates from that link. Try sharing the pin from Google Maps or tap your shop directly on the map.",
          });
        }
      } catch {
        setStatusNote({
          tone: "error",
          text: "Could not resolve that share link right now. Tap your pharmacy directly on the Interactive Map or paste raw coordinates.",
        });
      } finally {
        setResolvingLink(false);
      }
      return;
    }

    setStatusNote({
      tone: "error",
      text: "Paste a Google Maps share link (e.g. https://maps.app.goo.gl/...), full Maps URL, or coordinates like 31.5204, 74.3587.",
    });
  }

  async function handleSearchPlaces(customQuery?: string) {
    const q = (
      customQuery ??
      (placeSearchInput.trim() || [addressLine, city].filter((s) => s.trim()).join(", "))
    ).trim();
    if (!q) {
      setStatusNote({
        tone: "error",
        text: "Type a market, road, sector, or city name to search on the map.",
      });
      return;
    }

    setSearchingPlaces(true);
    setPlaceSuggestions([]);
    try {
      const res = await callLocationHelper({
        action: "search_place",
        query: q,
      });
      const list: PlaceSuggestion[] = Array.isArray(res.data?.results) ? res.data.results : [];
      if (list.length === 1) {
        const hit = list[0];
        setPreviewTab("picker");
        placePinOnMap(hit.latitude, hit.longitude, 16, false);
        if (hit.city && (!city.trim() || city.trim().toLowerCase() === "pakistan")) {
          setCity(hit.city);
        }
        setStatusNote({
          tone: "success",
          text: `Located "${hit.short_name}". Switch to Satellite view and drag the pin right onto your shop roof, then click Save!`,
        });
      } else if (list.length > 1) {
        setPlaceSuggestions(list);
        setStatusNote({
          tone: "info",
          text: `Found ${list.length} matching areas — pick the closest one below to jump the map there.`,
        });
      } else {
        setStatusNote({
          tone: "error",
          text: `No map match for "${q}". Try a nearby main road or sector name (e.g. "Gulberg Lahore") and then tap your exact shop on the map.`,
        });
      }
    } catch {
      setStatusNote({
        tone: "error",
        text: "Area search failed. Tap directly on the Interactive Map or paste your Google Maps share link.",
      });
    } finally {
      setSearchingPlaces(false);
    }
  }

  function handleSelectSuggestion(item: PlaceSuggestion) {
    setPlaceSuggestions([]);
    setPlaceSearchInput(item.short_name);
    setPreviewTab("picker");
    placePinOnMap(item.latitude, item.longitude, 16, false);
    if (item.city && (!city.trim() || city.trim().toLowerCase() === "pakistan")) {
      setCity(item.city);
    }
    setStatusNote({
      tone: "success",
      text: `Jumped to "${item.short_name}". Tap or drag the green pin onto your exact pharmacy building, then click Save Pharmacy Location.`,
    });
  }

  async function handleSaveClick() {
    if ((latInput.trim() || lngInput.trim()) && !parsedCoords) {
      setStatusNote({
        tone: "error",
        text: "Please enter valid latitude (-90 to 90) and longitude (-180 to 180) numbers, or clear both.",
      });
      return;
    }

    await onSave({
      address_line: addressLine.trim(),
      city: city.trim() || "Lahore",
      contact_phone: contactPhone.trim(),
      whatsapp_phone: whatsappPhone.trim(),
      latitude: parsedCoords ? parsedCoords.lat : null,
      longitude: parsedCoords ? parsedCoords.lng : null,
      clear_coordinates: !parsedCoords,
    });
    setStatusNote({
      tone: "success",
      text: "Saved! Your live pharmacy website map & Location page have been updated immediately.",
    });
    onNotify("Pharmacy map location updated on website");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
              <MapPin className="w-4 h-4" />
            </span>
            <h2 className="text-base font-extrabold text-slate-900">
              Exact Pharmacy Map Location &amp; Google Directions
            </h2>
            {parsedCoords ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 className="w-3 h-3" />
                Exact GPS Pin Set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                <Compass className="w-3 h-3" />
                Set Pin for Exact Map
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Set your exact shop pin using <strong>any</strong> method: paste a Google Maps share
            link (including <code className="font-mono text-[11px]">maps.app.goo.gl</code>), click
            directly on the interactive Street/Satellite map, or use device GPS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleFetchCurrentGps}
            disabled={fetchingGps || saving}
            className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
          >
            {fetchingGps ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LocateFixed className="w-4 h-4" />
            )}
            <span>{fetchingGps ? "Fetching GPS…" : "Fetch My Location"}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCenterOnMyCity()}
            disabled={locatingCity || saving}
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-60 text-slate-700 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
            title="Jump map near your current city without browser GPS permission"
          >
            {locatingCity ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>Center My City</span>
          </button>
        </div>
      </div>

      {/* Status Banner */}
      {statusNote && (
        <div
          className={`rounded-xl px-3.5 py-2.5 text-xs font-medium border ${
            statusNote.tone === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : statusNote.tone === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-sky-50 border-sky-200 text-sky-800"
          }`}
        >
          {statusNote.text}
        </div>
      )}

      {/* Helpful Zero-Friction Fallback Card when Browser GPS Permission is Blocked */}
      {gpsPermissionBlocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <p className="font-bold text-amber-900">
                Browser GPS is blocked — 2 faster ways to set your exact pin right now:
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11.5px] text-amber-900/90">
                <li>
                  <strong>Option A (Easiest):</strong> Open Google Maps on your phone/PC → tap{" "}
                  <strong>Share → Copy link</strong> (<code className="font-mono">maps.app.goo.gl/...</code>) and paste it in the box below.
                </li>
                <li>
                  <strong>Option B (Direct Pin):</strong> Click <strong>Center My City</strong> or
                  search your area on the map → switch to <strong>Satellite</strong> → tap directly
                  on your pharmacy roof.
                </li>
                <li>
                  <strong>To re-enable browser GPS:</strong> Click the lock/settings icon on the
                  left of your browser address bar → <strong>Site settings → Location → Allow</strong>,
                  then reload.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 2-Column Layout: Left Controls | Right Interactive Map Picker & Google Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-6 space-y-3.5">
          {/* Quick Paste ANY Google Maps Share Link (Short OR Full OR Raw Coords) */}
          <div className="rounded-xl bg-emerald-50/50 border border-emerald-200/80 p-3.5 space-y-2">
            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-900">
              <Link2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Paste Google Maps Share Link (Short or Full)</span>
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={mapsPasteInput}
                onChange={(e) => setMapsPasteInput(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted && (looksLikeMapLink(pasted) || parseCoordinatesFromInput(pasted))) {
                    e.preventDefault();
                    setMapsPasteInput(pasted);
                    void resolveAndApplyMapsInput(pasted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void resolveAndApplyMapsInput();
                  }
                }}
                placeholder="Paste https://maps.app.goo.gl/... or Google Maps link or 31.5204, 74.3587"
                className="flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
              />
              <button
                type="button"
                onClick={() => void resolveAndApplyMapsInput()}
                disabled={!mapsPasteInput.trim() || resolvingLink}
                className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold shrink-0 inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                {resolvingLink ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Resolving…</span>
                  </>
                ) : (
                  <span>Apply Pin</span>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-600">
              Supports <code className="font-mono text-[10.5px]">maps.app.goo.gl</code>,{" "}
              <code className="font-mono text-[10.5px]">goo.gl/maps</code>,{" "}
              <code className="font-mono text-[10.5px]">share.google</code>, WhatsApp shared pins,
              full Google Maps URLs, or coordinates.
            </p>
          </div>

          {/* Street Address + City */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-8">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Pharmacy Street Address
              </label>
              <input
                type="text"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                placeholder="Shop #, Plaza, Road / Sector"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Lahore"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void handleSearchPlaces([addressLine, city].filter((s) => s.trim()).join(", "))
              }
              disabled={searchingPlaces || (!addressLine.trim() && !city.trim())}
              className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              {searchingPlaces ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{searchingPlaces ? "Searching…" : "Find Address on Map"}</span>
            </button>
            {parsedCoords && (
              <button
                type="button"
                onClick={() => {
                  setLatInput("");
                  setLngInput("");
                  setStatusNote({
                    tone: "info",
                    text: "GPS pin cleared. Click Save Pharmacy Location to use address-only map.",
                  });
                }}
                className="min-h-[36px] px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Pin</span>
              </button>
            )}
          </div>

          {/* Exact Coordinates */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Latitude (GPS)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                placeholder="e.g. 31.520400"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Longitude (GPS)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={lngInput}
                onChange={(e) => setLngInput(e.target.value)}
                placeholder="e.g. 74.358700"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Contact Phone & WhatsApp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Counter Phone
              </label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="0300-1234567"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                WhatsApp Number
              </label>
              <input
                type="text"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="923001234567"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="pt-1 flex flex-wrap items-center gap-2.5">
            <PortalActionButton
              variant="primary"
              size="md"
              loading={saving}
              loadingText="Saving Location…"
              onClick={handleSaveClick}
            >
              Save Pharmacy Location
            </PortalActionButton>
          </div>
        </div>

        {/* Right Column: Interactive Click-to-Pin Map Picker + Google Maps Preview */}
        <div className="lg:col-span-6 space-y-2.5">
          {/* Map Search Bar (finds any area/market/road in Pakistan) */}
          <div className="relative">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={placeSearchInput}
                  onChange={(e) => setPlaceSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSearchPlaces();
                    }
                  }}
                  placeholder="Search area, road, market or city (e.g. Gulberg 3 Lahore)…"
                  className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSearchPlaces()}
                disabled={searchingPlaces || !placeSearchInput.trim()}
                className="min-h-[36px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-45 text-white text-xs font-bold shrink-0 inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                {searchingPlaces ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
              </button>
            </div>

            {placeSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[450] rounded-xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {placeSuggestions.map((item, idx) => (
                  <button
                    key={`${item.latitude}-${item.longitude}-${idx}`}
                    type="button"
                    onClick={() => handleSelectSuggestion(item)}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition flex items-start gap-2 cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {item.short_name}
                      </div>
                      <div className="text-[10.5px] text-slate-500 line-clamp-1">
                        {item.display_name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 shadow-xs">
            {/* Map Mode & Layer Switcher Header */}
            <div className="px-3 py-2 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="inline-flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                <button
                  type="button"
                  data-allow-rapid-click="true"
                  disabled={leafletFailed}
                  onClick={() => setPreviewTab("picker")}
                  className={`px-2.5 py-1 rounded-md font-bold inline-flex items-center gap-1 transition cursor-pointer ${
                    previewTab === "picker"
                      ? "bg-emerald-600 text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <MapIcon className="w-3 h-3" />
                  <span>Pin Picker</span>
                </button>
                <button
                  type="button"
                  data-allow-rapid-click="true"
                  onClick={() => setPreviewTab("google")}
                  className={`px-2.5 py-1 rounded-md font-bold inline-flex items-center gap-1 transition cursor-pointer ${
                    previewTab === "google"
                      ? "bg-emerald-600 text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  <span>Google Preview</span>
                </button>
              </div>

              {previewTab === "picker" ? (
                <div className="inline-flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    data-allow-rapid-click="true"
                    onClick={() => setTileMode("street")}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition cursor-pointer ${
                      tileMode === "street"
                        ? "bg-white text-slate-900"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    Street
                  </button>
                  <button
                    type="button"
                    data-allow-rapid-click="true"
                    onClick={() => setTileMode("satellite")}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold inline-flex items-center gap-1 transition cursor-pointer ${
                      tileMode === "satellite"
                        ? "bg-white text-slate-900"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <Layers className="w-2.5 h-2.5" />
                    <span>Satellite</span>
                  </button>
                </div>
              ) : (
                <span className="font-mono text-emerald-300 text-[10.5px] shrink-0">
                  {parsedCoords
                    ? `${parsedCoords.lat}, ${parsedCoords.lng}`
                    : city || "Pakistan"}
                </span>
              )}
            </div>

            {/* Map Viewport */}
            <div className="relative w-full h-[290px] sm:h-[320px] bg-slate-100">
              {previewTab === "picker" ? (
                <>
                  <div ref={mapContainerRef} className="w-full h-full z-0" />
                  {!leafletReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-600 text-xs font-semibold gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                      <span>Loading interactive map…</span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute top-2.5 left-2.5 right-2.5 z-[400] flex justify-center">
                    <span className="rounded-full bg-slate-900/85 text-white px-3 py-1 text-[10.5px] font-bold shadow-md backdrop-blur-xs">
                      Tap anywhere on map or drag the green pin onto your pharmacy
                    </span>
                  </div>
                </>
              ) : (
                <iframe
                  key={embedMapUrl}
                  title={`Map preview for ${pharmacyName}`}
                  src={embedMapUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="w-full h-full border-0"
                  allowFullScreen
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={googleDirectionsUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-[40px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              <span>Test Directions</span>
            </a>
            <a
              href={googleMapsOpenUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:border-slate-400 text-slate-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition"
            >
              <span>Open Google Maps</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
