"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* ------------------------------------------------------------------ */
/* Types (mirror AI_CONTRACT.md section A)                             */
/* ------------------------------------------------------------------ */

export type KeyStatus =
  | "Healthy"
  | "Rate Limited"
  | "Temporarily Unavailable"
  | "Invalid Credentials"
  | "Disabled"
  | "Needs Attention";

export type AiKey = {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  masked_key: string;
  enabled: boolean;
  weight: number;
  admin_restriction: "none" | "fallback_only" | "test_only";
  status: KeyStatus;
  cooldown_until: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  last_http_status: number | null;
  consecutive_failures: number;
  total_requests: number;
  total_failures: number;
  total_tokens: number;
  created_at: string;
  rotated_at: string | null;
};

export type AiPool = {
  organization_id: string;
  organization_name: string;
  status: string;
  rate_limited_until: string | null;
  circuit_open_until: string | null;
  in_flight_requests: number;
  daily_requests_used: number;
  daily_request_limit: number;
  daily_tokens_used: number;
  daily_token_limit: number;
  minute_requests_used: number;
  minute_request_limit: number;
  key_count: number;
  healthy_key_count: number;
};

export type AlertSeverity = "critical" | "warning" | "info";

export type AiAlert = {
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  reason: string;
  recommended_action: string;
  affected_entity_type: string;
  affected_entity_id: string;
  affected_entity_name: string;
  status: string;
  occurrence_count: number;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type TrendPoint = { date: string; requests: number; tokens: number; failures: number };

export type AiOverview = {
  status: "Running" | "Limited" | "Unavailable";
  statusReason: string;
  requestsToday: number;
  tokensToday: number;
  activePharmacies: number;
  healthyKeys: number;
  totalKeys: number;
  successRate: number | null;
  estimatedCostUsd: number | null;
  trend: TrendPoint[];
  alerts: AiAlert[];
};

export type UsagePolicy = "all_queries" | "simple_only" | "complex_only" | "fallback_only";

export type AiModel = {
  id: string;
  model_name: string;
  provider_model_id: string;
  enabled: boolean;
  is_default: boolean;
  is_complex_default: boolean;
  is_fallback: boolean;
  context_window: number;
  supports_tools: boolean;
  supports_structured_json: boolean;
  max_output_tokens: number;
  usage_policy: UsagePolicy;
  cost_per_million_input_usd: number;
  cost_per_million_output_usd: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_latency_ms: number;
  last_verified_at: string | null;
  last_error: string | null;
};

export type LicenseAiStatus =
  | "Active"
  | "Grace Period"
  | "Renewal Required"
  | "Suspended"
  | "Revoked"
  | "Unknown";

export type ModelPolicy = "auto" | "fast_only" | "full_featured";

export type Entitlement = {
  ai_enabled: boolean;
  allowed_models: string[];
  model_policy: ModelPolicy;
  daily_request_limit: number;
  monthly_request_limit: number;
  daily_token_limit: number;
  monthly_token_limit: number;
  max_output_tokens: number;
  concurrent_request_limit: number;
  advanced_copilot_enabled: boolean;
  purchase_preparation_enabled: boolean;
  allowed_roles: string[];
  promo_extra_requests: number;
  promo_extra_tokens: number;
  promo_expires_at: string | null;
  timezone: string;
  daily_requests_used: number;
  monthly_requests_used: number;
  daily_tokens_used: number;
  monthly_tokens_used: number;
  day_key: string;
  month_key: string;
};

export type LimitRow = {
  license_id: string;
  client_name: string;
  license_key_masked: string;
  license_status: LicenseAiStatus;
  entitlement: Entitlement;
};

export type UsageSummary = {
  requests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  failures: number;
  avgLatencyMs: number;
  estimatedCostUsd: number | null;
};

export type UsageData = {
  summary: UsageSummary;
  byDay: TrendPoint[];
  byModel: { model: string; requests: number; tokens: number }[];
  byPharmacy: { license_id: string; pharmacy_name: string; requests: number; tokens: number }[];
  rows: {
    id: string;
    created_at: string;
    pharmacy_name: string;
    operator_role: string;
    request_type: string;
    model_used: string;
    credential_name: string;
    total_tokens: number;
    latency_ms: number;
    status: string;
  }[];
};

export type KeyHistoryEvent = {
  timestamp: string;
  status: string;
  http_status: number | null;
  latency_ms: number | null;
  reason: string | null;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
};

export type AiSettings = {
  ai_global_enabled: boolean;
  default_daily_requests: number;
  default_monthly_requests: number;
  default_daily_tokens: number;
  default_monthly_tokens: number;
  default_max_output_tokens: number;
  max_payload_kb: number;
  max_tool_steps: number;
  chat_retention_days: number;
  alert_cooldown_minutes: number;
  unusual_token_multiplier: number;
  alert_email_enabled: boolean;
};

export type UsageFilters = {
  from: string;
  to: string;
  license_id: string;
  model: string;
  status: string;
};

/* ------------------------------------------------------------------ */
/* Fetch helper                                                         */
/* ------------------------------------------------------------------ */

export async function aiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/admin/ai${path}`, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/* ------------------------------------------------------------------ */
/* Query hooks                                                          */
/* ------------------------------------------------------------------ */

const QK = "ai-admin";

export function useAiOverview() {
  return useQuery({
    queryKey: [QK, "overview"],
    queryFn: () => aiFetch<AiOverview>("/overview"),
    refetchInterval: 30_000,
  });
}

export function useAiKeys() {
  return useQuery({
    queryKey: [QK, "keys"],
    queryFn: () => aiFetch<{ keys: AiKey[]; pools: AiPool[] }>("/keys"),
    refetchInterval: 30_000,
  });
}

export function useAiKeyHistory(id: string | null) {
  return useQuery({
    queryKey: [QK, "key-history", id],
    queryFn: () => aiFetch<{ history: KeyHistoryEvent[] }>(`/keys/${id}/history`),
    enabled: !!id,
  });
}

export function useAiModels() {
  return useQuery({
    queryKey: [QK, "models"],
    queryFn: () => aiFetch<{ models: AiModel[] }>("/models"),
  });
}

export function useAiLimits(search: string) {
  return useQuery({
    queryKey: [QK, "limits", search],
    queryFn: () =>
      aiFetch<{ rows: LimitRow[] }>(`/limits?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`),
    placeholderData: (prev) => prev,
  });
}

export function useAiUsage(f: UsageFilters) {
  return useQuery({
    queryKey: [QK, "usage", f],
    queryFn: () => {
      const p = new URLSearchParams();
      if (f.from) p.set("from", f.from);
      if (f.to) p.set("to", f.to);
      if (f.license_id) p.set("license_id", f.license_id);
      if (f.model) p.set("model", f.model);
      if (f.status) p.set("status", f.status);
      return aiFetch<UsageData>(`/usage?${p.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useAiAlerts(status: string) {
  return useQuery({
    queryKey: [QK, "alerts", status],
    queryFn: () => aiFetch<{ alerts: AiAlert[] }>(`/alerts?status=${status}`),
    refetchInterval: 30_000,
  });
}

export function useAiAudit(enabled = true) {
  return useQuery({
    queryKey: [QK, "audit"],
    queryFn: () => aiFetch<{ logs: AuditLogRow[] }>("/audit"),
    enabled,
  });
}

export function useAiSettings() {
  return useQuery({
    queryKey: [QK, "settings"],
    queryFn: () => aiFetch<{ settings: AiSettings }>("/settings"),
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                            */
/* ------------------------------------------------------------------ */

/** Generic mutation that invalidates the whole AI admin cache on success. */
export function useAiMutation<TVars, TRes>(fn: (vars: TVars) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export const aiApi = {
  createKey: (body: {
    name: string;
    organization_id: string;
    organization_name: string;
    api_key: string;
    weight?: number;
  }) => aiFetch<{ key: AiKey }>("/keys", { method: "POST", json: body }),
  patchKey: (id: string, body: Record<string, unknown>) =>
    aiFetch<{ key: AiKey }>(`/keys/${id}`, { method: "PATCH", json: body }),
  deleteKey: (id: string) => aiFetch<{ ok: true }>(`/keys/${id}`, { method: "DELETE" }),
  testKey: (id: string) =>
    aiFetch<{ ok: boolean; http_status: number | null; latency_ms: number | null; message: string; key: AiKey }>(
      `/keys/${id}/test`,
      { method: "POST" },
    ),
  createModel: (body: Partial<AiModel> & { model_name: string; provider_model_id: string }) =>
    aiFetch<{ model: AiModel }>("/models", { method: "POST", json: body }),
  patchModel: (id: string, body: Partial<AiModel>) =>
    aiFetch<{ model: AiModel }>(`/models/${id}`, { method: "PATCH", json: body }),
  deleteModel: (id: string) => aiFetch<{ ok: true }>(`/models/${id}`, { method: "DELETE" }),
  syncModels: () =>
    aiFetch<{ ok: boolean; available: string[]; verified: number; message: string }>("/models/sync", {
      method: "POST",
    }),
  putLimits: (licenseId: string, body: Partial<Entitlement>) =>
    aiFetch<{ entitlement: Entitlement }>(`/limits/${licenseId}`, { method: "PUT", json: body }),
  adjustLimits: (
    licenseId: string,
    body: {
      action: "reset_daily" | "reset_monthly" | "add_promo";
      reason: string;
      promo_requests?: number;
      promo_tokens?: number;
      promo_expires_at?: string;
    },
  ) => aiFetch<{ entitlement: Entitlement }>(`/limits/${licenseId}/adjust`, { method: "POST", json: body }),
  actOnAlert: (id: string, action: "acknowledge" | "resolve") =>
    aiFetch<{ alert: AiAlert }>(`/alerts/${id}`, { method: "POST", json: { action } }),
  putSettings: (settings: AiSettings) =>
    aiFetch<{ settings: AiSettings }>("/settings", { method: "PUT", json: settings }),
};
