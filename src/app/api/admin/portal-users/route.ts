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
 * GET /api/admin/portal-users?client_id=X
 *
 * List all portal users for a specific client.
 * Admin auth required.
 * password_hash is NEVER returned.
 */
export async function GET(req: NextRequest) {
  const adminToken = await requireAdmin(req);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  await connectToDatabase();
  const users = await PortalUser.find({ client_id: clientId })
    .select("+password_plain")
    .sort({ created_at: -1 })
    .lean();

  return NextResponse.json(users);
}

/**
 * POST /api/admin/portal-users
 *
 * Creates a new portal user and sends an invite email.
 *
 * Body: { client_id, name, email, role }
 *
 * Flow:
 *   1. Verify admin session
 *   2. Validate client exists
 *   3. Create PortalUser (status: "invited", no password_hash yet)
 *   4. Generate cryptographically secure invite token
 *   5. Hash token → store in PortalInvite (raw token NEVER stored)
 *   6. Invalidate any previous unused invites for this user
 *   7. Send invite email with raw token in URL
 *   8. Return portal user (no password_hash, no raw token)
 */
export async function POST(req: NextRequest) {
  const adminToken = await requireAdmin(req);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { client_id, name, email, role } = body;

  if (!client_id || !name || !email || !role) {
    return NextResponse.json(
      { error: "client_id, name, email, and role are required." },
      { status: 400 }
    );
  }

  if (!["owner", "manager", "viewer"].includes(role)) {
    return NextResponse.json(
      { error: "role must be one of: owner, manager, viewer" },
      { status: 400 }
    );
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  await connectToDatabase();

  // Validate client exists
  const client = await Client.findOne({ id: client_id }).lean<{ name: string }>();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Check email uniqueness
  const existing = await PortalUser.findOne({ email: normalizedEmail });
  if (existing) {
    return NextResponse.json(
      { error: "A portal user with this email already exists." },
      { status: 409 }
    );
  }

  // Create the portal user
  const userId = crypto.randomUUID();
  await PortalUser.create({
    id: userId,
    client_id,
    name: String(name).trim(),
    email: normalizedEmail,
    role,
    status: "invited",
    created_by: String(adminToken.id ?? adminToken.email ?? "admin"),
  });

  // Generate + store invite
  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Invalidate all previous unused invites for this user
  await PortalInvite.deleteMany({
    portal_user_id: userId,
    used_at: { $exists: false },
  });

  await PortalInvite.create({
    token_hash: hash,
    portal_user_id: userId,
    expires_at: expiresAt,
  });

  // Send invite email
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "https://mediqoo.vercel.app";
  const inviteUrl = `${baseUrl}/portal/accept-invite?token=${raw}`;

  try {
    await sendPortalInvite(
      String(name).trim(),
      normalizedEmail,
      client.name,
      inviteUrl,
      INVITE_EXPIRY_DAYS
    );
  } catch (emailErr) {
    console.error("Failed to send portal invite email:", emailErr);
    // Don't fail the whole request — admin can resend later
  }

  const created = await PortalUser.findOne({ id: userId }).lean();
  return NextResponse.json(created, { status: 201 });
}
