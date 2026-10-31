import AuditLog from "@/models/AuditLog";
import { scrubSecretsFromText } from "./crypto";
import type { AiAdminActor } from "./admin-auth";

function scrubMeta(meta: any): any {
  if (meta == null) return meta;
  if (typeof meta === "string") return scrubSecretsFromText(meta);
  if (Array.isArray(meta)) return meta.map(scrubMeta);
  if (typeof meta === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (/api_?key|secret|token_value|encrypted|password/i.test(k) && typeof v === "string") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrubMeta(v);
      }
    }
    return out;
  }
  return meta;
}

/** Writes an AI-related audit record. Never stores secret values. */
export async function aiAudit(
  actor: AiAdminActor | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, any>
) {
  try {
    await AuditLog.create({
      action: `ai_${action}`,
      actor_id: actor?.id,
      actor_email: actor?.email || "system",
      entity_type: entityType,
      entity_id: entityId,
      metadata: scrubMeta(metadata || {}),
    });
  } catch (e) {
    console.warn("[ai-audit] failed to write audit log:", (e as Error)?.message);
  }
}

