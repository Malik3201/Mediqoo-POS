import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import UserRole from "@/models/UserRole";

export interface AiAdminActor {
  id: string;
  email: string;
}

/**
 * Backend enforcement for every AI Management endpoint.
 * - Requires a valid NextAuth session JWT (same mechanism as the rest of the admin portal).
 * - Requires the "master-admin" account OR a user holding the `super_admin` role.
 *   (AI credential management is more sensitive than ordinary portal data, so plain
 *   `admin` / `operator` roles are NOT sufficient.)
 */
export async function requireSuperAdmin(
  req: NextRequest
): Promise<{ actor: AiAdminActor } | { error: NextResponse }> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const id = String((token as any).id || token.sub || "");
  const email = String(token.email || "");

  if (id === "master-admin") {
    return { actor: { id, email: email || "master-admin" } };
  }

  try {
    await connectToDatabase();
    const role = await UserRole.findOne({ user_id: id, role: "super_admin" }).lean();
    if (role) return { actor: { id, email } };
  } catch {
    /* fall through to forbidden */
  }
  return {
    error: NextResponse.json(
      { error: "Forbidden: AI Management requires the Super Admin role." },
      { status: 403 }
    ),
  };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

