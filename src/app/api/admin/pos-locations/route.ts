import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import Client from "@/models/Client";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Project from "@/models/Project";
import {
  PAKISTAN_CITIES,
  resolveCityFromText,
  applyDeterministicJitter,
} from "@/lib/geo-location";

export const dynamic = "force-dynamic";

async function requireAdminSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return null;
  }
  return token;
}

export async function GET(req: NextRequest) {
  const token = await requireAdminSession(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const [clients, licenses, seats, projects] = await Promise.all([
      Client.find({}).sort({ created_at: -1 }).lean(),
      License.find({}).sort({ created_at: -1 }).lean(),
      LicenseSeat.find({}).sort({ last_seen_at: -1 }).lean(),
      Project.find({}).lean(),
    ]);

    const projectById = new Map<string, any>();
    for (const p of projects as any[]) {
      projectById.set(p.id, p);
    }

    const licensesByClientId = new Map<string, any[]>();
    for (const lic of licenses as any[]) {
      const list = licensesByClientId.get(lic.client_id) || [];
      list.push(lic);
      licensesByClientId.set(lic.client_id, list);
    }

    const seatsByLicenseId = new Map<string, any[]>();
    for (const seat of seats as any[]) {
      const list = seatsByLicenseId.get(seat.license_id) || [];
      list.push(seat);
      seatsByLicenseId.set(seat.license_id, list);
    }

    const nowMs = Date.now();
    const ONLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

    // Track coordinate collisions so markers at the exact same point get slight visual separation
    const coordUsageCount = new Map<string, number>();

    const pharmacies = (clients as any[]).map((client) => {
      const clientLicenses = licensesByClientId.get(client.id) || [];
      const clientSeats: any[] = [];
      for (const lic of clientLicenses) {
        const ls = seatsByLicenseId.get(lic.id) || [];
        for (const s of ls) {
          clientSeats.push({
            ...s,
            license_key: lic.license_key,
          });
        }
      }

      // Sort terminals by most recently seen
      clientSeats.sort(
        (a, b) =>
          new Date(b.last_seen_at || 0).getTime() -
          new Date(a.last_seen_at || 0).getTime()
      );

      // Find latest seat with valid coordinates
      const seatWithGeo = clientSeats.find(
        (s) =>
          s.location &&
          typeof s.location.lat === "number" &&
          typeof s.location.lng === "number"
      );

      let rawLat: number | null = null;
      let rawLng: number | null = null;
      let city = "";
      let region = "";
      let country = "Pakistan";
      let ip = "";
      let isp = "";
      let resolvedAddress = client.address || "";
      let source: string = "pending_sync";
      let updatedAt: string | null = null;
      let accuracy: "exact" | "city" | "pending" = "pending";

      // Priority 1: Admin manual override on client
      if (
        client.location &&
        client.location.source === "admin_manual" &&
        typeof client.location.lat === "number" &&
        typeof client.location.lng === "number"
      ) {
        rawLat = client.location.lat;
        rawLng = client.location.lng;
        city = client.location.city || "Unknown City";
        region = client.location.region || "";
        country = client.location.country || "Pakistan";
        ip = client.location.ip || seatWithGeo?.location?.ip || "";
        isp = client.location.isp || seatWithGeo?.location?.isp || "";
        resolvedAddress = client.address || client.location.address || "";
        source = "admin_manual";
        updatedAt = client.location.updated_at
          ? new Date(client.location.updated_at).toISOString()
          : null;
        accuracy = "exact";
      }
      // Priority 2: Live POS terminal geolocation (from seat or client.location)
      else if (
        seatWithGeo?.location?.lat != null &&
        seatWithGeo?.location?.lng != null
      ) {
        rawLat = seatWithGeo.location.lat;
        rawLng = seatWithGeo.location.lng;
        city = seatWithGeo.location.city || client.location?.city || "";
        region = seatWithGeo.location.region || client.location?.region || "";
        country = seatWithGeo.location.country || "Pakistan";
        ip = seatWithGeo.location.ip || "";
        isp = seatWithGeo.location.isp || "";
        resolvedAddress =
          client.address || seatWithGeo.location.address || "";
        source = seatWithGeo.location.source || "pos_ip";
        updatedAt = seatWithGeo.location.updated_at
          ? new Date(seatWithGeo.location.updated_at).toISOString()
          : seatWithGeo.last_seen_at
          ? new Date(seatWithGeo.last_seen_at).toISOString()
          : null;
        accuracy =
          source === "pos_address" || source === "pos_ip" || source === "vercel_geo"
            ? "exact"
            : "city";
      } else if (
        client.location &&
        typeof client.location.lat === "number" &&
        typeof client.location.lng === "number"
      ) {
        rawLat = client.location.lat;
        rawLng = client.location.lng;
        city = client.location.city || "";
        region = client.location.region || "";
        country = client.location.country || "Pakistan";
        ip = client.location.ip || "";
        isp = client.location.isp || "";
        resolvedAddress = client.address || client.location.address || "";
        source = client.location.source || "pos_ip";
        updatedAt = client.location.updated_at
          ? new Date(client.location.updated_at).toISOString()
          : null;
        accuracy = "exact";
      }

      // Priority 3: Infer city from client address, name, project name, or license notes
      if (rawLat == null || rawLng == null || !city) {
        const searchBlob = [
          client.address,
          client.name,
          client.notes,
          ...clientLicenses.map((l) => l.notes),
          ...clientSeats.map((s) => s.hostname),
        ]
          .filter(Boolean)
          .join(" ");

        const matchedCity = resolveCityFromText(searchBlob);
        if (matchedCity) {
          if (rawLat == null || rawLng == null) {
            rawLat = matchedCity.lat;
            rawLng = matchedCity.lng;
            source = "address_match";
            accuracy = "city";
          }
          if (!city) city = matchedCity.city;
          if (!region) region = matchedCity.region;
        }
      }

      // Priority 4: If still no coordinates (e.g. legacy client with blank address before first POS heartbeat),
      // place at a default hub with deterministic spread so it is still visible & clickable on the map
      if (rawLat == null || rawLng == null) {
        rawLat = 31.5204; // Lahore / Central Punjab hub default until POS heartbeats
        rawLng = 74.3587;
        city = city || "Awaiting POS Sync";
        region = region || "Pakistan";
        source = "pending_sync";
        accuracy = "pending";
      }

      if (!city) {
        const inferred = resolveCityFromText(resolvedAddress || client.name);
        city = inferred?.city || "Unspecified City";
        if (!region && inferred?.region) region = inferred.region;
      }

      // Apply subtle deterministic jitter when multiple pharmacies share the same city-center coordinate
      const coordKey = `${rawLat.toFixed(3)},${rawLng.toFixed(3)}`;
      const seenCount = coordUsageCount.get(coordKey) || 0;
      coordUsageCount.set(coordKey, seenCount + 1);

      let displayLat = rawLat;
      let displayLng = rawLng;
      if (
        seenCount > 0 ||
        source === "address_match" ||
        source === "pending_sync"
      ) {
        const jittered = applyDeterministicJitter(
          rawLat,
          rawLng,
          `${client.id}-${seenCount}`,
          source === "pending_sync" ? 0.045 : 0.022
        );
        displayLat = jittered.lat;
        displayLng = jittered.lng;
      }

      // Compute terminal and pharmacy online status
      let lastSeenMs = 0;
      let onlineTerminalsCount = 0;
      let activeTodayTerminalsCount = 0;

      const formattedTerminals = clientSeats.map((s) => {
        const seenMs = s.last_seen_at ? new Date(s.last_seen_at).getTime() : 0;
        if (seenMs > lastSeenMs) lastSeenMs = seenMs;
        const isOnline = seenMs > 0 && nowMs - seenMs <= ONLINE_THRESHOLD_MS;
        const isActiveToday = seenMs > 0 && nowMs - seenMs <= TODAY_THRESHOLD_MS;
        if (isOnline) onlineTerminalsCount++;
        if (isActiveToday) activeTodayTerminalsCount++;

        return {
          id: s.id,
          terminal_number: s.terminal_number ?? null,
          role: s.role || "client",
          hostname: s.hostname || "POS Terminal",
          machine_id: s.machine_id,
          license_key: s.license_key,
          last_seen_version: s.last_seen_version || null,
          first_seen_at: s.first_seen_at || null,
          last_seen_at: s.last_seen_at || null,
          is_online: isOnline,
          is_active_today: isActiveToday,
          location: s.location || null,
        };
      });

      const hasActiveLicense = clientLicenses.some(
        (l) => l.status === "active"
      );

      let activityStatus: "online" | "active_today" | "active" | "inactive" =
        "inactive";
      if (onlineTerminalsCount > 0) {
        activityStatus = "online";
      } else if (activeTodayTerminalsCount > 0) {
        activityStatus = "active_today";
      } else if (hasActiveLicense && client.status === "active") {
        activityStatus = "active";
      }

      const formattedLicenses = clientLicenses.map((l) => {
        const proj = projectById.get(l.project_id);
        const lSeats = seatsByLicenseId.get(l.id) || [];
        return {
          id: l.id,
          license_key: l.license_key,
          status: l.status,
          seats: l.seats ?? 1,
          seats_used: lSeats.length,
          issued_at: l.issued_at || null,
          expires_at: l.expires_at || null,
          grace_until: l.grace_until || null,
          project_name: proj?.name || "AivraSol Pharmacy POS",
          billing_model: l.billing?.model || "fixed",
          notes: l.notes || null,
        };
      });

      return {
        id: client.id,
        name: client.name,
        status: client.status || "active",
        activityStatus,
        contact_name: client.contact_name || null,
        contact_email: client.contact_email || null,
        contact_phone: client.contact_phone || null,
        address: resolvedAddress || null,
        notes: client.notes || null,
        timezone: client.timezone || "Asia/Karachi",
        created_at: client.created_at || null,
        lastSeenAt: lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : null,
        onlineTerminalsCount,
        totalTerminalsCount: formattedTerminals.length,
        location: {
          lat: displayLat,
          lng: displayLng,
          rawLat,
          rawLng,
          city,
          region: region || "Pakistan",
          country,
          ip: ip || null,
          isp: isp || null,
          address: resolvedAddress || null,
          source,
          accuracy,
          updated_at: updatedAt,
        },
        licenses: formattedLicenses,
        terminals: formattedTerminals,
      };
    });

    // Build city-wise breakdown
    const cityMap = new Map<
      string,
      {
        city: string;
        region: string;
        count: number;
        onlineCount: number;
        activeTodayCount: number;
        activeCount: number;
        terminalsCount: number;
        onlineTerminalsCount: number;
        latSum: number;
        lngSum: number;
      }
    >();

    for (const p of pharmacies) {
      const cityName = p.location.city || "Unspecified City";
      const key = cityName.toLowerCase();
      const existing = cityMap.get(key) || {
        city: cityName,
        region: p.location.region || "Pakistan",
        count: 0,
        onlineCount: 0,
        activeTodayCount: 0,
        activeCount: 0,
        terminalsCount: 0,
        onlineTerminalsCount: 0,
        latSum: 0,
        lngSum: 0,
      };
      existing.count += 1;
      if (p.activityStatus === "online") existing.onlineCount += 1;
      if (
        p.activityStatus === "online" ||
        p.activityStatus === "active_today"
      ) {
        existing.activeTodayCount += 1;
      }
      if (p.activityStatus !== "inactive") existing.activeCount += 1;
      existing.terminalsCount += p.totalTerminalsCount;
      existing.onlineTerminalsCount += p.onlineTerminalsCount;
      existing.latSum += p.location.rawLat;
      existing.lngSum += p.location.rawLng;
      cityMap.set(key, existing);
    }

    const cities = Array.from(cityMap.values())
      .map((c) => ({
        city: c.city,
        region: c.region,
        count: c.count,
        onlineCount: c.onlineCount,
        activeTodayCount: c.activeTodayCount,
        activeCount: c.activeCount,
        terminalsCount: c.terminalsCount,
        onlineTerminalsCount: c.onlineTerminalsCount,
        lat: Number((c.latSum / c.count).toFixed(5)),
        lng: Number((c.lngSum / c.count).toFixed(5)),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.city.localeCompare(b.city);
      });

    const summary = {
      totalPharmacies: pharmacies.length,
      activePharmacies: pharmacies.filter(
        (p) => p.activityStatus !== "inactive"
      ).length,
      onlineNowCount: pharmacies.filter((p) => p.activityStatus === "online")
        .length,
      activeTodayCount: pharmacies.filter(
        (p) =>
          p.activityStatus === "online" || p.activityStatus === "active_today"
      ).length,
      totalTerminals: pharmacies.reduce(
        (acc, p) => acc + p.totalTerminalsCount,
        0
      ),
      onlineTerminals: pharmacies.reduce(
        (acc, p) => acc + p.onlineTerminalsCount,
        0
      ),
      totalCities: cities.filter((c) => c.city !== "Awaiting POS Sync").length || cities.length,
    };

    return NextResponse.json({
      summary,
      cities,
      pharmacies,
      availableCities: PAKISTAN_CITIES.map((c) => ({
        city: c.city,
        region: c.region,
        lat: c.lat,
        lng: c.lng,
      })),
    });
  } catch (e: any) {
    console.error("[pos-locations GET] error:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to load POS locations" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const token = await requireAdminSession(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { clientId, city, region, lat, lng, address, resetToAuto } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const client = await Client.findOne({ id: clientId }).lean();
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (resetToAuto) {
      await Client.updateOne(
        { id: clientId },
        { $unset: { location: 1 } }
      );
      return NextResponse.json({ ok: true, mode: "auto" });
    }

    let resolvedLat = typeof lat === "number" ? lat : Number(lat);
    let resolvedLng = typeof lng === "number" ? lng : Number(lng);
    let resolvedCity = city ? String(city).trim() : "";
    let resolvedRegion = region ? String(region).trim() : "";

    if (
      (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) &&
      resolvedCity
    ) {
      const matched = resolveCityFromText(resolvedCity);
      if (matched) {
        resolvedLat = matched.lat;
        resolvedLng = matched.lng;
        resolvedCity = matched.city;
        resolvedRegion = resolvedRegion || matched.region;
      }
    }

    if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) {
      return NextResponse.json(
        { error: "Valid coordinates or a known city name are required" },
        { status: 400 }
      );
    }

    const updatedLocation = {
      lat: resolvedLat,
      lng: resolvedLng,
      city: resolvedCity || client.location?.city || "Custom Location",
      region: resolvedRegion || client.location?.region || "Pakistan",
      country: "Pakistan",
      ip: client.location?.ip || undefined,
      isp: client.location?.isp || undefined,
      address:
        typeof address === "string"
          ? address.trim()
          : client.address || client.location?.address || "",
      source: "admin_manual",
      updated_at: new Date(),
    };

    const updateDoc: any = {
      location: updatedLocation,
    };
    if (typeof address === "string") {
      updateDoc.address = address.trim();
    }

    await Client.updateOne({ id: clientId }, { $set: updateDoc });

    return NextResponse.json({ ok: true, location: updatedLocation });
  } catch (e: any) {
    console.error("[pos-locations PATCH] error:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to update location" },
      { status: 500 }
    );
  }
}

