/**
 * Cloud Services — Pure Status Resolver & Types
 *
 * Business-level consolidation over existing independent authoritative fields:
 * - Cloud Sync:      License.features.cloud_dashboard
 * - Cloud Backup:    License.features.cloud_backup
 * - Recovery Secret: License.backup_recovery_secret (encrypted server KMS)
 * - WhatsApp Alerts: License.features.whatsapp_alerts + WhatsAppIntegration
 *
 * Pure presentation/orchestration layer — never mutates underlying data.
 */

export type CloudServicesOverallStatus = "disabled" | "enabled" | "needs_attention";

export type CloudServiceSubToggle = "enabled" | "disabled";

export type CloudServiceRecoveryStatus = "ready" | "setup_required" | "conflict";

export type CloudServiceWhatsAppStatus =
  | "connected"
  | "configured"
  | "available_not_configured"
  | "disconnected"
  | "error"
  | "disabled";

export interface CloudServicesWhatsAppSnapshot {
  status: CloudServiceWhatsAppStatus;
  rawStatus: string;
  configured: boolean;
  enabled: boolean;
  maskedSender: string | null;
  recipientCount: number;
  lastSuccessfulMessageAt: string | null;
  lastError: string | null;
}

export interface CloudServicesSummary {
  overallStatus: CloudServicesOverallStatus;
  cloud: CloudServiceSubToggle;
  backup: CloudServiceSubToggle;
  recovery: CloudServiceRecoveryStatus;
  recoveryUpdatedAt: string | null;
  backupCount?: number;
  whatsapp: CloudServicesWhatsAppSnapshot;
  issues: string[];
}

export interface ResolveCloudServicesInput {
  features?: Record<string, unknown> | null;
  hasRecoverySecret?: boolean;
  recoveryConflict?: boolean;
  recoveryUpdatedAt?: string | Date | null;
  backupCount?: number;
  whatsappAlerts?: {
    status?: string | null;
    configured?: boolean;
    enabled?: boolean;
    masked_sender?: string | null;
    maskedSender?: string | null;
    recipient_count?: number;
    recipientCount?: number;
    last_successful_message_at?: string | Date | null;
    lastSuccessfulMessageAt?: string | Date | null;
    last_error?: string | null;
    lastError?: string | null;
  } | null;
}

/**
 * Pure deterministic resolver for the business-level Cloud Services status.
 *
 * Rules:
 * - Cloud disabled + Backup disabled -> "disabled"
 * - Cloud enabled + Backup disabled (or vice versa) -> "needs_attention"
 * - Recovery conflict -> "needs_attention"
 * - Cloud enabled + Backup enabled + WhatsApp not configured -> still "enabled"
 *   (WhatsApp shows "Setup Required" inside details; never treated as failure)
 * - Cloud enabled + Backup enabled + WhatsApp connected -> "enabled"
 */
export function resolveCloudServicesState(input: ResolveCloudServicesInput): CloudServicesSummary {
  const features = input.features || {};
  const cloudEnabled = features.cloud_dashboard === true;
  const backupEnabled = features.cloud_backup === true;
  const whatsappFlag = features.whatsapp_alerts === true;

  const rawWa = input.whatsappAlerts || null;
  const rawWaStatus = String(rawWa?.status || "not_configured");
  const waConfigured =
    typeof rawWa?.configured === "boolean"
      ? rawWa.configured
      : rawWaStatus !== "not_configured";

  const whatsappAvailable = cloudEnabled || backupEnabled || whatsappFlag || waConfigured;

  let waStatus: CloudServiceWhatsAppStatus;
  if (!whatsappAvailable) {
    waStatus = "disabled";
  } else if (rawWaStatus === "connected") {
    waStatus = "connected";
  } else if (rawWaStatus === "disconnected") {
    waStatus = "disconnected";
  } else if (rawWaStatus === "error") {
    waStatus = "error";
  } else if (waConfigured) {
    waStatus = "configured";
  } else {
    waStatus = "available_not_configured";
  }

  let recovery: CloudServiceRecoveryStatus;
  if (input.recoveryConflict) {
    recovery = "conflict";
  } else if (input.hasRecoverySecret) {
    recovery = "ready";
  } else {
    recovery = "setup_required";
  }

  const issues: string[] = [];
  let overallStatus: CloudServicesOverallStatus;

  if (!cloudEnabled && !backupEnabled) {
    overallStatus = "disabled";
  } else if (cloudEnabled !== backupEnabled) {
    overallStatus = "needs_attention";
    if (cloudEnabled && !backupEnabled) {
      issues.push("Cloud Sync is enabled, but Automatic Cloud Backup is disabled.");
    } else {
      issues.push("Automatic Cloud Backup is enabled, but Cloud Sync is disabled.");
    }
  } else if (recovery === "conflict") {
    overallStatus = "needs_attention";
    issues.push("Backup Recovery Secret needs attention.");
  } else {
    overallStatus = "enabled";
  }

  const toIso = (v: string | Date | null | undefined): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v;
    return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
  };

  return {
    overallStatus,
    cloud: cloudEnabled ? "enabled" : "disabled",
    backup: backupEnabled ? "enabled" : "disabled",
    recovery,
    recoveryUpdatedAt: toIso(input.recoveryUpdatedAt),
    ...(typeof input.backupCount === "number" ? { backupCount: input.backupCount } : {}),
    whatsapp: {
      status: waStatus,
      rawStatus: rawWaStatus,
      configured: waConfigured,
      enabled: Boolean(rawWa?.enabled),
      maskedSender: (rawWa?.maskedSender ?? rawWa?.masked_sender ?? null) || null,
      recipientCount: Number(rawWa?.recipientCount ?? rawWa?.recipient_count ?? 0) || 0,
      lastSuccessfulMessageAt: toIso(rawWa?.lastSuccessfulMessageAt ?? rawWa?.last_successful_message_at),
      lastError: (rawWa?.lastError ?? rawWa?.last_error ?? null) || null,
    },
    issues,
  };
}
