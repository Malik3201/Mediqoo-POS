import connectToDatabase from "@/lib/db";
import AiCredential from "@/models/AiCredential";
import AiOrgPool from "@/models/AiOrgPool";
import AiModelRegistry from "@/models/AiModelRegistry";
import { decryptApiKey } from "./crypto";
import { groqChat, type ProviderResult } from "./groq";
import { raiseAlert, autoResolveAlerts } from "./alerts";
import {
  backoffMs,
  buildEligibleGroups,
  cooldownAfter429,
  dayKeyUtc,
  minuteKey,
  pickCredential,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_MS,
  MAX_PROVIDER_ATTEMPTS,
  type CredSnapshot,
  type PoolSnapshot,
} from "./routing-core";

const HEALTH_HISTORY_LIMIT = 60;

export interface ExecuteInput {
  model: string;
  messages: any[];
  tools?: any[];
  maxTokens: number;
  estTokens: number;
  allowFallbackOnly?: boolean;
}

export interface ExecuteDeps {
  call?: typeof groqChat;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

export type ExecuteResult =
  | {
      ok: true;
      result: ProviderResult;
      credentialId: string;
      credentialName: string;
      organizationId: string;
      attempts: number;
    }
  | {
      ok: false;
      error: "capacity_exhausted" | "provider_unavailable" | "model_unsupported";
      retryAfterSeconds?: number;
      attempts: number;
      lastCredentialId?: string;
      lastCredentialName?: string;
      organizationId?: string;
    };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toCredSnap(c: any): CredSnapshot {
  return {
    id: c.id,
    name: c.name,
    organization_id: c.organization_id,
    enabled: c.enabled,
    weight: c.weight,
    admin_restriction: c.admin_restriction,
    status: c.status,
    cooldown_until: c.cooldown_until ? new Date(c.cooldown_until) : null,
    allowed_models: c.allowed_models || [],
  };
}

function toPoolSnap(p: any): PoolSnapshot {
  const d = (v: any) => (v ? new Date(v) : null);
  return {
    organization_id: p.organization_id,
    rate_limited_until: d(p.rate_limited_until),
    circuit_open_until: d(p.circuit_open_until),
    in_flight_requests: p.in_flight_requests || 0,
    minute_window_key: p.minute_window_key,
    minute_requests_used: p.minute_requests_used,
    minute_tokens_used: p.minute_tokens_used,
    minute_request_limit: p.minute_request_limit,
    minute_token_limit: p.minute_token_limit,
    day_key: p.day_key,
    daily_requests_used: p.daily_requests_used,
    daily_tokens_used: p.daily_tokens_used,
    daily_request_limit: p.daily_request_limit,
    daily_token_limit: p.daily_token_limit,
    provider_remaining_requests: p.provider_remaining_requests ?? null,
    provider_remaining_tokens: p.provider_remaining_tokens ?? null,
    provider_reset_requests_at: d(p.provider_reset_requests_at),
    provider_reset_tokens_at: d(p.provider_reset_tokens_at),
  };
}

/** Makes sure a pool document exists for the organization (one pool per Groq organization). */
export async function ensurePool(organizationId: string, organizationName: string) {
  await AiOrgPool.updateOne(
    { organization_id: organizationId },
    { $setOnInsert: { organization_id: organizationId, organization_name: organizationName } },
    { upsert: true }
  ).catch((e: any) => {
    if (e?.code !== 11000) throw e; // concurrent upsert race is fine
  });
}

async function pushHealth(credId: string, status: string, httpStatus: number | null, latencyMs: number | null, reason: string | null) {
  await AiCredential.updateOne(
    { id: credId },
    {
      $push: {
        health_history: {
          $each: [{ timestamp: new Date(), status, http_status: httpStatus, latency_ms: latencyMs, reason }],
          $slice: -HEALTH_HISTORY_LIMIT,
        },
      },
    }
  );
}

async function rolloverPoolWindows(orgId: string, now: Date) {
  const dk = dayKeyUtc(now);
  const mk = minuteKey(now);
  await AiOrgPool.updateOne(
    { organization_id: orgId, day_key: { $ne: dk } },
    { $set: { day_key: dk, daily_requests_used: 0, daily_tokens_used: 0 } }
  );
  await AiOrgPool.updateOne(
    { organization_id: orgId, minute_window_key: { $ne: mk } },
    { $set: { minute_window_key: mk, minute_requests_used: 0, minute_tokens_used: 0 } }
  );
}

/**
 * Executes one chat completion through authorised capacity.
 *
 * Retry policy (all bounded; the chat request is read-only so retrying is safe — the gateway
 * never performs a business mutation and never replays tool side effects):
 *  - 429  → the whole organization pool is cooled down (retry-after honoured). No other key of that
 *           organization is tried. Only a different, independent organization pool may be tried.
 *  - 401  → that credential is marked Invalid Credentials; another credential may be tried.
 *  - 403  → that credential is marked Needs Attention; another credential may be tried.
 *  - 5xx / timeout / network → bounded exponential backoff + jitter; circuit breaker after
 *           repeated failures opens the pool for a short period.
 *  - model unsupported → returned to the caller so it can pick the fallback model.
 */
export async function executeChat(input: ExecuteInput, deps: ExecuteDeps = {}): Promise<ExecuteResult> {
  const call = deps.call || groqChat;
  const sleep = deps.sleep || defaultSleep;
  const rand = deps.rand || Math.random;
  await connectToDatabase();

  const excludedCreds = new Set<string>();
  const excludedPools = new Set<string>();
  let attempts = 0;
  let sawRateLimit = false;
  let sawProviderFault = false;
  let retryAfterSeconds: number | undefined;
  let last: { credId?: string; credName?: string; org?: string } = {};
  const sameCredRetries = new Map<string, number>();

  while (attempts < MAX_PROVIDER_ATTEMPTS) {
    const now = new Date();
    const [creds, pools] = await Promise.all([
      AiCredential.find({ enabled: true }).lean(),
      AiOrgPool.find({}).lean(),
    ]);

    const { groups } = buildEligibleGroups({
      creds: creds.map(toCredSnap),
      pools: pools.map(toPoolSnap),
      model: input.model,
      estTokens: input.estTokens,
      now,
      excludedCredIds: excludedCreds,
      excludedPoolIds: excludedPools,
      allowFallbackOnly: !!input.allowFallbackOnly,
    });

    const picked = pickCredential(groups, rand);
    if (!picked) break;

    const { cred, group } = picked;
    const orgId = group.organization_id;
    const orgPool: any = pools.find((p: any) => p.organization_id === orgId);
    last = { credId: cred.id, credName: cred.name, org: orgId };
    attempts += 1;

    const doc: any = await AiCredential.findOne({ id: cred.id }).select("+encrypted_key");
    if (!doc?.encrypted_key) {
      excludedCreds.add(cred.id);
      continue;
    }
    let apiKey: string;
    try {
      apiKey = decryptApiKey(doc.encrypted_key);
    } catch {
      excludedCreds.add(cred.id);
      await AiCredential.updateOne(
        { id: cred.id },
        { $set: { status: "Needs Attention", last_failure_at: now, last_failure_reason: "Stored credential could not be decrypted (check the server encryption key)." } }
      );
      await raiseAlert({
        type: "api_key_invalid",
        severity: "critical",
        title: `${cred.name} cannot be decrypted`,
        reason: "The stored credential could not be decrypted with the server encryption key.",
        recommendedAction: "Check AI_CREDENTIAL_MASTER_KEY configuration or re-enter the key.",
        entityType: "credential",
        entityId: cred.id,
        entityName: cred.name,
      });
      continue;
    }

    await rolloverPoolWindows(orgId, now);
    await AiOrgPool.updateOne({ organization_id: orgId }, { $inc: { in_flight_requests: 1 }, $set: { last_request_at: now } });

    let result: ProviderResult;
    try {
      result = await call({
        apiKey,
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        maxTokens: input.maxTokens,
      });
    } finally {
      await AiOrgPool.updateOne(
        { organization_id: orgId, in_flight_requests: { $gt: 0 } },
        { $inc: { in_flight_requests: -1 } }
      );
    }
    apiKey = ""; // drop reference ASAP

    const h = result.headers;
    const poolHeaderPatch: Record<string, any> = {};
    if (h.remainingRequests !== undefined) poolHeaderPatch.provider_remaining_requests = h.remainingRequests;
    if (h.remainingTokens !== undefined) poolHeaderPatch.provider_remaining_tokens = h.remainingTokens;
    if (h.resetRequestsMs !== undefined) poolHeaderPatch.provider_reset_requests_at = new Date(now.getTime() + h.resetRequestsMs);
    if (h.resetTokensMs !== undefined) poolHeaderPatch.provider_reset_tokens_at = new Date(now.getTime() + h.resetTokensMs);

    switch (result.outcome) {
      case "ok": {
        const tokens = result.usage?.total || 0;
        const wasUnhealthy = doc.status !== "Healthy";
        await AiCredential.updateOne(
          { id: cred.id },
          {
            $set: { status: "Healthy", cooldown_until: null, last_success_at: new Date(), consecutive_failures: 0, last_http_status: result.httpStatus },
            $inc: { total_requests: 1, total_tokens: tokens },
          }
        );
        if (wasUnhealthy) await pushHealth(cred.id, "Healthy", result.httpStatus, result.latencyMs, "Recovered");
        await AiOrgPool.updateOne(
          { organization_id: orgId },
          {
            $set: { ...poolHeaderPatch, status: "Healthy", consecutive_429s: 0, consecutive_5xxs: 0, rate_limited_until: null, circuit_open_until: null, last_error: null },
            $inc: { daily_requests_used: 1, minute_requests_used: 1, daily_tokens_used: tokens, minute_tokens_used: tokens },
          }
        );
        void autoResolveAlerts("sustained_rate_limiting", "org_pool", orgId);
        void autoResolveAlerts("provider_capacity_exhausted", "org_pool", orgId);
        void autoResolveAlerts("all_pools_unavailable", "gateway", "gateway");
        void autoResolveAlerts("api_key_invalid", "credential", cred.id);
        return { ok: true, result, credentialId: cred.id, credentialName: cred.name, organizationId: orgId, attempts };
      }

      case "rate_limited": {
        sawRateLimit = true;
        const cool = cooldownAfter429(h);
        const until = new Date(Date.now() + cool);
        retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, Math.ceil(cool / 1000));
        // Exclude this org pool for the current model attempt; only lock the pool across models
        // if multiple consecutive 429s occur across the fallback model chain.
        excludedPools.add(orgId);
        const prev429s = orgPool?.consecutive_429s || 0;
        const shouldLockPool = prev429s + 1 >= 3;
        const updated: any = await AiOrgPool.findOneAndUpdate(
          { organization_id: orgId },
          {
            $set: {
              ...poolHeaderPatch,
              status: shouldLockPool ? "Rate Limited" : "Healthy",
              rate_limited_until: shouldLockPool ? until : null,
              last_rate_limit_at: new Date(),
              last_error: `Provider rate limit (429) on ${input.model}`,
            },
            $inc: { consecutive_429s: 1 },
          },
          { new: true }
        );
        await AiCredential.updateOne(
          { id: cred.id },
          {
            $set: {
              status: shouldLockPool ? "Rate Limited" : "Healthy",
              cooldown_until: shouldLockPool ? until : null,
              last_failure_at: new Date(),
              last_failure_reason: `Rate limited by provider (429) on ${input.model} — temporary`,
              last_http_status: 429,
            },
            $inc: { total_failures: 1, consecutive_failures: 1, total_requests: 1 },
          }
        );
        await pushHealth(cred.id, "Rate Limited", 429, result.latencyMs, `Cooldown ${Math.ceil(cool / 1000)}s (${input.model})`);
        if ((updated?.consecutive_429s || 0) >= 5) {
          await raiseAlert({
            type: "sustained_rate_limiting",
            severity: "warning",
            title: `${orgPool?.organization_name || orgId} is being rate limited repeatedly`,
            reason: `${updated.consecutive_429s} consecutive provider 429 responses. All keys of this Groq organization share one quota.`,
            recommendedAction: "Reduce demand, lower pharmacy limits, or upgrade the Groq plan for this organization. Adding more keys to the same organization does not add capacity.",
            entityType: "org_pool",
            entityId: orgId,
            entityName: orgPool?.organization_name || orgId,
          });
        }
        continue; // another INDEPENDENT pool or fallback model in the chain may still serve the request
      }

      case "invalid_credentials": {
        excludedCreds.add(cred.id);
        await AiCredential.updateOne(
          { id: cred.id },
          {
            $set: { status: "Invalid Credentials", last_failure_at: new Date(), last_failure_reason: "Provider rejected the key (401)", last_http_status: 401 },
            $inc: { total_failures: 1, consecutive_failures: 1, total_requests: 1 },
          }
        );
        await pushHealth(cred.id, "Invalid Credentials", 401, result.latencyMs, "Provider rejected the key");
        await raiseAlert({
          type: "api_key_invalid",
          severity: "critical",
          title: `${cred.name} requires attention`,
          reason: "Groq rejected this API key (401). It may be revoked, expired or mistyped.",
          recommendedAction: "Open AI Management → API Keys and rotate or replace this key.",
          entityType: "credential",
          entityId: cred.id,
          entityName: cred.name,
        });
        if ((doc.consecutive_failures || 0) + 1 >= 3) {
          await raiseAlert({
            type: "repeated_auth_failures",
            severity: "critical",
            title: `Repeated authentication failures on ${cred.name}`,
            reason: "Three or more consecutive 401 responses.",
            recommendedAction: "Rotate the key and review recent credential activity.",
            entityType: "credential",
            entityId: cred.id,
            entityName: cred.name,
          });
        }
        continue;
      }

      case "access_denied": {
        excludedCreds.add(cred.id);
        await AiCredential.updateOne(
          { id: cred.id },
          {
            $set: { status: "Needs Attention", last_failure_at: new Date(), last_failure_reason: "Access denied by provider (403)", last_http_status: 403 },
            $inc: { total_failures: 1, consecutive_failures: 1, total_requests: 1 },
          }
        );
        await pushHealth(cred.id, "Needs Attention", 403, result.latencyMs, "Access denied");
        await raiseAlert({
          type: "api_key_invalid",
          severity: "warning",
          title: `${cred.name} was denied access`,
          reason: "Groq returned 403 for this key (project/organization permission or model access).",
          recommendedAction: "Check the key's Groq project permissions and model access.",
          entityType: "credential",
          entityId: cred.id,
          entityName: cred.name,
        });
        continue;
      }

      case "model_unsupported": {
        await AiModelRegistry.updateOne(
          { provider_model_id: input.model },
          { $set: { availability: "unavailable", last_error: (result.errorText || "Model not available").slice(0, 200), last_verified_at: new Date() } }
        );
        return { ok: false, error: "model_unsupported", attempts, lastCredentialId: cred.id, lastCredentialName: cred.name, organizationId: orgId };
      }

      case "provider_error":
      case "timeout":
      case "network_error":
      case "invalid_response": {
        sawProviderFault = true;
        const patch: Record<string, any> = { ...poolHeaderPatch, last_error: `${result.outcome}${result.httpStatus ? ` (${result.httpStatus})` : ""}` };
        const updated: any = await AiOrgPool.findOneAndUpdate(
          { organization_id: orgId },
          { $set: patch, $inc: { consecutive_5xxs: 1 } },
          { new: true }
        );
        const fails = updated?.consecutive_5xxs || 0;
        const coolMs = Math.min(30_000, 3_000 * Math.max(1, fails));
        await AiCredential.updateOne(
          { id: cred.id },
          {
            $set: { status: "Temporarily Unavailable", cooldown_until: new Date(Date.now() + coolMs), last_failure_at: new Date(), last_failure_reason: `Provider fault: ${result.outcome}`, last_http_status: result.httpStatus },
            $inc: { total_failures: 1, consecutive_failures: 1, total_requests: 1 },
          }
        );
        await pushHealth(cred.id, "Temporarily Unavailable", result.httpStatus, result.latencyMs, result.outcome);
        if (fails >= CIRCUIT_FAILURE_THRESHOLD) {
          await AiOrgPool.updateOne(
            { organization_id: orgId },
            { $set: { status: "Temporarily Unavailable", circuit_open_until: new Date(Date.now() + CIRCUIT_OPEN_MS) } }
          );
          excludedPools.add(orgId);
          await raiseAlert({
            type: "high_error_rate",
            severity: "warning",
            title: `${orgPool?.organization_name || orgId} circuit breaker opened`,
            reason: `${fails} consecutive provider failures (${result.outcome}). Requests are paused for ${CIRCUIT_OPEN_MS / 1000}s.`,
            recommendedAction: "Check the Groq status page. The gateway will retry automatically.",
            entityType: "org_pool",
            entityId: orgId,
            entityName: orgPool?.organization_name || orgId,
          });
        } else {
          // Bounded backoff, then allow ONE more try of the same credential (cooldown is short).
          const n = (sameCredRetries.get(cred.id) || 0) + 1;
          sameCredRetries.set(cred.id, n);
          if (n >= 2) excludedCreds.add(cred.id);
          await sleep(backoffMs(attempts, rand));
          await AiCredential.updateOne({ id: cred.id }, { $set: { cooldown_until: null } }); // retry allowed after backoff
        }
        continue;
      }
    }
  }

  // Could not be served.
  const hadAnyCreds = (await AiCredential.countDocuments({ enabled: true })) > 0;
  if (!hadAnyCreds || sawRateLimit || !sawProviderFault) {
    await raiseAlert({
      type: "all_pools_unavailable",
      severity: "critical",
      title: "All eligible AI provider pools are unavailable",
      reason: sawRateLimit
        ? "Every eligible provider pool is rate limited or exhausted."
        : "No healthy, enabled credential is available for routing.",
      recommendedAction: "Open AI Management → API Keys: check key health, add authorised capacity, or wait for the cooldown to end.",
      entityType: "gateway",
      entityId: "gateway",
      entityName: "AI Gateway",
    });
    if (sawRateLimit) {
      await raiseAlert({
        type: "provider_capacity_exhausted",
        severity: "warning",
        title: "Provider capacity exhausted",
        reason: "Provider quota was exhausted while serving pharmacy requests.",
        recommendedAction: "Wait for the shown reset time or increase authorised provider capacity.",
        entityType: "org_pool",
        entityId: last.org || "unknown",
        entityName: last.org || "Provider pool",
      });
    }
    return {
      ok: false,
      error: "capacity_exhausted",
      retryAfterSeconds: retryAfterSeconds ?? 30,
      attempts,
      lastCredentialId: last.credId,
      lastCredentialName: last.credName,
      organizationId: last.org,
    };
  }
  return {
    ok: false,
    error: "provider_unavailable",
    retryAfterSeconds: 15,
    attempts,
    lastCredentialId: last.credId,
    lastCredentialName: last.credName,
    organizationId: last.org,
  };
}

