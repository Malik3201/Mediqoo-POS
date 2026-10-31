import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import AiOrgPool from "@/models/AiOrgPool";
import AiUsageLog from "@/models/AiUsageLog";
import AiAlert from "@/models/AiAlert";
import AiModelRegistry from "@/models/AiModelRegistry";
import { adminHandler, serializeAlert } from "@/lib/ai/admin-http";
import { dailyTrend, dayString, startOfDayInTz } from "@/lib/ai/analytics";
import { getAiSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => {
  const settings = await getAiSettings();
  const now = new Date();
  const todayStart = startOfDayInTz(dayString(now));
  const weekStart = new Date(todayStart.getTime() - 6 * 86400_000);
  const tomorrow = new Date(todayStart.getTime() + 86400_000);

  const [keys, pools, todayAgg, activeAlerts, pricedModels, trend] = await Promise.all([
    AiCredential.find({}).lean(),
    AiOrgPool.find({}).lean(),
    AiUsageLog.aggregate([
      { $match: { created_at: { $gte: todayStart, $lt: tomorrow } } },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          tokens: { $sum: "$total_tokens" },
          success: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
          cost: { $sum: "$estimated_cost_usd" },
          pharmacies: { $addToSet: "$license_id" },
        },
      },
    ]),
    AiAlert.find({ status: "active" }).sort({ severity: 1, last_detected_at: -1 }).limit(20).lean(),
    AiModelRegistry.countDocuments({ $or: [{ cost_per_million_input_usd: { $gt: 0 } }, { cost_per_million_output_usd: { $gt: 0 } }] }),
    dailyTrend(weekStart, tomorrow),
  ]);

  const t: any = todayAgg[0] || { requests: 0, tokens: 0, success: 0, cost: 0, pharmacies: [] };
  const nowMs = now.getTime();
  const enabled = (keys as any[]).filter((k) => k.enabled);
  const healthy = enabled.filter((k) => k.status === "Healthy");
  const poolBlocked = new Set(
    (pools as any[])
      .filter((p) => (p.rate_limited_until && new Date(p.rate_limited_until).getTime() > nowMs) || (p.circuit_open_until && new Date(p.circuit_open_until).getTime() > nowMs))
      .map((p) => p.organization_id)
  );
  const routable = healthy.filter((k) => !poolBlocked.has(k.organization_id));
  const critical = (activeAlerts as any[]).filter((a) => a.severity === "critical");

  let status: "Running" | "Limited" | "Unavailable" = "Running";
  let reason = "All AI capacity is healthy.";
  if (!settings.ai_global_enabled) {
    status = "Unavailable";
    reason = "AI is switched off globally in AI Settings.";
  } else if (enabled.length === 0) {
    status = "Unavailable";
    reason = "No API key is configured yet. Add a Groq key in API Keys.";
  } else if (routable.length === 0) {
    status = "Unavailable";
    reason = poolBlocked.size ? "Every provider pool is rate limited or paused right now." : "No healthy API key is available.";
  } else if (poolBlocked.size > 0 || healthy.length < enabled.length || critical.length > 0) {
    status = "Limited";
    reason = poolBlocked.size ? "Some provider capacity is rate limited." : healthy.length < enabled.length ? "Some API keys need attention." : "There are critical alerts to review.";
  }

  return NextResponse.json({
    status,
    statusReason: reason,
    requestsToday: t.requests,
    tokensToday: t.tokens,
    activePharmacies: (t.pharmacies || []).length,
    healthyKeys: routable.length,
    totalKeys: (keys as any[]).length,
    successRate: t.requests > 0 ? Math.round((t.success / t.requests) * 1000) / 10 : null,
    estimatedCostUsd: pricedModels > 0 ? Math.round(t.cost * 10000) / 10000 : null,
    trend,
    alerts: (activeAlerts as any[]).slice(0, 5).map(serializeAlert),
  });
});

