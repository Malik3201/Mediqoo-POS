"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Compass,
  ExternalLink,
  Link2,
  Loader2,
  LocateFixed,
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

/**
 * Extracts latitude and longitude from:
 * - Raw coordinates: "31.5204, 74.3587" or "31.5204 74.3587"
 * - Google Maps URLs:
 *   - .../@31.5204,74.3587,17z
 *   - ...?q=31.5204,74.3587 or ?ll=31.5204,74.3587 or ?destination=31.5204,74.3587
 *   - ...!3d31.5204!4d74.3587
 */
export function parseCoordinatesFromInput(
  raw: string
): { lat: number; lng: number } | null {
  const input = (raw || "").trim();
  if (!input) return null;

  const patterns: RegExp[] = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i,
    /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];

  for (const re of patterns) {
    const m = input.match(re);
    if (m?.[1] && m?.[2]) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      ) {
        return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
      }
    }
  }
  return null;
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
  const [fetchingGps, setFetchingGps] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [statusNote, setStatusNote] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

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

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
          String(lat)
        )}&lon=${encodeURIComponent(String(lng))}&accept-language=en`
      );
      if (!res.ok) return;
      const geo = await res.json();
      const addr = geo?.address || {};
      const detectedCity =
        addr.city || addr.town || addr.village || addr.county || addr.state_district || "";
      const streetParts = [
        addr.house_number,
        addr.road || addr.pedestrian || addr.neighbourhood || addr.suburb,
        addr.suburb && addr.road ? addr.suburb : "",
      ].filter(Boolean);
      const detectedStreet =
        streetParts.join(", ") ||
        (typeof geo?.display_name === "string"
          ? geo.display_name.split(",").slice(0, 3).join(",").trim()
          : "");
      if (detectedStreet && !addressLine.trim()) {
        setAddressLine(detectedStreet);
      }
      if (detectedCity && (!city.trim() || city.trim().toLowerCase() === "pakistan")) {
        setCity(detectedCity);
      }
    } catch {
      /* Reverse geocode is best-effort only */
    }
  }

  function handleFetchCurrentGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatusNote({
        tone: "error",
        text: "Browser GPS is unavailable on this device. Paste a Google Maps link or enter coordinates manually.",
      });
      return;
    }

    setFetchingGps(true);
    setStatusNote({
      tone: "info",
      text: "Requesting high-accuracy GPS location from your device…",
    });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setLatInput(String(lat));
        setLngInput(String(lng));
        setFetchingGps(false);
        setStatusNote({
          tone: "success",
          text: `Live GPS locked (${lat}, ${lng} · ±${Math.round(
            pos.coords.accuracy || 15
          )}m). Verify the pin on the map and click Save Pharmacy Location.`,
        });
        void reverseGeocode(lat, lng);
      },
      (err) => {
        setFetchingGps(false);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow location access in your browser address bar, or paste your Google Maps link below."
            : err.code === err.TIMEOUT
            ? "GPS request timed out. Try again near a window, or paste your Google Maps link below."
            : "Could not read device GPS. Paste your Google Maps link or search by street address.";
        setStatusNote({ tone: "error", text: msg });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  async function handleGeocodeAddress() {
    const query = [addressLine, city, "Pakistan"]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    if (!query || query === "Pakistan") {
      setStatusNote({
        tone: "error",
        text: "Enter a street address or city first, then click Find on Map.",
      });
      return;
    }

    setSearchingAddress(true);
    setStatusNote(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=pk&q=${encodeURIComponent(
          query
        )}`
      );
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
        const lat = Number(Number(arr[0].lat).toFixed(6));
        const lng = Number(Number(arr[0].lon).toFixed(6));
        setLatInput(String(lat));
        setLngInput(String(lng));
        setStatusNote({
          tone: "success",
          text: `Found coordinates (${lat}, ${lng}) for "${query}". Confirm on the map preview and click Save.`,
        });
      } else {
        setStatusNote({
          tone: "error",
          text: "No exact match found for that address. Try clicking Fetch Current GPS Location while at your pharmacy, or paste your Google Maps link.",
        });
      }
    } catch {
      setStatusNote({
        tone: "error",
        text: "Address lookup failed. Use Fetch Current GPS Location or paste your Google Maps link.",
      });
    } finally {
      setSearchingAddress(false);
    }
  }

  function handleApplyMapsPaste() {
    const parsed = parseCoordinatesFromInput(mapsPasteInput);
    if (!parsed) {
      setStatusNote({
        tone: "error",
        text: "Could not find coordinates in that text. Paste a full Google Maps URL (with @lat,lng) or raw coordinates like 31.5204, 74.3587.",
      });
      return;
    }
    setLatInput(String(parsed.lat));
    setLngInput(String(parsed.lng));
    setMapsPasteInput("");
    setStatusNote({
      tone: "success",
      text: `Extracted exact pin (${parsed.lat}, ${parsed.lng}). Verify on the map preview and click Save.`,
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
                Set GPS Pin for Exact Map
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            This exact pin powers the live map, Google Maps link, and turn-by-turn directions on
            your website&rsquo;s Landing Page &amp; Locations Page.
          </p>
        </div>

        <button
          type="button"
          onClick={handleFetchCurrentGps}
          disabled={fetchingGps || saving}
          className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs transition shrink-0"
        >
          {fetchingGps ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LocateFixed className="w-4 h-4" />
          )}
          <span>{fetchingGps ? "Fetching GPS…" : "Fetch My Current Location"}</span>
        </button>
      </div>

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

      {/* 2-Column Layout: Left Controls | Right Live Map Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-6 space-y-3.5">
          {/* Quick Paste Google Maps Link / Coords */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <Link2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Quick Set: Paste Google Maps Link or Lat, Lng</span>
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={mapsPasteInput}
                onChange={(e) => setMapsPasteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyMapsPaste();
                  }
                }}
                placeholder="e.g. https://maps.google.com/@31.5204,74.3587,17z or 31.5204, 74.3587"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleApplyMapsPaste}
                disabled={!mapsPasteInput.trim()}
                className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold shrink-0 transition"
              >
                Apply Pin
              </button>
            </div>
          </div>

          {/* Street Address + City + Find on Map */}
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
              onClick={handleGeocodeAddress}
              disabled={searchingAddress || !addressLine.trim()}
              className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              {searchingAddress ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{searchingAddress ? "Searching…" : "Find Address on Map"}</span>
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
                className="min-h-[36px] px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center gap-1.5 transition"
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

        {/* Live Interactive Google Maps Preview */}
        <div className="lg:col-span-6 space-y-2.5">
          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 shadow-xs">
            <div className="px-3.5 py-2 bg-slate-900 text-white flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold truncate">
                Live Website Map Preview · {pharmacyName}
              </span>
              <span className="font-mono text-emerald-300 shrink-0">
                {parsedCoords
                  ? `${parsedCoords.lat}, ${parsedCoords.lng}`
                  : city || "Pakistan"}
              </span>
            </div>
            <div className="relative w-full h-[270px] sm:h-[300px] bg-slate-100">
              <iframe
                key={embedMapUrl}
                title={`Map preview for ${pharmacyName}`}
                src={embedMapUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full border-0"
                allowFullScreen
              />
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
