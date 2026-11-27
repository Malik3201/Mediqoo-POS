"use client";

/**
 * Lightweight Stale-While-Revalidate (SWR) Client Cache for AivraSol Owner Portal.
 *
 * Backed by an in-memory Map + sessionStorage so switching between portal tabs
 * renders previously fetched data in 0ms while silently refreshing fresh data in
 * the background, and deduplicates simultaneous in-flight GET requests.
 */

const CACHE_PREFIX = "aivrasol_portal_cache_v1:";
const ME_CACHE_KEY = "aivrasol_portal_me_v1";
const DEFAULT_TTL_MS = 45_000;
const MAX_STALE_MS = 15 * 60 * 1000; // 15 minutes max stale reuse

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();

function readSessionEntry<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (
      parsed &&
      typeof parsed.timestamp === "number" &&
      Date.now() - parsed.timestamp <= MAX_STALE_MS
    ) {
      return parsed;
    }
    window.sessionStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // Ignore storage quota / parse errors
  }
  return null;
}

function writeSessionEntry<T>(key: string, entry: CacheEntry<T>): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(entry);
    // Avoid bloating sessionStorage with huge payloads (> 300KB)
    if (serialized.length <= 320_000) {
      window.sessionStorage.setItem(CACHE_PREFIX + key, serialized);
    }
  } catch {
    // Storage full — evict old portal cache keys best-effort
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) toRemove.push(k);
      }
      toRemove.slice(0, Math.ceil(toRemove.length / 2)).forEach((k) => {
        window.sessionStorage.removeItem(k);
      });
    } catch {
      // Ignore
    }
  }
}

export function getPortalCached<T = any>(
  url: string,
  ttlMs: number = DEFAULT_TTL_MS
): { data: T; isFresh: boolean; timestamp: number } | null {
  let entry = memoryCache.get(url) as CacheEntry<T> | undefined;
  if (!entry) {
    const stored = readSessionEntry<T>(url);
    if (stored) {
      entry = stored;
      memoryCache.set(url, stored);
    }
  }
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > MAX_STALE_MS) {
    memoryCache.delete(url);
    return null;
  }

  return {
    data: entry.data,
    isFresh: age <= ttlMs,
    timestamp: entry.timestamp,
  };
}

export function setPortalCached<T = any>(url: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  memoryCache.set(url, entry);
  writeSessionEntry(url, entry);
}

export interface FetchPortalCachedOptions {
  ttlMs?: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export interface FetchPortalCachedResult<T> {
  data: T;
  fromCache: boolean;
  status: number;
}

/**
 * Fetches JSON from a portal GET endpoint with in-flight deduplication and
 * session + memory caching. Throws an Error with `.status` if non-OK.
 */
export async function fetchPortalCached<T = any>(
  url: string,
  options: FetchPortalCachedOptions = {}
): Promise<FetchPortalCachedResult<T>> {
  const { ttlMs = DEFAULT_TTL_MS, forceRefresh = false, signal } = options;

  if (!forceRefresh) {
    const cached = getPortalCached<T>(url, ttlMs);
    if (cached && cached.isFresh) {
      return { data: cached.data, fromCache: true, status: 200 };
    }
  }

  // Deduplicate concurrent identical requests when not using an external abort signal
  if (!signal && inflightRequests.has(url)) {
    const data = (await inflightRequests.get(url)) as T;
    return { data, fromCache: false, status: 200 };
  }

  const reqPromise = (async () => {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      signal,
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const errJson = await res.json();
        msg = errJson?.error || errJson?.message || msg;
      } catch {
        // Ignore parse error
      }
      const err: any = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const json = (await res.json()) as T;
    setPortalCached(url, json);
    return json;
  })();

  if (!signal) {
    inflightRequests.set(url, reqPromise);
  }

  try {
    const data = await reqPromise;
    return { data, fromCache: false, status: 200 };
  } finally {
    if (!signal) {
      inflightRequests.delete(url);
    }
  }
}

/**
 * Invalidates all cached portal responses matching `prefix` (or all if omitted).
 */
export function invalidatePortalCache(prefix?: string): void {
  for (const key of Array.from(memoryCache.keys())) {
    if (!prefix || key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
  if (typeof window === "undefined") return;
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (!k || !k.startsWith(CACHE_PREFIX)) continue;
      const rawUrl = k.slice(CACHE_PREFIX.length);
      if (!prefix || rawUrl.startsWith(prefix)) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Ignore storage errors
  }
}

export interface CachedPortalMe {
  user_id: string;
  client_id: string;
  client_name: string;
  pharmacy_logo?: string | null;
  email: string;
  role: string;
  cached_at?: number;
}

export function getCachedPortalMe(): CachedPortalMe | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPortalMe;
    if (parsed && parsed.client_id) {
      return parsed;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function setCachedPortalMe(me: CachedPortalMe): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ME_CACHE_KEY,
      JSON.stringify({ ...me, cached_at: Date.now() })
    );
  } catch {
    // Ignore
  }
}

export function clearPortalSessionCache(): void {
  invalidatePortalCache();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // Ignore
  }
}
