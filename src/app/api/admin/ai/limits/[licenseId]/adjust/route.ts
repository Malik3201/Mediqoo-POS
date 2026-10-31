import { NextResponse } from "next/server";
import License from "@/models/License";
import AiPharmacyEntitlement from "@/models/AiPharmacyEntitlement";
import { adminHandler, serializeEntitlement } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { getOrCreateEntitlement, periodKeys } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

/** Manual usage reset / promo quota — always requires an audited reason. */
export const POST = adminHandler<{ licenseId: string }>(async (req, actor, { licenseId }) => {
  const license: any = await License.findOne({ id: licenseId }).select("id client_id").lean();
  if (!license) return NextResponse.json({ error: "License not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 5) return NextResponse.json({ error: "A reason of at least 5 characters is required for audit." }, { status: 400 });

  const ent: any = await getOrCreateEntitlement(license.id, license.client_id);
  const keys = periodKeys(ent.timezone);
  let set: Record<string, any> = {};
  let detail: Record<string, any> = {};

  if (body.action === "reset_daily") {
    detail = { before: { requests: ent.daily_requests_used, tokens: ent.daily_tokens_used } };
    set = { daily_requests_used: 0, daily_tokens_used: 0, day_key: keys.day, last_reset_at: new Date() };
  } else if (body.action === "reset_monthly") {
    detail = { before: { requests: ent.monthly_requests_used, tokens: ent.monthly_tokens_used } };
    set = { monthly_requests_used: 0, monthly_tokens_used: 0, month_key: keys.month, last_reset_at: new Date() };
  } else if (body.action === "add_promo") {
    const pr = Math.max(0, Math.min(1_000_000, Math.round(Number(body.promo_requests) || 0)));
    const pt = Math.max(0, Math.min(1_000_000_000, Math.round(Number(body.promo_tokens) || 0)));
    if (pr === 0 && pt === 0) return NextResponse.json({ error: "Enter promo requests and/or tokens." }, { status: 400 });
    let exp: Date | null = null;
    if (body.promo_expires_at) {
      exp = new Date(body.promo_expires_at);
      if (isNaN(exp.getTime())) return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
    }
    set = { promo_extra_requests: pr, promo_extra_tokens: pt, promo_expires_at: exp };
    detail = { promo_requests: pr, promo_tokens: pt, promo_expires_at: exp };
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  set.last_adjustment_reason = reason.slice(0, 300);
  set.last_adjusted_by = actor.email;

  const updated: any = await AiPharmacyEntitlement.findOneAndUpdate({ license_id: licenseId }, { $set: set }, { new: true });
  await aiAudit(actor, `pharmacy_usage_${body.action}`, "license", licenseId, { reason, ...detail });
  return NextResponse.json({ entitlement: serializeEntitlement(updated) });
});

