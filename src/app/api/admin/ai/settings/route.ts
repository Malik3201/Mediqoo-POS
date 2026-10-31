import { NextResponse } from "next/server";
import { adminHandler } from "@/lib/ai/admin-http";
import { aiAudit } from "@/lib/ai/audit";
import { getAiSettings, normalizeAiSettings, saveAiSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => {
  return NextResponse.json({ settings: await getAiSettings() });
});

export const PUT = adminHandler(async (req, actor) => {
  const body = await req.json().catch(() => ({}));
  const incoming = body?.settings && typeof body.settings === "object" ? body.settings : body;
  const before = await getAiSettings();
  const next = normalizeAiSettings({ ...before, ...incoming });
  const saved = await saveAiSettings(next);
  const changed: Record<string, { from: any; to: any }> = {};
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) {
    if (saved[k] !== before[k]) changed[k] = { from: before[k], to: saved[k] };
  }
  await aiAudit(actor, saved.ai_global_enabled !== before.ai_global_enabled ? (saved.ai_global_enabled ? "global_enabled" : "global_disabled") : "settings_updated", "ai_settings", "global", { changed });
  return NextResponse.json({ settings: saved });
});

