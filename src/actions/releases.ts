"use server";

import { getServerSession } from "next-auth";
import { unlink } from "fs/promises";
import { join } from "path";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import UserRole from "@/models/UserRole";
import Profile from "@/models/Profile";
import Release from "@/models/Release";

export async function deleteReleaseFile(storagePath: string) {
  const session = await getServerSession();
  if (!session || !session.user || !session.user.email) throw new Error("Unauthorized");
  
  await connectToDatabase();
  const userEmail = session.user.email;
  
  let userId = "master-admin";
  let isAdmin = userEmail === process.env.ADMIN_EMAIL;
  
  if (!isAdmin) {
    const profile = await Profile.findOne({ email: userEmail }).lean();
    if (!profile) throw new Error("Profile not found");
    userId = (profile as any)._id;
    const roles = await UserRole.find({ user_id: userId }).lean();
    isAdmin = roles.some((r: any) => r.role === "admin" || r.role === "super_admin");
  }
  if (!isAdmin) throw new Error("Forbidden");

  try {
    const fullPath = join(process.cwd(), "public", storagePath);
    await unlink(fullPath);
  } catch (error) {
    console.error("Failed to delete release file from disk:", error);
  }
}
