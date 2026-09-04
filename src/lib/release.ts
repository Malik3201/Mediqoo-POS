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
