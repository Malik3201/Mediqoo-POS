import { NextResponse } from "next/server";
import License from "@/models/License";
import Client from "@/models/Client";
import AiPharmacyEntitlement from "@/models/AiPharmacyEntitlement";
import { adminHandler, serializeEntitlement } from "@/lib/ai/admin-http";
import { deriveOperationalStatus } from "@/lib/status";
import { getAiSettings } from "@/lib/ai/settings";
import { defaultEntitlementView } from "@/lib/ai/limits-admin";
import { periodKeys } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const GET = adminHandler(async (req) => {
  const search = (req.nextUrl.searchParams.get("search") || "").trim().slice(0, 60);
  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50));
  const settings = await getAiSettings();

  let clientIds: string[] | null = null;
  const q: any = {};
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    const clients: any[] = await Client.find({ name: re }).select("id").limit(100).lean();
    clientIds = clients.map((c) => c.id);
    q.$or = [{ license_key: re }, ...(clientIds.length ? [{ client_id: { $in: clientIds } }] : [])];
  }
  const licenses: any[] = await License.find(q).sort({ created_at: -1 }).limit(limit).lean();
  const [clients, ents]: [any[], any[]] = await Promise.all([
    Client.find({ id: { $in: licenses.map((l) => l.client_id) } }).select("id name").lean() as any,
    AiPharmacyEntitlement.find({ license_id: { $in: licenses.map((l) => l.id) } }).lean() as any,
  ]);
  const clientMap = new Map(clients.map((c) => [c.id, c.name]));
  const entMap = new Map(ents.map((e) => [e.license_id, e]));

  const rows = licenses.map((l) => {
    const e = entMap.get(l.id);
    let view: any = e ? serializeEntitlement(e) : defaultEntitlementView(settings);
    if (e) {
      // Show counters for the CURRENT period even if no request has happened since rollover.
      const k = periodKeys(e.timezone);
      if (e.day_key !== k.day) view = { ...view, daily_requests_used: 0, daily_tokens_used: 0, day_key: k.day };
      if (e.month_key !== k.month) view = { ...view, monthly_requests_used: 0, monthly_tokens_used: 0, month_key: k.month };
    }
    const key: string = l.license_key || "";
    return {
      license_id: l.id,
      client_name: clientMap.get(l.client_id) || "Unknown pharmacy",
      license_key_masked: key.length > 10 ? `${key.slice(0, 8)}••••${key.slice(-4)}` : "••••",
      license_status: deriveOperationalStatus(l),
      entitlement: view,
    };
  });
  return NextResponse.json({ rows });
});

