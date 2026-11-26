import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";
import AdminRole from "@/models/AdminRole";
import {
  AdminAuthError,
  ensureSystemAdminRoles,
  requireSuperAdminRequest,
} from "@/lib/admin-auth";
import { recordAdminActivity } from "@/lib/audit-logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();
    await ensureSystemAdminRoles();

    const body = await req.json();
    const name = String(body?.name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const roleSlug = String(body?.role || "admin").trim().toLowerCase();

    if (!name || name.length < 2) {
      return NextResponse.json({ ok: false, error: "Admin full name is required." }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "A valid email address is required." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const masterEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (masterEmail && email === masterEmail) {
      return NextResponse.json(
        { ok: false, error: "This email is reserved for the Master Super Admin." },
        { status: 409 }
      );
    }

    const existing = await Profile.findOne({ email }).lean();
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "An admin account with this email already exists." },
        { status: 409 }
      );
    }

    const roleDoc: any = await AdminRole.findOne({ slug: roleSlug }).lean();
    if (!roleDoc) {
      return NextResponse.json(
        { ok: false, error: `Role "${roleSlug}" does not exist.` },
        { status: 400 }
      );
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await Profile.create({
      id: userId,
      name,
      email,
      password_hash: passwordHash,
      status: "active",
      created_by: actor.userId,
      created_by_name: actor.name,
    });

    await UserRole.create({
      user_id: userId,
      role: roleDoc.slug,
    });

    await recordAdminActivity({
      actor,
      action: "admin_user.create",
      entity_type: "admin_user",
      entity_id: userId,
      summary: `Added admin "${name}" (${email}) with role "${roleDoc.name}"`,
      metadata: { name, email, role: roleDoc.slug, role_name: roleDoc.name },
    });

    return NextResponse.json(
      {
        ok: true,
        admin: {
          id: userId,
          name,
          email,
          status: "active",
          role: roleDoc.slug,
          role_name: roleDoc.name,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to add admin" }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();
    await ensureSystemAdminRoles();

    const body = await req.json();
    const id = String(body?.id || "").trim();
    if (!id || id === "master-admin") {
      return NextResponse.json(
        { ok: false, error: "Cannot modify the Master Super Admin from this panel." },
        { status: 400 }
      );
    }

    const profile: any = await Profile.findOne({ id });
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Admin user not found." }, { status: 404 });
    }

    const changes: string[] = [];

    if (typeof body.name === "string" && body.name.trim().length >= 2 && body.name.trim() !== profile.name) {
      profile.name = body.name.trim();
      changes.push("name");
    }

    if (body.status === "active" || body.status === "disabled") {
      if (profile.status !== body.status) {
        profile.status = body.status;
        changes.push(`status=${body.status}`);
      }
    }

    if (typeof body.password === "string" && body.password.trim().length > 0) {
      if (body.password.length < 6) {
        return NextResponse.json(
          { ok: false, error: "New password must be at least 6 characters." },
          { status: 400 }
        );
      }
      profile.password_hash = await bcrypt.hash(body.password, 10);
      changes.push("password");
    }

    await profile.save();

    if (typeof body.role === "string" && body.role.trim()) {
      const roleSlug = body.role.trim().toLowerCase();
      const roleDoc: any = await AdminRole.findOne({ slug: roleSlug }).lean();
      if (!roleDoc) {
        return NextResponse.json({ ok: false, error: `Role "${roleSlug}" not found.` }, { status: 400 });
      }
      await UserRole.deleteMany({ user_id: profile.id });
      await UserRole.create({ user_id: profile.id, role: roleDoc.slug });
      changes.push(`role=${roleDoc.name}`);
    }

    await recordAdminActivity({
      actor,
      action: "admin_user.update",
      entity_type: "admin_user",
      entity_id: profile.id,
      summary: `Updated admin "${profile.name}" (${changes.join(", ") || "details"})`,
      metadata: { email: profile.email, changes },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to update admin" }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireSuperAdminRequest(req);
    await connectToDatabase();

    const id = req.nextUrl.searchParams.get("id");
    if (!id || id === "master-admin") {
      return NextResponse.json(
        { ok: false, error: "Cannot delete the Master Super Admin." },
        { status: 400 }
      );
    }
    if (id === actor.userId) {
      return NextResponse.json(
        { ok: false, error: "You cannot delete your own active account." },
        { status: 400 }
      );
    }

    const profile: any = await Profile.findOne({ id }).lean();
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Admin user not found." }, { status: 404 });
    }

    await Promise.all([
      UserRole.deleteMany({ user_id: id }),
      Profile.deleteOne({ id }),
    ]);

    await recordAdminActivity({
      actor,
      action: "admin_user.delete",
      entity_type: "admin_user",
      entity_id: id,
      summary: `Removed admin "${profile.name}" (${profile.email})`,
      metadata: { name: profile.name, email: profile.email },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err instanceof AdminAuthError ? err.status : 500;
    return NextResponse.json({ ok: false, error: err?.message || "Failed to delete admin" }, { status });
  }
}
