import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import {
  callStorefrontManageApi,
  getStorefrontWorkerBaseUrl,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

function qualifyMediaUrl(url: string | null | undefined, workerBase: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${workerBase}${url}`;
  return url;
}

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
    const workerBase = getStorefrontWorkerBaseUrl();
    if (res.data && typeof res.data === "object" && Array.isArray((res.data as any).medicines)) {
      const fixed = (res.data as any).medicines.map((m: any) => ({
        ...m,
        preferred_image_url: qualifyMediaUrl(m.preferred_image_url, workerBase),
      }));
      return NextResponse.json({ ...res.data, medicines: fixed }, { status: res.status });
    }
    return NextResponse.json(res.data, { status: res.status });
  }

  if (view === "submissions") {
    const status = url.searchParams.get("status") || "pending";
    const res = await callStorefrontManageApi(
      `/api/v1/manage/central-library/submissions?status=${encodeURIComponent(status)}`,
      { actor }
    );
    const workerBase = getStorefrontWorkerBaseUrl();
    if (res.data && typeof res.data === "object" && Array.isArray((res.data as any).submissions)) {
      const fixed = (res.data as any).submissions.map((s: any) => ({
        ...s,
        media_url: qualifyMediaUrl(s.media_url, workerBase),
      }));
      return NextResponse.json({ ...res.data, submissions: fixed }, { status: res.status });
    }
    return NextResponse.json(res.data, { status: res.status });
  }

  if (view === "discovery_overview") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/overview", {
      actor,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (view === "discovery_queue") {
    const qs = url.searchParams.toString();
    const res = await callStorefrontManageApi(`/api/v1/manage/central-library/discovery/queue?${qs}`, {
      actor,
    });
    const workerBase = getStorefrontWorkerBaseUrl();
    if (res.data && typeof res.data === "object" && Array.isArray((res.data as any).items)) {
      const fixed = (res.data as any).items.map((it: any) => ({
        ...it,
        approved_image_url: qualifyMediaUrl(it.approved_image_url, workerBase),
        candidate_results: (it.candidate_results || []).map((cand: any) => ({
          ...cand,
          image_url: qualifyMediaUrl(cand.image_url, workerBase),
        })),
      }));
      return NextResponse.json({ ...res.data, items: fixed }, { status: res.status });
    }
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
    const workerBase = getStorefrontWorkerBaseUrl();
    if (res.data && typeof res.data === "object" && (res.data as any).public_url) {
      return NextResponse.json(
        {
          ...res.data,
          public_url: qualifyMediaUrl((res.data as any).public_url, workerBase),
        },
        { status: res.status }
      );
    }
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

  if (action === "discovery_import") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/import", {
      method: "POST",
      actor,
      body: { items: body.items || [] },
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "discovery_settings") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/settings", {
      method: "POST",
      actor,
      body: body.settings || body,
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "discovery_retry_failed") {
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/retry-failed", {
      method: "POST",
      actor,
      body: {},
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "discovery_approve_candidate") {
    const queueId = body.queue_id;
    if (!queueId) {
      return NextResponse.json({ ok: false, error: "missing_queue_id" }, { status: 400 });
    }
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/approve-candidate", {
      method: "POST",
      actor,
      body: { queue_id: queueId, candidate: body.candidate || body },
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  if (action === "discovery_reject_candidate") {
    const queueId = body.queue_id;
    if (!queueId) {
      return NextResponse.json({ ok: false, error: "missing_queue_id" }, { status: 400 });
    }
    const res = await callStorefrontManageApi("/api/v1/manage/central-library/discovery/reject-candidate", {
      method: "POST",
      actor,
      body: { queue_id: queueId, reason: body.reason },
    });
    return NextResponse.json(res.data, { status: res.status });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

