import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Client from "@/models/Client";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Release from "@/models/Release";
import ReleaseInstall from "@/models/ReleaseInstall";
import { extractRequestGeo } from "@/lib/geo-location";
import { extractR2KeyFromUrl, getPresignedDownloadUrl } from "@/lib/r2";
import {
  ANDROID_POS_PLATFORM,
  ANDROID_POS_PRODUCT,
  compareStrictSemver,
  DEFAULT_ANDROID_PACKAGE_ID,
  normalizeAndroidChannel,
  normalizeHexSha256,
  verifyStoredManifestWithServerKey,
} from "@/lib/release-signing";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function isChannelEligible(
  manifestChannel: string,
  requestedChannel: string,
  allowDebug: boolean
): boolean {
  if (manifestChannel === "debug") {
    return requestedChannel === "debug" && allowDebug;
  }
  if (requestedChannel === "stable") {
    return manifestChannel === "stable";
  }
  if (requestedChannel === "beta") {
    return manifestChannel === "stable" || manifestChannel === "beta";
  }
  return manifestChannel === "stable" || manifestChannel === "beta" || manifestChannel === "debug";
}

function resolveLicenseOperationalEligibility(license: any): boolean {
  const status = String(license?.status || "").toLowerCase();
  if (status === "revoked" || status === "suspended" || status === "blocked" || status === "expired") {
    return false;
  }
  const now = Date.now();
  if (license.expires_at) {
    const exp = new Date(license.expires_at);
    exp.setHours(23, 59, 59, 999);
    if (now > exp.getTime()) {
      if (!license.grace_until) return false;
      const grace = new Date(license.grace_until);
      grace.setHours(23, 59, 59, 999);
      return now <= grace.getTime();
    }
  }
  return status === "active" || status === "issued" || status === "grace";
}

async function resolveArtifactDownloadUrl(release: any): Promise<string | null> {
  const key =
    release.object_key ||
    extractR2KeyFromUrl(release.bundle_url) ||
    extractR2KeyFromUrl(release.full_package_url) ||
    extractR2KeyFromUrl(release.storage_path);
  if (key) {
    const filename = key.split("/").pop() || `aivrasol-android-pos-${release.version}`;
    return getPresignedDownloadUrl(key, filename, 1800);
  }
  const fallback = release.bundle_url || release.full_package_url || release.storage_path;
  return typeof fallback === "string" && fallback.startsWith("http") ? fallback : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const licenseKey = String(body.license_key || "").trim();
    const machineId = String(body.machine_id || "").trim();
    const packageId = String(body.package_id || DEFAULT_ANDROID_PACKAGE_ID).trim();
    const nativeVersionCode = Number(body.native_version_code ?? 0);
    const webVersion = String(body.web_version || "1.0.0").trim();
    const schemaVersion = Number(body.schema_version ?? 1);
    const channel = normalizeAndroidChannel(body.channel, "stable");
    const allowDebugUpdates = Boolean(body.allow_debug_updates);
    const clientCertSha = body.signing_cert_sha256
      ? normalizeHexSha256(body.signing_cert_sha256)
      : null;
    const failedReleaseIds = new Set<string>(
      Array.isArray(body.failed_release_ids)
        ? body.failed_release_ids.map((x: unknown) => String(x || "").trim()).filter(Boolean)
        : []
    );

    if (!licenseKey || !machineId) {
      return NextResponse.json(
        { ok: false, error: "license_key and machine_id are required." },
        { status: 400, headers: CORS }
      );
    }
    if (packageId !== DEFAULT_ANDROID_PACKAGE_ID) {
      return NextResponse.json(
        { ok: false, error: "Unsupported Android packageId." },
        { status: 400, headers: CORS }
      );
    }
    if (!Number.isSafeInteger(nativeVersionCode) || nativeVersionCode < 1) {
      return NextResponse.json(
        { ok: false, error: "native_version_code must be a positive integer." },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    const lic = (await License.findOne({ license_key: licenseKey }).lean()) as any;
    if (!lic || !resolveLicenseOperationalEligibility(lic)) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_inactive_license" },
        { status: 403, headers: CORS }
      );
    }

    const seat = await LicenseSeat.findOne({
      license_id: lic.id,
      machine_id: machineId,
    }).lean();
    if (!seat) {
      return NextResponse.json(
        { ok: false, error: "unregistered_machine" },
        { status: 403, headers: CORS }
      );
    }

    // Telemetry + non-critical location capture
    try {
      const client = lic.client_id
        ? ((await Client.findOne({ id: lic.client_id }).lean()) as any)
        : null;
      const geo = extractRequestGeo(req, body?.location, client?.address || client?.name);
      await LicenseSeat.updateOne(
        { license_id: lic.id, machine_id: machineId },
        {
          $set: {
            last_seen_at: new Date(),
            last_seen_version: `${webVersion}-android (build ${nativeVersionCode})`,
            ...(geo ? { location: geo } : {}),
          },
        }
      );
    } catch {
      // non-critical
    }

    const allPublishedOrDisabled = (await Release.find({
      app_type: ANDROID_POS_PRODUCT,
      platform: ANDROID_POS_PLATFORM,
      status: "published",
    })
      .sort({ published_at: -1, release_seq: -1 })
      .lean()) as any[];

    const withdrawnReleaseIds = allPublishedOrDisabled
      .filter((r) => Boolean(r.disabled))
      .map((r) => String(r.id));

    const candidates = allPublishedOrDisabled.filter(
      (r) =>
        !r.disabled &&
        !r.storage_deleted_at &&
        r.signature_status === "signed" &&
        !failedReleaseIds.has(r.id) &&
        isChannelEligible(r.channel || "stable", channel, allowDebugUpdates) &&
        (r.rollout_type !== "specific" ||
          (Array.isArray(r.target_client_ids) &&
            lic.client_id &&
            r.target_client_ids.includes(lic.client_id))) &&
        (!r.package_id || r.package_id === packageId)
    );

    const webCandidates: Array<{ doc: any; envelope: any }> = [];
    const apkCandidates: Array<{ doc: any; envelope: any }> = [];

    for (const r of candidates) {
      const verified = await verifyStoredManifestWithServerKey(r.manifest_json);
      if (!verified.ok) continue;

      if (r.release_type === "web-bundle") {
        const minNative = Number(r.min_native_version_code ?? 1);
        const maxNative =
          r.max_native_version_code !== null && r.max_native_version_code !== undefined
            ? Number(r.max_native_version_code)
            : null;
        const reqSchema = Number(r.schema_version ?? 1);
        if (nativeVersionCode < minNative) continue;
        if (maxNative !== null && nativeVersionCode > maxNative) continue;
        if (reqSchema > schemaVersion) continue;
        const cmp = compareStrictSemver(r.version, webVersion);
        if (cmp === null || cmp <= 0) continue;
        if (r.min_web_version) {
          const minWebCmp = compareStrictSemver(webVersion, r.min_web_version);
          if (minWebCmp === null || minWebCmp < 0) continue;
        }
        webCandidates.push({ doc: r, envelope: verified.envelope });
      } else if (r.release_type === "apk") {
        const vc = Number(r.version_code ?? 0);
        if (!Number.isSafeInteger(vc) || vc <= nativeVersionCode) continue;
        if (clientCertSha && r.signing_cert_sha256) {
          const targetCert = normalizeHexSha256(r.signing_cert_sha256);
          if (targetCert && targetCert !== clientCertSha) continue;
        }
        apkCandidates.push({ doc: r, envelope: verified.envelope });
      }
    }

    webCandidates.sort((a, b) => {
      const cmp = compareStrictSemver(b.doc.version, a.doc.version) ?? 0;
      if (cmp !== 0) return cmp;
      return (b.doc.release_seq ?? 0) - (a.doc.release_seq ?? 0);
    });

    apkCandidates.sort((a, b) => {
      const diff = (b.doc.version_code ?? 0) - (a.doc.version_code ?? 0);
      if (diff !== 0) return diff;
      const cmp = compareStrictSemver(b.doc.version, a.doc.version) ?? 0;
      if (cmp !== 0) return cmp;
      return (b.doc.release_seq ?? 0) - (a.doc.release_seq ?? 0);
    });

    let webBundleOffer = null;
    if (webCandidates[0]) {
      const url = await resolveArtifactDownloadUrl(webCandidates[0].doc);
      if (url) {
        webBundleOffer = {
          manifestEnvelope: webCandidates[0].envelope,
          downloadUrl: url,
          changelog: webCandidates[0].doc.changelog || "",
        };
      }
    }

    let apkOffer = null;
    if (apkCandidates[0]) {
      const url = await resolveArtifactDownloadUrl(apkCandidates[0].doc);
      if (url) {
        apkOffer = {
          manifestEnvelope: apkCandidates[0].envelope,
          downloadUrl: url,
          changelog: apkCandidates[0].doc.changelog || "",
        };
      }
    }

    if (webBundleOffer) {
      await ReleaseInstall.create({
        release_id: webCandidates[0].doc.id,
        license_id: lic.id,
        license_key: lic.license_key,
        machine_id: machineId,
        version: webCandidates[0].doc.version,
        app_type: ANDROID_POS_PRODUCT,
        platform: ANDROID_POS_PLATFORM,
        channel,
        release_type: "web-bundle",
        native_version_code: nativeVersionCode,
        web_version: webVersion,
        status: "checked",
      }).catch(() => {});
    } else if (apkOffer) {
      await ReleaseInstall.create({
        release_id: apkCandidates[0].doc.id,
        license_id: lic.id,
        license_key: lic.license_key,
        machine_id: machineId,
        version: apkCandidates[0].doc.version,
        app_type: ANDROID_POS_PRODUCT,
        platform: ANDROID_POS_PLATFORM,
        channel,
        release_type: "apk",
        native_version_code: nativeVersionCode,
        web_version: webVersion,
        status: "checked",
      }).catch(() => {});
    }

    return NextResponse.json(
      {
        ok: true,
        checkedAt: new Date().toISOString(),
        channel,
        webBundle: webBundleOffer,
        apk: apkOffer,
        withdrawnReleaseIds,
      },
      { headers: CORS }
    );
  } catch (err: any) {
    console.error("Android check-update API error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Update check failed." },
      { status: 500, headers: CORS }
    );
  }
}

