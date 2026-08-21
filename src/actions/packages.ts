"use server";

import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/db";
import Project from "@/models/Project";
import License from "@/models/License";
import Package from "@/models/Package";
import AuditLog from "@/models/AuditLog";
import UserRole from "@/models/UserRole";
import Client from "@/models/Client";
import BusinessTemplate from "@/models/BusinessTemplate";
import Profile from "@/models/Profile";
import { webcrypto } from "node:crypto";

const crypto = webcrypto as any;

const FORMAT = "aivra/1";

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
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
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function aesEncrypt(keyMaterial: Uint8Array, plaintext: Uint8Array) {
  const rawKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", keyMaterial as unknown as BufferSource),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext as unknown as BufferSource,
    ),
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
          await crypto.subtle.digest(
            "SHA-256",
            toBytes(seedInput) as unknown as BufferSource,
          ),
        );
  if (seed.length !== 32) throw new Error("Signing seed must be 32 bytes");
  const publicKey = ed.getPublicKey(seed);
  const signature = ed.sign(message, seed);
  return { publicKey, signature };
}

export async function generatePackage(data: { project_id: string; license_id?: string; notes?: string }) {
  try {
    const session = await getServerSession();
    if (!session || !session.user || !session.user.email) throw new Error("Unauthorized");
    
    await connectToDatabase();
    const userEmail = session.user.email;
    
    let userId = "master-admin";
    let isAdmin = userEmail === process.env.ADMIN_EMAIL;
    
    if (!isAdmin) {
      const profile = await Profile.findOne({ email: userEmail }).lean();
      if (!profile) throw new Error("Profile not found");
      userId = profile.id;
      const roles = await UserRole.find({ user_id: userId }).lean();
      isAdmin = roles.some((r: any) => r.role === "admin" || r.role === "super_admin");
    }
    if (!isAdmin) throw new Error("Forbidden");

    const project: any = await Project.findOne({ id: data.project_id }).lean();
    if (!project) throw new Error("Project not found");

    const client = await Client.findOne({ id: project.client_id }).lean();
    const template = await BusinessTemplate.findOne({ id: project.template_id }).lean();
    
    let license = null;
    if (data.license_id) {
      license = await License.findOne({ id: data.license_id, project_id: data.project_id }).lean();
    }

    const generatedAt = new Date().toISOString();

    const manifest = {
      format: FORMAT,
      generated_at: generatedAt,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        version: "Auto",
        modules_config: project.modules_config,
        branding: project.branding,
        hardware_config: project.hardware_config,
      },
      client: client ?? null,
      template: template ?? null,
      license: license
        ? {
            id: license.id,
            key: license.license_key,
            machine_fingerprint: license.machine_fingerprint,
            expires_at: license.expires_at,
            status: license.status,
            seats: license.seats,
          }
        : null,
    };

    const manifestBytes = toBytes(JSON.stringify(manifest));

    const fallbackKey = process.env.PACKAGE_ENCRYPTION_KEY || "fallback_encryption_key_1234567890";
    const signSeed = process.env.PACKAGE_SIGNING_SEED || "fallback_signing_seed_1234567890";
    
    const encKey = license?.license_key ?? fallbackKey;
    if (!encKey) throw new Error("No encryption key available");

    const { iv, cipher } = await aesEncrypt(toBytes(encKey), manifestBytes);

    const signed = new Uint8Array(iv.length + cipher.length);
    signed.set(iv, 0);
    signed.set(cipher, iv.length);
    const { publicKey, signature } = await ed25519Sign(signSeed, signed);

    const envelope = {
      format: FORMAT,
      alg: { cipher: "AES-256-GCM", signature: "Ed25519" },
      created_at: generatedAt,
      project_slug: project.slug,
      project_version: "Auto",
      iv: b64encode(iv),
      ciphertext: b64encode(cipher),
      signature: b64encode(signature),
      public_key: b64encode(publicKey),
    };

    const envelopeBytes = toBytes(JSON.stringify(envelope));
    const checksum = await sha256Hex(envelopeBytes);
    const filename = `${project.slug}-vAuto-${generatedAt.slice(0, 10)}.aivra`;

    const pkgRow = await Package.create({
      project_id: project.id,
      license_id: license?.id ?? null,
      version: "Auto",
      filename,
      size_bytes: envelopeBytes.byteLength,
      checksum_sha256: checksum,
      signature: b64encode(signature),
      public_key: b64encode(publicKey),
      notes: data.notes ?? null,
      created_by: userId,
    });

    await Project.findOneAndUpdate({ id: project.id }, { status: "packaged" });

    await AuditLog.create({
      actor_id: userId,
      action: "package.generate",
      entity_type: "package",
      entity_id: pkgRow.id,
      metadata: { project_id: project.id, license_id: license?.id ?? null, checksum },
    });

    return {
      id: pkgRow.id,
      filename,
      checksum,
      size_bytes: envelopeBytes.byteLength,
      content_base64: b64encode(envelopeBytes),
    };
  } catch (error: any) {
    console.log("GENERATE PACKAGE CRASHED:", String(error));
    return { error: error.message || String(error) || "Internal generation failed" };
  }
}
