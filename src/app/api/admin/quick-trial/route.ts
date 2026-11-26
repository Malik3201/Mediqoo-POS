import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { webcrypto } from "node:crypto";
import connectToDatabase from "@/lib/db";
import Client from "@/models/Client";
import Project from "@/models/Project";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Package from "@/models/Package";
import BusinessTemplate from "@/models/BusinessTemplate";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import { recordAdminActivity } from "@/lib/audit-logger";
import { uploadLicensePharmacyLogo } from "@/lib/branding/logo-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORMAT = "aivra/1";
const webCrypto = webcrypto as any;

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await webCrypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function aesEncrypt(keyMaterial: Uint8Array, plaintext: Uint8Array) {
  const rawKey = new Uint8Array(
    await webCrypto.subtle.digest("SHA-256", keyMaterial as unknown as BufferSource)
  );
  const key = await webCrypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await webCrypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext as unknown as BufferSource
    )
  );
  return { iv, cipher };
}

async function ed25519Sign(seedInput: string, message: Uint8Array) {
  const ed = await import("@noble/ed25519");
  const { sha512 } = await import("@noble/hashes/sha2.js");
  (ed as any).hashes ||= {};
  (ed as any).hashes.sha512 = sha512;

  const hex = seedInput.replace(/[^0-9a-fA-F]/g, "");
  const seed =
    hex.length >= 64
      ? hexToBytes(hex).slice(0, 32)
      : new Uint8Array(
          await webCrypto.subtle.digest("SHA-256", toBytes(seedInput) as unknown as BufferSource)
        );
  if (seed.length !== 32) throw new Error("Signing seed must be 32 bytes");
  const publicKey = ed.getPublicKey(seed);
  const signature = ed.sign(message, seed);
  return { publicKey, signature };
}

function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(20);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `AIVRA-${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

function slugifyPharmacy(name: string): string {
  const base = String(name || "trial-pharmacy")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base || "trial-pharmacy"}-${suffix}`;
}

async function buildSignedAivraEnvelope(params: {
  project: any;
  client: any;
  template: any;
  license: any;
  logoUrl?: string | null;
}) {
  const generatedAt = new Date().toISOString();
  const isTrial = Boolean(params.license?.features?.is_trial);
  const manifest = {
    format: FORMAT,
    generated_at: generatedAt,
    project: {
      id: params.project.id,
      name: params.project.name,
      slug: params.project.slug,
      version: "Auto",
      modules_config: params.project.modules_config || {},
      branding: {
        ...(params.project.branding || {}),
        ...(params.logoUrl ? { logo_url: params.logoUrl } : {}),
      },
      hardware_config: params.project.hardware_config || {},
    },
    client: params.client ?? null,
    template: params.template ?? null,
    license: {
      id: params.license.id,
      key: params.license.license_key,
      machine_fingerprint: params.license.machine_fingerprint || null,
      expires_at: params.license.expires_at ? new Date(params.license.expires_at).toISOString() : null,
      status: params.license.status,
      seats: params.license.seats || 1,
      is_trial: isTrial,
      trial_days: isTrial ? Number(params.license.features?.trial_days || 3) : null,
    },
  };

  const manifestBytes = toBytes(JSON.stringify(manifest));
  const encKey = params.license.license_key;
  const signSeed =
    process.env.PACKAGE_SIGNING_SEED ||
    process.env.LICENSE_STATUS_SIGNING_SEED ||
    "fallback_signing_seed_1234567890";

  const { iv, cipher } = await aesEncrypt(toBytes(encKey), manifestBytes);
  const signed = new Uint8Array(iv.length + cipher.length);
  signed.set(iv, 0);
  signed.set(cipher, iv.length);
  const { publicKey, signature } = await ed25519Sign(signSeed, signed);

  const envelope = {
    format: FORMAT,
    alg: { cipher: "AES-256-GCM", signature: "Ed25519" },
    created_at: generatedAt,
    project_slug: params.project.slug,
    project_version: "Auto",
    iv: b64encode(iv),
    ciphertext: b64encode(cipher),
    signature: b64encode(signature),
    public_key: b64encode(publicKey),
  };

  const envelopeBytes = toBytes(JSON.stringify(envelope));
  const checksum = await sha256Hex(envelopeBytes);
  const filename = `${params.project.slug}-trial-${generatedAt.slice(0, 10)}.aivra`;

  return {
    filename,
    checksum,
    size_bytes: envelopeBytes.byteLength,
    signature_b64: b64encode(signature),
    public_key_b64: b64encode(publicKey),
    content_base64: b64encode(envelopeBytes),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminRequest(req);
    await connectToDatabase();

    const downloadId = req.nextUrl.searchParams.get("download_license_id");
    if (downloadId) {
      const lic: any = await License.findOne({ id: downloadId }).lean();
      if (!lic) return NextResponse.json({ ok: false, error: "License not found" }, { status: 404 });
      const [project, client] = await Promise.all([
        Project.findOne({ id: lic.project_id }).lean<any>(),
        Client.findOne({ id: lic.client_id }).lean<any>(),
      ]);
      const template = project?.template_id
        ? await BusinessTemplate.findOne({ id: project.template_id }).lean<any>()
        : null;
      const pkg = await buildSignedAivraEnvelope({
        project,
        client,
        template,
        license: lic,
        logoUrl: lic.branding?.logo_url || project?.branding?.logo_url || null,
      });
      return NextResponse.json({
        ok: true,
        filename: pkg.filename,
        content_base64: pkg.content_base64,
        license_key: lic.license_key,
      });
    }

    const trials: any[] = await License.find({
      $or: [
        { "features.is_trial": true },
        { "features.created_via": "quick_trial" },
      ],
    })
      .sort({ created_at: -1 })
      .limit(100)
      .lean();

    const clientIds = Array.from(new Set(trials.map((t) => t.client_id).filter(Boolean)));
    const projectIds = Array.from(new Set(trials.map((t) => t.project_id).filter(Boolean)));
    const licenseIds = trials.map((t) => t.id);

    const [clients, projects, seats] = await Promise.all([
      Client.find({ id: { $in: clientIds } }).lean<any[]>(),
      Project.find({ id: { $in: projectIds } }).lean<any[]>(),
      LicenseSeat.find({ license_id: { $in: licenseIds } }).lean<any[]>(),
    ]);

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const seatsByLicense = new Map<string, number>();
    for (const s of seats) {
      seatsByLicense.set(s.license_id, (seatsByLicense.get(s.license_id) || 0) + 1);
    }

    const nowMs = Date.now();
    const items = trials.map((lic) => {
      const client = clientMap.get(lic.client_id);
      const project = projectMap.get(lic.project_id);
      const isTrial = Boolean(lic.features?.is_trial);
      const expMs = lic.expires_at ? new Date(lic.expires_at).getTime() : null;
      const expired = Boolean(expMs && nowMs > expMs);
      let trialState: "active" | "expired" | "converted" | "suspended" = "active";
      if (lic.status !== "active") trialState = "suspended";
      else if (!isTrial) trialState = "converted";
      else if (expired) trialState = "expired";

      return {
        id: lic.id,
        license_key: lic.license_key,
        status: lic.status,
        trial_state: trialState,
        is_trial: isTrial,
        trial_days: Number(lic.features?.trial_days || 3),
        expires_at: lic.expires_at || null,
        issued_at: lic.issued_at || lic.created_at,
        issued_by: lic.issued_by || "Admin",
        seats: lic.seats || 1,
        seats_used: seatsByLicense.get(lic.id) || 0,
        client_name: client?.contact_name || client?.name || "—",
        pharmacy_name: project?.name || client?.name || "—",
        phone: client?.contact_phone || null,
        city: client?.address || null,
        logo_url: lic.branding?.logo_url || project?.branding?.logo_url || null,
      };
    });

    return NextResponse.json({ ok: true, trials: items });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to load quick trials" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();

    const body = await req.json();
    const clientName = String(body?.client_name || "").trim();
    const pharmacyName = String(body?.pharmacy_name || "").trim();
    const phone = String(body?.phone || "").trim();
    const city = String(body?.city || "").trim();
    const logoBase64 = typeof body?.logo_base64 === "string" ? body.logo_base64.trim() : "";
    const trialDays = Math.min(30, Math.max(1, Number(body?.trial_days || 3)));

    if (!clientName || !pharmacyName) {
      return NextResponse.json(
        { ok: false, error: "Both Client Name and Pharmacy Name are required." },
        { status: 400 }
      );
    }

    // 1. Find existing Pharmacy BusinessTemplate (or create clean default)
    let template: any =
      (await BusinessTemplate.findOne({ slug: /pharmacy/i }).lean()) ||
      (await BusinessTemplate.findOne({}).lean());
    if (!template) {
      template = await BusinessTemplate.create({
        name: "Pharmacy POS",
        slug: "pharmacy-pos",
        description: "Standard AivraSol Pharmacy POS template",
        modules: {
          billing: true,
          inventory: true,
          purchases: true,
          customers: true,
          suppliers: true,
          reports: true,
          cashbook: true,
          controlled_drugs: true,
          multi_user: true,
        },
        status: "active",
      });
    }

    // 2. Create Client record (standard schema — fully compatible with existing Clients page)
    const client = await Client.create({
      name: pharmacyName,
      contact_name: clientName,
      contact_phone: phone || undefined,
      address: city || undefined,
      status: "active",
      notes: `Quick ${trialDays}-Day Trial issued by ${actor.name}`,
      created_by: actor.name,
    });

    // 3. Create Project record (standard schema — full updated POS modules enabled)
    const projectSlug = slugifyPharmacy(pharmacyName);
    const project = await Project.create({
      client_id: client.id,
      template_id: template.id,
      name: pharmacyName,
      slug: projectSlug,
      status: "packaged",
      branding: {
        store_name: pharmacyName,
        ...(logoBase64 ? { logo_preview_uploaded: true } : {}),
      },
      modules_config: {
        cloud_dashboard: false,
        cloud_backup: false,
        online_orders: false,
        controlled_drugs: true,
        multi_user: true,
      },
      notes: `Quick ${trialDays}-Day Trial project`,
      created_by: actor.name,
    });

    // 4. Create Trial License (exact 3-day expiry, zero extra grace, full POS unlocked in Trial Mode)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const licenseKey = generateLicenseKey();

    const license = await License.create({
      client_id: client.id,
      project_id: project.id,
      license_key: licenseKey,
      seats: 1,
      status: "active",
      issued_at: now,
      expires_at: expiresAt,
      grace_until: null,
      issued_by: actor.name,
      license_version: 1,
      notes: `Quick ${trialDays}-Day Trial (${clientName})`,
      features: {
        is_trial: true,
        trial_days: trialDays,
        trial_started_at: now.toISOString(),
        created_via: "quick_trial",
        cloud_dashboard: false,
        cloud_backup: false,
        online_orders: false,
      },
    });

    // 5. Optional Logo upload to R2 via existing canonical license branding service
    let logoUrl: string | null = null;
    if (logoBase64) {
      try {
        const up = await uploadLicensePharmacyLogo({
          licenseId: license.id,
          imageBase64: logoBase64,
          actorLabel: actor.name,
          actorId: actor.userId,
          actorEmail: actor.email,
        });
        if (up.ok) {
          logoUrl = up.logoUrl;
        }
      } catch (e) {
        console.warn("Quick Trial R2 logo upload skipped:", e);
      }
      // Fallback: if R2 is unavailable in dev, preserve compact data URL in project branding
      if (!logoUrl && logoBase64.startsWith("data:image/") && logoBase64.length <= 280_000) {
        logoUrl = logoBase64;
        await Project.updateOne({ id: project.id }, { $set: { "branding.logo_url": logoUrl } });
      }
    }

    // 6. Generate signed .aivra bundle (exact `aivra/1` format for full compatibility!)
    const freshLicense: any = (await License.findOne({ id: license.id }).lean()) || license.toObject();
    const freshProject: any = (await Project.findOne({ id: project.id }).lean()) || project.toObject();
    const pkg = await buildSignedAivraEnvelope({
      project: freshProject,
      client: client.toObject(),
      template,
      license: freshLicense,
      logoUrl,
    });

    await Package.create({
      project_id: project.id,
      license_id: license.id,
      version: "Auto",
      filename: pkg.filename,
      size_bytes: pkg.size_bytes,
      checksum_sha256: pkg.checksum,
      signature: pkg.signature_b64,
      public_key: pkg.public_key_b64,
      notes: `Quick ${trialDays}-Day Trial package`,
      created_by: actor.name,
    });

    // 7. Record admin activity under acting admin's name
    await recordAdminActivity({
      actor,
      action: "quick_trial.create",
      entity_type: "quick_trial",
      entity_id: license.id,
      summary: `Issued ${trialDays}-day trial for "${pharmacyName}" (Client: ${clientName}, Key: ${licenseKey})`,
      metadata: {
        client_id: client.id,
        project_id: project.id,
        license_id: license.id,
        license_key: licenseKey,
        trial_days: trialDays,
        expires_at: expiresAt.toISOString(),
        has_logo: Boolean(logoUrl),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        license_id: license.id,
        license_key: licenseKey,
        trial_days: trialDays,
        expires_at: expiresAt.toISOString(),
        client_name: clientName,
        pharmacy_name: pharmacyName,
        logo_url: logoUrl,
        filename: pkg.filename,
        size_bytes: pkg.size_bytes,
        checksum: pkg.checksum,
        content_base64: pkg.content_base64,
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to create trial" }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();

    const body = await req.json();
    const licenseId = String(body?.license_id || "").trim();
    const action = String(body?.action || "extend").trim();

    if (!licenseId) {
      return NextResponse.json({ ok: false, error: "license_id is required" }, { status: 400 });
    }

    const lic: any = await License.findOne({ id: licenseId });
    if (!lic) {
      return NextResponse.json({ ok: false, error: "License not found" }, { status: 404 });
    }

    const now = new Date();
    let summary = "";

    if (action === "extend") {
      const days = Math.min(365, Math.max(1, Number(body?.extend_days || 3)));
      const baseTime =
        lic.expires_at && new Date(lic.expires_at).getTime() > now.getTime()
          ? new Date(lic.expires_at).getTime()
          : now.getTime();
      const nextExpiry = new Date(baseTime + days * 24 * 60 * 60 * 1000);
      lic.expires_at = nextExpiry;
      lic.status = "active";
      lic.grace_until = null;
      lic.license_version = Number(lic.license_version || 1) + 1;
      await lic.save();
      summary = `Extended trial license ${lic.license_key} by +${days} day(s) until ${nextExpiry.toLocaleDateString()}`;
    } else if (action === "convert_full") {
      const days = Math.min(3650, Math.max(30, Number(body?.full_days || 365)));
      const nextExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      lic.expires_at = nextExpiry;
      lic.status = "active";
      lic.features = {
        ...(lic.features || {}),
        is_trial: false,
        trial_converted: true,
        trial_converted_at: now.toISOString(),
        trial_converted_by: actor.name,
      };
      lic.markModified("features");
      lic.license_version = Number(lic.license_version || 1) + 1;
      await lic.save();
      summary = `Converted trial license ${lic.license_key} to Full Active License (${days} days)`;
    } else if (action === "suspend") {
      lic.status = "suspended";
      lic.license_version = Number(lic.license_version || 1) + 1;
      await lic.save();
      summary = `Suspended trial license ${lic.license_key}`;
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
    }

    await recordAdminActivity({
      actor,
      action: `quick_trial.${action}`,
      entity_type: "quick_trial",
      entity_id: lic.id,
      summary,
      metadata: { license_key: lic.license_key, expires_at: lic.expires_at, status: lic.status },
    });

    return NextResponse.json({
      ok: true,
      license: {
        id: lic.id,
        license_key: lic.license_key,
        status: lic.status,
        expires_at: lic.expires_at,
        is_trial: Boolean(lic.features?.is_trial),
      },
    });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to update trial" }, { status });
  }
}
