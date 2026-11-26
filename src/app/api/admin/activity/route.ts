import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import Profile from "@/models/Profile";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdminRequest(req);
    await connectToDatabase();

    const sp = req.nextUrl.searchParams;
    const actorId = sp.get("actor_id")?.trim() || "";
    const entityType = sp.get("entity_type")?.trim() || "";
    const q = sp.get("q")?.trim() || "";
    const limit = Math.min(300, Math.max(20, parseInt(sp.get("limit") || "150", 10)));

    const filter: Record<string, any> = {};
    if (actorId && actorId !== "all") {
      filter.actor_id = actorId;
    }
    if (entityType && entityType !== "all") {
      filter.entity_type = entityType;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { actor_name: rx },
        { actor_email: rx },
        { action: rx },
        { summary: rx },
        { entity_type: rx },
        { entity_id: rx },
      ];
    }

    const [logs, profiles] = await Promise.all([
      AuditLog.find(filter).sort({ created_at: -1 }).limit(limit).lean(),
      Profile.find({}).select("id name email").lean(),
    ]);

    const profileMap = new Map<string, { name: string; email: string }>();
    for (const p of profiles as any[]) {
      profileMap.set(String(p.id), { name: String(p.name || p.email), email: String(p.email || "") });
    }

    const masterEmail = String(process.env.ADMIN_EMAIL || "").trim();

    const enriched = (logs as any[]).map((row) => {
      const prof = row.actor_id ? profileMap.get(String(row.actor_id)) : undefined;
      const isMaster = row.actor_id === "master-admin";
      const actorName =
        row.actor_name ||
        (isMaster ? "Super Admin" : prof?.name) ||
        row.actor_email ||
        "System";
      const actorEmail =
        row.actor_email || (isMaster ? masterEmail : prof?.email) || "";
      const actorRole = row.actor_role || (isMaster ? "Super Admin" : "Admin");
      return {
        id: row.id,
        action: row.action,
        actor_id: row.actor_id || null,
        actor_name: actorName,
        actor_email: actorEmail,
        actor_role: actorRole,
        entity_type: row.entity_type || null,
        entity_id: row.entity_id || null,
        summary: row.summary || null,
        metadata: row.metadata || null,
        created_at: row.created_at,
      };
    });

    const actorsList = [
      { id: "master-admin", name: "Super Admin (Master)", email: masterEmail },
      ...(profiles as any[]).map((p) => ({
        id: String(p.id),
        name: String(p.name || p.email),
        email: String(p.email || ""),
      })),
    ];

    return NextResponse.json({
      ok: true,
      logs: enriched,
      actors: actorsList,
    });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to load activity" }, { status });
  }
}
