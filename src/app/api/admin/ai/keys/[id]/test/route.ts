import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import { adminHandler, serializeKey } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { testCredential } from "@/lib/ai/key-test";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = adminHandler<{ id: string }>(async (_req, actor, { id }) => {
  const exists = await AiCredential.exists({ id });
  if (!exists) return NextResponse.json({ error: "Key not found." }, { status: 404 });
  const r = await testCredential(id);
  await aiAudit(actor, "credential_tested", "ai_credential", id, { ok: r.ok, http_status: r.http_status });
  const fresh: any = await AiCredential.findOne({ id }).lean();
  return NextResponse.json({ ok: r.ok, http_status: r.http_status, latency_ms: r.latency_ms, message: r.message, key: serializeKey(fresh) });
});

