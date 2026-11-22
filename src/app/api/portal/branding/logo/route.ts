import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Project from "@/models/Project";
import OwnerPortalState from "@/models/OwnerPortalState";
import { requirePortalSession, PortalAuthError, portalAuthErrorResponse } from "@/lib/portal-auth";
import {
  removeLicensePharmacyLogo,
  resolveEffectivePharmacyLogo,
  uploadLicensePharmacyLogo,
} from "@/lib/branding/logo-service";

export const dynamic = "force-dynamic";

async function resolvePortalPrimaryLicense(clientId: string, requestedLicenseId?: string | null) {
  await connectToDatabase();
  const licenses = await License.find({ client_id: clientId }).sort({ created_at: -1 }).lean<any[]>();
  if (requestedLicenseId) {
    const match = licenses.find((l) => l.id === requestedLicenseId);
    if (match) return match;
  }
  return licenses.find((l) => l.status === "active") || licenses[0] || null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    const licId = req.nextUrl.searchParams.get("licenseId");
    const license = await resolvePortalPrimaryLicense(session.client_id, licId);
    if (!license) {
      return NextResponse.json({ ok: false, error: "license_not_found" }, { status: 404 });
    }
    const [project, portalState] = await Promise.all([
      license.project_id ? Project.findOne({ id: license.project_id }).select("branding").lean() : null,
      OwnerPortalState.findOne({ license_id: license.id }).select("pharmacy_logo").lean(),
    ]);
    const resolved = resolveEffectivePharmacyLogo({ license, project, portalState });
    return NextResponse.json({
      ok: true,
      licenseId: license.id,
      ...resolved,
    });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("[portal/branding/logo GET]", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    if (session.role && !["owner", "admin"].includes(session.role.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "Only Pharmacy Owners/Admins may change branding." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const license = await resolvePortalPrimaryLicense(session.client_id, body?.licenseId);
    if (!license) {
      return NextResponse.json({ ok: false, error: "license_not_found" }, { status: 404 });
    }

    const res = await uploadLicensePharmacyLogo({
      licenseId: license.id,
      imageBase64: String(body?.imageBase64 || ""),
      thumbBase64: typeof body?.thumbBase64 === "string" ? body.thumbBase64 : null,
      actorLabel: `Owner Portal (${session.name || session.email})`,
      actorId: session.id,
      actorEmail: session.email,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
    }
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("[portal/branding/logo POST]", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    if (session.role && !["owner", "admin"].includes(session.role.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "Only Pharmacy Owners/Admins may change branding." }, { status: 403 });
    }
    const licId = req.nextUrl.searchParams.get("licenseId");
    const license = await resolvePortalPrimaryLicense(session.client_id, licId);
    if (!license) {
      return NextResponse.json({ ok: false, error: "license_not_found" }, { status: 404 });
    }

    const res = await removeLicensePharmacyLogo({
      licenseId: license.id,
      actorLabel: `Owner Portal (${session.name || session.email})`,
      actorId: session.id,
      actorEmail: session.email,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
    }
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("[portal/branding/logo DELETE]", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
