import { NextResponse } from "next/server";
import AiAlert from "@/models/AiAlert";
import { adminHandler, serializeAlert } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";

export const dynamic = "force-dynamic";

export const POST = adminHandler<{ id: string }>(async (req, actor, { id }) => {
  const body = await req.json().catch(() => ({}));
  const now = new Date();
  let update: Record<string, any>;
  if (body.action === "acknowledge") {
    update = { status: "acknowledged", acknowledged_at: now, acknowledged_by: actor.email };
  } else if (body.action === "resolve") {
    update = { status: "resolved", resolved_at: now, resolved_by: actor.email };
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const filter: any = { id };
  if (body.action === "acknowledge") filter.status = "active";
  const alert: any = await AiAlert.findOneAndUpdate(filter, { $set: update }, { new: true });
  if (!alert) return NextResponse.json({ error: "Alert not found or not in a state that allows this action." }, { status: 404 });
  await aiAudit(actor, `alert_${body.action}d`, "ai_alert", id, { alert_type: alert.alert_type, entity: alert.affected_entity_name });
  return NextResponse.json({ alert: serializeAlert(alert) });
});

