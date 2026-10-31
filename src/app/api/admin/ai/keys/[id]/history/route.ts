import { NextResponse } from "next/server";
import AiCredential from "@/models/AiCredential";
import { adminHandler } from "@/lib/ai/admin-http";

export const dynamic = "force-dynamic";

export const GET = adminHandler<{ id: string }>(async (_req, _actor, { id }) => {
  const doc: any = await AiCredential.findOne({ id }).select("health_history").lean();
  if (!doc) return NextResponse.json({ error: "Key not found." }, { status: 404 });
  const history = [...(doc.health_history || [])].reverse().map((h: any) => ({
    timestamp: h.timestamp,
    status: h.status,
    http_status: h.http_status ?? null,
    latency_ms: h.latency_ms ?? null,
    reason: h.reason ?? null,
  }));
  return NextResponse.json({ history });
});

