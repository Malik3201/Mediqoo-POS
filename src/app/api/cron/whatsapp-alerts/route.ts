import { NextResponse } from "next/server";
import { processDueWhatsAppRetries, runScheduledWhatsAppSummaries } from "@/lib/whatsapp/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [retries, summaries] = await Promise.all([
      processDueWhatsAppRetries(30),
      runScheduledWhatsAppSummaries(new Date()),
    ]);

    return NextResponse.json({
      ok: true,
      retries,
      summaries,
      ranAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/whatsapp-alerts]", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "Cron failed" }, { status: 500 });
  }
}
