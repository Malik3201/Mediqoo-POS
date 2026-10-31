import { NextResponse } from "next/server";
import AuditLog from "@/models/AuditLog";
import { adminHandler } from "@/lib/ai/admin-http";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => {
  const logs: any[] = await AuditLog.find({ action: { $regex: "^ai_" } }).sort({ created_at: -1 }).limit(100).lean();
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      actor_email: l.actor_email || null,
      entity_type: l.entity_type || null,
      entity_id: l.entity_id || null,
      metadata: l.metadata || {},
      created_at: l.created_at,
    })),
  });
});

