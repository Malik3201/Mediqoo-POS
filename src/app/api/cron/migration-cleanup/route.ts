import { NextResponse } from "next/server";
import { runScheduledStorageMaintenance } from "@/app/api/cron/storage-maintenance/route";

export const maxDuration = 300;

/**
 * Durable migration and R2 storage maintenance cron (scheduled via vercel.json crons).
 * Executes migration source/package cleanup, daily storage retention, and weekly inventory/backup sweeps.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runScheduledStorageMaintenance();
    return NextResponse.json({ ok: true, summary: result.migrationSweep, maintenance: result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
