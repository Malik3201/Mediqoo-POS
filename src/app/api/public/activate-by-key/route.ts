import { NextRequest, NextResponse } from "next/server";
import { webcrypto } from "node:crypto";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import LicenseCounter from "@/models/LicenseCounter";
import Project from "@/models/Project";
import Client from "@/models/Client";
import BusinessTemplate from "@/models/BusinessTemplate";
import { resolveEffectivePharmacyLogo } from "@/lib/branding/logo-service";
import { extractRequestGeo } from "@/lib/geo-location";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const cryptoWeb = webcrypto as any;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function canonicalSerialize(payload: any): string {
  const sortedPayload: any = {};
  Object.keys(payload)
    .sort()
    .forEach((key) => {
      sortedPayload[key] = payload[key];
    });
  return JSON.stringify(sortedPayload);
}

async function signKeyActivationPayload(payload: any) {
  const seedInput = process.env.LICENSE_STATUS_SIGNING_SEED;
  if (!seedInput) {
    throw new Error("Server configuration error: missing LICENSE_STATUS_SIGNING_SEED");
  }
  const ed = await import("@noble/ed25519");
  const { sha512 } = await import("@noble/hashes/sha2.js");
  (ed as any).hashes ||= {};
  (ed as any).hashes.sha512 = sha512;

  const hex = seedInput.replace(/[^0-9a-fA-F]/g, "");
  const seed =
    hex.length >= 64
      ? hexToBytes(hex).slice(0, 32)
      : new Uint8Array(
          await cryptoWeb.subtle.digest("SHA-256", toBytes(seedInput) as unknown as BufferSource)
        );
  const signature = ed.sign(toBytes(canonicalSerialize(payload)), seed);
  return {
    format: "aivrasol-key-activation/1",
    metadata: payload,
    signature: b64encode(signature as Uint8Array),
  };
}

async function allocateTerminalNumber(licenseId: string): Promise<number> {
  const counter = await LicenseCounter.findOneAndUpdate(
    { license_id: licenseId },
    { $inc: { next_terminal: 1 } },
    { new: true, upsert: true }
  );
  return counter!.next_terminal;
}

/**
 * POST /api/public/activate-by-key
 *
 * Additive license-key-only instant POS activation (no .aivra file required!).
 * Ideal for Quick 3-Day Trials as well as any active AivraSol license.
 * Does NOT disturb existing `.aivra` local decryption or `/api/public/register-seat`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawKey = String(body?.license_key || "").trim().toUpperCase();
    const machineId = String(body?.machine_id || "").trim();
    const requestedRole: "main" | "client" = body?.role === "client" ? "client" : "main";
    const previewOnly = Boolean(body?.preview_only);

    if (!rawKey || !machineId) {
      return NextResponse.json(
        { error: "missing_fields", message: "License key and machine identity are required." },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    const lic: any = await License.findOne({ license_key: rawKey }).lean();
    if (!lic) {
      return NextResponse.json(
        { error: "invalid_license", message: "License key not recognized. Please double-check the key." },
        { status: 401, headers: CORS }
      );
    }

    if (lic.status !== "active") {
      return NextResponse.json(
        {
          error: "license_not_active",
          status: lic.status,
          message: `This license is currently ${lic.status}. Contact AivraSol Admin.`,
        },
        { status: 403, headers: CORS }
      );
    }

    const isTrial = Boolean(lic.features?.is_trial);
    const now = new Date();
    if (lic.expires_at) {
      const expiresAt = new Date(lic.expires_at);
      if (isTrial && now > expiresAt) {
        return NextResponse.json(
          {
            error: "trial_expired",
            message: "This 3-day trial license has expired. Contact AivraSol Admin to extend or upgrade.",
          },
          { status: 403, headers: CORS }
        );
      }
      if (!isTrial) {
        const endOfDay = new Date(expiresAt);
        endOfDay.setHours(23, 59, 59, 999);
        const graceUntil = lic.grace_until ? new Date(lic.grace_until) : endOfDay;
        const endOfGrace = new Date(graceUntil);
        endOfGrace.setHours(23, 59, 59, 999);
        if (now > endOfGrace) {
          return NextResponse.json(
            {
              error: "license_expired",
              message: "This license has expired. Please contact AivraSol Admin to renew.",
            },
            { status: 403, headers: CORS }
          );
        }
      }
    }

    const [project, client] = await Promise.all([
      lic.project_id ? Project.findOne({ id: lic.project_id }).lean<any>() : null,
      lic.client_id ? Client.findOne({ id: lic.client_id }).lean<any>() : null,
    ]);
    const template = project?.template_id
      ? await BusinessTemplate.findOne({ id: project.template_id }).lean<any>()
      : null;

    if (!project) {
      return NextResponse.json(
        { error: "project_not_found", message: "License project configuration is missing." },
        { status: 404, headers: CORS }
      );
    }

    // Seat registration (skipped when preview_only=true so UI can verify key & show role picker first)
    let seatId: string | null = null;
    let terminalNumber: number | null = null;
    const maxSeats = Math.max(1, Number(lic.seats || 1));
    const effectiveRole: "main" | "client" = maxSeats > 1 ? requestedRole : "main";

    if (!previewOnly) {
      const existingSeat: any = await LicenseSeat.findOne({
        license_id: lic.id,
        machine_id: machineId,
      });

      if (existingSeat) {
        seatId = existingSeat.id;
        terminalNumber = existingSeat.terminal_number ?? null;
        if (!terminalNumber) {
          terminalNumber = await allocateTerminalNumber(lic.id);
          existingSeat.terminal_number = terminalNumber;
        }
        existingSeat.last_seen_at = now;
        if (body.hostname) existingSeat.hostname = String(body.hostname);
        if (body.app_version) existingSeat.last_seen_version = String(body.app_version);
        await existingSeat.save();
      } else {
        const seatCount = await LicenseSeat.countDocuments({ license_id: lic.id });
        if (seatCount >= maxSeats) {
          return NextResponse.json(
            {
              error: "seat_limit_reached",
              seats: maxSeats,
              seats_used: seatCount,
              message: `All ${maxSeats} seat(s) for this license are already in use.`,
            },
            { status: 403, headers: CORS }
          );
        }
        if (effectiveRole === "main") {
          const existingMain = await LicenseSeat.countDocuments({
            license_id: lic.id,
            role: "main",
          });
          if (existingMain > 0) {
            return NextResponse.json(
              {
                error: "main_already_exists",
                message: "A Main PC is already registered for this license. Please select Client PC.",
              },
              { status: 409, headers: CORS }
            );
          }
        }

        let geo: any = null;
        try {
          geo = extractRequestGeo(req, body.location, client?.address || client?.name || lic.notes);
        } catch {
          geo = null;
        }

        terminalNumber = await allocateTerminalNumber(lic.id);
        const createdSeat = await LicenseSeat.create({
          license_id: lic.id,
          machine_id: machineId,
          role: effectiveRole,
          hostname: body.hostname ? String(body.hostname) : null,
          last_seen_version: body.app_version ? String(body.app_version) : null,
          terminal_number: terminalNumber,
          ...(geo ? { location: geo } : {}),
        });
        seatId = createdSeat.id;
      }
    }

    const resolvedLogo = resolveEffectivePharmacyLogo({ license: lic, project });

    const payload = {
      branding_logo_url: resolvedLogo.logoUrl,
      branding_version: resolvedLogo.brandingVersion,
      client: client
        ? {
            address: client.address || null,
            contact_email: client.contact_email || null,
            contact_name: client.contact_name || null,
            contact_phone: client.contact_phone || null,
            name: client.name || project.name,
          }
        : { name: project.name },
      generated_at: now.toISOString(),
      is_trial: isTrial,
      license: {
        expires_at: lic.expires_at ? new Date(lic.expires_at).toISOString() : null,
        id: lic.id,
        key: lic.license_key,
        machine_fingerprint: lic.machine_fingerprint || null,
        seats: maxSeats,
        status: lic.status,
      },
      machine_id: machineId,
      preview_only: previewOnly,
      project: {
        branding: {
          ...(project.branding || {}),
          ...(resolvedLogo.logoUrl ? { logo_url: resolvedLogo.logoUrl } : {}),
        },
        hardware_config: project.hardware_config || {},
        id: project.id,
        modules_config: project.modules_config || {},
        name: project.name,
        slug: project.slug,
        version: "Auto",
      },
      role: effectiveRole,
      seat_id: seatId,
      template: template
        ? { name: template.name, slug: template.slug, version: template.version || "1.0" }
        : { name: "Pharmacy POS", slug: "pharmacy-pos", version: "1.0" },
      terminal_number: terminalNumber,
      trial_days: isTrial ? Number(lic.features?.trial_days || 3) : null,
    };

    const signed = await signKeyActivationPayload(payload);
    return NextResponse.json(signed, { status: 200, headers: CORS });
  } catch (err: any) {
    console.error("activate-by-key error:", err);
    return NextResponse.json(
      { error: "server_error", message: err?.message || "Activation failed" },
      { status: 500, headers: CORS }
    );
  }
}
