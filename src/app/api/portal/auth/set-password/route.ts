import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import PortalUser from "@/models/PortalUser";
import PortalInvite from "@/models/PortalInvite";
import { signPortalToken, setPortalCookie } from "@/lib/portal-auth";

const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must contain at least one letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null;
}

/**
 * POST /api/portal/auth/set-password
 *
 * Accepts a one-time invite token and a new password.
 * Activates the portal user account.
 *
 * Body: { token: string, password: string }
 *
 * Flow:
 *   1. Receive raw token from URL/body
 *   2. SHA-256 hash it → look up in PortalInvite by token_hash
 *   3. Validate: exists, not expired, not used
 *   4. Validate password policy
 *   5. bcrypt hash the password
 *   6. Update PortalUser: password_hash, status → "active"
 *   7. Mark invite: used_at = now
 *   8. Auto-login: sign JWT, set cookie
 *   9. Redirect to portal dashboard
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.token || !body?.password) {
      return NextResponse.json(
        { error: "missing_fields", message: "Token and password are required." },
        { status: 400 }
      );
    }

    // Validate password policy before DB operations
    const pwError = validatePassword(body.password);
    if (pwError) {
      return NextResponse.json(
        { error: "weak_password", message: pwError },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Hash the raw token to look up in DB (raw token is never stored)
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(body.token))
      .digest("hex");

    const invite = await PortalInvite.findOne({ token_hash: tokenHash });

    if (!invite) {
      return NextResponse.json(
        { error: "invalid_token", message: "This invitation link is invalid." },
        { status: 400 }
      );
    }

    if (invite.used_at) {
      return NextResponse.json(
        { error: "token_used", message: "This invitation link has already been used." },
        { status: 400 }
      );
    }

    if (invite.expires_at < new Date()) {
      return NextResponse.json(
        { error: "token_expired", message: "This invitation link has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Load the portal user
    const user = await PortalUser.findOne({ id: invite.portal_user_id });
    if (!user) {
      return NextResponse.json(
        { error: "user_not_found", message: "Associated account not found." },
        { status: 400 }
      );
    }

    // Hash password and activate account
    const passwordHash = await bcrypt.hash(body.password, 12);

    await PortalUser.updateOne(
      { id: user.id },
      {
        $set: {
          password_hash: passwordHash,
          password_plain: String(body.password),
          status: "active",
          last_login_at: new Date(),
          login_attempts: 0,
        },
        $unset: { locked_until: "" },
      }
    );

    // Mark invite as used (one-time enforcement)
    await PortalInvite.updateOne(
      { id: invite.id },
      { $set: { used_at: new Date() } }
    );

    // Auto-login: sign JWT and set cookie
    const freshUser = await PortalUser.findOne({ id: user.id });
    const token = await signPortalToken(freshUser!);

    const res = NextResponse.json({
      ok: true,
      user: {
        id: freshUser!.id,
        name: freshUser!.name,
        email: freshUser!.email,
        role: freshUser!.role,
        client_id: freshUser!.client_id,
      },
    });

    return setPortalCookie(res, token);
  } catch (e: any) {
    console.error("Set-password error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
