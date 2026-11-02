import crypto from "crypto";
import zlib from "zlib";

export const BACKUP_COLLECTIONS_V2 = [
  "products",
  "customers",
  "invoices",
  "purchases",
  "sales-returns",
  "master-medicines",
  "prescriptions",
  "cashbook-entries",
  "suppliers",
  "supplier-payments",
  "purchase-returns",
  "khata-payments",
  "narcotics-register",
  "quotations",
  "pos-users",
  "operator-sessions",
  "migration-history",
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTIONS_V2)[number];

export interface BackupSnapshotV2 {
  format: "aivrasol-backup";
  version: 2;
  createdAt: string;
  schemaVersion: 1;
  collections: Record<string, unknown[]>;
  settings: Record<string, any>;
  manifest: {
    collections: { name: string; records: number }[];
    totalRecords: number;
    /** Optional collections (e.g. legacy-archive). Not part of totalRecords for backward compatibility. */
    optionalCollections?: { name: string; records: number }[];
  };
}

export interface EncryptedAivrabakEnvelope {
  format: "aivrasol-backup";
  v: 2;
  createdAt: string;
  compression: "gzip";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 200000;
    salt: string; // base64
  };
  cipher: {
    name: "AES-GCM";
    iv: string; // base64
  };
  ciphertext: string; // base64 (AES-GCM ciphertext + 16-byte auth tag)
}

/**
 * Encodes canonical pharmacy collections into a genuine, production-standard .aivrabak V2 file.
 * Exactly compatible with AivraSol POS `restoreBackup` in `aivrasol-pos/src/lib/backup.ts`.
 */
export function createEncryptedAivrabak(
  collections: Partial<Record<BackupCollectionName, unknown[]>>,
  passphrase: string,
  extraSettings: Record<string, any> = {},
  optionalCollections: Record<string, unknown[]> = {}
): {
  buffer: Buffer;
  snapshot: BackupSnapshotV2;
  sha256: string;
  totalRecords: number;
} {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Restore key/passphrase must be at least 6 characters.");
  }

  const createdAt = new Date().toISOString();
  const normalizedCollections: Record<string, unknown[]> = {};
  const manifestList: { name: string; records: number }[] = [];
  let totalRecords = 0;

  for (const name of BACKUP_COLLECTIONS_V2) {
    const rows = Array.isArray(collections[name]) ? (collections[name] as unknown[]) : [];
    normalizedCollections[name] = rows;
    manifestList.push({ name, records: rows.length });
    totalRecords += rows.length;
  }
  const optionalList: { name: string; records: number }[] = [];
  for (const [name, rows] of Object.entries(optionalCollections)) {
    if ((BACKUP_COLLECTIONS_V2 as readonly string[]).includes(name) || !Array.isArray(rows) || rows.length === 0) continue;
    normalizedCollections[name] = rows;
    optionalList.push({ name, records: rows.length });
  }

  const snapshot: BackupSnapshotV2 = {
    format: "aivrasol-backup",
    version: 2,
    createdAt,
    schemaVersion: 1,
    collections: normalizedCollections,
    settings: {
      // Migration packages never overwrite the target POS receipt/printing settings.
      migration: {
        isMigratedPackage: true,
        packageType: extraSettings.packageType || (extraSettings.targetLicenseKey ? "license-bound-legacy-migration" : "portable-legacy-migration"),
        isPortable: extraSettings.isPortable ?? !extraSettings.targetLicenseKey,
        migratedAt: createdAt,
        ...extraSettings,
      },
    },
    manifest: {
      collections: manifestList,
      totalRecords,
      ...(optionalList.length ? { optionalCollections: optionalList } : {}),
    },
  };

  // 1. JSON stringify
  const jsonBytes = Buffer.from(JSON.stringify(snapshot), "utf-8");

  // 2. GZIP compress
  const compressed = zlib.gzipSync(jsonBytes, { level: 9 });

  // 3. Derive AES-256-GCM key using PBKDF2 SHA-256 200,000 rounds
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 200000, 32, "sha256");

  // 4. AES-256-GCM encrypt
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(compressed),
    cipher.final(),
    cipher.getAuthTag(), // 16 bytes auth tag appended to ciphertext
  ]);

  // 5. Envelope
  const envelope: EncryptedAivrabakEnvelope = {
    format: "aivrasol-backup",
    v: 2,
    createdAt,
    compression: "gzip",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 200000,
      salt: salt.toString("base64"),
    },
    cipher: {
      name: "AES-GCM",
      iv: iv.toString("base64"),
    },
    ciphertext: encryptedPayload.toString("base64"),
  };

  const buffer = Buffer.from(JSON.stringify(envelope, null, 2), "utf-8");
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    snapshot,
    sha256,
    totalRecords,
  };
}

/**
 * Decrypts and verifies a generated .aivrabak V2 buffer using the restore key.
 * Throws if the restore key is wrong, format is invalid, or manifest doesn't match.
 */
export function verifyEncryptedAivrabak(
  buffer: Buffer,
  passphrase: string
): BackupSnapshotV2 {
  const text = buffer.toString("utf-8");
  let envelope: EncryptedAivrabakEnvelope;
  try {
    envelope = JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid .aivrabak JSON envelope format.");
  }

  if (envelope.format !== "aivrasol-backup" || envelope.v !== 2) {
    throw new Error(`Unsupported backup format/version: ${envelope.format} v${envelope.v}`);
  }

  if (envelope.compression !== "gzip") {
    throw new Error(`Unsupported compression: ${envelope.compression}`);
  }

  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.cipher.iv, "base64");
  const rawCiphertextWithTag = Buffer.from(envelope.ciphertext, "base64");

  if (rawCiphertextWithTag.length < 16) {
    throw new Error("Corrupted ciphertext payload.");
  }

  const ciphertext = rawCiphertextWithTag.subarray(0, rawCiphertextWithTag.length - 16);
  const tag = rawCiphertextWithTag.subarray(rawCiphertextWithTag.length - 16);

  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, envelope.kdf.iterations || 200000, 32, "sha256");

  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);

  let decompressedBytes: Buffer;
  try {
    const plainCompressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    decompressedBytes = zlib.gunzipSync(plainCompressed);
  } catch (err) {
    throw new Error("Decryption failed: Incorrect restore key or tampered ciphertext.");
  }

  const snapshot: BackupSnapshotV2 = JSON.parse(decompressedBytes.toString("utf-8"));

  // Verify strict manifest integrity
  if (!snapshot.manifest || !snapshot.collections) {
    throw new Error("Malformed V2 snapshot: missing collections or manifest.");
  }

  let totalCount = 0;
  for (const name of BACKUP_COLLECTIONS_V2) {
    const rows = snapshot.collections[name];
    if (!Array.isArray(rows)) {
      throw new Error(`Collection ${name} is missing or not an array.`);
    }
    const manifestItem = snapshot.manifest.collections.find((c) => c.name === name);
    if (!manifestItem || manifestItem.records !== rows.length) {
      throw new Error(
        `Manifest count mismatch for ${name}: manifest says ${manifestItem?.records}, actual is ${rows.length}`
      );
    }
    totalCount += rows.length;
  }

  if (totalCount !== snapshot.manifest.totalRecords) {
    throw new Error(
      `Manifest totalRecords mismatch: expected ${snapshot.manifest.totalRecords}, got ${totalCount}`
    );
  }

  for (const opt of snapshot.manifest.optionalCollections || []) {
    const rows = snapshot.collections[opt.name];
    if (!Array.isArray(rows) || rows.length !== opt.records) {
      throw new Error(`Optional collection ${opt.name} count mismatch: manifest ${opt.records}, actual ${Array.isArray(rows) ? rows.length : "missing"}`);
    }
  }

  return snapshot;
}

/**
 * Generates a cryptographically strong unique restore key with 256 bits of CSPRNG entropy.
 * Format: MIG-PORTABLE-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
 * (32 random bytes = 256 bits of entropy, split into 8 readable 8-character hex blocks)
 */
export function generateUniqueRestoreKey(sourcePrefix = "ABZ", isPortable = true): string {
  const randomBuf = crypto.randomBytes(32);
  const chunks: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    chunks.push(randomBuf.subarray(i, i + 4).toString("hex").toUpperCase());
  }
  const prefix = isPortable ? "MIG-PORTABLE" : `MIG-${sourcePrefix.toUpperCase().slice(0, 3)}`;
  return `${prefix}-${chunks.join("-")}`;
}

export const decryptAivrabakSnapshot = verifyEncryptedAivrabak;
