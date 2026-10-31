import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requireSuperAdmin, type AiAdminActor } from "./admin-auth";

/** Serializes a credential for admin responses. Whitelist only — never a secret, never a fingerprint. */
export function serializeKey(c: any) {
  return {
    id: c.id,
    name: c.name,
    organization_id: c.organization_id,
    organization_name: c.organization_name,
    masked_key: c.masked_key,
    enabled: !!c.enabled,
    weight: c.weight,
    admin_restriction: c.admin_restriction,
    status: !c.enabled ? "Disabled" : c.status,
    cooldown_until: c.cooldown_until || null,
    last_success_at: c.last_success_at || null,
    last_failure_at: c.last_failure_at || null,
    last_failure_reason: c.last_failure_reason || null,
    last_http_status: c.last_http_status ?? null,
    consecutive_failures: c.consecutive_failures || 0,
    total_requests: c.total_requests || 0,
    total_failures: c.total_failures || 0,
    total_tokens: c.total_tokens || 0,
    created_at: c.created_at,
    rotated_at: c.rotated_at || null,
  };
}

export function serializeModel(m: any) {
  return {
    id: m.id,
    model_name: m.model_name,
    provider_model_id: m.provider_model_id,
    enabled: !!m.enabled,
    is_default: !!m.is_default,
    is_complex_default: !!m.is_complex_default,
    is_fallback: !!m.is_fallback,
    context_window: m.context_window,
    supports_tools: !!m.supports_tools,
    supports_structured_json: !!m.supports_structured_json,
    max_output_tokens: m.max_output_tokens,
    usage_policy: m.usage_policy,
    cost_per_million_input_usd: m.cost_per_million_input_usd || 0,
    cost_per_million_output_usd: m.cost_per_million_output_usd || 0,
    availability: m.availability || "unknown",
    total_requests: m.total_requests || 0,
    successful_requests: m.successful_requests || 0,
    failed_requests: m.failed_requests || 0,
    avg_latency_ms: m.avg_latency_ms || 0,
    last_verified_at: m.last_verified_at || null,
    last_error: m.last_error || null,
  };
}

export function serializeAlert(a: any) {
  return {
    id: a.id,
    alert_type: a.alert_type,
    severity: a.severity,
    title: a.title,
    reason: a.reason,
    recommended_action: a.recommended_action,
    affected_entity_type: a.affected_entity_type,
    affected_entity_id: a.affected_entity_id,
    affected_entity_name: a.affected_entity_name,
    status: a.status,
    occurrence_count: a.occurrence_count,
    first_detected_at: a.first_detected_at,
    last_detected_at: a.last_detected_at,
    acknowledged_at: a.acknowledged_at || null,
    resolved_at: a.resolved_at || null,
  };
}

export const ENTITLEMENT_EDITABLE = [
  "ai_enabled",
  "allowed_models",
  "model_policy",
  "daily_request_limit",
  "monthly_request_limit",
  "daily_token_limit",
  "monthly_token_limit",
  "max_output_tokens",
  "concurrent_request_limit",
  "advanced_copilot_enabled",
  "purchase_preparation_enabled",
  "allowed_roles",
  "promo_extra_requests",
  "promo_extra_tokens",
  "promo_expires_at",
  "timezone",
] as const;

export function serializeEntitlement(e: any) {
  const out: Record<string, any> = {};
  for (const k of ENTITLEMENT_EDITABLE) out[k] = e[k];
  out.promo_expires_at = e.promo_expires_at || null;
  out.daily_requests_used = e.daily_requests_used || 0;
  out.monthly_requests_used = e.monthly_requests_used || 0;
  out.daily_tokens_used = e.daily_tokens_used || 0;
  out.monthly_tokens_used = e.monthly_tokens_used || 0;
  out.day_key = e.day_key;
  out.month_key = e.month_key;
  return out;
}

type Ctx<P> = { params: Promise<P> };

/**
 * Wraps an AI Management handler with BACKEND-enforced Super Admin authorization,
 * database connection and uniform error handling (no stack traces / secrets leak to clients).
 */
export function adminHandler<P = Record<string, never>>(
  fn: (req: NextRequest, actor: AiAdminActor, params: P) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    const auth = await requireSuperAdmin(req);
    if ("error" in auth) return auth.error;
    try {
      await connectToDatabase();
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, auth.actor, params);
    } catch (e: any) {
      console.error("[ai-admin] handler error:", e?.message);
      return NextResponse.json({ error: e?.message ? String(e.message).slice(0, 200) : "Internal server error" }, { status: 500 });
    }
  };
}

