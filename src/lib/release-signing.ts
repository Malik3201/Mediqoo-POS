import crypto from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { getR2BucketName, getR2Client } from "@/lib/r2";

export const ANDROID_RELEASE_MANIFEST_FORMAT = "aivrasol-release-manifest/1" as const;
export const ANDROID_POS_PRODUCT = "android-pos" as const;
export const ANDROID_POS_PLATFORM = "android" as const;
export const DEFAULT_ANDROID_PACKAGE_ID = "com.aivrasol.pos" as const;

export const ANDROID_WEB_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;
export const ANDROID_APK_MAX_BYTES = 250 * 1024 * 1024;
export const WINDOWS_HOT_MAX_BYTES = 150 * 1024 * 1024;
export const WINDOWS_FULL_MAX_BYTES = 500 * 1024 * 1024;

export type AndroidReleaseChannel = "stable" | "beta" | "debug";
export type AndroidReleaseType = "web-bundle" | "apk";

export interface AndroidReleaseManifestPayload {
  format: typeof ANDROID_RELEASE_MANIFEST_FORMAT;
  releaseId: string;
  releaseSeq: number;
  product: typeof ANDROID_POS_PRODUCT;
  platform: typeof ANDROID_POS_PLATFORM;
  channel: AndroidReleaseChannel;
  releaseType: AndroidReleaseType;
  version: string;
  versionCode: number | null;
  minNativeVersionCode: number;
  maxNativeVersionCode: number | null;
  minWebVersion: string | null;
  schemaVersion: number;
  packageId: string;
  signingCertSha256: string | null;
  sha256: string;
  sizeBytes: number;
  mandatory: boolean;
  issuedAt: string;
  expiresAt: string | null;
}

export interface SignedReleaseManifestEnvelope {
  format: typeof ANDROID_RELEASE_MANIFEST_FORMAT;
  alg: "Ed25519";
  keyId: string;
  payload: AndroidReleaseManifestPayload;
  signature: string;
}

const SEMVER_REGEX =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX64_REGEX = /^[a-f0-9]{64}$/;

export function normalizeHexSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/:/g, "").toLowerCase();
  return HEX64_REGEX.test(clean) ? clean : null;
}

export function normalizeAndroidChannel(
  value: unknown,
  fallback: AndroidReleaseChannel = "stable"
): AndroidReleaseChannel {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "stable" || s === "beta" || s === "debug") return s;
  return fallback;
}

export function parseStrictSemver(input: unknown) {
  if (typeof input !== "string") return null;
  const match = SEMVER_REGEX.exec(input.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  const prerelease = match[4] ? match[4].split(".") : [];
  return {
    major,
    minor,
    patch,
    prerelease,
    raw: `${major}.${minor}.${patch}${prerelease.length ? `-${prerelease.join(".")}` : ""}`,
  };
}

export function compareStrictSemver(a: string, b: string): number | null {
  const pa = parseStrictSemver(a);
  const pb = parseStrictSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const na = Number(ai);
      const nb = Number(bi);
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const entry = obj[key];
    if (entry !== undefined) {
      sorted[key] = canonicalizeValue(entry);
    }
  }
  return sorted;
}

export function canonicalDeepSerialize(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

/**
 * Strictly reads ONLY `RELEASE_MANIFEST_SIGNING_SEED`.
 * Never falls back to `LICENSE_STATUS_SIGNING_SEED` or hardcoded keys.
 */
function loadConfiguredSigningSeed(): Uint8Array {
  const raw = process.env.RELEASE_MANIFEST_SIGNING_SEED;
  if (!raw || !raw.trim()) {
    throw new Error(
      "RELEASE_MANIFEST_SIGNING_SEED is not configured on the server. Signed Android releases cannot be created or published until a dedicated 64-hex Ed25519 signing seed is set."
    );
  }
  const cleanHex = raw.trim().replace(/[^0-9a-fA-F]/g, "");
  if (cleanHex.length !== 64) {
    throw new Error(
      "RELEASE_MANIFEST_SIGNING_SEED must be a 64-character hexadecimal string (32-byte raw Ed25519 seed)."
    );
  }
  return Uint8Array.from(Buffer.from(cleanHex, "hex"));
}

async function getEdModule() {
  const ed = await import("@noble/ed25519");
  const { sha512 } = await import("@noble/hashes/sha2.js");
  (ed as any).hashes ||= {};
  (ed as any).hashes.sha512 = sha512;
  return ed;
}

export async function getReleaseSigningStatus(): Promise<{
  configured: boolean;
  keyId: string | null;
  publicKeyB64: string | null;
  error?: string;
}> {
  try {
    const seed = loadConfiguredSigningSeed();
    const ed = await getEdModule();
    const pubBytes = Uint8Array.from(await Promise.resolve(ed.getPublicKey(seed)));
    const keyId = crypto.createHash("sha256").update(pubBytes).digest("hex").slice(0, 16);
    return {
      configured: true,
      keyId,
      publicKeyB64: Buffer.from(pubBytes).toString("base64"),
    };
  } catch (err: any) {
    return {
      configured: false,
      keyId: null,
      publicKeyB64: null,
      error: err?.message || "Release signing key is not configured.",
    };
  }
}

export async function signAndroidReleaseManifest(
  payload: AndroidReleaseManifestPayload
): Promise<{
  envelope: SignedReleaseManifestEnvelope;
  manifestJson: string;
  signature: string;
  keyId: string;
  publicKeyB64: string;
}> {
  const seed = loadConfiguredSigningSeed();
  const ed = await getEdModule();
  const pubBytes = Uint8Array.from(await Promise.resolve(ed.getPublicKey(seed)));
  const keyId = crypto.createHash("sha256").update(pubBytes).digest("hex").slice(0, 16);
  const canonicalPayloadStr = canonicalDeepSerialize(payload);
  const messageBytes = new TextEncoder().encode(canonicalPayloadStr);
  const sigBytes = Uint8Array.from(await Promise.resolve(ed.sign(messageBytes, seed)));

  // Immediate self-verification guard before returning or persisting
  const verified = await Promise.resolve(ed.verify(sigBytes, messageBytes, pubBytes));
  if (!verified) {
    throw new Error("Ed25519 self-verification failed for release manifest.");
  }

  const signature = Buffer.from(sigBytes).toString("base64");
  const envelope: SignedReleaseManifestEnvelope = {
    format: ANDROID_RELEASE_MANIFEST_FORMAT,
    alg: "Ed25519",
    keyId,
    payload,
    signature,
  };

  return {
    envelope,
    manifestJson: canonicalDeepSerialize(envelope),
    signature,
    keyId,
    publicKeyB64: Buffer.from(pubBytes).toString("base64"),
  };
}

export async function verifyStoredManifestWithServerKey(
  manifestJson: string | undefined | null
): Promise<{ ok: true; envelope: SignedReleaseManifestEnvelope } | { ok: false; error: string }> {
  if (!manifestJson) {
    return { ok: false, error: "Release has no signed manifest JSON." };
  }
  const status = await getReleaseSigningStatus();
  if (!status.configured || !status.publicKeyB64) {
    return {
      ok: false,
      error: status.error || "RELEASE_MANIFEST_SIGNING_SEED is not configured.",
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return { ok: false, error: "Stored manifest JSON is corrupt." };
  }

  if (
    !parsed ||
    parsed.format !== ANDROID_RELEASE_MANIFEST_FORMAT ||
    parsed.alg !== "Ed25519" ||
    typeof parsed.signature !== "string" ||
    !parsed.payload
  ) {
    return { ok: false, error: "Stored manifest envelope has invalid structure." };
  }

  try {
    const ed = await getEdModule();
    const pubBytes = Uint8Array.from(Buffer.from(status.publicKeyB64, "base64"));
    const sigBytes = Uint8Array.from(Buffer.from(parsed.signature, "base64"));
    const msgBytes = new TextEncoder().encode(canonicalDeepSerialize(parsed.payload));
    const ok = await Promise.resolve(ed.verify(sigBytes, msgBytes, pubBytes));
    if (!ok) {
      return { ok: false, error: "Manifest signature does not match active RELEASE_MANIFEST_SIGNING_SEED." };
    }
    return { ok: true, envelope: parsed as SignedReleaseManifestEnvelope };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to verify stored manifest signature." };
  }
}

/**
 * Streams an R2 object in O(1) memory to measure exact bytes, compute SHA-256,
 * and verify ZIP/APK magic header (`PK\x03\x04` or `PK\x05\x06`).
 */
export async function streamInspectR2Artifact(
  objectKey: string,
  options: { maxBytes: number; requireZipMagic?: boolean }
): Promise<{ sizeBytes: number; sha256: string }> {
  const client = getR2Client();
  const bucket = getR2BucketName();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
  if (!res.Body) {
    throw new Error(`R2 object body missing for ${objectKey}`);
  }

  const hash = crypto.createHash("sha256");
  const head = Buffer.alloc(4);
  let headLen = 0;
  let totalBytes = 0;

  const stream = res.Body as Readable;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > options.maxBytes) {
      stream.destroy();
      throw new Error(
        `Artifact exceeds maximum allowed size (${options.maxBytes} bytes).`
      );
    }
    if (headLen < 4) {
      const toCopy = Math.min(4 - headLen, buf.length);
      buf.copy(head, headLen, 0, toCopy);
      headLen += toCopy;
    }
    hash.update(buf);
  }

  if (totalBytes <= 0) {
    throw new Error("Uploaded R2 artifact is empty (0 bytes).");
  }

  if (options.requireZipMagic) {
    const isPk =
      headLen >= 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06));
    if (!isPk) {
      throw new Error("Uploaded artifact is not a valid ZIP/APK archive (missing PK signature).");
    }
  }

  return {
    sizeBytes: totalBytes,
    sha256: hash.digest("hex"),
  };
}

