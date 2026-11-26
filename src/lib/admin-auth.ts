import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";
import AdminRole from "@/models/AdminRole";
import { ALL_PERMISSION_KEYS, SYSTEM_DEFAULT_ROLES } from "@/lib/admin-permissions";

export interface AdminSessionActor {
  userId: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  isSuperAdmin: boolean;
  permissions: string[];
}

let seededRolesOnce = false;

export async function ensureSystemAdminRoles(): Promise<void> {
  if (seededRolesOnce) return;
  try {
    for (const def of SYSTEM_DEFAULT_ROLES) {
      await AdminRole.updateOne(
        { slug: def.slug },
        {
          $setOnInsert: {
            slug: def.slug,
            name: def.name,
            description: def.description,
            permissions: def.permissions,
            is_system: true,
          },
        },
        { upsert: true }
      );
    }
    seededRolesOnce = true;
  } catch {
    // Non-fatal on concurrent cold start
  }
}

export async function requireAdminRequest(req: NextRequest): Promise<AdminSessionActor> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const session = await getServerSession();
  const userEmail = String(token?.email || session?.user?.email || "").trim().toLowerCase();

  if (!userEmail) {
    throw new AdminAuthError("Unauthorized", 401);
  }

  await connectToDatabase();
  await ensureSystemAdminRoles();

  const masterEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (masterEmail && userEmail === masterEmail) {
    return {
      userId: "master-admin",
      name: String(token?.name || session?.user?.name || "Super Admin"),
      email: userEmail,
      role: "super_admin",
      roleName: "Super Admin",
      isSuperAdmin: true,
      permissions: ALL_PERMISSION_KEYS,
    };
  }

  const profile = (await Profile.findOne({ email: userEmail }).lean()) as any;
  if (!profile) {
    throw new AdminAuthError("Forbidden: admin profile not found", 403);
  }
  if (profile.status === "disabled") {
    throw new AdminAuthError("Forbidden: this admin account is disabled", 403);
  }

  const candidateIds = [profile._id, profile.id, (token as any)?.id, token?.sub].filter(Boolean);
  const userRoles = (await UserRole.find({ user_id: { $in: candidateIds } }).lean()) as any[];
  const roleSlugs = userRoles.map((r) => String(r.role || "").trim()).filter(Boolean);

  if (roleSlugs.length === 0) {
    throw new AdminAuthError("Forbidden: admin role required", 403);
  }

  const isSuper = roleSlugs.includes("super_admin");
  const roleDocs = (await AdminRole.find({ slug: { $in: roleSlugs } }).lean()) as any[];

  if (!isSuper && !roleSlugs.includes("admin") && roleDocs.length === 0) {
    throw new AdminAuthError("Forbidden: valid admin role required", 403);
  }

  const primarySlug = isSuper ? "super_admin" : roleDocs[0]?.slug || roleSlugs[0];
  const primaryDoc = roleDocs.find((d) => d.slug === primarySlug);
  const permSet = new Set<string>();
  if (isSuper) {
    ALL_PERMISSION_KEYS.forEach((p) => permSet.add(p));
  } else {
    for (const rd of roleDocs) {
      if (Array.isArray(rd.permissions)) {
        rd.permissions.forEach((p: string) => permSet.add(p));
      }
    }
    if (permSet.size === 0 && roleSlugs.includes("admin")) {
      SYSTEM_DEFAULT_ROLES[1].permissions.forEach((p) => permSet.add(p));
    }
  }

  return {
    userId: String(profile.id || profile._id),
    name: String(profile.name || token?.name || userEmail),
    email: userEmail,
    role: primarySlug,
    roleName: isSuper ? "Super Admin" : String(primaryDoc?.name || primarySlug),
    isSuperAdmin: isSuper,
    permissions: Array.from(permSet),
  };
}

export async function requireSuperAdminRequest(req: NextRequest): Promise<AdminSessionActor> {
  const actor = await requireAdminRequest(req);
  if (!actor.isSuperAdmin) {
    throw new AdminAuthError("Forbidden: Super Admin access is required for this action.", 403);
  }
  return actor;
}

export class AdminAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}
