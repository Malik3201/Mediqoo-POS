import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import PortalUser from "@/models/PortalUser";
import PortalInvite from "@/models/PortalInvite";
import Client from "@/models/Client";
import { sendPortalInvite } from "@/lib/email";

const INVITE_EXPIRY_DAYS = 7;

function requireAdmin(req: NextRequest) {
  return getToken({ req, secret: process.env.NEXTAUTH_SECRET });
}

function generateInviteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/**
 * PATCH /api/admin/portal-users/[id]
 *
 * Update role or status of a portal user.
 * Body: { role?, status? }
 * - role: "owner" | "manager" | "viewer"
 * - status: "active" | "disabled"
 *
 * Note: Takes effect immediately on next portal API call (DB revalidation).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminToken = await requireAdmin(req);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, string> = {};
  if (body.role !== undefined) {
    if (!["owner", "manager", "viewer"].includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    update.role = body.role;
  }
  if (body.status !== undefined) {
    if (!["active", "disabled"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status. Use 'active' or 'disabled'" }, { status: 400 });
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await connectToDatabase();
  const user = await PortalUser.findOneAndUpdate(
    { id },
    { $set: update },
    { new: true }
  );

  if (!user) {
    return NextResponse.json({ error: "Portal user not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

/**
 * DELETE /api/admin/portal-users/[id]
 *
 * Hard-deletes a portal user.
 * Also invalidates all their unused invites.
 * OLD JWTs become invalid because requirePortalSession() revalidates from DB (user not found → 401).
 *
 * Prefer PATCH {status: "disabled"} for reversible deactivation.
 * Use DELETE only when the user record should be permanently removed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminToken = await requireAdmin(req);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  await connectToDatabase();

  const user = await PortalUser.findOne({ id });
  if (!user) {
    return NextResponse.json({ error: "Portal user not found" }, { status: 404 });
  }

  // Invalidate all invites (any remaining JWTs become invalid at next DB check)
  await PortalInvite.deleteMany({ portal_user_id: id });

  await PortalUser.deleteOne({ id });

  return NextResponse.json({ ok: true, deleted: id });
}
