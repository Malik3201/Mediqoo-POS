import { NextResponse } from "next/server";
import { runMigrationCleanupSweep, ensureMigrationSourceLifecycleRule } from "@/lib/migration/cleanup";

export const maxDuration = 300;

/**
 * Durable migration storage cleanup (scheduled via vercel.json crons).
 * Deletes due legacy source uploads, expires abandoned uploads and expired packages,
 * fails stale jobs, and (optionally) maintains the R2 lifecycle safety-net rule.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runMigrationCleanupSweep("system:cron");
    let lifecycle: any = "disabled";
    if (process.env.MIGRATION_R2_LIFECYCLE_ENABLED === "true") {
      lifecycle = await ensureMigrationSourceLifecycleRule().catch((e) => ({ error: String(e?.message || e) }));
    }
    return NextResponse.json({ ok: true, summary, lifecycle });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

