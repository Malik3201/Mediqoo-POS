import Release from "@/models/Release";

/** Compare semantic versions "1.2.3". Returns 1 if a>b, -1 if a<b, 0 equal. */
export function cmpVer(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 
 * Returns the latest applicable "hot" release for an installed version and optionally target client id.
 */
export async function getLatestPublishedHotRelease(currentVersion: string, clientId?: string) {
  // Query all published hot releases, sorted by newest first
  const releases = await Release.find({ 
    status: "published", 
    release_type: "hot" 
  })
    .sort({ published_at: -1 })
    .lean();

  // Sort strictly by semantic version just in case published_at order differs
  releases.sort((a: any, b: any) => cmpVer(b.version, a.version));

  // Find the highest version applicable
  const applicable = releases.find((r: any) => {
    if (r.rollout_type === "specific") {
      const targets: string[] = r.target_client_ids ?? [];
      if (!clientId || !targets.includes(clientId)) return false;
    }
    return cmpVer(r.version, currentVersion) > 0;
  });

  return applicable || null;
}

/**
 * Shared serializer to preserve backward compatibility for old 1.4.0 POS clients 
 * while serving the new 1.4.1+ POS clients.
 */
export function serializeHotUpdateResponse(release: any, installedVersion: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001";
  
  const rawUrl = release.storage_path || release.asar_url || "";
  const downloadUrl = rawUrl.startsWith("http")
    ? rawUrl
    : `${baseUrl}${rawUrl}`;

  return {
    updateAvailable: true,
    update_available: true,
    latestVersion: release.version,
    version: release.version,
    downloadUrl: downloadUrl,
    download_url: downloadUrl,
    sha256: release.sha256 ?? "",
    checksum: release.sha256 ?? "",
    size: release.installer_size ?? 0,
    releaseType: "hot",
    release_type: "hot",
    update: {
      id: release.id || release._id?.toString(),
      version: release.version,
      latestVersion: release.version,
      changelog: release.changelog ?? "",
      mandatory: !!release.mandatory,
      size: release.installer_size ?? 0,
      sha256: release.sha256 ?? null,
      checksum: release.sha256 ?? null,
      download_url: downloadUrl,
      downloadUrl: downloadUrl,
      published_at: release.published_at,
    }
  };
}
