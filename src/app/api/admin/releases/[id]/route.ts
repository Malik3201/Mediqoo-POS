import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import Release from "@/models/Release";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import { checkR2Object, deleteR2Object, extractR2KeyFromUrl } from "@/lib/r2";
import { verifyStoredManifestWithServerKey } from "@/lib/release-signing";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();
    const { id } = await params;
    const body = await req.json();

    const release = (await Release.findOne({ id }).lean()) as any;
    if (!release) {
      return NextResponse.json({ error: "Release not found." }, { status: 404 });
    }

    const patch: Record<string, any> = {};
    if (body.status === "draft" || body.status === "published" || body.status === "archived") {
      patch.status = body.status;
      if (body.status === "published" && !release.published_at) {
        patch.published_at = new Date();
      }
    }
    if (typeof body.disabled === "boolean") {
      patch.disabled = body.disabled;
    }
    if (typeof body.protected === "boolean") {
      patch.protected = body.protected;
    }
    if (typeof body.changelog === "string") {
      patch.changelog = body.changelog;
    }
    if (body.rolloutType === "all" || body.rolloutType === "specific") {
      patch.rollout_type = body.rolloutType;
      patch.target_client_ids =
        body.rolloutType === "specific" && Array.isArray(body.targetClientIds)
          ? body.targetClientIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
          : [];
    }

    const nextStatus = patch.status ?? release.status;
    const nextDisabled = patch.disabled ?? Boolean(release.disabled);

    if (release.app_type === "android-pos" && nextStatus === "published" && !nextDisabled) {
      if (release.signature_status !== "signed") {
        return NextResponse.json(
          { error: "Cannot publish an unsigned Android release." },
          { status: 400 }
        );
      }
      const sigCheck = await verifyStoredManifestWithServerKey(release.manifest_json);
      if (!sigCheck.ok) {
        return NextResponse.json({ error: sigCheck.error }, { status: 400 });
      }
      const key = release.object_key || extractR2KeyFromUrl(release.storage_path);
      if (key) {
        const obj = await checkR2Object(key);
        if (!obj) {
          return NextResponse.json(
            { error: "Cannot publish: R2 release artifact does not exist." },
            { status: 400 }
          );
        }
      }
    }

    const updated = await Release.findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean();

    await AuditLog.create({
      action: "release_updated",
      entity_type: "release",
      entity_id: id,
      actor_id: actor.userId,
      metadata: { patch, app_type: release.app_type, version: release.version },
    }).catch(() => {});

    return NextResponse.json({ release: updated });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/releases/[id] error:", err);
    return NextResponse.json({ error: err?.message || "Update failed." }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAdminRequest(req);
    await connectToDatabase();
    const { id } = await params;

    const release = (await Release.findOne({ id }).lean()) as any;
    if (!release) {
      return NextResponse.json({ error: "Release not found." }, { status: 404 });
    }

    const key =
      release.object_key ||
      extractR2KeyFromUrl(release.storage_path) ||
      extractR2KeyFromUrl(release.bundle_url) ||
      extractR2KeyFromUrl(release.asar_url) ||
      extractR2KeyFromUrl(release.full_package_url);

    if (key && key.startsWith("releases/")) {
      const shared = await Release.countDocuments({
        id: { $ne: id },
        $or: [{ object_key: key }, { storage_path: key }, { storage_path: release.storage_path }],
      });
      if (shared === 0) {
        await deleteR2Object(key).catch((e) => {
          console.error("Failed R2 object delete during release removal:", e);
        });
      }
    }

    await Release.findOneAndDelete({ id });

    await AuditLog.create({
      action: "release_deleted",
      entity_type: "release",
      entity_id: id,
      actor_id: actor.userId,
      metadata: { app_type: release.app_type, version: release.version, objectKey: key },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("DELETE /api/admin/releases/[id] error:", err);
    return NextResponse.json({ error: err?.message || "Delete failed." }, { status: 500 });
  }
}

