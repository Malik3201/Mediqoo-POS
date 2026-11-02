"use server";

import { getServerSession } from "next-auth";
import { unlink } from "fs/promises";
import { join } from "path";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import UserRole from "@/models/UserRole";
import Profile from "@/models/Profile";
import Release from "@/models/Release";
import { deleteR2Object, extractR2KeyFromUrl } from "@/lib/r2";

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

  const r2Key = extractR2KeyFromUrl(storagePath);
  if (r2Key && r2Key.startsWith("releases/")) {
    try {
      // Ensure no other remaining release record references the exact same object key
      const sharedCount = await Release.countDocuments({
        $or: [
          { storage_path: storagePath },
          { asar_url: storagePath },
          { full_package_url: storagePath },
          { storage_path: { $regex: r2Key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$" } },
        ],
      });
      if (sharedCount <= 1) {
        await deleteR2Object(r2Key);
        await AuditLog.create({
          action: "release_r2_file_deleted",
          entity_type: "release",
          entity_id: r2Key,
          actor_id: String(userId),
          metadata: { storage_path: storagePath, object_key: r2Key, actor_email: userEmail },
        }).catch(() => {});
      }
      return;
    } catch (error) {
      console.error("Failed to delete release file from R2:", error);
      return;
    }
  }

  try {
    if (!storagePath.startsWith("http")) {
      const fullPath = join(process.cwd(), "public", storagePath);
      await unlink(fullPath);
    }
  } catch (error) {
    console.error("Failed to delete release file from disk:", error);
  }
}
