import { NextRequest, NextResponse } from "next/server";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import { getPresignedUploadUrl } from "@/lib/r2";
import {
  ANDROID_APK_MAX_BYTES,
  ANDROID_WEB_BUNDLE_MAX_BYTES,
  normalizeAndroidChannel,
  parseStrictSemver,
  WINDOWS_FULL_MAX_BYTES,
  WINDOWS_HOT_MAX_BYTES,
} from "@/lib/release-signing";

const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  "android-pos:web-bundle": [".zip"],
  "android-pos:apk": [".apk"],
  "windows-pos:hot": [".asar"],
  "windows-pos:full": [".exe", ".msi", ".zip", ".appimage"],
};

export async function POST(req: NextRequest) {
  try {
    await requireAdminRequest(req);
    const body = await req.json();

    const appType = body.appType === "android-pos" ? "android-pos" : "windows-pos";
    const releaseType = String(body.releaseType || (appType === "android-pos" ? "web-bundle" : "hot"));
    const channel = normalizeAndroidChannel(body.channel, "stable");
    const filename = String(body.filename || "").trim();
    const version = String(body.version || "").trim();
    const fileType = String(body.fileType || "application/octet-stream");
    const sizeBytes = Number(body.sizeBytes ?? 0);

    if (!filename || !version) {
      return NextResponse.json(
        { error: "filename and version are required." },
        { status: 400 }
      );
    }

    if (appType === "android-pos" && !parseStrictSemver(version)) {
      return NextResponse.json(
        { error: `Android version "${version}" must follow semantic versioning (e.g. 1.0.1).` },
        { status: 400 }
      );
    }

    const modeKey = `${appType}:${releaseType}`;
    const allowedExts = ALLOWED_EXTENSIONS[modeKey];
    if (!allowedExts) {
      return NextResponse.json(
        { error: `Unsupported releaseType "${releaseType}" for ${appType}.` },
        { status: 400 }
      );
    }

    const lowerName = filename.toLowerCase();
    if (!allowedExts.some((ext) => lowerName.endsWith(ext))) {
      return NextResponse.json(
        { error: `File "${filename}" must end with ${allowedExts.join(" or ")}.` },
        { status: 400 }
      );
    }

    const maxBytes =
      modeKey === "android-pos:web-bundle"
        ? ANDROID_WEB_BUNDLE_MAX_BYTES
        : modeKey === "android-pos:apk"
          ? ANDROID_APK_MAX_BYTES
          : modeKey === "windows-pos:hot"
            ? WINDOWS_HOT_MAX_BYTES
            : WINDOWS_FULL_MAX_BYTES;

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
      return NextResponse.json(
        { error: `File size must be between 1 byte and ${Math.round(maxBytes / (1024 * 1024))} MB.` },
        { status: 400 }
      );
    }

    const safeVer = version.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const prefix =
      appType === "android-pos"
        ? `releases/android-pos/${channel}/${releaseType}/${safeVer}`
        : `releases/${safeVer}`;
    const objectKey = `${prefix}/${Date.now()}-${safeName}`;

    const uploadUrl = await getPresignedUploadUrl(objectKey, fileType, 900);
    const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "") || "";
    const publicUrl =
      appType === "windows-pos" && publicBase ? `${publicBase}/${objectKey}` : objectKey;

    return NextResponse.json({
      uploadUrl,
      objectKey,
      publicUrl,
      maxBytes,
    });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Admin upload-url error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate presigned R2 upload URL." },
      { status: 500 }
    );
  }
}

