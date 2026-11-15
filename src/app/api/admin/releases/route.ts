import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import Release from "@/models/Release";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import { checkR2Object } from "@/lib/r2";
import {
  ANDROID_APK_MAX_BYTES,
  ANDROID_POS_PLATFORM,
  ANDROID_POS_PRODUCT,
  ANDROID_RELEASE_MANIFEST_FORMAT,
  ANDROID_WEB_BUNDLE_MAX_BYTES,
  DEFAULT_ANDROID_PACKAGE_ID,
  getReleaseSigningStatus,
  normalizeAndroidChannel,
  normalizeHexSha256,
  parseStrictSemver,
  signAndroidReleaseManifest,
  streamInspectR2Artifact,
  WINDOWS_FULL_MAX_BYTES,
  WINDOWS_HOT_MAX_BYTES,
} from "@/lib/release-signing";

export async function GET(req: NextRequest) {
  try {
    await requireAdminRequest(req);
    await connectToDatabase();

    const appType = req.nextUrl.searchParams.get("appType");
    const filter: Record<string, any> = {};
    if (appType === "android-pos") {
      filter.app_type = "android-pos";
    } else if (appType === "windows-pos") {
      filter.$or = [
        { app_type: "windows-pos" },
        { app_type: { $exists: false } },
        { app_type: null },
      ];
    }

    const [releases, signingStatus] = await Promise.all([
      Release.find(filter).sort({ created_at: -1 }).lean(),
      getReleaseSigningStatus(),
    ]);

    return NextResponse.json({
      releases,
      capabilities: {
        r2Configured: Boolean(
          process.env.R2_ENDPOINT &&
            process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY
        ),
        signingConfigured: signingStatus.configured,
        signingKeyId: signingStatus.keyId,
        signingPublicKeyB64: signingStatus.publicKeyB64,
        signingError: signingStatus.error || null,
      },
    });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/releases error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();
    const body = await req.json();

    const appType = body.appType === "android-pos" ? "android-pos" : "windows-pos";
    const platform = appType === "android-pos" ? "android" : "windows";
    const releaseType = String(body.releaseType || (appType === "android-pos" ? "web-bundle" : "hot"));
    const status = body.status === "published" ? "published" : "draft";
    const objectKey = String(body.objectKey || "").trim();
    const versionInput = String(body.version || "").trim();
    const rolloutType = body.rolloutType === "specific" ? "specific" : "all";
    const targetClientIds = Array.isArray(body.targetClientIds)
      ? body.targetClientIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : [];
    const mandatory = Boolean(body.mandatory);
    const changelog = typeof body.changelog === "string" ? body.changelog : "";

    if (!versionInput || !objectKey || !objectKey.startsWith("releases/") || objectKey.includes("..")) {
      return NextResponse.json(
        { error: "Valid version and R2 objectKey under releases/ are required." },
        { status: 400 }
      );
    }

    if (rolloutType === "specific" && targetClientIds.length === 0) {
      return NextResponse.json(
        { error: "Specific rollout requires at least one target pharmacy client." },
        { status: 400 }
      );
    }

    // 1. Verify R2 object actually uploaded & non-empty
    const r2Meta = await checkR2Object(objectKey);
    if (!r2Meta) {
      return NextResponse.json(
        { error: `R2 object "${objectKey}" was not found. Upload the artifact to R2 first.` },
        { status: 400 }
      );
    }

    const declaredSize = body.sizeBytes !== undefined ? Number(body.sizeBytes) : r2Meta.size;
    if (!Number.isFinite(declaredSize) || declaredSize !== r2Meta.size) {
      return NextResponse.json(
        {
          error: `R2 object size mismatch (expected ${declaredSize} bytes, stored ${r2Meta.size} bytes).`,
        },
        { status: 400 }
      );
    }

    const maxBytes =
      appType === "android-pos"
        ? releaseType === "apk"
          ? ANDROID_APK_MAX_BYTES
          : ANDROID_WEB_BUNDLE_MAX_BYTES
        : releaseType === "full"
          ? WINDOWS_FULL_MAX_BYTES
          : WINDOWS_HOT_MAX_BYTES;

    // 2. Server-side stream hash + ZIP/APK archive header inspection
    const inspected = await streamInspectR2Artifact(objectKey, {
      maxBytes,
      requireZipMagic: appType === "android-pos",
    });

    const submittedSha = body.sha256 ? normalizeHexSha256(body.sha256) : null;
    if (body.sha256 && !submittedSha) {
      return NextResponse.json(
        { error: "Submitted sha256 must be a 64-character hex SHA-256 digest." },
        { status: 400 }
      );
    }
    if (submittedSha && submittedSha !== inspected.sha256) {
      return NextResponse.json(
        {
          error: `Artifact SHA-256 verification failed: expected ${submittedSha}, computed ${inspected.sha256}.`,
        },
        { status: 400 }
      );
    }

    const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "") || "";
    const resolvedUrl = publicBase ? `${publicBase}/${objectKey}` : objectKey;

    if (appType === "windows-pos") {
      if (releaseType !== "hot" && releaseType !== "full") {
        return NextResponse.json({ error: "Invalid Windows releaseType." }, { status: 400 });
      }
      const created = await Release.create({
        version: versionInput,
        app_type: "windows-pos",
        platform: "windows",
        channel: normalizeAndroidChannel(body.channel, "stable"),
        release_type: releaseType,
        mandatory,
        min_version: body.minVersion ? String(body.minVersion) : undefined,
        rollout_type: rolloutType,
        target_client_ids: rolloutType === "specific" ? targetClientIds : [],
        status,
        changelog,
        asar_url: releaseType === "hot" ? resolvedUrl : undefined,
        full_package_url: releaseType === "full" ? resolvedUrl : undefined,
        object_key: objectKey,
        storage_path: resolvedUrl,
        installer_size: inspected.sizeBytes,
        sha256: inspected.sha256,
        published_at: status === "published" ? new Date() : undefined,
        created_by: actor.email,
      });

      await AuditLog.create({
        action: "windows_release_created",
        entity_type: "release",
        entity_id: created.id,
        actor_id: actor.userId,
        metadata: { version: created.version, releaseType, status, objectKey, sha256: inspected.sha256 },
      }).catch(() => {});

      return NextResponse.json({ release: created }, { status: 201 });
    }

    // --- Android POS release validation + mandatory Ed25519 manifest signing ---
    const parsedVer = parseStrictSemver(versionInput);
    if (!parsedVer) {
      return NextResponse.json(
        { error: `Android version "${versionInput}" is not valid SemVer (e.g. 1.0.1).` },
        { status: 400 }
      );
    }

    if (releaseType !== "web-bundle" && releaseType !== "apk") {
      return NextResponse.json(
        { error: 'Android releaseType must be "web-bundle" or "apk".' },
        { status: 400 }
      );
    }

    const channel = normalizeAndroidChannel(body.channel, "stable");
    const packageId = String(body.packageId || DEFAULT_ANDROID_PACKAGE_ID).trim();
    if (packageId !== DEFAULT_ANDROID_PACKAGE_ID) {
      return NextResponse.json(
        { error: `Invalid Android packageId "${packageId}". Expected "${DEFAULT_ANDROID_PACKAGE_ID}".` },
        { status: 400 }
      );
    }

    const schemaVersion = Number(body.schemaVersion ?? 1);
    const minNativeVersionCode = Number(body.minNativeVersionCode ?? 1);
    const maxNativeVersionCode =
      body.maxNativeVersionCode !== undefined &&
      body.maxNativeVersionCode !== null &&
      body.maxNativeVersionCode !== ""
        ? Number(body.maxNativeVersionCode)
        : null;
    const minWebVersion =
      typeof body.minWebVersion === "string" && body.minWebVersion.trim()
        ? parseStrictSemver(body.minWebVersion.trim())?.raw || null
        : null;

    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      return NextResponse.json({ error: "schemaVersion must be an integer >= 1." }, { status: 400 });
    }
    if (!Number.isSafeInteger(minNativeVersionCode) || minNativeVersionCode < 1) {
      return NextResponse.json(
        { error: "minNativeVersionCode must be an integer >= 1." },
        { status: 400 }
      );
    }
    if (
      maxNativeVersionCode !== null &&
      (!Number.isSafeInteger(maxNativeVersionCode) || maxNativeVersionCode < minNativeVersionCode)
    ) {
      return NextResponse.json(
        { error: "maxNativeVersionCode must be >= minNativeVersionCode." },
        { status: 400 }
      );
    }

    let versionCode: number | null = null;
    let signingCertSha256: string | null = body.signingCertSha256
      ? normalizeHexSha256(body.signingCertSha256)
      : null;

    if (releaseType === "apk") {
      const vc = Number(body.versionCode);
      if (!Number.isSafeInteger(vc) || vc < 1) {
        return NextResponse.json(
          { error: "Full APK releases require a positive integer versionCode." },
          { status: 400 }
        );
      }
      versionCode = vc;
      if (!signingCertSha256) {
        return NextResponse.json(
          {
            error:
              "Full APK releases require the 64-hex signingCertSha256 fingerprint (from apk-meta.json or apksigner) so devices verify keystore continuity.",
          },
          { status: 400 }
        );
      }
    } else if (body.signingCertSha256 && !signingCertSha256) {
      return NextResponse.json(
        { error: "signingCertSha256 must be a valid 64-character hex SHA-256 fingerprint." },
        { status: 400 }
      );
    }

    const signingStatus = await getReleaseSigningStatus();
    if (!signingStatus.configured) {
      return NextResponse.json(
        {
          error:
            signingStatus.error ||
            "RELEASE_MANIFEST_SIGNING_SEED is not configured. Signed Android releases cannot be created unsigned.",
        },
        { status: 400 }
      );
    }

    const latestSeqDoc = (await Release.findOne({
      app_type: ANDROID_POS_PRODUCT,
      platform: ANDROID_POS_PLATFORM,
      release_seq: { $exists: true },
    })
      .sort({ release_seq: -1 })
      .lean()) as any;
    const requestedSeq = Number(body.releaseSeq ?? 0);
    const nextSeq = Math.max(
      Number.isSafeInteger(latestSeqDoc?.release_seq) ? latestSeqDoc.release_seq + 1 : 1,
      Number.isSafeInteger(requestedSeq) && requestedSeq > 0 ? requestedSeq : 1
    );

    const releaseId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();

    const manifestPayload = {
      format: ANDROID_RELEASE_MANIFEST_FORMAT,
      releaseId,
      releaseSeq: nextSeq,
      product: ANDROID_POS_PRODUCT,
      platform: ANDROID_POS_PLATFORM,
      channel,
      releaseType: releaseType as "web-bundle" | "apk",
      version: parsedVer.raw,
      versionCode,
      minNativeVersionCode,
      maxNativeVersionCode,
      minWebVersion,
      schemaVersion,
      packageId,
      signingCertSha256,
      sha256: inspected.sha256,
      sizeBytes: inspected.sizeBytes,
      mandatory,
      issuedAt,
      expiresAt: null,
    };

    const signed = await signAndroidReleaseManifest(manifestPayload);

    const created = await Release.create({
      id: releaseId,
      version: parsedVer.raw,
      app_type: ANDROID_POS_PRODUCT,
      platform: ANDROID_POS_PLATFORM,
      channel,
      release_type: releaseType,
      release_seq: nextSeq,
      package_id: packageId,
      version_code: versionCode ?? undefined,
      min_native_version_code: minNativeVersionCode,
      max_native_version_code: maxNativeVersionCode,
      min_web_version: minWebVersion,
      schema_version: schemaVersion,
      signing_cert_sha256: signingCertSha256,
      mandatory,
      rollout_type: rolloutType,
      target_client_ids: rolloutType === "specific" ? targetClientIds : [],
      status,
      disabled: false,
      is_prerelease: channel !== "stable",
      changelog,
      object_key: objectKey,
      bundle_url: releaseType === "web-bundle" ? objectKey : undefined,
      full_package_url: releaseType === "apk" ? objectKey : undefined,
      storage_path: objectKey,
      installer_size: inspected.sizeBytes,
      sha256: inspected.sha256,
      manifest_json: signed.manifestJson,
      manifest_signature: signed.signature,
      manifest_key_id: signed.keyId,
      signature_status: "signed",
      published_at: status === "published" ? new Date() : undefined,
      created_by: actor.email,
    });

    await AuditLog.create({
      action: "android_release_created",
      entity_type: "release",
      entity_id: created.id,
      actor_id: actor.userId,
      metadata: {
        version: created.version,
        releaseType,
        channel,
        releaseSeq: nextSeq,
        versionCode,
        status,
        objectKey,
        sha256: inspected.sha256,
        keyId: signed.keyId,
      },
    }).catch(() => {});

    return NextResponse.json({ release: created }, { status: 201 });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/admin/releases error:", err);
    return NextResponse.json({ error: err?.message || "Failed to create release." }, { status: 500 });
  }
}

