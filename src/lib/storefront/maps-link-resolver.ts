/**
 * Server-Side Google Maps / Share Link Resolver & Geocoding Helpers
 *
 * Safely resolves shortened mobile/desktop share links such as:
 * - https://maps.app.goo.gl/xxxx
 * - https://goo.gl/maps/xxxx
 * - https://g.co/kgs/xxxx
 * - https://share.google/xxxx
 * - Full Google Maps / Apple Maps / OpenStreetMap URLs (including %2C, !3d!4d, @lat,lng, /search/, /dir/)
 * - WhatsApp / Android share text containing a map link
 * - Raw decimal or DMS coordinates
 *
 * Includes strict host allowlisting to prevent SSRF.
 */

export interface ResolvedMapLocation {
  ok: true;
  latitude: number;
  longitude: number;
  resolved_url: string | null;
  place_name: string | null;
  address_hint: string | null;
  city_hint: string | null;
  source: "direct" | "redirect_url" | "html_embed" | "place_geocode";
}

export interface PlaceSearchResult {
  display_name: string;
  short_name: string;
  city: string;
  latitude: number;
  longitude: number;
}

const ALLOWED_MAP_HOST_SUFFIXES = [
  "maps.app.goo.gl",
  "goo.gl",
  "g.co",
  "share.google",
  "google.com",
  "google.com.pk",
  "google.co.uk",
  "google.ae",
  "consent.google.com",
  "maps.apple.com",
  "osm.org",
  "openstreetmap.org",
  "waze.com",
  "bing.com",
];

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NOMINATIM_USER_AGENT = "AivraSolPharmacyPortal/1.0 (https://www.aivrasol.com)";

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  );
}

function roundCoord(val: number): number {
  return Number(val.toFixed(6));
}

function isAllowedMapHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) {
    return false;
  }
  return ALLOWED_MAP_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

/**
 * Extracts first http(s) URL from pasted text (handles WhatsApp / Android share text like
 * "AR Pharmacy\nhttps://maps.app.goo.gl/abc123").
 */
export function extractFirstUrlFromText(raw: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const explicit = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (explicit?.[0]) {
    return explicit[0].replace(/[),.;]+$/, "");
  }

  // Handle schemeless pasted share links like "maps.app.goo.gl/abc123"
  const schemeless = text.match(
    /(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com|www\.google\.com\/maps|g\.co\/kgs|share\.google)\/[^\s"'<>]+/i
  );
  if (schemeless?.[0]) {
    return `https://${schemeless[0].replace(/[),.;]+$/, "")}`;
  }

  return null;
}

/**
 * Converts DMS coordinates like 31°31'13.4"N 74°21'31.5"E to decimal degrees.
 */
function parseDmsCoordinates(input: string): { lat: number; lng: number } | null {
  const re =
    /(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NS])[\s,]+(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([EW])/i;
  const m = input.match(re);
  if (!m) return null;

  let lat = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  let lng = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;
  if (m[4].toUpperCase() === "S") lat = -lat;
  if (m[8].toUpperCase() === "W") lng = -lng;

  if (!isValidLatLng(lat, lng)) return null;
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

/**
 * Extracts exact latitude & longitude from a URL, HTML snippet, or raw text.
 * Priority order prefers exact place pins (!3d!4d) over viewport center (@lat,lng).
 */
export function extractCoordsFromUrlOrText(
  raw: string
): { lat: number; lng: number } | null {
  if (!raw) return null;

  // Test both raw string and URI-decoded variant (handles %2C, %213d, etc.)
  const variants = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) variants.push(decoded);
  } catch {
    // Ignore malformed percent encodings
  }

  const patterns: RegExp[] = [
    // Exact Google Maps pin marker in data param (!3dLAT!4dLNG)
    /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/i,
    // Google Maps staticmap / og:image center=LAT,LNG
    /[?&]center=(-?\d{1,2}\.\d{3,})(?:%2C|,)\s*(-?\d{1,3}\.\d{3,})/i,
    // Query params q=, query=, ll=, sll=, destination=, daddr=, mlat=/mlon=
    /[?&](?:q|query|ll|sll|destination|daddr|origin|pb_ll)=(?:loc:)?(-?\d{1,2}\.\d{2,})(?:%2C|,|\s|\+)+(-?\d{1,3}\.\d{2,})/i,
    // Path search/dir coordinates: /maps/search/31.5204,+74.3587 or /maps/dir//31.5204,74.3587
    /\/(?:search|place|dir\/[^/]*)\/(-?\d{1,2}\.\d{3,})(?:%2C|,|\+)+(-?\d{1,3}\.\d{3,})/i,
    // Viewport center @LAT,LNG,17z
    /@(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    // OpenStreetMap #map=17/LAT/LNG
    /#map=\d+\/(-?\d{1,2}\.\d{3,})\/(-?\d{1,3}\.\d{3,})/i,
    // Embedded Google APP_INITIALIZATION_STATE arrays: [null,null,31.5204,74.3587]
    /\[null,\s*null,\s*(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})\]/,
    // Raw decimal coordinate pair anywhere on its own line
    /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
  ];

  for (const text of variants) {
    const dms = parseDmsCoordinates(text);
    if (dms) return dms;

    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1] && m?.[2]) {
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (isValidLatLng(lat, lng)) {
          return { lat: roundCoord(lat), lng: roundCoord(lng) };
        }
      }
    }
  }

  // OpenStreetMap mlat= & mlon=
  const mlat = raw.match(/[?&]mlat=(-?\d{1,2}\.\d+)/i);
  const mlon = raw.match(/[?&]mlon=(-?\d{1,3}\.\d+)/i);
  if (mlat?.[1] && mlon?.[1]) {
    const lat = Number(mlat[1]);
    const lng = Number(mlon[1]);
    if (isValidLatLng(lat, lng)) {
      return { lat: roundCoord(lat), lng: roundCoord(lng) };
    }
  }

  return null;
}

function extractPlaceNameFromGoogleUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placeMatch?.[1]) {
      const cleaned = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
      if (cleaned && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(cleaned)) {
        return cleaned;
      }
    }
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    if (q && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q.trim())) {
      return q.trim();
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1]
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    }
  }
  return null;
}

function sanitizeAddressHint(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (
    /find local businesses|view maps and get driving directions|google maps/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function parsePlaceTitleAndAddress(rawTitle: string | null): {
  placeName: string | null;
  addressHint: string | null;
} {
  if (!rawTitle) return { placeName: null, addressHint: null };
  const cleaned = rawTitle
    .replace(/\s*[-–|·]\s*Google Maps\s*$/i, "")
    .replace(/^Google Maps$/i, "")
    .trim();
  if (!cleaned) return { placeName: null, addressHint: null };

  const parts = cleaned.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      placeName: parts[0],
      addressHint: sanitizeAddressHint(parts.slice(1).join(", ")),
    };
  }
  return { placeName: cleaned, addressHint: null };
}

export async function searchPlacesInPakistan(
  rawQuery: string,
  limit = 5
): Promise<PlaceSearchResult[]> {
  const query = (rawQuery || "").trim();
  if (!query || query.length < 2) return [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${Math.min(
      8,
      Math.max(1, limit)
    )}&countrycodes=pk&accept-language=en&q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const items = await res.json();
    if (!Array.isArray(items)) return [];

    return items
      .map((item: any): PlaceSearchResult | null => {
        const lat = Number(item?.lat);
        const lng = Number(item?.lon);
        if (!isValidLatLng(lat, lng)) return null;
        const addr = item?.address || {};
        const city =
          addr.city ||
          addr.town ||
          addr.village ||
          addr.county ||
          addr.state_district ||
          addr.state ||
          "";
        const displayName = String(item?.display_name || "").trim();
        const shortName =
          String(item?.name || "").trim() ||
          displayName.split(",").slice(0, 3).join(", ").trim();
        return {
          display_name: displayName,
          short_name: shortName,
          city: String(city).trim(),
          latitude: roundCoord(lat),
          longitude: roundCoord(lng),
        };
      })
      .filter((x): x is PlaceSearchResult => x !== null);
  } catch {
    return [];
  }
}

export async function reverseGeocodeCoords(
  lat: number,
  lng: number
): Promise<{ address_line: string; city: string; display_name: string } | null> {
  if (!isValidLatLng(lat, lng)) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      String(lat)
    )}&lon=${encodeURIComponent(String(lng))}&accept-language=en`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const geo = await res.json();
    const addr = geo?.address || {};
    const city = String(
      addr.city || addr.town || addr.village || addr.county || addr.state_district || ""
    ).trim();
    const streetParts = [
      addr.house_number,
      addr.road || addr.pedestrian || addr.neighbourhood || addr.suburb,
      addr.suburb && addr.road ? addr.suburb : "",
    ].filter(Boolean);
    const displayName = typeof geo?.display_name === "string" ? geo.display_name : "";
    const addressLine =
      streetParts.join(", ") ||
      displayName
        .split(",")
        .slice(0, 3)
        .join(",")
        .trim();
    return {
      address_line: addressLine,
      city,
      display_name: displayName,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves ANY Google Maps / short share link or coordinate input server-side.
 */
export async function resolveMapsShareLink(
  rawInput: string
): Promise<ResolvedMapLocation | { ok: false; error: string }> {
  const input = (rawInput || "").trim();
  if (!input) {
    return { ok: false, error: "Please paste a Google Maps share link or coordinates." };
  }

  // 1. Direct extraction (already contains exact coordinates!)
  const direct = extractCoordsFromUrlOrText(input);
  if (direct) {
    const directUrl = extractFirstUrlFromText(input);
    const placeName = directUrl ? extractPlaceNameFromGoogleUrl(directUrl) : null;
    return {
      ok: true,
      latitude: direct.lat,
      longitude: direct.lng,
      resolved_url: directUrl,
      place_name: placeName,
      address_hint: null,
      city_hint: null,
      source: "direct",
    };
  }

  // 2. Extract URL from pasted text
  const startUrlStr = extractFirstUrlFromText(input);
  if (!startUrlStr) {
    return {
      ok: false,
      error:
        "No map link or coordinates found. Paste a Google Maps share link (maps.app.goo.gl/...), full Maps URL, or coordinates like 31.5204, 74.3587.",
    };
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(startUrlStr);
  } catch {
    return { ok: false, error: "That link does not look like a valid URL." };
  }

  if (currentUrl.protocol !== "https:" && currentUrl.protocol !== "http:") {
    return { ok: false, error: "Only http/https map links are supported." };
  }
  if (!isAllowedMapHost(currentUrl.hostname)) {
    return {
      ok: false,
      error:
        "Please paste a link from Google Maps (maps.app.goo.gl, google.com/maps), Apple Maps, or OpenStreetMap.",
    };
  }

  // 3. Follow redirects manually (up to 8 hops) so we catch consent.google.com?continue=...
  //    AND extract coordinates the moment they appear in ANY Location header!
  let lastHtml = "";
  let finalUrlStr = currentUrl.toString();
  let placeHint: string | null = extractPlaceNameFromGoogleUrl(finalUrlStr);

  for (let hop = 0; hop < 8; hop++) {
    let urlObj: URL;
    try {
      urlObj = new URL(finalUrlStr);
    } catch {
      break;
    }

    // Handle Google EU/datacenter consent interstitial redirect immediately
    if (urlObj.hostname.toLowerCase().includes("consent.google.")) {
      const cont = urlObj.searchParams.get("continue");
      if (cont) {
        finalUrlStr = cont;
        const contCoords = extractCoordsFromUrlOrText(finalUrlStr);
        if (contCoords) {
          return {
            ok: true,
            latitude: contCoords.lat,
            longitude: contCoords.lng,
            resolved_url: finalUrlStr,
            place_name: extractPlaceNameFromGoogleUrl(finalUrlStr) || placeHint,
            address_hint: null,
            city_hint: null,
            source: "redirect_url",
          };
        }
        placeHint = extractPlaceNameFromGoogleUrl(finalUrlStr) || placeHint;
        continue;
      }
    }

    if (!isAllowedMapHost(urlObj.hostname)) {
      break;
    }

    let res: Response;
    try {
      res = await fetch(finalUrlStr, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb.20230531-04-p0.en+FX+999; SOCS=CAI",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(9000),
      });
    } catch {
      break;
    }

    const loc = res.headers.get("location");
    if (loc && res.status >= 300 && res.status < 400) {
      try {
        finalUrlStr = new URL(loc, finalUrlStr).toString();
      } catch {
        break;
      }

      const hopCoords = extractCoordsFromUrlOrText(finalUrlStr);
      if (hopCoords) {
        return {
          ok: true,
          latitude: hopCoords.lat,
          longitude: hopCoords.lng,
          resolved_url: finalUrlStr,
          place_name: extractPlaceNameFromGoogleUrl(finalUrlStr) || placeHint,
          address_hint: null,
          city_hint: null,
          source: "redirect_url",
        };
      }
      placeHint = extractPlaceNameFromGoogleUrl(finalUrlStr) || placeHint;
      continue;
    }

    // Reached final HTML response — read capped chunk and inspect meta tags / embedded state
    try {
      const text = await res.text();
      lastHtml = text.slice(0, 400_000);
    } catch {
      lastHtml = "";
    }
    break;
  }

  // 4. Inspect final URL one more time
  const finalUrlCoords = extractCoordsFromUrlOrText(finalUrlStr);
  if (finalUrlCoords) {
    return {
      ok: true,
      latitude: finalUrlCoords.lat,
      longitude: finalUrlCoords.lng,
      resolved_url: finalUrlStr,
      place_name: extractPlaceNameFromGoogleUrl(finalUrlStr) || placeHint,
      address_hint: null,
      city_hint: null,
      source: "redirect_url",
    };
  }

  // 5. Inspect HTML meta tags (og:image staticmap center, og:url, canonical, explicit !3d!4d pins)
  if (lastHtml) {
    const ogUrl = extractMetaContent(lastHtml, "og:url");
    const ogImage =
      extractMetaContent(lastHtml, "og:image") || extractMetaContent(lastHtml, "image");
    const ogTitle =
      extractMetaContent(lastHtml, "og:title") || extractMetaContent(lastHtml, "name");
    const ogDesc = sanitizeAddressHint(
      extractMetaContent(lastHtml, "og:description") ||
        extractMetaContent(lastHtml, "description")
    );
    const titleInfo = parsePlaceTitleAndAddress(ogTitle);

    const isResolvedPlaceUrl =
      /\/maps\/place\/|[?&](?:cid|ftid)=/i.test(finalUrlStr) ||
      /maps\.app\.goo\.gl|goo\.gl\/maps|share\.google|g\.co\/kgs/i.test(startUrlStr);

    // 5a. Highest-confidence HTML sources: og:url and pinned og:image staticmap
    const trustedMetaCandidates = [
      ogUrl,
      ogImage && (/markers=/i.test(ogImage) || isResolvedPlaceUrl) ? ogImage : null,
    ].filter(Boolean) as string[];
    for (const candidate of trustedMetaCandidates) {
      const found = extractCoordsFromUrlOrText(candidate);
      if (found) {
        return {
          ok: true,
          latitude: found.lat,
          longitude: found.lng,
          resolved_url: ogUrl || finalUrlStr,
          place_name: titleInfo.placeName || placeHint,
          address_hint: titleInfo.addressHint || ogDesc || null,
          city_hint: null,
          source: "html_embed",
        };
      }
    }

    // 5b. High-confidence pin markers inside HTML (!3dLAT!4dLNG or pinned staticmap)
    const explicitPinMatch =
      lastHtml.match(/!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/i) ||
      (isResolvedPlaceUrl
        ? lastHtml.match(
            /staticmap\?[^"'<>]*center=(-?\d{1,2}\.\d{3,})(?:%2C|,)(-?\d{1,3}\.\d{3,})/i
          )
        : null);
    if (explicitPinMatch?.[1] && explicitPinMatch?.[2]) {
      const lat = Number(explicitPinMatch[1]);
      const lng = Number(explicitPinMatch[2]);
      if (isValidLatLng(lat, lng)) {
        return {
          ok: true,
          latitude: roundCoord(lat),
          longitude: roundCoord(lng),
          resolved_url: ogUrl || finalUrlStr,
          place_name: titleInfo.placeName || placeHint,
          address_hint: titleInfo.addressHint || ogDesc || null,
          city_hint: null,
          source: "html_embed",
        };
      }
    }

    // 5c. Check JS redirect links inside Google Maps share interstitial HTML
    const embeddedMapLink = lastHtml.match(
      /https:\/\/(?:www\.)?google\.com\/maps\/[^\s"'<>\\]+/i
    );
    if (embeddedMapLink?.[0]) {
      const unescaped = embeddedMapLink[0].replace(/\\u0026/g, "&").replace(/\\u003d/g, "=");
      const embeddedCoords = extractCoordsFromUrlOrText(unescaped);
      if (embeddedCoords) {
        return {
          ok: true,
          latitude: embeddedCoords.lat,
          longitude: embeddedCoords.lng,
          resolved_url: unescaped,
          place_name:
            titleInfo.placeName || extractPlaceNameFromGoogleUrl(unescaped) || placeHint,
          address_hint: titleInfo.addressHint || ogDesc || null,
          city_hint: null,
          source: "html_embed",
        };
      }
      placeHint = titleInfo.placeName || extractPlaceNameFromGoogleUrl(unescaped) || placeHint;
    }

    // 5d. APP_INITIALIZATION_STATE fallback ONLY for resolved place/cid/ftid/short-link URLs
    //     (NOT generic `?q=text` search pages whose state holds the server's IP viewport!)
    if (isResolvedPlaceUrl) {
      const stateCoords = extractCoordsFromUrlOrText(lastHtml);
      if (stateCoords) {
        return {
          ok: true,
          latitude: stateCoords.lat,
          longitude: stateCoords.lng,
          resolved_url: ogUrl || finalUrlStr,
          place_name: titleInfo.placeName || placeHint,
          address_hint: titleInfo.addressHint || ogDesc || null,
          city_hint: null,
          source: "html_embed",
        };
      }
    }

    if (titleInfo.placeName && !placeHint) {
      placeHint = titleInfo.addressHint
        ? `${titleInfo.placeName}, ${titleInfo.addressHint}`
        : titleInfo.placeName;
    }
  }

  // 6. Fallback: if the link resolved to a named place/address without raw coords, geocode it
  if (placeHint) {
    const matches = await searchPlacesInPakistan(placeHint, 1);
    if (matches[0]) {
      return {
        ok: true,
        latitude: matches[0].latitude,
        longitude: matches[0].longitude,
        resolved_url: finalUrlStr,
        place_name: matches[0].short_name || placeHint,
        address_hint: matches[0].display_name || null,
        city_hint: matches[0].city || null,
        source: "place_geocode",
      };
    }
  }

  return {
    ok: false,
    error:
      "Could not extract exact pin coordinates from that link. Please tap your pharmacy directly on the interactive map or share a pin from Google Maps.",
  };
}
