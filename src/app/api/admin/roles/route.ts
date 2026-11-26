import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AdminRole from "@/models/AdminRole";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";
import AuditLog from "@/models/AuditLog";
import {
  AdminAuthError,
  ensureSystemAdminRoles,
  requireAdminRequest,
  requireSuperAdminRequest,
} from "@/lib/admin-auth";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  slugifyRoleName,
} from "@/lib/admin-permissions";
import { recordAdminActivity } from "@/lib/audit-logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();
    await ensureSystemAdminRoles();

    const [roles, profiles, userRoles, recentCounts] = await Promise.all([
      AdminRole.find({}).sort({ is_system: -1, name: 1 }).lean(),
      Profile.find({}).select("-password_hash").sort({ created_at: -1 }).lean(),
      UserRole.find({}).lean(),
      AuditLog.aggregate([
        { $group: { _id: "$actor_id", count: { $sum: 1 }, last_at: { $max: "$created_at" } } },
      ]),
    ]);

    const roleBySlug = new Map<string, any>();
    for (const r of roles as any[]) roleBySlug.set(r.slug, r);

    const activityByActor = new Map<string, { count: number; last_at: Date | null }>();
    for (const c of recentCounts as any[]) {
      if (c._id) activityByActor.set(String(c._id), { count: Number(c.count || 0), last_at: c.last_at || null });
    }

    const userRoleMap = new Map<string, string[]>();
    for (const ur of userRoles as any[]) {
      const list = userRoleMap.get(ur.user_id) || [];
      list.push(ur.role);
      userRoleMap.set(ur.user_id, list);
    }

    const admins = (profiles as any[]).map((p) => {
      const assignedSlugs = userRoleMap.get(p.id) || [];
      const primarySlug = assignedSlugs.includes("super_admin")
        ? "super_admin"
        : assignedSlugs[0] || "admin";
      const roleDoc = roleBySlug.get(primarySlug);
      const actStats = activityByActor.get(p.id) || { count: 0, last_at: null };
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        status: p.status || "active",
        role: primarySlug,
        role_name: roleDoc?.name || primarySlug,
        roles: assignedSlugs,
        created_by_name: p.created_by_name || null,
        last_login_at: p.last_login_at || null,
        created_at: p.created_at,
        activity_count: actStats.count,
        last_activity_at: actStats.last_at,
      };
    });

    // Include Master Super Admin entry at top for visibility (read-only)
    const masterEmail = String(process.env.ADMIN_EMAIL || "").trim();
    const masterStats = activityByActor.get("master-admin") || { count: 0, last_at: null };
    const membersWithMaster = masterEmail
      ? [
          {
            id: "master-admin",
            name: "Super Admin (Master)",
            email: masterEmail,
            status: "active",
            role: "super_admin",
            role_name: "Super Admin",
            roles: ["super_admin"],
            is_master: true,
            created_by_name: "System",
            last_login_at: null,
            created_at: null,
            activity_count: masterStats.count,
            last_activity_at: masterStats.last_at,
          },
          ...admins.filter((a) => a.email.toLowerCase() !== masterEmail.toLowerCase()),
        ]
      : admins;

    const rolesWithCounts = (roles as any[]).map((r) => ({
      ...r,
      member_count: membersWithMaster.filter((m) => m.role === r.slug).length,
    }));

    return NextResponse.json({
      ok: true,
      current_actor: actor,
      permissions_catalog: ADMIN_PERMISSIONS,
      roles: rolesWithCounts,
      admins: membersWithMaster,
    });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to load roles" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();
    await ensureSystemAdminRoles();

    const body = await req.json();
    const name = String(body?.name || "").trim();
    const description = String(body?.description || "").trim();
    const rawPerms: string[] = Array.isArray(body?.permissions) ? body.permissions : [];

    if (!name || name.length < 2) {
      return NextResponse.json({ ok: false, error: "Role name must be at least 2 characters." }, { status: 400 });
    }

    const slug = slugifyRoleName(body?.slug || name);
    if (!slug || slug.length < 2) {
      return NextResponse.json({ ok: false, error: "Invalid role identifier." }, { status: 400 });
    }

    const existing = await AdminRole.findOne({ slug }).lean();
    if (existing) {
      return NextResponse.json({ ok: false, error: `Role "${name}" already exists.` }, { status: 409 });
    }

    const validSet = new Set(ALL_PERMISSION_KEYS);
    const permissions = Array.from(new Set(rawPerms.filter((p) => validSet.has(p))));

    const created = await AdminRole.create({
      slug,
      name,
      description,
      permissions,
      is_system: false,
      created_by: actor.userId,
      created_by_name: actor.name,
    });

    await recordAdminActivity({
      actor,
      action: "role.create",
      entity_type: "role",
      entity_id: created.id,
      summary: `Created custom role "${name}" (${permissions.length} permissions)`,
      metadata: { slug, permissions },
    });

    return NextResponse.json({ ok: true, role: created }, { status: 201 });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to create role" }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();

    const body = await req.json();
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Role id is required." }, { status: 400 });
    }

    const role: any = await AdminRole.findOne({ id });
    if (!role) {
      return NextResponse.json({ ok: false, error: "Role not found." }, { status: 404 });
    }
    if (role.slug === "super_admin") {
      return NextResponse.json(
        { ok: false, error: "The Super Admin system role cannot be restricted." },
        { status: 400 }
      );
    }

    const validSet = new Set(ALL_PERMISSION_KEYS);
    if (typeof body.name === "string" && body.name.trim().length >= 2) {
      role.name = body.name.trim();
    }
    if (typeof body.description === "string") {
      role.description = body.description.trim();
    }
    if (Array.isArray(body.permissions)) {
      role.permissions = Array.from(new Set(body.permissions.filter((p: string) => validSet.has(p))));
    }
    await role.save();

    await recordAdminActivity({
      actor,
      action: "role.update",
      entity_type: "role",
      entity_id: role.id,
      summary: `Updated role "${role.name}" (${role.permissions.length} permissions)`,
      metadata: { slug: role.slug, permissions: role.permissions },
    });

    return NextResponse.json({ ok: true, role });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to update role" }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ ok: false, error: "Role id is required." }, { status: 400 });
    }

    const role: any = await AdminRole.findOne({ id }).lean();
    if (!role) {
      return NextResponse.json({ ok: false, error: "Role not found." }, { status: 404 });
    }
    if (role.is_system) {
      return NextResponse.json({ ok: false, error: "Built-in system roles cannot be deleted." }, { status: 400 });
    }

    const assignedCount = await UserRole.countDocuments({ role: role.slug });
    if (assignedCount > 0) {
      return NextResponse.json(
        { ok: false, error: `Reassign ${assignedCount} admin(s) before deleting "${role.name}".` },
        { status: 409 }
      );
    }

    await AdminRole.deleteOne({ id });

    await recordAdminActivity({
      actor,
      action: "role.delete",
      entity_type: "role",
      entity_id: role.id,
      summary: `Deleted custom role "${role.name}"`,
      metadata: { slug: role.slug },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to delete role" }, { status });
  }
}
