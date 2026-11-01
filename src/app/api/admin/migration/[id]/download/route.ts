import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import MigrationJob from "@/models/MigrationJob";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { getPresignedDownloadUrl } from "@/lib/r2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const { id } = await params;
    const job = await MigrationJob.findOne({ id });
    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 });
    }

    if (job.status !== "completed" || !job.output_backup?.object_key) {
      return NextResponse.json(
        { error: "Migration package is not ready for download yet." },
        { status: 400 }
      );
    }

    const downloadUrl = await getPresignedDownloadUrl(
      job.output_backup.object_key,
      job.output_backup.filename,
      1800 // 30 minutes validity
    );

    return NextResponse.json({
      success: true,
      downloadUrl,
      filename: job.output_backup.filename,
      size_bytes: job.output_backup.size_bytes,
      checksum_sha256: job.output_backup.checksum_sha256,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
