import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import {
  getCloudResourceMonitorReport,
  getCloudMonitorConfig,
  updateCloudMonitorConfig,
} from "@/lib/infrastructure/cloud-monitor";
import AuditLog from "@/models/AuditLog";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin(req);
    if ("error" in auth) return auth.error;

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const report = await getCloudResourceMonitorReport({ forceRefresh });
    return NextResponse.json(report);
  } catch (err: any) {
    console.error("[api/admin/infrastructure/cloud-monitor GET] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load Cloud Resource Monitor report" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin(req);
    if ("error" in auth) return auth.error;

    await connectToDatabase();

    const body = await req.json();
    const configPatch = body.config || body;
    const updatedConfig = await updateCloudMonitorConfig(configPatch, auth.actor);

    await AuditLog.create({
      user_id: auth.actor,
      action: "cloud_monitor.config.update",
      resource: "infrastructure.cloud-monitor",
      details: updatedConfig,
      status: "success",
    }).catch(() => {});

    // Return refreshed report with updated thresholds/quotas applied
    const report = await getCloudResourceMonitorReport({ forceRefresh: true });
    return NextResponse.json({
      success: true,
      config: updatedConfig,
      report,
    });
  } catch (err: any) {
    console.error("[api/admin/infrastructure/cloud-monitor PATCH] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update Cloud Resource Monitor configuration" },
      { status: 500 }
    );
  }
}

