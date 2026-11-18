import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import PortalUser from "@/models/PortalUser";
import { requirePortalSession, PortalAuthError, portalAuthErrorResponse } from "@/lib/portal-auth";

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

export async function POST(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    const body = await req.json().catch(() => null);

    const { current_password, new_password } = body ?? {};

    if (!current_password || !new_password) {
      return NextResponse.json(
        { error: "missing_fields", message: "Both current password and new password are required." },
        { status: 400 }
      );
    }

    const pwError = validatePassword(new_password);
    if (pwError) {
      return NextResponse.json(
        { error: "weak_password", message: pwError },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const user = await PortalUser.findOne({ id: session.id || (session as any).user_id });
    if (!user) {
      return NextResponse.json(
        { error: "user_not_found", message: "User account not found." },
        { status: 404 }
      );
    }

    // Verify current password
    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return NextResponse.json(
        { error: "invalid_current_password", message: "The current password you entered is incorrect." },
        { status: 400 }
      );
    }

    // Hash and update new password
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(new_password, salt);

    user.password_hash = newHash;
    user.updated_at = new Date();
    await user.save();

    return NextResponse.json({
      ok: true,
      message: "Password changed successfully. Your account is secured.",
    });
  } catch (err) {
    if (err instanceof PortalAuthError) {
      return portalAuthErrorResponse(err);
    }
    console.error("Change password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
