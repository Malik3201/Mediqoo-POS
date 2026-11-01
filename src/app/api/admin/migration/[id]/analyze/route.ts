import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { serverMigrationEngine } from "@/lib/migration/server-migration-engine";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    const { id } = await params;
    const updatedJob = await serverMigrationEngine.analyzeJob(id, auth.actor.email);
    return NextResponse.json({ success: true, job: updatedJob });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
