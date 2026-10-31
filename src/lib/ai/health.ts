import AiUsageLog from "@/models/AiUsageLog";
import AiCredential from "@/models/AiCredential";
import { raiseAlert, autoResolveAlerts } from "./alerts";

let lastCheck = 0;

/**
 * Evaluates the recent provider error rate and gateway capacity. Throttled (once per minute
 * per server instance) so it can be called after failed requests without adding load.
 * Alerts are deduplicated + cooled down by raiseAlert.
 */
export async function checkGatewayHealth(force = false) {
  const now = Date.now();
  if (!force && now - lastCheck < 60_000) return { skipped: true };
  lastCheck = now;

  const since = new Date(now - 15 * 60_000);
  const agg: any[] = await AiUsageLog.aggregate([
    { $match: { created_at: { $gte: since }, status: { $in: ["success", "provider_error", "rate_limited", "auth_error"] } } },
    { $group: { _id: null, total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 0, 1] } } } },
  ]);
  const total = agg[0]?.total || 0;
  const failed = agg[0]?.failed || 0;
  const rate = total > 0 ? failed / total : 0;

  if (total >= 10 && rate >= 0.3) {
    await raiseAlert({
      type: "high_error_rate",
      severity: rate >= 0.6 ? "critical" : "warning",
      title: "High AI error rate",
      reason: `${failed} of ${total} AI requests failed in the last 15 minutes (${Math.round(rate * 100)}%).`,
      recommendedAction: "Check API key health and the Groq status page in AI Management → API Keys.",
      entityType: "gateway",
      entityId: "gateway",
      entityName: "AI Gateway",
    });
  } else if (total >= 10) {
    await autoResolveAlerts("high_error_rate", "gateway", "gateway");
  }

  const usable = await AiCredential.countDocuments({
    enabled: true,
    status: { $nin: ["Invalid Credentials", "Disabled", "Needs Attention"] },
  });
  if (usable === 0) {
    await raiseAlert({
      type: "gateway_unavailable",
      severity: "critical",
      title: "AI Gateway has no usable API key",
      reason: "There is no enabled API key in a usable state, so pharmacies cannot use the AI assistant.",
      recommendedAction: "Add or rotate a Groq API key in AI Management → API Keys.",
      entityType: "gateway",
      entityId: "gateway",
      entityName: "AI Gateway",
    });
  } else {
    await autoResolveAlerts("gateway_unavailable", "gateway", "gateway");
  }
  return { skipped: false, total, failed, usable };
}

