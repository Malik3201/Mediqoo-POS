import { NextResponse } from "next/server";
import AiAlert from "@/models/AiAlert";
import { adminHandler, serializeAlert } from "@/lib/ai/admin-http";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async (req) => {
  const status = req.nextUrl.searchParams.get("status") || "active";
  const q: any = {};
  if (["active", "acknowledged", "resolved"].includes(status)) q.status = status;
  const alerts = await AiAlert.find(q).sort({ last_detected_at: -1 }).limit(200).lean();
  return NextResponse.json({ alerts: (alerts as any[]).map(serializeAlert) });
});

