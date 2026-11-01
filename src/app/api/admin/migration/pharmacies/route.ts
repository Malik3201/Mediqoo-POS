import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Project from "@/models/Project";
import Client from "@/models/Client";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();

    const licenses = await License.find({ status: "active" }).lean();
    const projectIds = licenses.map((l) => l.project_id).filter(Boolean);
    const clientIds = licenses.map((l) => l.client_id).filter(Boolean);

    const [projects, clients] = await Promise.all([
      Project.find({ id: { $in: projectIds } }).lean(),
      Client.find({ id: { $in: clientIds } }).lean(),
    ]);

    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const pharmacies = licenses.map((lic) => {
      const proj = projectMap.get(lic.project_id);
      const cli = clientMap.get(lic.client_id);
      return {
        license_id: lic.id,
        license_key: lic.license_key,
        status: lic.status,
        expires_at: lic.expires_at,
        project_id: lic.project_id,
        pharmacy_name: proj?.name || "Unnamed Pharmacy",
        client_id: lic.client_id,
        client_name: cli?.name || "Unknown Client",
      };
    });

    return NextResponse.json({ pharmacies });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
