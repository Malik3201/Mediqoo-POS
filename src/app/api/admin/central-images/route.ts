import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import {
  callStorefrontManageApi,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "overview";

  if (view === "overview") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/overview", {
      actor,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (view === "medicines") {
    const qs = url.searchParams.toString();
    const res = await callStorefrontManageApi(`/api/v1/manage/central-library/medicines?${qs}`, {
      actor,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (view === "submissions") {
    const status = url.searchParams.get("status") || "pending";
    const res = await callStorefrontManageApi(
      `/api/v1/manage/central-library/submissions?status=${encodeURIComponent(status)}`,
      { actor }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  return NextResponse.json({ ok: false, error: "unknown_view" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "upsert_medicine") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/medicines", {
      method: "POST",
      actor,
      body: body.medicine || body,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "upload_shared_image") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/upload", {
      method: "POST",
      actor,
      body: body.payload || body,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "approve_submission") {
    const subId = body.submission_id;
    if (!subId) {
      return NextResponse.json({ ok: false, error: "missing_submission_id" }, { status: 400 });
    }
    const res = await callStorefrontManageApi(
      `/api/v1/manage/central-library/submissions/${encodeURIComponent(subId)}/approve`,
      {
        method: "POST",
        actor,
        body: { target_canonical_id: body.target_canonical_id },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "reject_submission") {
    const subId = body.submission_id;
    if (!subId) {
      return NextResponse.json({ ok: false, error: "missing_submission_id" }, { status: 400 });
    }
    const res = await callStorefrontManageApi(
      `/api/v1/manage/central-library/submissions/${encodeURIComponent(subId)}/reject`,
      {
        method: "POST",
        actor,
        body: { reason: body.reason },
      }
    );
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "batch_match") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/batch-match", {
      method: "POST",
      actor,
      body: {
        batch_size: body.batch_size,
        offset: body.offset,
        storefront_id: body.storefront_id,
      },
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

