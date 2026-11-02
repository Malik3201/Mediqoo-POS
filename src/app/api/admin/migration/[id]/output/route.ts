import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { serverMigrationEngine } from "@/lib/migration/server-migration-engine";

/** Manually delete the generated encrypted package (metadata and report are kept). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;
  try {
    const { id } = await params;
    const job = await serverMigrationEngine.deleteOutputPackage(id, auth.actor.email);
    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

