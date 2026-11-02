import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import MigrationJob from "@/models/MigrationJob";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { serverMigrationEngine } from "@/lib/migration/server-migration-engine";

/** Manually delete the generated encrypted package (metadata and report are kept). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;
  try {
    await connectToDatabase();
    const { id } = await params;
    const job = await MigrationJob.findOne({ id });
    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 });
    }

    const confirm = req.nextUrl.searchParams.get("confirm") === "true";
    const sourceAlreadyDeleted = job.source_cleanup?.status === "deleted";
    if (sourceAlreadyDeleted && !confirm && !job.output_backup?.restore_confirmed_at) {
      return NextResponse.json(
        {
          error:
            "WARNING_LAST_RECOVERABLE_PACKAGE: The original uploaded .BAK source has already been deleted. Confirm deletion if POS restore has already been completed.",
          requiresConfirmation: true,
          sourceDeleted: true,
        },
        { status: 409 }
      );
    }

    const updated = await serverMigrationEngine.deleteOutputPackage(id, auth.actor.email);
    return NextResponse.json({ success: true, job: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

/** Extend converted package retention, toggle protection, or record restore confirmation. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;
  try {
    await connectToDatabase();
    const { id } = await params;
    const body = await req.json();
    const job = await MigrationJob.findOne({ id });
    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 });
    }

    if (typeof body.extend_days === "number" && body.extend_days > 0 && job.output_backup) {
      const days = Math.min(90, Math.max(1, Math.floor(body.extend_days)));
      const baseMs = Math.max(
        Date.now(),
        job.output_backup.expires_at ? new Date(job.output_backup.expires_at).getTime() : Date.now()
      );
      job.output_backup.expires_at = new Date(baseMs + days * 86400_000);
      job.markModified("output_backup");
      job.audit_events.push({
        timestamp: new Date(),
        actor: auth.actor.email,
        action: "OUTPUT_RETENTION_EXTENDED",
        details: `Extended converted package expiry by ${days} day(s) until ${job.output_backup.expires_at.toISOString().slice(0, 10)}`,
      });
    }

    if (typeof body.protect_output === "boolean" && job.output_backup) {
      job.output_backup.protected = body.protect_output;
      job.markModified("output_backup");
      job.audit_events.push({
        timestamp: new Date(),
        actor: auth.actor.email,
        action: body.protect_output ? "OUTPUT_PROTECTED" : "OUTPUT_UNPROTECTED",
        details: `Converted package protection set to ${body.protect_output}`,
      });
    }

    if (typeof body.protect_source === "boolean") {
      job.source_cleanup = {
        ...(job.source_cleanup || { status: "retained" }),
        protected: body.protect_source,
      } as any;
      job.markModified("source_cleanup");
      job.audit_events.push({
        timestamp: new Date(),
        actor: auth.actor.email,
        action: body.protect_source ? "SOURCE_PROTECTED" : "SOURCE_UNPROTECTED",
        details: `Source upload protection set to ${body.protect_source}`,
      });
    }

    if (body.restore_confirmed === true && job.output_backup) {
      job.output_backup.restore_confirmed_at = new Date();
      job.markModified("output_backup");
      job.audit_events.push({
        timestamp: new Date(),
        actor: auth.actor.email,
        action: "RESTORE_CONFIRMED",
        details: "Super Admin confirmed POS restore completed; package eligible for cleanup",
      });
    }

    await job.save();
    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
