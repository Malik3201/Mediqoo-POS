import { NextResponse } from "next/server";
import AiUsageLog from "@/models/AiUsageLog";
import AiModelRegistry from "@/models/AiModelRegistry";
import { adminHandler } from "@/lib/ai/admin-http";
import { dailyTrend, dayString, startOfDayInTz } from "@/lib/ai/analytics";

export const dynamic = "force-dynamic";

const STATUSES = ["success", "rate_limited", "quota_exceeded", "auth_error", "provider_error", "blocked"];

export const GET = adminHandler(async (req) => {
  const sp = req.nextUrl.searchParams;
  const today = dayString(new Date());
  const toDay = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") || "") ? (sp.get("to") as string) : today;
  const defaultFrom = dayString(new Date(Date.now() - 6 * 86400_000));
  let fromDay = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") || "") ? (sp.get("from") as string) : defaultFrom;
  if (fromDay > toDay) fromDay = toDay;

  const from = startOfDayInTz(fromDay);
  const to = new Date(startOfDayInTz(toDay).getTime() + 86400_000);
  if (to.getTime() - from.getTime() > 400 * 86400_000) return NextResponse.json({ error: "Date range too large (max ~13 months)." }, { status: 400 });

  const match: Record<string, any> = { created_at: { $gte: from, $lt: to } };
  const licenseId = sp.get("license_id");
  const model = sp.get("model");
  const status = sp.get("status");
  if (licenseId) match.license_id = licenseId;
  if (model) match.model_used = model;
  if (status === "failed") match.status = { $ne: "success" };
  else if (status && STATUSES.includes(status)) match.status = status;

  const [summaryAgg, byModel, byPharmacy, rows, trend, priced] = await Promise.all([
    AiUsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          tokens: { $sum: "$total_tokens" },
          inputTokens: { $sum: "$input_tokens" },
          outputTokens: { $sum: "$output_tokens" },
          cachedTokens: { $sum: "$cached_tokens" },
          failures: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 0, 1] } },
          latency: { $avg: "$latency_ms" },
          cost: { $sum: "$estimated_cost_usd" },
        },
      },
    ]),
    AiUsageLog.aggregate([
      { $match: match },
      { $group: { _id: "$model_used", requests: { $sum: 1 }, tokens: { $sum: "$total_tokens" } } },
      { $sort: { requests: -1 } },
      { $limit: 20 },
    ]),
    AiUsageLog.aggregate([
      { $match: match },
      { $group: { _id: "$license_id", pharmacy_name: { $last: "$pharmacy_name" }, requests: { $sum: 1 }, tokens: { $sum: "$total_tokens" } } },
      { $sort: { requests: -1 } },
      { $limit: 50 },
    ]),
    AiUsageLog.find(match).sort({ created_at: -1 }).limit(200).lean(),
    dailyTrend(from, to, match),
    AiModelRegistry.countDocuments({ $or: [{ cost_per_million_input_usd: { $gt: 0 } }, { cost_per_million_output_usd: { $gt: 0 } }] }),
  ]);

  const s: any = summaryAgg[0] || {};
  return NextResponse.json({
    summary: {
      requests: s.requests || 0,
      tokens: s.tokens || 0,
      inputTokens: s.inputTokens || 0,
      outputTokens: s.outputTokens || 0,
      cachedTokens: s.cachedTokens || 0,
      failures: s.failures || 0,
      avgLatencyMs: Math.round(s.latency || 0),
      estimatedCostUsd: priced > 0 ? Math.round((s.cost || 0) * 10000) / 10000 : null,
    },
    byDay: trend,
    byModel: byModel.map((m: any) => ({ model: m._id, requests: m.requests, tokens: m.tokens })),
    byPharmacy: byPharmacy.map((p: any) => ({ license_id: p._id, pharmacy_name: p.pharmacy_name, requests: p.requests, tokens: p.tokens })),
    rows: (rows as any[]).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      pharmacy_name: r.pharmacy_name,
      operator_role: r.operator_role,
      request_type: r.request_type,
      model_used: r.model_used,
      credential_name: r.credential_name || null,
      total_tokens: r.total_tokens,
      latency_ms: r.latency_ms,
      status: r.status,
    })),
  });
});
