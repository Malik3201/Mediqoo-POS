import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import Project from "@/models/Project";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import OwnerPortalState from "@/models/OwnerPortalState";
import WhatsAppIntegration, {
  type IWhatsAppIntegration,
  type IWhatsAppRecipient,
  type WhatsAppConnectionStatus,
  type WhatsAppPlanTier,
} from "@/models/WhatsAppIntegration";
import WhatsAppAlertDelivery from "@/models/WhatsAppAlertDelivery";
import WhatsAppAlertState from "@/models/WhatsAppAlertState";
import { computeFinancialSummary, getClientDateRange } from "@/lib/analytics";
import {
  decryptWhatsAppTokenWithMeta,
  encryptWhatsAppToken,
  formatPhoneForDisplay,
  maskPhoneNumber,
  maskWhatsAppToken,
  normalizeGreenApiUrl,
  normalizeGreenInstanceId,
  normalizeWhatsAppPhone,
  scrubWhatsAppSecrets,
} from "./crypto";
import { createWhatsAppProvider, type WhatsAppProvider } from "./provider";
import {
  buildTestMessageText,
  evaluateAlertPreferenceAndThreshold,
  formatWhatsAppAlertMessage,
  getFriendlyConnectionMessage,
  isEventStale,
  isSummaryEvent,
} from "./formatter";
import {
  ALL_VALID_ALERT_EVENT_TYPES,
  BUSINESS_MAX_RECIPIENTS,
  DEFAULT_WHATSAPP_PREFERENCES,
  DEFAULT_WHATSAPP_SCHEDULE,
  DEFAULT_WHATSAPP_THRESHOLDS,
  DEVELOPER_MAX_RECIPIENTS,
  type IncomingWhatsAppAlertEvent,
  type SanitizedWhatsAppSettings,
  type WhatsAppAlertEventType,
} from "./types";

// Exponential backoff schedule: 1 min -> 5 min -> 15 min -> 60 min (max 4 retries)
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;
const NUMBER_CHECK_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function resolvePharmacyNameForLicense(license: {
  id: string;
  project_id?: string;
  client_id?: string;
}): Promise<string> {
  if (license.project_id) {
    const project: any = await Project.findOne({ id: license.project_id }).select("name").lean().catch(() => null);
    if (project?.name) return String(project.name);
  }
  if (license.client_id) {
    const client: any = await Client.findOne({ id: license.client_id }).select("name").lean().catch(() => null);
    if (client?.name) return String(client.name);
  }
  return "AivraSol Pharmacy";
}

export async function recordWhatsAppAudit(params: {
  action:
    | "whatsapp_credentials_configured"
    | "whatsapp_connected"
    | "whatsapp_disconnected"
    | "whatsapp_recipients_changed"
    | "whatsapp_preferences_changed"
    | "whatsapp_test_message_sent";
  licenseId: string;
  actorName?: string;
  actorId?: string;
  extra?: Record<string, unknown>;
}) {
  try {
    await AuditLog.create({
      action: params.action,
      actor_id: params.actorId || undefined,
      actor_email: params.actorName || undefined,
      entity_type: "whatsapp_integration",
      entity_id: params.licenseId,
      metadata: {
        license_id: params.licenseId,
        actor_name: params.actorName || "Main POS Admin",
        recorded_at: new Date().toISOString(),
        ...(params.extra || {}),
      },
    });
  } catch (err) {
    console.warn("[whatsapp] AuditLog write failed:", (err as Error)?.message);
  }
}

export function getProviderForIntegration(integration: IWhatsAppIntegration): WhatsAppProvider | null {
  if (!integration.api_url || !integration.instance_id || !integration.encrypted_api_token) {
    return null;
  }
  const { token, usedLegacyKey } = decryptWhatsAppTokenWithMeta(integration.encrypted_api_token);
  if (usedLegacyKey && integration.license_id) {
    try {
      const reencrypted = encryptWhatsAppToken(token);
      integration.encrypted_api_token = reencrypted;
      void WhatsAppIntegration.updateOne(
        { license_id: integration.license_id },
        { $set: { encrypted_api_token: reencrypted } }
      ).catch((err) => {
        console.warn("[whatsapp] Auto key-rotation re-encryption skipped:", (err as Error)?.message);
      });
    } catch {
      /* non-fatal: token already decrypted cleanly */
    }
  }
  return createWhatsAppProvider(integration.provider || "green-api", {
    apiUrl: integration.api_url,
    instanceId: integration.instance_id,
    apiToken: token,
  });
}

export async function getWhatsAppIntegration(licenseId: string): Promise<IWhatsAppIntegration | null> {
  await connectToDatabase();
  return WhatsAppIntegration.findOne({ license_id: licenseId });
}

export async function sanitizeIntegrationForClient(
  integration: IWhatsAppIntegration | null,
  licenseId: string
): Promise<SanitizedWhatsAppSettings> {
  const lastDelivery: any = integration
    ? await WhatsAppAlertDelivery.findOne({
        license_id: licenseId,
        status: { $in: ["sent", "failed_permanent", "retry_scheduled", "paused_disconnected"] },
      })
        .sort({ queued_at: -1 })
        .lean()
        .catch(() => null)
    : null;

  if (!integration) {
    return {
      configured: false,
      provider: "green-api",
      planTier: "developer",
      maxRecipients: DEVELOPER_MAX_RECIPIENTS,
      enabled: false,
      alertsEnabledAt: null,
      connectionStatus: "not_configured",
      statusMessage: getFriendlyConnectionMessage("not_configured"),
      apiUrl: "",
      instanceId: "",
      hasToken: false,
      tokenMask: null,
      senderNumber: null,
      maskedSenderNumber: null,
      primaryRecipient: null,
      secondaryRecipients: [],
      recipients: [],
      timezone: "Asia/Karachi",
      currency: "Rs",
      preferences: { ...DEFAULT_WHATSAPP_PREFERENCES },
      thresholds: { ...DEFAULT_WHATSAPP_THRESHOLDS },
      schedule: { ...DEFAULT_WHATSAPP_SCHEDULE },
      lastVerifiedAt: null,
      lastSuccessfulMessageAt: null,
      lastError: null,
      lastMessage: null,
    };
  }

  const configured = Boolean(integration.api_url && integration.instance_id && integration.encrypted_api_token);
  const status: WhatsAppConnectionStatus = configured
    ? integration.connection_status || "waiting_for_qr"
    : "not_configured";

  return {
    configured,
    provider: integration.provider || "green-api",
    planTier: integration.plan_tier || "developer",
    maxRecipients: integration.max_recipients || DEVELOPER_MAX_RECIPIENTS,
    enabled: Boolean(integration.enabled),
    alertsEnabledAt: integration.alerts_enabled_at ? new Date(integration.alerts_enabled_at).toISOString() : null,
    connectionStatus: status,
    statusMessage: getFriendlyConnectionMessage(status, integration.last_error),
    apiUrl: integration.api_url || "",
    instanceId: integration.instance_id || "",
    hasToken: Boolean(integration.encrypted_api_token),
    tokenMask: integration.token_mask || null,
    senderNumber: formatPhoneForDisplay(integration.sender_number),
    maskedSenderNumber: integration.sender_number ? maskPhoneNumber(integration.sender_number) : null,
    primaryRecipient: formatPhoneForDisplay(integration.primary_recipient),
    secondaryRecipients: (integration.secondary_recipients || [])
      .map((p) => formatPhoneForDisplay(p) || p)
      .filter(Boolean),
    recipients: (integration.recipients || []).map((r) => ({
      slot: r.slot,
      label: r.label,
      phone: formatPhoneForDisplay(r.phone) || r.phone,
      verified: Boolean(r.verified),
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      whatsappExists: r.whatsapp_exists ?? null,
    })),
    timezone: integration.timezone || "Asia/Karachi",
    currency: integration.currency || "Rs",
    preferences: { ...DEFAULT_WHATSAPP_PREFERENCES, ...(integration.preferences || {}) },
    thresholds: { ...DEFAULT_WHATSAPP_THRESHOLDS, ...(integration.thresholds || {}) },
    schedule: { ...DEFAULT_WHATSAPP_SCHEDULE, ...(integration.schedule || {}) },
    lastVerifiedAt: integration.last_verified_at ? new Date(integration.last_verified_at).toISOString() : null,
    lastSuccessfulMessageAt: integration.last_successful_message_at
      ? new Date(integration.last_successful_message_at).toISOString()
      : null,
    lastError: integration.last_error || null,
    lastMessage: lastDelivery
      ? {
          id: lastDelivery.id,
          eventType: lastDelivery.event_type,
          title: lastDelivery.title,
          status: lastDelivery.status,
          maskedRecipient: lastDelivery.masked_recipient,
          sentAt: lastDelivery.sent_at ? new Date(lastDelivery.sent_at).toISOString() : null,
          queuedAt: new Date(lastDelivery.queued_at).toISOString(),
          errorMessage: lastDelivery.error_message || null,
        }
      : null,
  };
}

export interface SaveWhatsAppSettingsInput {
  enabled?: boolean;
  planTier?: WhatsAppPlanTier;
  apiUrl?: string;
  instanceId?: string;
  apiToken?: string; // Only passed when setting/updating token
  recipients?: Array<{
    slot: "owner" | "manager" | "accountant" | "extra";
    label?: string;
    phone: string;
  }>;
  verifyRecipients?: boolean;
  timezone?: string;
  currency?: string;
  preferences?: Partial<typeof DEFAULT_WHATSAPP_PREFERENCES>;
  thresholds?: Partial<typeof DEFAULT_WHATSAPP_THRESHOLDS>;
  schedule?: Partial<typeof DEFAULT_WHATSAPP_SCHEDULE>;
}

/**
 * Checks a phone number against cached GREEN-API results first so we preserve
 * the limited 100 checks/month Developer plan quota.
 */
async function verifyRecipientWithCache(
  integration: IWhatsAppIntegration,
  provider: WhatsAppProvider | null,
  phoneDigits: string,
  forceVerify: boolean
): Promise<{ verified: boolean; exists: boolean | null; error?: string }> {
  const now = Date.now();
  const cached = (integration.number_check_cache || []).find(
    (c) => c.phone === phoneDigits && now - new Date(c.checked_at).getTime() < NUMBER_CHECK_CACHE_TTL_MS
  );
  if (cached && !forceVerify) {
    return { verified: cached.exists, exists: cached.exists };
  }

  if (!provider || !provider.checkNumber || integration.connection_status !== "connected") {
    return { verified: Boolean(cached?.exists), exists: cached ? cached.exists : null };
  }

  const check = await provider.checkNumber(phoneDigits);
  if (!check.ok) {
    return { verified: Boolean(cached?.exists), exists: cached ? cached.exists : null, error: check.errorMessage };
  }

  const exists = Boolean(check.existsWhatsapp);
  const nextCache = (integration.number_check_cache || []).filter((c) => c.phone !== phoneDigits);
  nextCache.push({ phone: phoneDigits, exists, checked_at: new Date() });
  integration.number_check_cache = nextCache.slice(-50);
  return { verified: exists, exists };
}

export async function saveWhatsAppSettings(params: {
  licenseId: string;
  input: SaveWhatsAppSettingsInput;
  actorName?: string;
}): Promise<{ ok: true; settings: SanitizedWhatsAppSettings; warnings: string[] } | { ok: false; status: number; error: string }> {
  await connectToDatabase();
  const { licenseId, input, actorName } = params;
  const warnings: string[] = [];

  let integration = await WhatsAppIntegration.findOne({ license_id: licenseId });
  const isNew = !integration;
  if (!integration) {
    integration = new WhatsAppIntegration({
      license_id: licenseId,
      provider: "green-api",
      plan_tier: "developer",
      max_recipients: DEVELOPER_MAX_RECIPIENTS,
      connection_status: "not_configured",
    });
  }

  let credentialsChanged = false;
  let recipientsChanged = false;
  let prefsChanged = false;

  if (input.planTier === "developer" || input.planTier === "business") {
    integration.plan_tier = input.planTier;
    integration.max_recipients =
      input.planTier === "business" ? BUSINESS_MAX_RECIPIENTS : DEVELOPER_MAX_RECIPIENTS;
  }

  // 1. Validate and save GREEN-API credentials if provided
  const updatingCreds =
    input.apiUrl !== undefined || input.instanceId !== undefined || (input.apiToken && input.apiToken.trim().length > 0);

  if (updatingCreds) {
    const nextUrlRaw = input.apiUrl !== undefined ? input.apiUrl : integration.api_url || "";
    const nextInstRaw = input.instanceId !== undefined ? input.instanceId : integration.instance_id || "";

    if (nextUrlRaw || nextInstRaw || input.apiToken) {
      const urlCheck = normalizeGreenApiUrl(nextUrlRaw);
      if (!urlCheck.valid) return { ok: false, status: 400, error: urlCheck.error || "Invalid API URL." };

      const instCheck = normalizeGreenInstanceId(nextInstRaw);
      if (!instCheck.valid) return { ok: false, status: 400, error: instCheck.error || "Invalid Instance ID." };

      const rawToken = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
      if (!rawToken && !integration.encrypted_api_token) {
        return { ok: false, status: 400, error: "API Token is required when configuring GREEN-API." };
      }

      if (rawToken) {
        if (rawToken.length < 10 || rawToken.length > 256 || /\s/.test(rawToken)) {
          return { ok: false, status: 400, error: "API Token format is invalid." };
        }
        integration.encrypted_api_token = encryptWhatsAppToken(rawToken);
        integration.token_mask = maskWhatsAppToken(rawToken);
        credentialsChanged = true;
      }

      if (integration.api_url !== urlCheck.url || integration.instance_id !== instCheck.instanceId) {
        integration.api_url = urlCheck.url;
        integration.instance_id = instCheck.instanceId;
        credentialsChanged = true;
      }
    }
  }

  // If credentials were changed, immediately verify state once against GREEN-API
  if (credentialsChanged) {
    const provider = getProviderForIntegration(integration);
    if (provider) {
      const statusRes = await provider.getStatus();
      integration.connection_status = statusRes.connectionStatus;
      integration.raw_provider_state = statusRes.rawState || null;
      if (statusRes.senderNumber) {
        integration.sender_number = statusRes.senderNumber;
      }
      if (statusRes.ok) {
        integration.last_verified_at = new Date();
        integration.last_error = null;
        integration.last_error_code = null;
        integration.consecutive_failures = 0;
      } else {
        integration.last_error = statusRes.errorMessage || "Could not verify credentials.";
        integration.last_error_code = statusRes.errorCode || "VERIFY_FAILED";
      }
    }
  }

  // 2. Validate and normalize recipients (respecting plan limit: max 3 on Developer plan)
  if (Array.isArray(input.recipients)) {
    const maxAllowed = integration.max_recipients || DEVELOPER_MAX_RECIPIENTS;
    const cleanedInput = input.recipients
      .map((r) => ({ ...r, phone: String(r.phone || "").trim() }))
      .filter((r) => r.phone.length > 0);

    if (cleanedInput.length > maxAllowed) {
      return {
        ok: false,
        status: 400,
        error: `Current ${integration.plan_tier} plan supports up to ${maxAllowed} WhatsApp recipients.`,
      };
    }

    const prevPhones = new Map<string, IWhatsAppRecipient>();
    for (const r of integration.recipients || []) {
      prevPhones.set(r.phone, r);
    }

    const seenDigits = new Set<string>();
    const nextRecipients: IWhatsAppRecipient[] = [];
    const provider = getProviderForIntegration(integration);

    for (const item of cleanedInput) {
      const norm = normalizeWhatsAppPhone(item.phone);
      if (!norm.valid) {
        return { ok: false, status: 400, error: norm.error || `Invalid number: ${item.phone}` };
      }
      if (seenDigits.has(norm.digits)) {
        continue; // deduplicate identical numbers cleanly
      }
      seenDigits.add(norm.digits);

      const existingRec = prevPhones.get(norm.digits);
      const isAddedOrChanged = !existingRec;
      let verified = existingRec?.verified ?? false;
      let verifiedAt = existingRec?.verified_at ?? null;
      let whatsappExists = existingRec?.whatsapp_exists ?? null;

      // Only consume GREEN-API checkWhatsapp quota when added/changed or explicitly requested
      if (isAddedOrChanged || input.verifyRecipients) {
        const vRes = await verifyRecipientWithCache(
          integration,
          provider,
          norm.digits,
          Boolean(input.verifyRecipients)
        );
        verified = vRes.verified;
        whatsappExists = vRes.exists;
        if (vRes.exists !== null) verifiedAt = new Date();
        if (vRes.exists === false) {
          warnings.push(`${formatPhoneForDisplay(norm.digits)} does not appear to have an active WhatsApp account.`);
        } else if (vRes.error) {
          warnings.push(`Saved ${formatPhoneForDisplay(norm.digits)}, but live WhatsApp check was skipped: ${vRes.error}`);
        }
      }

      const defaultLabel =
        item.slot === "owner"
          ? "Owner"
          : item.slot === "manager"
          ? "Manager"
          : item.slot === "accountant"
          ? "Accountant"
          : "Alert Recipient";

      nextRecipients.push({
        slot: item.slot || (nextRecipients.length === 0 ? "owner" : "manager"),
        label: (item.label || defaultLabel).trim().slice(0, 40),
        phone: norm.digits,
        verified,
        verified_at: verifiedAt,
        whatsapp_exists: whatsappExists,
      });
    }

    const prevSig = (integration.recipients || []).map((r: IWhatsAppRecipient) => r.phone).join(",");
    const nextSig = nextRecipients.map((r) => r.phone).join(",");
    if (prevSig !== nextSig) recipientsChanged = true;

    integration.recipients = nextRecipients;
    integration.primary_recipient = nextRecipients[0]?.phone || null;
    integration.secondary_recipients = nextRecipients.slice(1).map((r) => r.phone);
  }

  // 3. Preferences, thresholds, timezone, schedule
  if (input.timezone && typeof input.timezone === "string" && input.timezone.trim()) {
    integration.timezone = input.timezone.trim().slice(0, 64);
    prefsChanged = true;
  }
  if (input.currency && typeof input.currency === "string" && input.currency.trim()) {
    integration.currency = input.currency.trim().slice(0, 10);
  }
  if (input.preferences && typeof input.preferences === "object") {
    integration.preferences = {
      ...DEFAULT_WHATSAPP_PREFERENCES,
      ...(integration.preferences || {}),
      ...input.preferences,
    };
    prefsChanged = true;
  }
  if (input.thresholds && typeof input.thresholds === "object") {
    const cleanNum = (v: unknown, fb: number, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
    };
    const cur = { ...DEFAULT_WHATSAPP_THRESHOLDS, ...(integration.thresholds || {}) };
    const t = input.thresholds;
    integration.thresholds = {
      largeSaleAmount: cleanNum(t.largeSaleAmount, cur.largeSaleAmount, 100, 100_000_000),
      largeDiscountPct: cleanNum(t.largeDiscountPct, cur.largeDiscountPct, 1, 100),
      belowCostLossAmount: cleanNum(t.belowCostLossAmount, cur.belowCostLossAmount, 0, 100_000_000),
      largeReturnAmount: cleanNum(t.largeReturnAmount, cur.largeReturnAmount, 100, 100_000_000),
      largeCashAdjustmentAmount: cleanNum(t.largeCashAdjustmentAmount, cur.largeCashAdjustmentAmount, 100, 100_000_000),
      largeCustomerBalanceAdjustmentAmount: cleanNum(
        t.largeCustomerBalanceAdjustmentAmount,
        cur.largeCustomerBalanceAdjustmentAmount,
        100,
        100_000_000
      ),
      largeSupplierPaymentAmount: cleanNum(
        t.largeSupplierPaymentAmount,
        cur.largeSupplierPaymentAmount,
        100,
        100_000_000
      ),
      majorStockAdjustmentUnits: cleanNum(t.majorStockAdjustmentUnits, cur.majorStockAdjustmentUnits, 1, 1_000_000),
      lowStockReminderHours: cleanNum(t.lowStockReminderHours, cur.lowStockReminderHours, 1, 168),
    };
    prefsChanged = true;
  }
  if (input.schedule && typeof input.schedule === "object") {
    const cur = { ...DEFAULT_WHATSAPP_SCHEDULE, ...(integration.schedule || {}) };
    integration.schedule = {
      ...cur,
      ...(typeof input.schedule.dailySummaryAfterClosing === "boolean"
        ? { dailySummaryAfterClosing: input.schedule.dailySummaryAfterClosing }
        : {}),
      ...(typeof input.schedule.dailyFallbackTime === "string" && /^\d{2}:\d{2}$/.test(input.schedule.dailyFallbackTime)
        ? { dailyFallbackTime: input.schedule.dailyFallbackTime }
        : {}),
      ...(typeof input.schedule.sendDailyNotClosedNotice === "boolean"
        ? { sendDailyNotClosedNotice: input.schedule.sendDailyNotClosedNotice }
        : {}),
      ...(typeof input.schedule.weeklySummaryDay === "number" &&
      input.schedule.weeklySummaryDay >= 0 &&
      input.schedule.weeklySummaryDay <= 6
        ? { weeklySummaryDay: Math.floor(input.schedule.weeklySummaryDay) }
        : {}),
      ...(typeof input.schedule.weeklySummaryTime === "string" && /^\d{2}:\d{2}$/.test(input.schedule.weeklySummaryTime)
        ? { weeklySummaryTime: input.schedule.weeklySummaryTime }
        : {}),
      ...(typeof input.schedule.monthlySummaryDay === "number" &&
      input.schedule.monthlySummaryDay >= 1 &&
      input.schedule.monthlySummaryDay <= 28
        ? { monthlySummaryDay: Math.floor(input.schedule.monthlySummaryDay) }
        : {}),
    };
    prefsChanged = true;
  }

  // 4. Enabled toggle + activation watermark (Requirement 49 & 50: NO historical flood!)
  if (typeof input.enabled === "boolean") {
    const wasEnabled = Boolean(integration.enabled);
    integration.enabled = input.enabled;
    if (input.enabled && (!wasEnabled || !integration.alerts_enabled_at)) {
      integration.alerts_enabled_at = new Date();
    }
    prefsChanged = true;
  } else if (isNew && integration.encrypted_api_token && integration.primary_recipient) {
    integration.enabled = true;
    integration.alerts_enabled_at = new Date();
  }

  await integration.save();

  // Record non-sensitive audit entries (NEVER log API token)
  if (credentialsChanged) {
    await recordWhatsAppAudit({
      action: "whatsapp_credentials_configured",
      licenseId,
      actorName,
      extra: {
        provider: integration.provider,
        instance_id: integration.instance_id,
        token_mask: integration.token_mask,
        connection_status: integration.connection_status,
      },
    });
  }
  if (recipientsChanged) {
    await recordWhatsAppAudit({
      action: "whatsapp_recipients_changed",
      licenseId,
      actorName,
      extra: {
        recipient_count: integration.recipients.length,
        masked_recipients: integration.recipients.map((r: IWhatsAppRecipient) => ({
          slot: r.slot,
          masked: maskPhoneNumber(r.phone),
        })),
      },
    });
  }
  if (prefsChanged && !credentialsChanged && !recipientsChanged) {
    await recordWhatsAppAudit({
      action: "whatsapp_preferences_changed",
      licenseId,
      actorName,
      extra: {
        enabled: integration.enabled,
        timezone: integration.timezone,
      },
    });
  }

  const sanitized = await sanitizeIntegrationForClient(integration, licenseId);
  return { ok: true, settings: sanitized, warnings };
}

export async function requestWhatsAppQr(params: {
  licenseId: string;
  actorName?: string;
}): Promise<
  | {
      ok: true;
      alreadyConnected: boolean;
      qrBase64: string | null;
      connectionStatus: WhatsAppConnectionStatus;
      statusMessage: string;
      senderNumber: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  await connectToDatabase();
  const integration = await WhatsAppIntegration.findOne({ license_id: params.licenseId });
  if (!integration || !integration.api_url || !integration.instance_id || !integration.encrypted_api_token) {
    return {
      ok: false,
      status: 400,
      error: "Please save your GREEN-API provider details under Advanced / Provider Setup first.",
    };
  }

  const provider = getProviderForIntegration(integration);
  if (!provider || !provider.requestQr) {
    return { ok: false, status: 400, error: "QR connection is not supported by the active WhatsApp provider." };
  }

  const qrRes = await provider.requestQr();
  if (!qrRes.ok) {
    integration.connection_status = qrRes.connectionStatus;
    integration.last_error = qrRes.errorMessage || "Failed fetching QR code.";
    integration.last_error_code = qrRes.errorCode || "QR_ERROR";
    await integration.save();
    return { ok: false, status: 502, error: integration.last_error };
  }

  const prevStatus = integration.connection_status;
  integration.connection_status = qrRes.connectionStatus;
  integration.last_error = null;
  integration.last_error_code = null;

  if (qrRes.alreadyConnected) {
    const st = await provider.getStatus();
    if (st.senderNumber) integration.sender_number = st.senderNumber;
    integration.last_verified_at = new Date();
    integration.consecutive_failures = 0;
    if (!integration.alerts_enabled_at && integration.enabled) {
      integration.alerts_enabled_at = new Date();
    }
    if (prevStatus !== "connected") {
      await recordWhatsAppAudit({
        action: "whatsapp_connected",
        licenseId: params.licenseId,
        actorName: params.actorName,
        extra: { masked_sender: maskPhoneNumber(integration.sender_number) },
      });
    }
  }

  await integration.save();
  return {
    ok: true,
    alreadyConnected: Boolean(qrRes.alreadyConnected),
    qrBase64: qrRes.qrBase64 || null,
    connectionStatus: integration.connection_status,
    statusMessage: getFriendlyConnectionMessage(integration.connection_status),
    senderNumber: formatPhoneForDisplay(integration.sender_number),
  };
}

export async function refreshWhatsAppConnectionStatus(params: {
  licenseId: string;
  actorName?: string;
}): Promise<{
  ok: boolean;
  configured: boolean;
  connectionStatus: WhatsAppConnectionStatus;
  statusMessage: string;
  senderNumber: string | null;
  lastError: string | null;
  resumedPendingCount?: number;
}> {
  await connectToDatabase();
  const integration = await WhatsAppIntegration.findOne({ license_id: params.licenseId });
  if (!integration || !integration.api_url || !integration.instance_id || !integration.encrypted_api_token) {
    return {
      ok: true,
      configured: false,
      connectionStatus: "not_configured",
      statusMessage: getFriendlyConnectionMessage("not_configured"),
      senderNumber: null,
      lastError: null,
    };
  }

  const provider = getProviderForIntegration(integration);
  if (!provider) {
    return {
      ok: true,
      configured: false,
      connectionStatus: "not_configured",
      statusMessage: getFriendlyConnectionMessage("not_configured"),
      senderNumber: null,
      lastError: null,
    };
  }

  const prevStatus = integration.connection_status;
  const st = await provider.getStatus();
  integration.connection_status = st.connectionStatus;
  integration.raw_provider_state = st.rawState || null;
  if (st.senderNumber) {
    integration.sender_number = st.senderNumber;
  }
  if (st.ok) {
    integration.last_verified_at = new Date();
    if (st.connectionStatus === "connected") {
      integration.last_error = null;
      integration.last_error_code = null;
      integration.consecutive_failures = 0;
      integration.paused_until = null;
    }
  } else {
    integration.last_error = st.errorMessage || "Could not verify WhatsApp status.";
    integration.last_error_code = st.errorCode || "STATUS_ERROR";
  }

  await integration.save();

  let resumedPendingCount = 0;
  if (prevStatus !== "connected" && st.connectionStatus === "connected") {
    await recordWhatsAppAudit({
      action: "whatsapp_connected",
      licenseId: params.licenseId,
      actorName: params.actorName,
      extra: { masked_sender: maskPhoneNumber(integration.sender_number) },
    });
    // Re-queue any non-stale paused_disconnected deliveries cleanly for immediate retry
    const resumeRes = await WhatsAppAlertDelivery.updateMany(
      { license_id: params.licenseId, status: "paused_disconnected" },
      { $set: { status: "retry_scheduled", next_attempt_at: new Date(), error_message: null } }
    );
    resumedPendingCount = resumeRes.modifiedCount || 0;
  } else if (prevStatus === "connected" && st.connectionStatus === "disconnected") {
    await recordWhatsAppAudit({
      action: "whatsapp_disconnected",
      licenseId: params.licenseId,
      actorName: params.actorName,
      extra: { raw_state: st.rawState || null },
    });
  }

  return {
    ok: st.ok,
    configured: true,
    connectionStatus: integration.connection_status,
    statusMessage: getFriendlyConnectionMessage(integration.connection_status, integration.last_error),
    senderNumber: formatPhoneForDisplay(integration.sender_number),
    lastError: integration.last_error || null,
    resumedPendingCount,
  };
}

export async function sendWhatsAppTestMessage(params: {
  license: { id: string; project_id?: string; client_id?: string };
  recipientOverride?: string;
  actorName?: string;
}): Promise<
  | { ok: true; message: string; providerMessageId: string; maskedRecipient: string }
  | { ok: false; status: number; error: string }
> {
  await connectToDatabase();
  const integration = await WhatsAppIntegration.findOne({ license_id: params.license.id });
  if (!integration || !integration.api_url || !integration.instance_id || !integration.encrypted_api_token) {
    return { ok: false, status: 400, error: "WhatsApp Alerts is not configured yet." };
  }

  const targetPhoneRaw = params.recipientOverride || integration.primary_recipient || integration.recipients?.[0]?.phone;
  if (!targetPhoneRaw) {
    return { ok: false, status: 400, error: "Please add an Owner WhatsApp Number before sending a test message." };
  }

  const norm = normalizeWhatsAppPhone(targetPhoneRaw);
  if (!norm.valid) {
    return { ok: false, status: 400, error: norm.error || "Invalid recipient WhatsApp number." };
  }

  const provider = getProviderForIntegration(integration);
  if (!provider) {
    return { ok: false, status: 400, error: "WhatsApp provider credentials are incomplete." };
  }

  const pharmacyName = await resolvePharmacyNameForLicense(params.license);
  const text = buildTestMessageText(pharmacyName);

  const sendRes = await provider.sendMessage({
    recipientDigits: norm.digits,
    message: text,
  });

  const masked = maskPhoneNumber(norm.digits);
  const testId = `test:${crypto.randomUUID()}`;

  await WhatsAppAlertDelivery.create({
    license_id: params.license.id,
    event_id: testId,
    event_type: "system.test",
    event_key: testId,
    dedupe_key: `${params.license.id}:system.test:${testId}:${norm.digits}`,
    severity: "info",
    title: "Test Message",
    reference_label: "Connection Test",
    recipient_phone: norm.digits,
    masked_recipient: masked,
    provider: integration.provider,
    provider_message_id: sendRes.providerMessageId || null,
    status: sendRes.ok ? "sent" : "failed_permanent",
    attempts: 1,
    error_code: sendRes.errorCode || null,
    error_message: sendRes.errorMessage || null,
    event_occurred_at: new Date(),
    queued_at: new Date(),
    sent_at: sendRes.ok ? new Date() : null,
  });

  if (!sendRes.ok) {
    if (sendRes.disconnected) {
      integration.connection_status = "disconnected";
    } else if (!sendRes.transient) {
      integration.connection_status = "error";
    }
    integration.last_error = sendRes.errorMessage || "Test message failed.";
    integration.last_error_code = sendRes.errorCode || "TEST_FAILED";
    await integration.save();
    return { ok: false, status: 502, error: integration.last_error };
  }

  integration.connection_status = "connected";
  integration.last_successful_message_at = new Date();
  integration.last_verified_at = new Date();
  integration.last_error = null;
  integration.last_error_code = null;
  integration.consecutive_failures = 0;
  await integration.save();

  await recordWhatsAppAudit({
    action: "whatsapp_test_message_sent",
    licenseId: params.license.id,
    actorName: params.actorName,
    extra: {
      masked_recipient: masked,
      provider_message_id: sendRes.providerMessageId,
    },
  });

  return {
    ok: true,
    message: "Test message sent successfully",
    providerMessageId: sendRes.providerMessageId!,
    maskedRecipient: masked,
  };
}

export interface BatchProcessSummary {
  accepted: number;
  duplicates: number;
  ignored: number;
  failed: number;
  paused: number;
  connectionStatus: WhatsAppConnectionStatus;
  results: Array<{
    eventId: string;
    outcome: "accepted" | "duplicate" | "ignored" | "failed" | "paused";
    reason?: string;
  }>;
}

/**
 * Evaluates stateful dedupe for stock/expiry summary alerts so repeated alerts
 * are not sent while an item/snapshot remains unchanged.
 */
async function checkAndUpdateStatefulDedupe(
  licenseId: string,
  event: IncomingWhatsAppAlertEvent,
  reminderHours: number
): Promise<{ shouldSend: boolean; stateHash: string; reason?: string }> {
  const isStateful =
    event.eventType === "inventory.low_stock_summary" ||
    event.eventType === "inventory.out_of_stock_summary" ||
    event.eventType === "inventory.near_expiry_summary";

  if (!isStateful) {
    return { shouldSend: true, stateHash: event.stateFingerprint || event.eventKey };
  }

  const stateHash =
    event.stateFingerprint ||
    crypto.createHash("sha256").update(JSON.stringify(event.payload || {})).digest("hex").slice(0, 16);

  const stateKey = `${event.eventType}:${event.eventKey}`;
  const isRecovered = Boolean(event.payload?.recovered === true);

  const existing = await WhatsAppAlertState.findOne({ license_id: licenseId, state_key: stateKey });

  if (isRecovered) {
    if (existing && existing.is_active) {
      existing.is_active = false;
      existing.recovered_at = new Date();
      existing.state_hash = stateHash;
      await existing.save();
    }
    return { shouldSend: false, stateHash, reason: "state_recovered" };
  }

  if (existing && existing.is_active) {
    // Same active condition -> suppress duplicate until recovery or reminder window elapsed
    const lastAlertedMs = existing.last_alerted_at ? new Date(existing.last_alerted_at).getTime() : 0;
    const reminderWindowMs = Math.max(1, reminderHours) * 60 * 60 * 1000;
    const unchanged = existing.state_hash === stateHash;
    if (unchanged && Date.now() - lastAlertedMs < reminderWindowMs) {
      return { shouldSend: false, stateHash, reason: "active_state_duplicate" };
    }
  }

  await WhatsAppAlertState.findOneAndUpdate(
    { license_id: licenseId, state_key: stateKey },
    {
      $set: {
        event_type: event.eventType,
        is_active: true,
        state_hash: stateHash,
        last_alerted_at: new Date(),
      },
    },
    { upsert: true }
  );

  return { shouldSend: true, stateHash };
}

/**
 * Authoritative server ingestion for batched POS alert events.
 * Enforces: activation watermark, staleness check, preferences, thresholds, dedupe,
 * disconnected-instance pause, GREEN-API delivery, retry scheduling, and delivery history.
 */
export async function processAlertEventsBatch(params: {
  license: { id: string; project_id?: string; client_id?: string };
  events: IncomingWhatsAppAlertEvent[];
}): Promise<BatchProcessSummary> {
  await connectToDatabase();
  const integration = await WhatsAppIntegration.findOne({ license_id: params.license.id });

  if (
    !integration ||
    !integration.enabled ||
    !integration.api_url ||
    !integration.instance_id ||
    !integration.encrypted_api_token
  ) {
    return {
      accepted: 0,
      duplicates: 0,
      ignored: params.events.length,
      failed: 0,
      paused: 0,
      connectionStatus: integration?.connection_status || "not_configured",
      results: params.events.map((e) => ({
        eventId: e.id,
        outcome: "ignored",
        reason: "integration_not_enabled",
      })),
    };
  }

  const maxRecipients = integration.max_recipients || DEVELOPER_MAX_RECIPIENTS;
  const activeRecipients = (integration.recipients || [])
    .map((r: IWhatsAppRecipient) => r.phone)
    .filter(Boolean)
    .slice(0, maxRecipients);

  if (activeRecipients.length === 0) {
    return {
      accepted: 0,
      duplicates: 0,
      ignored: params.events.length,
      failed: 0,
      paused: 0,
      connectionStatus: integration.connection_status,
      results: params.events.map((e) => ({
        eventId: e.id,
        outcome: "ignored",
        reason: "no_recipients_configured",
      })),
    };
  }

  const provider = getProviderForIntegration(integration);
  const pharmacyName = await resolvePharmacyNameForLicense(params.license);
  const prefs = { ...DEFAULT_WHATSAPP_PREFERENCES, ...(integration.preferences || {}) };
  const thresholds = { ...DEFAULT_WHATSAPP_THRESHOLDS, ...(integration.thresholds || {}) };
  const watermarkMs = integration.alerts_enabled_at ? new Date(integration.alerts_enabled_at).getTime() : 0;

  let accepted = 0;
  let duplicates = 0;
  let ignored = 0;
  let failed = 0;
  let paused = 0;
  const results: BatchProcessSummary["results"] = [];
  let integrationDirty = false;

  for (const rawEvent of params.events) {
    const eventId = String(rawEvent?.id || "").trim();
    const eventType = String(rawEvent?.eventType || "").trim() as WhatsAppAlertEventType;
    const eventKey = String(rawEvent?.eventKey || eventId).trim();

    if (!eventId || !ALL_VALID_ALERT_EVENT_TYPES.has(eventType) || !eventKey) {
      ignored++;
      results.push({ eventId: eventId || "invalid", outcome: "ignored", reason: "invalid_event" });
      continue;
    }

    const occurredAt = rawEvent.occurredAt || rawEvent.createdAt ? new Date(rawEvent.occurredAt || rawEvent.createdAt!) : new Date();
    const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

    // 1. Activation Watermark — NEVER alert historical transactions predating feature activation!
    if (!isSummaryEvent(eventType) && watermarkMs > 0 && safeOccurredAt.getTime() < watermarkMs - 60_000) {
      ignored++;
      results.push({ eventId, outcome: "ignored", reason: "before_activation_watermark" });
      continue;
    }

    // 2. Stale offline alert filter (e.g. don't send "Main disconnected" 2 days after reconnect)
    if (isEventStale(eventType, safeOccurredAt)) {
      ignored++;
      results.push({ eventId, outcome: "ignored", reason: "stale_event" });
      continue;
    }

    // 3. Server-authoritative preferences + threshold evaluation
    const prefCheck = evaluateAlertPreferenceAndThreshold(rawEvent, prefs, thresholds);
    if (!prefCheck.allowed) {
      ignored++;
      results.push({ eventId, outcome: "ignored", reason: prefCheck.reason });
      continue;
    }

    // 4. Stateful dedupe (for grouped low-stock / expiry alerts)
    const stateCheck = await checkAndUpdateStatefulDedupe(
      params.license.id,
      rawEvent,
      thresholds.lowStockReminderHours || 24
    );
    if (!stateCheck.shouldSend) {
      duplicates++;
      results.push({ eventId, outcome: "duplicate", reason: stateCheck.reason });
      continue;
    }

    const formattedMessage = formatWhatsAppAlertMessage({
      eventType,
      title: rawEvent.title,
      payload: rawEvent.payload || {},
      pharmacyName,
      occurredAt: safeOccurredAt,
      timezone: integration.timezone || "Asia/Karachi",
      currency: integration.currency || "Rs",
    });

    const referenceLabel =
      typeof rawEvent.payload?.invoiceNumber === "string"
        ? rawEvent.payload.invoiceNumber
        : typeof rawEvent.payload?.returnNumber === "string"
        ? rawEvent.payload.returnNumber
        : typeof rawEvent.payload?.dateLabel === "string"
        ? rawEvent.payload.dateLabel
        : eventKey.slice(0, 60);

    let eventSentCount = 0;
    let eventDupCount = 0;
    let eventPausedCount = 0;
    let eventFailCount = 0;

    for (const phoneDigits of activeRecipients) {
      const dedupeKey = `${eventType}:${eventKey}:${stateCheck.stateHash}:${phoneDigits}`;
      const existingDelivery = await WhatsAppAlertDelivery.findOne({
        license_id: params.license.id,
        dedupe_key: dedupeKey,
      }).lean();

      if (existingDelivery) {
        eventDupCount++;
        continue;
      }

      const masked = maskPhoneNumber(phoneDigits);
      const isPausedDisconnected =
        integration.connection_status === "disconnected" ||
        (integration.paused_until && new Date(integration.paused_until).getTime() > Date.now());

      // When instance is disconnected: retain important pending alerts without hammering GREEN-API!
      if (isPausedDisconnected || !provider) {
        try {
          await WhatsAppAlertDelivery.create({
            license_id: params.license.id,
            event_id: eventId,
            event_type: eventType,
            event_key: eventKey,
            dedupe_key: dedupeKey,
            severity: rawEvent.severity || "info",
            title: rawEvent.title || eventType,
            reference_label: referenceLabel,
            recipient_phone: phoneDigits,
            masked_recipient: masked,
            provider: integration.provider,
            status: "paused_disconnected",
            attempts: 0,
            next_attempt_at: null,
            error_code: "INSTANCE_DISCONNECTED",
            error_message: "WhatsApp is disconnected. Alert retained until reconnected.",
            retry_payload: rawEvent.payload || {},
            pharmacy_name: pharmacyName,
            event_occurred_at: safeOccurredAt,
            queued_at: new Date(),
          });
          eventPausedCount++;
        } catch (err: any) {
          if (err?.code === 11000) eventDupCount++;
          else eventFailCount++;
        }
        continue;
      }

      // Reserve delivery row before outbound call (prevents concurrent multi-terminal double-sends!)
      let deliveryDoc: any;
      try {
        deliveryDoc = await WhatsAppAlertDelivery.create({
          license_id: params.license.id,
          event_id: eventId,
          event_type: eventType,
          event_key: eventKey,
          dedupe_key: dedupeKey,
          severity: rawEvent.severity || "info",
          title: rawEvent.title || eventType,
          reference_label: referenceLabel,
          recipient_phone: phoneDigits,
          masked_recipient: masked,
          provider: integration.provider,
          status: "queued",
          attempts: 1,
          retry_payload: rawEvent.payload || {},
          pharmacy_name: pharmacyName,
          event_occurred_at: safeOccurredAt,
          queued_at: new Date(),
        });
      } catch (err: any) {
        if (err?.code === 11000) {
          eventDupCount++;
          continue;
        }
        eventFailCount++;
        continue;
      }

      const sendRes = await provider.sendMessage({
        recipientDigits: phoneDigits,
        message: formattedMessage,
      });

      if (sendRes.ok && sendRes.providerMessageId) {
        deliveryDoc.status = "sent";
        deliveryDoc.provider_message_id = sendRes.providerMessageId;
        deliveryDoc.sent_at = new Date();
        deliveryDoc.error_code = null;
        deliveryDoc.error_message = null;
        deliveryDoc.retry_payload = null; // Do not store message/payload unnecessarily once delivered
        await deliveryDoc.save();

        integration.connection_status = "connected";
        integration.last_successful_message_at = new Date();
        integration.last_error = null;
        integration.last_error_code = null;
        integration.consecutive_failures = 0;
        integrationDirty = true;

        if (eventType === "summary.daily" && typeof rawEvent.payload?.businessDate === "string") {
          integration.schedule = {
            ...DEFAULT_WHATSAPP_SCHEDULE,
            ...(integration.schedule || {}),
            lastDailySummaryDate: rawEvent.payload.businessDate,
          };
        }
        eventSentCount++;
      } else if (sendRes.disconnected) {
        deliveryDoc.status = "paused_disconnected";
        deliveryDoc.error_code = sendRes.errorCode || "INSTANCE_DISCONNECTED";
        deliveryDoc.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "WhatsApp disconnected.");
        await deliveryDoc.save();

        integration.connection_status = "disconnected";
        integration.last_error = deliveryDoc.error_message;
        integration.last_error_code = deliveryDoc.error_code;
        integration.consecutive_failures = (integration.consecutive_failures || 0) + 1;
        integrationDirty = true;
        eventPausedCount++;
      } else if (sendRes.transient) {
        deliveryDoc.status = "retry_scheduled";
        deliveryDoc.next_attempt_at = new Date(Date.now() + RETRY_DELAYS_MS[0]);
        deliveryDoc.error_code = sendRes.errorCode || "TRANSIENT_ERROR";
        deliveryDoc.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "Temporary send error.");
        await deliveryDoc.save();

        integration.last_error = deliveryDoc.error_message;
        integration.last_error_code = deliveryDoc.error_code;
        integration.consecutive_failures = (integration.consecutive_failures || 0) + 1;
        integrationDirty = true;
        eventFailCount++;
      } else {
        deliveryDoc.status = "failed_permanent";
        deliveryDoc.error_code = sendRes.errorCode || "PERMANENT_ERROR";
        deliveryDoc.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "Permanent send error.");
        deliveryDoc.retry_payload = null;
        await deliveryDoc.save();

        if (sendRes.errorCode === "INVALID_CREDENTIALS" || sendRes.errorCode === "INSTANCE_NOT_FOUND") {
          integration.connection_status = "error";
        }
        integration.last_error = deliveryDoc.error_message;
        integration.last_error_code = deliveryDoc.error_code;
        integrationDirty = true;
        eventFailCount++;
      }
    }

    if (eventSentCount > 0) {
      accepted++;
      results.push({ eventId, outcome: "accepted" });
    } else if (eventPausedCount > 0) {
      paused++;
      results.push({ eventId, outcome: "paused", reason: "instance_disconnected" });
    } else if (eventDupCount > 0 && eventFailCount === 0) {
      duplicates++;
      results.push({ eventId, outcome: "duplicate", reason: "already_delivered" });
    } else {
      failed++;
      results.push({ eventId, outcome: "failed", reason: "provider_delivery_failed" });
    }
  }

  if (integrationDirty) {
    await integration.save();
  }

  return {
    accepted,
    duplicates,
    ignored,
    failed,
    paused,
    connectionStatus: integration.connection_status,
    results,
  };
}

/**
 * Processes due server-side retries with exponential backoff (1m -> 5m -> 15m -> 60m).
 * Skips any disconnected integration so we never spam GREEN-API.
 */
export async function processDueWhatsAppRetries(limit = 30): Promise<{
  processed: number;
  sent: number;
  rescheduled: number;
  failedPermanent: number;
  paused: number;
}> {
  await connectToDatabase();
  const now = new Date();
  const dueRows = await WhatsAppAlertDelivery.find({
    status: "retry_scheduled",
    next_attempt_at: { $lte: now },
  })
    .sort({ next_attempt_at: 1 })
    .limit(limit);

  let sent = 0;
  let rescheduled = 0;
  let failedPermanent = 0;
  let paused = 0;

  const integrationCache = new Map<string, IWhatsAppIntegration | null>();

  for (const row of dueRows) {
    let integration = integrationCache.get(row.license_id);
    if (integration === undefined) {
      integration = (await WhatsAppIntegration.findOne({ license_id: row.license_id })) ?? null;
      integrationCache.set(row.license_id, integration);
    }

    if (!integration || !integration.enabled || integration.connection_status === "disconnected") {
      row.status = "paused_disconnected";
      row.next_attempt_at = null;
      await row.save();
      paused++;
      continue;
    }

    if (isEventStale(row.event_type as WhatsAppAlertEventType, new Date(row.event_occurred_at), now)) {
      row.status = "stale_ignored";
      row.next_attempt_at = null;
      row.retry_payload = null;
      await row.save();
      continue;
    }

    const provider = getProviderForIntegration(integration);
    if (!provider) {
      row.status = "failed_permanent";
      row.error_code = "MISSING_CREDENTIALS";
      row.retry_payload = null;
      await row.save();
      failedPermanent++;
      continue;
    }

    const text = formatWhatsAppAlertMessage({
      eventType: row.event_type as WhatsAppAlertEventType,
      title: row.title,
      payload: (row.retry_payload as Record<string, unknown>) || {},
      pharmacyName: row.pharmacy_name || "Pharmacy",
      occurredAt: row.event_occurred_at,
      timezone: integration.timezone || "Asia/Karachi",
      currency: integration.currency || "Rs",
    });

    row.attempts = (row.attempts || 0) + 1;
    const sendRes = await provider.sendMessage({
      recipientDigits: row.recipient_phone,
      message: text,
    });

    if (sendRes.ok && sendRes.providerMessageId) {
      row.status = "sent";
      row.provider_message_id = sendRes.providerMessageId;
      row.sent_at = new Date();
      row.next_attempt_at = null;
      row.error_code = null;
      row.error_message = null;
      row.retry_payload = null;
      await row.save();

      integration.connection_status = "connected";
      integration.last_successful_message_at = new Date();
      integration.last_error = null;
      integration.consecutive_failures = 0;
      await integration.save();
      sent++;
    } else if (sendRes.disconnected) {
      row.status = "paused_disconnected";
      row.next_attempt_at = null;
      row.error_code = sendRes.errorCode || "INSTANCE_DISCONNECTED";
      row.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "WhatsApp disconnected.");
      await row.save();

      integration.connection_status = "disconnected";
      integration.last_error = row.error_message;
      await integration.save();
      paused++;
    } else if (sendRes.transient && row.attempts < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[Math.min(row.attempts, RETRY_DELAYS_MS.length - 1)];
      row.status = "retry_scheduled";
      row.next_attempt_at = new Date(Date.now() + delay);
      row.error_code = sendRes.errorCode || "TRANSIENT_ERROR";
      row.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "Temporary delivery error.");
      await row.save();
      rescheduled++;
    } else {
      row.status = "failed_permanent";
      row.next_attempt_at = null;
      row.error_code = sendRes.errorCode || "MAX_RETRIES_EXCEEDED";
      row.error_message = scrubWhatsAppSecrets(sendRes.errorMessage || "Delivery failed permanently.");
      row.retry_payload = null;
      await row.save();
      failedPermanent++;
    }
  }

  return {
    processed: dueRows.length,
    sent,
    rescheduled,
    failedPermanent,
    paused,
  };
}

function getTzLocalParts(now: Date, tz: string): {
  ymd: string;
  hhmm: string;
  dayOfWeek: number;
  dayOfMonth: number;
  isoWeekKey: string;
  monthKey: string;
} {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    const y = parts.year;
    const m = parts.month;
    const d = parts.day;
    const hh = parts.hour === "24" ? "00" : parts.hour;
    const mm = parts.minute;
    const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = wdMap[parts.weekday] ?? now.getUTCDay();
    const dayOfMonth = Number(d) || 1;
    // Simple ISO week identifier
    const localDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const startOfYear = new Date(Date.UTC(Number(y), 0, 1));
    const weekNum = Math.ceil(((localDate.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
    return {
      ymd: `${y}-${m}-${d}`,
      hhmm: `${hh}:${mm}`,
      dayOfWeek,
      dayOfMonth,
      isoWeekKey: `${y}-W${String(weekNum).padStart(2, "0")}`,
      monthKey: `${y}-${m}`,
    };
  } catch {
    const ymd = now.toISOString().slice(0, 10);
    return {
      ymd,
      hhmm: now.toISOString().slice(11, 16),
      dayOfWeek: now.getUTCDay(),
      dayOfMonth: now.getUTCDate(),
      isoWeekKey: `${ymd.slice(0, 4)}-W01`,
      monthKey: ymd.slice(0, 7),
    };
  }
}

/**
 * Server-side scheduled Daily / Weekly / Monthly summary dispatcher.
 * Uses existing canonical synced analytics (`AnalyticsEvent`, `CloudExpense`, `OwnerPortalState`,
 * `computeFinancialSummary`) — never fabricates a Daily Closing when none occurred.
 */
export async function runScheduledWhatsAppSummaries(now: Date = new Date()): Promise<{
  checked: number;
  dailySent: number;
  weeklySent: number;
  monthlySent: number;
}> {
  await connectToDatabase();
  const integrations = await WhatsAppIntegration.find({
    enabled: true,
    connection_status: "connected",
    primary_recipient: { $ne: null },
  });

  let dailySent = 0;
  let weeklySent = 0;
  let monthlySent = 0;

  for (const integ of integrations) {
    const tz = integ.timezone || "Asia/Karachi";
    const local = getTzLocalParts(now, tz);
    const prefs = { ...DEFAULT_WHATSAPP_PREFERENCES, ...(integ.preferences || {}) };
    const sched = { ...DEFAULT_WHATSAPP_SCHEDULE, ...(integ.schedule || {}) };

    // 1. Daily fallback notice (ONLY if dailySummary enabled, no closing summary sent today, and past fallback time)
    if (
      prefs.dailySummary &&
      sched.sendDailyNotClosedNotice &&
      sched.lastDailySummaryDate !== local.ymd &&
      local.hhmm >= (sched.dailyFallbackTime || "22:00")
    ) {
      const res = await processAlertEventsBatch({
        license: { id: integ.license_id },
        events: [
          {
            id: `daily-not-closed:${local.ymd}`,
            eventType: "summary.daily",
            eventKey: `daily-not-closed:${local.ymd}`,
            severity: "info",
            title: "Daily Closing Pending",
            occurredAt: now.toISOString(),
            payload: {
              notClosedNotice: true,
              businessDate: local.ymd,
              dateLabel: local.ymd,
            },
          },
        ],
      });
      if (res.accepted > 0) {
        integ.schedule = { ...sched, lastDailySummaryDate: local.ymd };
        await integ.save();
        dailySent++;
      }
    }

    // 2. Weekly summary from canonical synced analytics (once-daily cron; evaluated in pharmacy timezone)
    if (
      prefs.weeklySummary &&
      sched.lastWeeklySummaryKey !== local.isoWeekKey &&
      local.dayOfWeek === (sched.weeklySummaryDay ?? 0)
    ) {
      const range = getClientDateRange(tz, "7d");
      const summary = await buildServerCanonicalPeriodSummary(integ.license_id, range.start, range.end);
      if (summary) {
        const res = await processAlertEventsBatch({
          license: { id: integ.license_id },
          events: [
            {
              id: `weekly-summary:${local.isoWeekKey}`,
              eventType: "summary.weekly",
              eventKey: `weekly:${local.isoWeekKey}`,
              severity: "info",
              title: "Weekly Summary",
              occurredAt: now.toISOString(),
              payload: {
                periodLabel: `Week ${local.isoWeekKey}`,
                ...summary,
              },
            },
          ],
        });
        if (res.accepted > 0) {
          integ.schedule = { ...DEFAULT_WHATSAPP_SCHEDULE, ...(integ.schedule || {}), lastWeeklySummaryKey: local.isoWeekKey };
          await integ.save();
          weeklySent++;
        }
      }
    }

    // 3. Monthly summary from canonical synced analytics (once-daily cron; evaluated in pharmacy timezone)
    if (
      prefs.monthlySummary &&
      sched.lastMonthlySummaryKey !== local.monthKey &&
      local.dayOfMonth === (sched.monthlySummaryDay ?? 1)
    ) {
      const range = getClientDateRange(tz, "30d");
      const summary = await buildServerCanonicalPeriodSummary(integ.license_id, range.start, range.end);
      if (summary) {
        const res = await processAlertEventsBatch({
          license: { id: integ.license_id },
          events: [
            {
              id: `monthly-summary:${local.monthKey}`,
              eventType: "summary.monthly",
              eventKey: `monthly:${local.monthKey}`,
              severity: "info",
              title: "Monthly Summary",
              occurredAt: now.toISOString(),
              payload: {
                periodLabel: `Last 30 Days (${local.monthKey})`,
                ...summary,
              },
            },
          ],
        });
        if (res.accepted > 0) {
          integ.schedule = { ...DEFAULT_WHATSAPP_SCHEDULE, ...(integ.schedule || {}), lastMonthlySummaryKey: local.monthKey };
          await integ.save();
          monthlySent++;
        }
      }
    }
  }

  return {
    checked: integrations.length,
    dailySent,
    weeklySent,
    monthlySent,
  };
}

/**
 * Reads canonical synced analytics (`AnalyticsEvent` + `CloudExpense` + `OwnerPortalState`)
 * using the exact existing `computeFinancialSummary` function — never invents new math.
 */
async function buildServerCanonicalPeriodSummary(licenseId: string, start: Date, end: Date) {
  const [aggByType, expenseAgg, portalState] = await Promise.all([
    AnalyticsEvent.aggregate([
      { $match: { license_id: licenseId, occurred_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$type",
          gross_sales: { $sum: { $ifNull: ["$payload.netSales", { $ifNull: ["$payload.total", 0] }] } },
          cogs: { $sum: { $ifNull: ["$payload.cogs", 0] } },
          return_amount: { $sum: { $ifNull: ["$payload.returnAmount", { $ifNull: ["$payload.total", 0] }] } },
          cogs_reversed: { $sum: { $ifNull: ["$payload.cogsReversed", 0] } },
          purchase_total: { $sum: { $ifNull: ["$payload.total", 0] } },
          cash_sales: {
            $sum: {
              $cond: [{ $eq: ["$payload.paymentMethod", "cash"] }, { $ifNull: ["$payload.netSales", 0] }, 0],
            },
          },
          credit_sales: {
            $sum: {
              $cond: [{ $eq: ["$payload.paymentMethod", "credit"] }, { $ifNull: ["$payload.netSales", 0] }, 0],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    CloudExpense.aggregate([
      {
        $match: {
          license_id: licenseId,
          deleted: { $ne: true },
          occurred_at: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    OwnerPortalState.findOne({ license_id: licenseId })
      .select("receivables_total payables_total")
      .lean()
      .catch(() => null),
  ]);

  if (!aggByType || aggByType.length === 0) return null;

  const expenseTotal = Number(expenseAgg?.[0]?.total) || 0;
  const fin = computeFinancialSummary(aggByType, expenseTotal);
  const ps: any = portalState || {};

  return {
    netSales: fin.net_sales,
    grossProfit: fin.gross_profit,
    returns: fin.sales_returns,
    purchases: fin.purchases,
    expenses: fin.expenses,
    netProfit: fin.net_profit,
    cashSales: fin.cash_sales,
    creditSales: fin.credit_sales,
    receivables: Number(ps.receivables_total) || 0,
    payables: Number(ps.payables_total) || 0,
  };
}

export async function getRecentWhatsAppDeliveries(licenseId: string, limit = 30) {
  await connectToDatabase();
  const rows = await WhatsAppAlertDelivery.find({ license_id: licenseId })
    .sort({ queued_at: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  return rows.map((r: any) => ({
    id: r.id,
    eventType: r.event_type,
    severity: r.severity,
    title: r.title,
    referenceLabel: r.reference_label || null,
    maskedRecipient: r.masked_recipient,
    providerMessageId: r.provider_message_id || null,
    status: r.status,
    attempts: r.attempts || 0,
    errorCode: r.error_code || null,
    errorMessage: r.error_message || null,
    queuedAt: r.queued_at ? new Date(r.queued_at).toISOString() : null,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  }));
}
