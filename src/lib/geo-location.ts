import { NextRequest } from "next/server";

export interface PosLocationData {
  lat: number;
  lng: number;
  city: string;
  region?: string;
  country?: string;
  ip?: string;
  isp?: string;
  address?: string;
  source: "pos_address_geo" | "pos_ip_geo" | "vercel_ip" | "address_match" | "admin_manual" | "default_pk";
  updated_at: Date;
}

export interface CityCoordEntry {
  city: string;
  region: string;
  lat: number;
  lng: number;
  aliases?: string[];
}

export const PAKISTAN_CITIES: CityCoordEntry[] = [
  // Federal
  { city: "Islamabad", region: "Islamabad Capital Territory", lat: 33.6844, lng: 73.0479, aliases: ["isb", "g-8", "g-9", "f-6", "f-7", "f-8", "f-10", "f-11", "i-8", "i-9", "i-10", "blue area", "bharakahu", "tarlai"] },

  // Punjab
  { city: "Lahore", region: "Punjab", lat: 31.5204, lng: 74.3587, aliases: ["lhr", "gulberg", "johar town", "model town", "dha lahore", "cantt lahore", "iqbal town", "samanabad", "shadman", "ichhra", "wapda town", "valencia", "bahria town lahore", "raiwind", "shahdara", "baghbanpura", "mugulpura", "township"] },
  { city: "Rawalpindi", region: "Punjab", lat: 33.5651, lng: 73.0169, aliases: ["rwp", "pindi", "saddar rawalpindi", "satellite town", "commercial market", "chaklala", "adiala", "peshawar road", "bahria town rawalpindi"] },
  { city: "Faisalabad", region: "Punjab", lat: 31.4504, lng: 73.135, aliases: ["fsd", "lyallpur", "peoples colony", "madina town", "ghulam muhammad abad", "samanabad faisalabad", "satiana road", "jaranwala road"] },
  { city: "Multan", region: "Punjab", lat: 30.1575, lng: 71.5249, aliases: ["bosan road", "gulgasht", "shah rukn e alam", "mumtazabad", "cantt multan", "nishtar road"] },
  { city: "Gujranwala", region: "Punjab", lat: 32.1877, lng: 74.1945, aliases: ["grw", "peoples colony gujranwala", "model town gujranwala", "satellite town gujranwala", "wapda town gujranwala"] },
  { city: "Sialkot", region: "Punjab", lat: 32.4945, lng: 74.5229, aliases: ["skt", "sialkot cantt", "ugoki", "pasrur"] },
  { city: "Sargodha", region: "Punjab", lat: 32.0836, lng: 72.6711, aliases: ["bhalwal", "kot momin", "sillanwali"] },
  { city: "Bahawalpur", region: "Punjab", lat: 29.3544, lng: 71.6911, aliases: ["bwp", "ahmedpur east", "yazman"] },
  { city: "Sahiwal", region: "Punjab", lat: 30.6682, lng: 73.1114, aliases: ["farid town", "chichawatni"] },
  { city: "Sheikhupura", region: "Punjab", lat: 31.7167, lng: 73.985, aliases: ["skp", "ferozewala", "sharaqpur"] },
  { city: "Rahim Yar Khan", region: "Punjab", lat: 28.4212, lng: 70.2989, aliases: ["ryk", "sadiqabad", "khanpur", "liaquatpur"] },
  { city: "Jhang", region: "Punjab", lat: 31.2781, lng: 72.3317, aliases: ["jhang sadar", "shorkot", "ahmadpur sial"] },
  { city: "Dera Ghazi Khan", region: "Punjab", lat: 30.0489, lng: 70.6455, aliases: ["dg khan", "dgk", "taunsa"] },
  { city: "Gujrat", region: "Punjab", lat: 32.5731, lng: 74.075, aliases: ["kharian", "lalamusa", "sarai alamgir", "jalalpur jattan"] },
  { city: "Kasur", region: "Punjab", lat: 31.1179, lng: 74.4408, aliases: ["pattoki", "chunian", "kot radha kishan", "phool nagar"] },
  { city: "Okara", region: "Punjab", lat: 30.8138, lng: 73.4534, aliases: ["depalpur", "renala khurd", "hujra shah muqeem"] },
  { city: "Wah Cantt", region: "Punjab", lat: 33.7715, lng: 72.7511, aliases: ["taxila", "hassan abdal"] },
  { city: "Mandi Bahauddin", region: "Punjab", lat: 32.5861, lng: 73.4917, aliases: ["mbdin", "phalia", "malakwal"] },
  { city: "Chiniot", region: "Punjab", lat: 31.72, lng: 72.9789, aliases: ["bhawana", "lalian"] },
  { city: "Kamoke", region: "Punjab", lat: 31.9753, lng: 74.2239 },
  { city: "Hafizabad", region: "Punjab", lat: 32.0709, lng: 73.688, aliases: ["pindi bhattian"] },
  { city: "Sadiqabad", region: "Punjab", lat: 28.3062, lng: 70.1307 },
  { city: "Burewala", region: "Punjab", lat: 30.1667, lng: 72.65 },
  { city: "Khanewal", region: "Punjab", lat: 30.3017, lng: 71.9321, aliases: ["mian channu", "kabirwala", "jahanian"] },
  { city: "Muzaffargarh", region: "Punjab", lat: 30.0703, lng: 71.1933, aliases: ["kot addu", "alipur", "jatoi"] },
  { city: "Toba Tek Singh", region: "Punjab", lat: 30.9709, lng: 72.4826, aliases: ["tts", "gojra", "kamalia", "pir mahal"] },
  { city: "Vehari", region: "Punjab", lat: 30.0452, lng: 72.3489, aliases: ["mailsi"] },
  { city: "Jhelum", region: "Punjab", lat: 32.9425, lng: 73.7257, aliases: ["dina", "sohawa", "pind dadan khan"] },
  { city: "Chakwal", region: "Punjab", lat: 32.9328, lng: 72.863, aliases: ["talagang", "choa saidan shah", "kallar kahar"] },
  { city: "Attock", region: "Punjab", lat: 33.766, lng: 72.3609, aliases: ["fateh jang", "pindi gheb", "hazro", "jand"] },
  { city: "Narowal", region: "Punjab", lat: 32.102, lng: 74.873, aliases: ["shakargarh", "zafarwal"] },
  { city: "Pakpattan", region: "Punjab", lat: 30.341, lng: 73.3866, aliases: ["arifwala"] },
  { city: "Muridke", region: "Punjab", lat: 31.802, lng: 74.255 },
  { city: "Wazirabad", region: "Punjab", lat: 32.4419, lng: 74.12, aliases: ["alipur chattha", "ghakhar"] },
  { city: "Daska", region: "Punjab", lat: 32.3242, lng: 74.3497, aliases: ["sambrial"] },
  { city: "Khushab", region: "Punjab", lat: 32.2967, lng: 72.352, aliases: ["jauharabad", "noorpur thal", "quaidabad"] },
  { city: "Mianwali", region: "Punjab", lat: 32.5839, lng: 71.5264, aliases: ["isa khel", "piplan"] },
  { city: "Bhakkar", region: "Punjab", lat: 31.6253, lng: 71.0657, aliases: ["darya khan", "kaloorkot", "mankera"] },
  { city: "Layyah", region: "Punjab", lat: 30.9693, lng: 70.9428, aliases: ["karor lal esan", "chowk azam", "fatehpur"] },
  { city: "Rajanpur", region: "Punjab", lat: 29.1035, lng: 70.325, aliases: ["jampur", "rojhan", "fazilpur"] },
  { city: "Bahawalnagar", region: "Punjab", lat: 29.9987, lng: 73.2536, aliases: ["chishtian", "haroonabad", "fort abbas", "minchinabad"] },
  { city: "Lodhran", region: "Punjab", lat: 29.5405, lng: 71.6336, aliases: ["dunyapur", "kehror pacca"] },
  { city: "Nankana Sahib", region: "Punjab", lat: 31.4492, lng: 73.7124, aliases: ["sangla hill", "shahkot"] },
  { city: "Murree", region: "Punjab", lat: 33.907, lng: 73.3943, aliases: ["kotli sattian"] },
  { city: "Gujar Khan", region: "Punjab", lat: 33.2561, lng: 73.3043, aliases: ["kahuta", "kallar syedan"] },
  { city: "Jaranwala", region: "Punjab", lat: 31.3333, lng: 73.4167, aliases: ["samundri", "tandlianwala", "chak jhumra"] },

  // Sindh
  { city: "Karachi", region: "Sindh", lat: 24.8607, lng: 67.0011, aliases: ["khi", "gulshan e iqbal", "gulistan e johar", "north nazimabad", "defence karachi", "dha karachi", "clifton", "saddar karachi", "korangi", "malir", "landhi", "orangi", "lyari", "PECHS", "tariq road", "bahadurabad", "fb area", "federal b area", "surjani", "scheme 33"] },
  { city: "Hyderabad", region: "Sindh", lat: 25.396, lng: 68.3578, aliases: ["latifabad", "qasimabad", "hirabad"] },
  { city: "Sukkur", region: "Sindh", lat: 27.7052, lng: 68.8574, aliases: ["rohri", "pano aqil"] },
  { city: "Larkana", region: "Sindh", lat: 27.559, lng: 68.212, aliases: ["ratodero", "dokri"] },
  { city: "Nawabshah", region: "Sindh", lat: 26.2442, lng: 68.41, aliases: ["shaheed benazirabad", "sakrand", "qazi ahmed"] },
  { city: "Mirpur Khas", region: "Sindh", lat: 25.5276, lng: 69.0159, aliases: ["mirpurkhas", "digri", "kot ghulam muhammad"] },
  { city: "Jacobabad", region: "Sindh", lat: 28.281, lng: 68.4388 },
  { city: "Shikarpur", region: "Sindh", lat: 27.9556, lng: 68.6382 },
  { city: "Khairpur", region: "Sindh", lat: 27.5295, lng: 68.7592, aliases: ["gambat", "pir jo goth"] },
  { city: "Dadu", region: "Sindh", lat: 26.7319, lng: 67.775, aliases: ["mehar", "khairpur nathan shah", "johi"] },
  { city: "Badin", region: "Sindh", lat: 24.6558, lng: 68.8383, aliases: ["matli", "talhar"] },
  { city: "Thatta", region: "Sindh", lat: 24.7461, lng: 67.9243, aliases: ["makli", "sujawal"] },
  { city: "Tando Adam", region: "Sindh", lat: 25.7681, lng: 68.6619, aliases: ["sanghar", "shahdadpur"] },
  { city: "Tando Allahyar", region: "Sindh", lat: 25.4607, lng: 68.7174 },
  { city: "Umerkot", region: "Sindh", lat: 25.3614, lng: 69.7361 },
  { city: "Ghotki", region: "Sindh", lat: 28.0064, lng: 69.315, aliases: ["mirpur mathelo", "daharki", "ubauro"] },

  // Khyber Pakhtunkhwa (KPK)
  { city: "Peshawar", region: "Khyber Pakhtunkhwa", lat: 34.0151, lng: 71.5249, aliases: ["psh", "hayatabad", "university town peshawar", "saddar peshawar", "dabgari", "lady reading", "ring road peshawar", "hastnagri"] },
  { city: "Mardan", region: "Khyber Pakhtunkhwa", lat: 34.1986, lng: 72.0404, aliases: ["takht bhai", "katlang"] },
  { city: "Mingora", region: "Khyber Pakhtunkhwa", lat: 34.7717, lng: 72.3602, aliases: ["swat", "saidu sharif", "matta", "kabal", "bahrain"] },
  { city: "Abbottabad", region: "Khyber Pakhtunkhwa", lat: 34.1688, lng: 73.2215, aliases: ["avelian", "havelian", "supply abbottabad", "mandian"] },
  { city: "Kohat", region: "Khyber Pakhtunkhwa", lat: 33.5889, lng: 71.4429, aliases: ["lachi"] },
  { city: "Nowshera", region: "Khyber Pakhtunkhwa", lat: 34.0153, lng: 71.9747, aliases: ["risalpur", "pabbi", "jehangira", "akora khattak"] },
  { city: "Swabi", region: "Khyber Pakhtunkhwa", lat: 34.1202, lng: 72.4698, aliases: ["topi", "lahor"] },
  { city: "Charsadda", region: "Khyber Pakhtunkhwa", lat: 34.1453, lng: 71.7308, aliases: ["tangi", "shabqadar"] },
  { city: "Dera Ismail Khan", region: "Khyber Pakhtunkhwa", lat: 31.8326, lng: 70.9024, aliases: ["di khan", "dik", "paharpur", "paroa"] },
  { city: "Mansehra", region: "Khyber Pakhtunkhwa", lat: 34.3333, lng: 73.2, aliases: ["balakot", "oghi", "shinkiari"] },
  { city: "Haripur", region: "Khyber Pakhtunkhwa", lat: 33.9942, lng: 72.9333, aliases: ["khalabat", "ghazi", "hattar"] },
  { city: "Bannu", region: "Khyber Pakhtunkhwa", lat: 32.9889, lng: 70.6056, aliases: ["lakki marwat"] },
  { city: "Timergara", region: "Khyber Pakhtunkhwa", lat: 34.8281, lng: 71.8408, aliases: ["lower dir", "upper dir", "chakdara"] },
  { city: "Batkhela", region: "Khyber Pakhtunkhwa", lat: 34.6167, lng: 71.9725, aliases: ["malakand", "dargai"] },
  { city: "Chitral", region: "Khyber Pakhtunkhwa", lat: 35.8518, lng: 71.7864, aliases: ["drosh", "booni"] },
  { city: "Karak", region: "Khyber Pakhtunkhwa", lat: 33.1167, lng: 71.0833, aliases: ["banda daud shah", "takht-e-nasrati"] },
  { city: "Hangu", region: "Khyber Pakhtunkhwa", lat: 33.5281, lng: 71.0572, aliases: ["thall"] },
  { city: "Buner", region: "Khyber Pakhtunkhwa", lat: 34.3943, lng: 72.6151, aliases: ["daggar"] },
  { city: "Shangla", region: "Khyber Pakhtunkhwa", lat: 34.8872, lng: 72.6006, aliases: ["alpuri", "besham"] },

  // Balochistan
  { city: "Quetta", region: "Balochistan", lat: 30.1798, lng: 66.975, aliases: ["jinnah road quetta", "sariab", "kuchlak"] },
  { city: "Gwadar", region: "Balochistan", lat: 25.1264, lng: 62.3225, aliases: ["pasni", "jiwani"] },
  { city: "Turbat", region: "Balochistan", lat: 26.0031, lng: 63.0544, aliases: ["kech"] },
  { city: "Khuzdar", region: "Balochistan", lat: 27.8, lng: 66.6167 },
  { city: "Chaman", region: "Balochistan", lat: 30.921, lng: 66.4597 },
  { city: "Hub", region: "Balochistan", lat: 25.0256, lng: 66.89, aliases: ["lasbela", "uthal"] },
  { city: "Sibi", region: "Balochistan", lat: 29.543, lng: 67.8773 },
  { city: "Zhob", region: "Balochistan", lat: 31.3417, lng: 69.4486, aliases: ["loralai"] },

  // Azad Kashmir (AJK)
  { city: "Muzaffarabad", region: "Azad Kashmir", lat: 34.37, lng: 73.4711 },
  { city: "Mirpur", region: "Azad Kashmir", lat: 33.1478, lng: 73.7519, aliases: ["mirpur ajk", "dadyal"] },
  { city: "Kotli", region: "Azad Kashmir", lat: 33.5156, lng: 73.9019 },
  { city: "Rawalakot", region: "Azad Kashmir", lat: 33.8578, lng: 73.7604, aliases: ["poonch"] },
  { city: "Bagh", region: "Azad Kashmir", lat: 33.9803, lng: 73.7747 },
  { city: "Bhimber", region: "Azad Kashmir", lat: 32.9746, lng: 74.0784 },

  // Gilgit-Baltistan
  { city: "Gilgit", region: "Gilgit-Baltistan", lat: 35.9208, lng: 74.3144, aliases: ["danyore", "hunza", "karimabad", "chilas"] },
  { city: "Skardu", region: "Gilgit-Baltistan", lat: 35.2971, lng: 75.6333, aliases: ["khaplu", "shigar"] },
];

/**
 * Resolves a Pakistani city/town from free-text address, client name, or city string.
 */
export function resolveCityFromText(rawText?: string | null): CityCoordEntry | null {
  if (!rawText || typeof rawText !== "string") return null;
  const text = rawText.toLowerCase().trim();
  if (!text || text.length < 2) return null;

  // 1. Exact or whole-word match on canonical city name
  for (const entry of PAKISTAN_CITIES) {
    const cityLower = entry.city.toLowerCase();
    const re = new RegExp(`\\b${cityLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      return entry;
    }
  }

  // 2. Match on known locality/town aliases
  for (const entry of PAKISTAN_CITIES) {
    if (!entry.aliases) continue;
    for (const alias of entry.aliases) {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(text)) {
        return entry;
      }
    }
  }

  return null;
}

/**
 * Deterministic sub-kilometer offset so multiple pharmacies in the same city
 * do not stack on the exact same pixel when using city-level coordinates.
 */
export function applyDeterministicJitter(
  lat: number,
  lng: number,
  seed: string,
  radiusDeg = 0.012
): { lat: number; lng: number } {
  let h1 = 2166136261;
  let h2 = 16777619;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c * 31), 2166136261);
  }
  const angle = ((h1 >>> 0) % 360) * (Math.PI / 180);
  const dist = (((h2 >>> 0) % 1000) / 1000) * radiusDeg + 0.0015;
  return {
    lat: Number((lat + Math.sin(angle) * dist).toFixed(6)),
    lng: Number((lng + Math.cos(angle) * dist).toFixed(6)),
  };
}

/**
 * Extracts and normalizes POS terminal location from:
 * 1. Explicit POS-reported `body.location` (from Electron main process silent resolver)
 * 2. Vercel Edge request headers (`x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-city`)
 * 3. Client address / name text matching against `PAKISTAN_CITIES`
 */
export function extractRequestGeo(
  req: NextRequest,
  bodyLocation?: any,
  fallbackAddress?: string | null
): PosLocationData | null {
  const now = new Date();
  const forwardedFor = req.headers.get("x-forwarded-for");
  const reqIp = forwardedFor ? forwardedFor.split(",")[0].trim() : req.headers.get("x-real-ip") || "";

  const vercelLatStr = req.headers.get("x-vercel-ip-latitude");
  const vercelLngStr = req.headers.get("x-vercel-ip-longitude");
  const vercelCity = req.headers.get("x-vercel-ip-city")
    ? decodeURIComponent(req.headers.get("x-vercel-ip-city")!)
    : "";
  const vercelRegion = req.headers.get("x-vercel-ip-country-region") || "";
  const vercelCountry = req.headers.get("x-vercel-ip-country") || "";

  const addrText =
    (typeof bodyLocation?.address_hint === "string" && bodyLocation.address_hint.trim()) ||
    (typeof fallbackAddress === "string" && fallbackAddress.trim()) ||
    "";
  const matchedCityFromAddr = resolveCityFromText(addrText);

  // 1. Check POS-supplied coordinates
  if (
    bodyLocation &&
    typeof bodyLocation === "object" &&
    typeof bodyLocation.lat === "number" &&
    typeof bodyLocation.lng === "number" &&
    Number.isFinite(bodyLocation.lat) &&
    Number.isFinite(bodyLocation.lng) &&
    Math.abs(bodyLocation.lat) <= 90 &&
    Math.abs(bodyLocation.lng) <= 180
  ) {
    const rawCity = typeof bodyLocation.city === "string" ? bodyLocation.city.trim() : "";
    const matchedFromRawCity = resolveCityFromText(rawCity);

    // If POS IP geolocation landed in a different city than the pharmacy's explicit written address city,
    // and the source wasn't already Nominatim street geocoding, prefer the written address city if clearly stated.
    if (
      matchedCityFromAddr &&
      bodyLocation.source !== "pos_address_geo" &&
      rawCity.toLowerCase() !== matchedCityFromAddr.city.toLowerCase()
    ) {
      return {
        lat: matchedCityFromAddr.lat,
        lng: matchedCityFromAddr.lng,
        city: matchedCityFromAddr.city,
        region: matchedCityFromAddr.region,
        country: "Pakistan",
        ip: bodyLocation.ip || reqIp || undefined,
        isp: bodyLocation.isp || undefined,
        address: addrText || undefined,
        source: "address_match",
        updated_at: now,
      };
    }

    return {
      lat: Number(bodyLocation.lat.toFixed(6)),
      lng: Number(bodyLocation.lng.toFixed(6)),
      city: matchedFromRawCity?.city || rawCity || matchedCityFromAddr?.city || vercelCity || "Unknown City",
      region:
        matchedFromRawCity?.region ||
        matchedCityFromAddr?.region ||
        (typeof bodyLocation.region === "string" ? bodyLocation.region : "") ||
        vercelRegion ||
        "",
      country: (typeof bodyLocation.country === "string" ? bodyLocation.country : "") || vercelCountry || "Pakistan",
      ip: (typeof bodyLocation.ip === "string" ? bodyLocation.ip : "") || reqIp || undefined,
      isp: typeof bodyLocation.isp === "string" ? bodyLocation.isp : undefined,
      address: addrText || undefined,
      source: bodyLocation.source === "pos_address_geo" ? "pos_address_geo" : "pos_ip_geo",
      updated_at: now,
    };
  }

  // 2. If address explicitly names a Pakistani city, use it before broad IP fallback
  if (matchedCityFromAddr) {
    return {
      lat: matchedCityFromAddr.lat,
      lng: matchedCityFromAddr.lng,
      city: matchedCityFromAddr.city,
      region: matchedCityFromAddr.region,
      country: "Pakistan",
      ip: reqIp || undefined,
      address: addrText || undefined,
      source: "address_match",
      updated_at: now,
    };
  }

  // 3. Fallback to Vercel Edge Geo Headers (works automatically even for older POS builds!)
  if (vercelLatStr && vercelLngStr) {
    const vLat = parseFloat(vercelLatStr);
    const vLng = parseFloat(vercelLngStr);
    if (Number.isFinite(vLat) && Number.isFinite(vLng)) {
      const matchedFromVercelCity = resolveCityFromText(vercelCity);
      return {
        lat: Number(vLat.toFixed(6)),
        lng: Number(vLng.toFixed(6)),
        city: matchedFromVercelCity?.city || vercelCity || "Unknown City",
        region: matchedFromVercelCity?.region || vercelRegion || "",
        country: vercelCountry === "PK" ? "Pakistan" : vercelCountry || "Pakistan",
        ip: reqIp || undefined,
        address: addrText || undefined,
        source: "vercel_ip",
        updated_at: now,
      };
    }
  }

  return null;
}

