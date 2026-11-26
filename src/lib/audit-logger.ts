import AuditLog from "@/models/AuditLog";
import type { AdminSessionActor } from "@/lib/admin-auth";

export interface ActivityLogInput {
  actor: Pick<AdminSessionActor, "userId" | "name" | "email" | "role" | "roleName">;
  action: string;
  entity_type?: string;
  entity_id?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAdminActivity(input: ActivityLogInput): Promise<void> {
  try {
    await AuditLog.create({
      action: input.action,
      actor_id: input.actor.userId,
      actor_name: input.actor.name || input.actor.email || "Admin",
      actor_email: input.actor.email,
      actor_role: input.actor.roleName || input.actor.role || "Admin",
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      summary: input.summary,
      metadata: input.metadata,
    });
  } catch (err) {
    console.error("Failed to record admin activity:", err);
  }
}

const MODEL_LABELS: Record<string, string> = {
  clients: "client",
  projects: "project",
  licenses: "license",
  packages: "package",
  business_templates: "template",
  license_payments: "license payment",
  license_billing_periods: "billing period",
  license_renewal_invoices: "renewal voucher",
  billing_adjustments: "billing adjustment",
  releases: "release",
  profiles: "admin user",
  user_roles: "user role",
};

export function describeModelMutation(
  model: string,
  verb: "created" | "updated" | "deleted",
  doc: any,
  fallbackId?: string | null
): { entityType: string; entityId?: string; summary: string } {
  const entityType = MODEL_LABELS[model] || model.replace(/_/g, " ");
  const entityId = String(doc?.id || fallbackId || "").trim() || undefined;
  const label =
    doc?.license_key ||
    doc?.name ||
    doc?.filename ||
    doc?.version ||
    doc?.email ||
    entityId ||
    "";
  const verbTitle = verb.charAt(0).toUpperCase() + verb.slice(1);
  const summary = label
    ? `${verbTitle} ${entityType} "${label}"`
    : `${verbTitle} ${entityType}`;
  return { entityType: model.replace(/s$/, ""), entityId, summary };
}
