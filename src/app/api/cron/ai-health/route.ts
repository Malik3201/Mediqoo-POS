import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AiCredential from "@/models/AiCredential";
import { checkGatewayHealth } from "@/lib/ai/health";
import { testCredential } from "@/lib/ai/key-test";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Optional background health job (call from any scheduler with `Authorization: Bearer $CRON_SECRET`).
 * Fails CLOSED: it refuses to run when CRON_SECRET is not configured.
 * It re-tests keys currently in a non-healthy state (token-free GET /models) so temporary
 * problems (429 / 5xx) recover automatically, then evaluates gateway alerts.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const now = new Date();
  const toRetest: any[] = await AiCredential.find({
    enabled: true,
    status: { $in: ["Rate Limited", "Temporarily Unavailable"] },
    $or: [{ cooldown_until: null }, { cooldown_until: { $lte: now } }],
  })
    .select("id")
    .limit(10)
    .lean();
  const results: Record<string, boolean> = {};
  for (const k of toRetest) {
    try {
      results[k.id] = (await testCredential(k.id)).ok;
    } catch {
      results[k.id] = false;
    }
  }
  const health = await checkGatewayHealth(true);
  return NextResponse.json({ ok: true, retested: results, health });
}

