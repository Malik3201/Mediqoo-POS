import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";

export interface AdminSessionActor {
  userId: string;
  email: string;
  role: "super_admin" | "admin";
}

export async function requireAdminRequest(req: NextRequest): Promise<AdminSessionActor> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const session = await getServerSession();
  const userEmail = String(token?.email || session?.user?.email || "").trim().toLowerCase();

  if (!userEmail) {
    throw new AdminAuthError("Unauthorized", 401);
  }

  await connectToDatabase();

  const masterEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (masterEmail && userEmail === masterEmail) {
    return {
      userId: "master-admin",
      email: userEmail,
      role: "super_admin",
    };
  }

  const profile = (await Profile.findOne({ email: userEmail }).lean()) as any;
  if (!profile) {
    throw new AdminAuthError("Forbidden: admin profile not found", 403);
  }

  const candidateIds = [profile._id, profile.id, token?.sub].filter(Boolean);
  const roles = await UserRole.find({ user_id: { $in: candidateIds } }).lean();
  const isSuper = roles.some((r: any) => r.role === "super_admin");
  const isAdmin = isSuper || roles.some((r: any) => r.role === "admin");

  if (!isAdmin) {
    throw new AdminAuthError("Forbidden: admin role required", 403);
  }

  return {
    userId: String(profile.id || profile._id),
    email: userEmail,
    role: isSuper ? "super_admin" : "admin",
  };
}

export class AdminAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

