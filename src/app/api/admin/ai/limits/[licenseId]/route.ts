import { NextResponse } from "next/server";
import License from "@/models/License";
import AiPharmacyEntitlement from "@/models/AiPharmacyEntitlement";
import { adminHandler, serializeEntitlement } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { cleanEntitlementPatch } from "@/lib/ai/limits-admin";
import { getOrCreateEntitlement } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

export const PUT = adminHandler<{ licenseId: string }>(async (req, actor, { licenseId }) => {
  const license: any = await License.findOne({ id: licenseId }).select("id client_id").lean();
  if (!license) return NextResponse.json({ error: "License not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const { patch, error } = cleanEntitlementPatch(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No valid changes." }, { status: 400 });

  const before: any = await getOrCreateEntitlement(license.id, license.client_id);
  const beforeView = serializeEntitlement(before);
  const updated: any = await AiPharmacyEntitlement.findOneAndUpdate({ license_id: licenseId }, { $set: patch }, { new: true });
  const changed: Record<string, { from: any; to: any }> = {};
  for (const k of Object.keys(patch)) changed[k] = { from: (beforeView as any)[k], to: patch[k] };
  await aiAudit(actor, "pharmacy_limits_updated", "license", licenseId, { changed });
  return NextResponse.json({ entitlement: serializeEntitlement(updated) });
});

