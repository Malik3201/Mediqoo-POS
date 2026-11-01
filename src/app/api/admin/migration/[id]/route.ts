import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import MigrationJob from "@/models/MigrationJob";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { deleteR2Object } from "@/lib/r2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const { id } = await params;
    const job = await MigrationJob.findOne({ id }).lean();
    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
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

    // Clean up R2 objects if any
    if (job.source_object_key) {
      try {
        await deleteR2Object(job.source_object_key);
      } catch {}
    }
    if (job.output_backup?.object_key) {
      try {
        await deleteR2Object(job.output_backup.object_key);
      } catch {}
    }

    await MigrationJob.deleteOne({ id });

    return NextResponse.json({ success: true, message: "Migration job deleted." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
