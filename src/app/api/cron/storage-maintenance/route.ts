import { NextResponse } from "next/server";
import { runScheduledStorageMaintenance } from "@/lib/storage/maintenance";

export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "weekly" ? "weekly" : undefined;
    const result = await runScheduledStorageMaintenance(mode);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
