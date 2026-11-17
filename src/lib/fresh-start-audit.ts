import AuditLog from "@/models/AuditLog";
import Client from "@/models/Client";
import Project from "@/models/Project";

export type FreshStartAuditAction =
  | "fresh_start_requested"
  | "fresh_start_new_cycle_requested"
  | "fresh_start_request_rejected"
  | "fresh_start_approved"
  | "fresh_start_reauthorized"
  | "fresh_start_rejected"
  | "fresh_start_revoked"
  | "fresh_start_completed"
  | "fresh_start_completion_rejected";

export async function recordFreshStartAudit(params: {
  action: FreshStartAuditAction;
  license: {
    id: string;
    license_key?: string;
    client_id?: string;
    project_id?: string;
  };
  previousState: string;
  newState: string;
  actorId?: string;
  actorEmail?: string;
  actorName?: string;
  cycleId?: string | null;
  authorizationVersion?: number | null;
  reason?: string | null;
  extra?: Record<string, unknown>;
}) {
  try {
    let clientName: string | null = null;
    let projectName: string | null = null;

    if (params.license.client_id) {
      const client = await Client.findOne({ id: params.license.client_id })
        .select("name")
        .lean()
        .catch(() => null);
      clientName = (client as any)?.name || null;
    }

    if (params.license.project_id) {
      const project = await Project.findOne({ id: params.license.project_id })
        .select("name")
        .lean()
        .catch(() => null);
      projectName = (project as any)?.name || null;
    }

    const keyPrefix = params.license.license_key
      ? `${params.license.license_key.slice(0, 12)}...`
      : null;

    await AuditLog.create({
      action: params.action,
      actor_id: params.actorId || undefined,
      actor_email: params.actorEmail || undefined,
      entity_type: "license",
      entity_id: params.license.id,
      metadata: {
        license_id: params.license.id,
        license_key_prefix: keyPrefix,
        client_id: params.license.client_id || null,
        client_name: clientName,
        project_id: params.license.project_id || null,
        pharmacy_name: projectName,
        previous_state: params.previousState,
        new_state: params.newState,
        actor_name: params.actorName || params.actorEmail || "System",
        cycle_id: params.cycleId || null,
        authorization_version: params.authorizationVersion ?? null,
        reason: params.reason || null,
        recorded_at: new Date().toISOString(),
        ...(params.extra || {}),
      },
    });
  } catch (err) {
    console.warn("Fresh Start AuditLog creation failed:", err);
  }
}
