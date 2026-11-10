import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import {
  callStorefrontManageApi,
  getStorefrontConfigStatus,
  type StorefrontManagementActor,
} from "@/lib/storefront/client";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  const cfg = getStorefrontConfigStatus();
  const checkedAt = new Date().toISOString();

  if (!cfg.configured || !cfg.workerBaseUrl) {
    return NextResponse.json({
      ok: true,
      worker_status: cfg.workerUrlConfigured ? "disconnected" : "not_configured",
      d1_status: "unavailable",
      r2_status: "unavailable",
      website_api_status: "error",
      active_websites: 0,
      total_websites: 0,
      worker_url: cfg.workerBaseUrl || null,
      last_checked: checkedAt,
      missing_env_vars: cfg.missingEnvVars,
      auth_agreed: false,
      setup_guidance: [
        "1. Authenticate Cloudflare CLI (`npx wrangler login`) and run `scripts/provision-cloudflare-staging.ps1` in `aivrasol-storefront` to deploy the Worker, D1 migrations (0001 + 0002), and R2 media bucket to `*.workers.dev`.",
        "2. Set `STOREFRONT_ADMIN_SECRET` and `STOREFRONT_SYNC_SECRET` on the Cloudflare Worker via `npx wrangler secret put <NAME> --env staging`.",
        "3. Add `STOREFRONT_WORKER_URL`, `STOREFRONT_ADMIN_SECRET`, and `STOREFRONT_SYNC_SECRET` with matching server-side values in Vercel Project Settings → Environment Variables (`mediqoo.vercel.app`), then redeploy.",
      ],
    });
  }

  const actor: StorefrontManagementActor = {
    actorType: "super_admin",
    actorId: auth.actor.id,
    actorEmail: auth.actor.email,
    scopedPharmacyId: null,
  };

  try {
    const res = await callStorefrontManageApi("/api/v1/manage/platform-status", {
      method: "GET",
      actor,
    });

    if (!res.ok) {
      const isAuthMismatch = res.status === 401 || res.status === 403;
      return NextResponse.json({
        ok: true,
        worker_status: isAuthMismatch ? "connected" : "disconnected",
        d1_status: "unavailable",
        r2_status: "unavailable",
        website_api_status: "error",
        active_websites: 0,
        total_websites: 0,
        worker_url: cfg.workerBaseUrl,
        last_checked: checkedAt,
        missing_env_vars: cfg.missingEnvVars,
        auth_agreed: !isAuthMismatch,
        error_detail: isAuthMismatch
          ? "Worker responded, but STOREFRONT_ADMIN_SECRET on Vercel does not match the Worker secret."
          : res.data?.message || `Worker returned HTTP ${res.status}`,
        setup_guidance: isAuthMismatch
          ? [
              "Ensure `STOREFRONT_ADMIN_SECRET` and `STOREFRONT_SYNC_SECRET` in Vercel Environment Variables match the secrets set via `wrangler secret put` on the Cloudflare Worker.",
            ]
          : [
              `Verify the Cloudflare Worker is deployed and reachable at ${cfg.workerBaseUrl}/api/v1/health.`,
            ],
      });
    }

    const d = res.data || {};
    return NextResponse.json({
      ok: true,
      worker_status: "connected",
      d1_status: d.d1?.status === "available" ? "available" : "unavailable",
      r2_status: d.r2?.status === "available" ? "available" : "unavailable",
      website_api_status: d.website_api?.status === "working" ? "working" : "error",
      active_websites: Number(d.active_websites || 0),
      total_websites: Number(d.total_websites || 0),
      worker_url: cfg.workerBaseUrl,
      last_checked: d.checked_at || checkedAt,
      missing_env_vars: cfg.missingEnvVars,
      auth_agreed: true,
      setup_guidance: [],
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: true,
      worker_status: "disconnected",
      d1_status: "unavailable",
      r2_status: "unavailable",
      website_api_status: "error",
      active_websites: 0,
      total_websites: 0,
      worker_url: cfg.workerBaseUrl,
      last_checked: checkedAt,
      missing_env_vars: cfg.missingEnvVars,
      auth_agreed: false,
      error_detail: err?.message || "Failed to reach Cloudflare Worker endpoint.",
      setup_guidance: [
        `Could not connect to ${cfg.workerBaseUrl}. Confirm the Cloudflare Worker is deployed and STOREFRONT_WORKER_URL points to its HTTPS workers.dev address.`,
      ],
    });
  }
}

