import nodemailer from "nodemailer";
import AiAlert, { type AiAlertSeverity, type AiAlertType } from "@/models/AiAlert";
import { getAiSettings } from "./settings";

export interface RaiseAlertInput {
  type: AiAlertType;
  severity: AiAlertSeverity;
  title: string;
  reason: string;
  recommendedAction: string;
  entityType: "credential" | "org_pool" | "pharmacy" | "gateway";
  entityId: string;
  entityName: string;
}

/**
 * Raises (or updates) an alert with deduplication + cooldown.
 *
 * - One open (active/acknowledged) alert per (type, entity) — repeated failures only
 *   bump `occurrence_count` / `last_detected_at`; they never create a new row.
 * - A resolved alert may re-open as a NEW alert only once the cooldown has elapsed.
 * - Optional email is sent through the portal's already-configured SMTP only,
 *   at most once per cooldown window, and only for critical alerts.
 *
 * Returns the alert plus whether a brand-new alert row was created.
 */
export async function raiseAlert(input: RaiseAlertInput) {
  const settings = await getAiSettings();
  const cooldownMs = settings.alert_cooldown_minutes * 60_000;
  const dedupKey = `${input.type}:${input.entityType}:${input.entityId}`;
  const now = new Date();

  const open: any = await AiAlert.findOne({
    dedup_key: dedupKey,
    status: { $in: ["active", "acknowledged"] },
  });

  if (open) {
    open.occurrence_count += 1;
    open.last_detected_at = now;
    open.reason = input.reason;
    const renotify = open.cooldown_until <= now;
    if (renotify) open.cooldown_until = new Date(now.getTime() + cooldownMs);
    await open.save();
    if (renotify && open.status === "active") {
      void maybeEmail(settings.alert_email_enabled, open);
    }
    return { alert: open, created: false };
  }

  // Cooldown guard against flapping: do not re-create immediately after resolution.
  const lastResolved: any = await AiAlert.findOne({ dedup_key: dedupKey, status: "resolved" })
    .sort({ resolved_at: -1 })
    .lean();
  if (lastResolved?.resolved_at) {
    const since = now.getTime() - new Date(lastResolved.resolved_at).getTime();
    if (since < cooldownMs) {
      return { alert: lastResolved, created: false };
    }
  }

  const created: any = await AiAlert.create({
    dedup_key: dedupKey,
    alert_type: input.type,
    severity: input.severity,
    title: input.title,
    reason: input.reason,
    recommended_action: input.recommendedAction,
    affected_entity_type: input.entityType,
    affected_entity_id: input.entityId,
    affected_entity_name: input.entityName,
    status: "active",
    occurrence_count: 1,
    first_detected_at: now,
    last_detected_at: now,
    cooldown_until: new Date(now.getTime() + cooldownMs),
  });
  void maybeEmail(settings.alert_email_enabled, created);
  return { alert: created, created: true };
}

/** Auto-resolves open alerts when the underlying condition has cleared. */
export async function autoResolveAlerts(type: AiAlertType, entityType: string, entityId: string) {
  await AiAlert.updateMany(
    { dedup_key: `${type}:${entityType}:${entityId}`, status: { $in: ["active", "acknowledged"] } },
    { $set: { status: "resolved", resolved_at: new Date(), resolved_by: "system:auto" } }
  );
}

async function maybeEmail(enabled: boolean, alert: any) {
  try {
    if (!enabled || alert.severity !== "critical") return;
    // Only through the existing configured SMTP; silently skip when it is not configured.
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
    const to = process.env.RENEWAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
    if (!to) return;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: { name: "AivraSol AI Monitor", address: process.env.SMTP_FROM || "support@aivrasol.com" },
      to,
      subject: `[AI Management] ${alert.title}`,
      text: `${alert.title}\n\nReason: ${alert.reason}\nRecommended action: ${alert.recommended_action}\nAffected: ${alert.affected_entity_name}\nOccurrences: ${alert.occurrence_count}`,
    });
  } catch (e) {
    console.warn("[ai-alert] email skipped:", (e as Error)?.message);
  }
}

