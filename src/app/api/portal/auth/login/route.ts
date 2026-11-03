import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import PortalUser from "@/models/PortalUser";
import { signPortalToken, setPortalCookie } from "@/lib/portal-auth";

const CORS = { "Access-Control-Allow-Credentials": "true" };

/**
 * POST /api/portal/auth/login
 *
 * Authenticates a portal user by email + password.
 *
 * Security:
 * - Always returns generic "Invalid email or password." error regardless of failure reason.
 *   This prevents account enumeration (attacker cannot tell if email exists).
 * - Rate limiting: tracks login_attempts per user. After 5 consecutive failures:
 *   15-minute lockout (locked_until). Lockout is per-user, not per-IP.
 * - Successful login resets login_attempts to 0.
 * - Status check: "active" only. "invited" (password not set) and "disabled" return same generic error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const email = String(body.email).toLowerCase().trim();
    const password = String(body.password);

    await connectToDatabase();

    // Load user with password_hash (excluded by default projection)
    const user = await PortalUser.findOne({ email })
      .select("+password_hash +login_attempts +locked_until");

    // ALWAYS do a bcrypt work even if user not found — prevents timing attacks
    const dummyHash = "$2b$10$dummyhashforpreventtimingattacksonnotfound";

    if (!user || user.status !== "active") {
      // Still run bcrypt to normalize response time
      await bcrypt.compare(password, dummyHash).catch(() => null);
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Check lockout
    if (user.locked_until && user.locked_until > new Date()) {
      await bcrypt.compare(password, dummyHash).catch(() => null);
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash ?? "");

    if (!passwordMatch) {
      // Increment attempt counter; lockout after 5 failures
      const attempts = (user.login_attempts ?? 0) + 1;
      const update: any = { login_attempts: attempts };
      if (attempts >= 5) {
        update.locked_until = new Date(Date.now() + 15 * 60 * 1000); // 15 min
      }
      await PortalUser.updateOne({ id: user.id }, { $set: update });
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Success — reset rate limiting, update last_login_at, and ensure password_plain is synced for admin view
    await PortalUser.updateOne(
      { id: user.id },
      {
        $set: { last_login_at: new Date(), login_attempts: 0, password_plain: password },
        $unset: { locked_until: "" },
      }
    );

    const token = await signPortalToken(user);

    const responseBody = {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        client_id: user.client_id,
      },
    };

    const res = NextResponse.json(responseBody, { headers: CORS });
    return setPortalCookie(res, token);
  } catch (e: any) {
    console.error("Portal login error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
