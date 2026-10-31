import AiUsageLog from "@/models/AiUsageLog";

export const ADMIN_TZ = "Asia/Karachi";

export function startOfDayInTz(day: string, tz = ADMIN_TZ): Date {
  // Karachi has no DST (+05:00); for other zones this is an approximation used for admin analytics only.
  const offset = tz === "Asia/Karachi" ? "+05:00" : "Z";
  return new Date(`${day}T00:00:00${offset}`);
}

export function dayString(d: Date, tz = ADMIN_TZ): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // YYYY-MM-DD
}

/** Aggregates requests / tokens / failures per calendar day (admin timezone). */
export async function dailyTrend(from: Date, to: Date, extraMatch: Record<string, any> = {}) {
  const rows: any[] = await AiUsageLog.aggregate([
    { $match: { created_at: { $gte: from, $lt: to }, ...extraMatch } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: ADMIN_TZ } },
        requests: { $sum: 1 },
        tokens: { $sum: "$total_tokens" },
        failures: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 0, 1] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const map = new Map(rows.map((r) => [r._id, r]));
  const out: { date: string; requests: number; tokens: number; failures: number }[] = [];
  const cursor = new Date(from);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const key = dayString(cursor);
    if (!seen.has(key)) {
      seen.add(key);
      const r = map.get(key);
      out.push({ date: key, requests: r?.requests || 0, tokens: r?.tokens || 0, failures: r?.failures || 0 });
    }
    cursor.setTime(cursor.getTime() + 12 * 3600 * 1000);
    if (cursor >= to) break;
  }
  return out;
}

