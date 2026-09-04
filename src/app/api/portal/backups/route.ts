import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import connectToDatabase from "@/lib/db";
import CloudBackup from "@/models/CloudBackup";
import License from "@/models/License";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);
    await connectToDatabase();
    
    // Check cloud backup feature entitlement for this client to verify navigation entitlement matches data access
    const hasCloudBackup = await License.exists({ 
      client_id: user.client_id, 
      "features.cloud_backup": true 
    });

    if (!hasCloudBackup) {
      return NextResponse.json({ error: "Feature disabled for this client" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const licenseId = searchParams.get("license_id");
    
    // Only fetch uploaded or failed, don't show pending to the UI
    const query: any = { 
      client_id: user.client_id,
      status: { $in: ["uploaded"] } 
    };

    if (licenseId) {
      query.license_id = licenseId;
    }

    const backups = await CloudBackup.find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .lean();

    // Attach license info (project name) for UI
    const licenseIds = Array.from(new Set(backups.map(b => b.license_id)));
    const licenses = await License.find({ id: { $in: licenseIds } }).lean();
    
    // Actually the License model has a virtual for projects, but since we use lean() we might need to manually populate or resolve.
    // To keep it simple, let's just use mongoose populate if we drop lean, or we manually fetch Projects.
    // The easiest is just return backups, the UI can fetch licenses or we can populate it.
    
    // Using manual population for performance
    const Project = require("@/models/Project").default;
    const projectIds = Array.from(new Set(licenses.map(l => l.project_id)));
    const projects = await Project.find({ id: { $in: projectIds } }).lean();
    
    const enriched = backups.map(b => {
      const lic = licenses.find(l => l.id === b.license_id);
      const proj = lic ? projects.find((p: any) => p.id === lic.project_id) : null;
      return {
        ...b,
        _project_name: proj ? (proj as any).name : "Unknown Location",
      };
    });

    return NextResponse.json({ backups: enriched });
  } catch (error: any) {
    if (error instanceof PortalAuthError) return portalAuthErrorResponse(error);
    console.error("Portal Backup list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
