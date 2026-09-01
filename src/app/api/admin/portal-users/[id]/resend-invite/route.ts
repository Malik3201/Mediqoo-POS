import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import PortalUser from "@/models/PortalUser";
import PortalInvite from "@/models/PortalInvite";
import Client from "@/models/Client";
import { sendPortalInvite } from "@/lib/email";

const INVITE_EXPIRY_DAYS = 7;

function generateInviteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/**
 * POST /api/admin/portal-users/[id]/resend-invite
 *
 * Generates a new invite token for a portal user and resends the email.
 * Invalidates all previous unused invites (per correction #11).
 *
 * Can only resend for users in "invited" status.
 * To re-invite a disabled user, first re-enable them via PATCH status=active.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  await connectToDatabase();

  const user = await PortalUser.findOne({ id });
  if (!user) {
    return NextResponse.json({ error: "Portal user not found" }, { status: 404 });
  }

  if (user.status === "disabled") {
    return NextResponse.json(
      { error: "Cannot resend invite to a disabled account. Enable the account first." },
      { status: 400 }
    );
  }

  // Load client for email
  const client = await Client.findOne({ id: user.client_id }).lean<{ name: string }>();
  if (!client) {
    return NextResponse.json({ error: "Associated client not found" }, { status: 404 });
  }

  // Invalidate ALL previous unused invites for this user
  await PortalInvite.deleteMany({
    portal_user_id: id,
    used_at: { $exists: false },
  });

  // Generate fresh invite
  const { raw, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await PortalInvite.create({
    token_hash: hash,
    portal_user_id: id,
    expires_at: expiresAt,
  });

  // If user was active (re-invite scenario), reset to invited
  if (user.status === "active" && !user.password_hash) {
    await PortalUser.updateOne({ id }, { $set: { status: "invited" } });
  }

  // Send invite email
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "https://mediqoo.vercel.app";
  const inviteUrl = `${baseUrl}/portal/accept-invite?token=${raw}`;

  await sendPortalInvite(
    user.name,
    user.email,
    client.name,
    inviteUrl,
    INVITE_EXPIRY_DAYS
  );

  return NextResponse.json({ ok: true, message: "Invite resent successfully." });
}
