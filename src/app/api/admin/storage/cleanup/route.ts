import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { runStorageCleanup, DEFAULT_SAFE_CLEANUP_POLICIES } from "@/lib/storage/cleanup-engine";
import { CleanupPolicyId } from "@/lib/storage/inventory";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const mode: "dry_run" | "execute" = body.mode === "execute" ? "execute" : "dry_run";
    const policies: CleanupPolicyId[] = Array.isArray(body.policies) && body.policies.length > 0
      ? body.policies
      : DEFAULT_SAFE_CLEANUP_POLICIES;
    const onlyKeys: string[] | undefined = Array.isArray(body.onlyKeys) ? body.onlyKeys : undefined;
    const reconcileDbMetadata: boolean = body.reconcileDbMetadata !== false;

    const result = await runStorageCleanup({
      mode,
      trigger: "manual",
      actor: auth.actor,
      policies,
      onlyKeys,
      reconcileDbMetadata,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    const status = String(err?.message || "").startsWith("CLEANUP_ALREADY_RUNNING") ? 409 : 500;
    return NextResponse.json({ error: err.message || "Storage cleanup failed" }, { status });
  }
}

