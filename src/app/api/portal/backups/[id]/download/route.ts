import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import CloudBackup from "@/models/CloudBackup";
import PortalUser from "@/models/PortalUser";
import License from "@/models/License";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token || !token.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await connectToDatabase();

    const user = await PortalUser.findOne({ email: token.email }).lean();
    if (!user || !user.client_id) {
      return NextResponse.json({ error: "Client identity not found" }, { status: 403 });
    }

    const backup = await CloudBackup.findOne({ id, client_id: user.client_id, status: "uploaded" }).lean();
    if (!backup) {
      return NextResponse.json({ error: "Backup not found or unavailable" }, { status: 404 });
    }

    // Resolve project name for safe filename
    const license = await License.findOne({ id: backup.license_id }).lean();
    const Project = require("@/models/Project").default;
    const project = license ? await Project.findOne({ id: license.project_id }).lean() : null;
    
    const projectName = project ? String((project as any).name).replace(/[^a-zA-Z0-9_-]/g, "") : "Location";
    const dateStr = backup.created_at.toISOString().split("T")[0];
    const safeFilename = `AivraSol_Backup_${projectName}_${dateStr}_${backup.backup_type}.aivrabak`;

    const s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: backup.object_key,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`
    });

    // 15 Minutes TTL
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return NextResponse.json({
      ok: true,
      download_url: downloadUrl
    });

  } catch (error: any) {
    console.error("Portal Backup download error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
