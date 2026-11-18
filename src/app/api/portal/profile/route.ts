import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession, PortalAuthError, portalAuthErrorResponse } from "@/lib/portal-auth";
import PortalUser from "@/models/PortalUser";
import Client from "@/models/Client";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";

export async function GET(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    await connectToDatabase();

    const [user, client, portalState, project, licenses, seats] = await Promise.all([
      PortalUser.findOne({ id: session.id || (session as any).user_id }).lean<any>(),
      Client.findOne({ id: session.client_id }).lean<any>(),
      OwnerPortalState.findOne({ client_id: session.client_id })
        .sort({ captured_at: -1 })
        .lean<any>(),
      Project.findOne({ client_id: session.client_id })
        .sort({ updatedAt: -1 })
        .lean<any>(),
      License.find({ client_id: session.client_id })
        .sort({ created_at: -1 })
        .lean<any[]>(),
      LicenseSeat.find({ status: "active" })
        .lean<any[]>(),
    ]);

    const primaryLicense = licenses.find((l) => l.status === "active") || licenses[0] || null;
    const clientSeats = seats.filter((s) => licenses.some((l) => l.id === s.license_id));

    const resolvedPharmacyName =
      portalState?.pharmacy_name ||
      project?.branding?.business_name ||
      project?.name ||
      client?.name ||
      session.client_name ||
      "AivraSol Pharmacy";

    const resolvedPharmacyLogo =
      portalState?.pharmacy_logo ||
      project?.branding?.logo_url ||
      null;

    return NextResponse.json({
      ok: true,
      profile: {
        id: user?.id || session.id,
        name: user?.name || client?.contact_name || session.name || "Pharmacy Owner",
        email: user?.email || session.email,
        role: user?.role || session.role || "owner",
        last_login_at: user?.last_login_at || null,
        created_at: user?.created_at || null,
      },
      pharmacy: {
        id: client?.id || session.client_id,
        name: resolvedPharmacyName,
        logo: resolvedPharmacyLogo,
        phone: portalState?.pharmacy_phone || client?.contact_phone || client?.phone || null,
        address: portalState?.pharmacy_address || client?.address || client?.city || null,
        city: client?.city || client?.location?.city || "Pakistan",
        timezone: client?.timezone || "Asia/Karachi",
        license_key: primaryLicense?.license_key || null,
        plan_name: primaryLicense?.plan_name || "Enterprise POS",
        license_status: primaryLicense?.status || "active",
        expires_at: primaryLicense?.expires_at || null,
        active_terminals: clientSeats.length,
      },
    });
  } catch (err) {
    if (err instanceof PortalAuthError) {
      return portalAuthErrorResponse(err);
    }
    console.error("Profile GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    await connectToDatabase();

    const body = await req.json().catch(() => null);
    const { name, phone, address, pharmacy_name } = body ?? {};

    if (name && typeof name === "string") {
      await PortalUser.updateOne(
        { id: session.id || (session as any).user_id },
        { $set: { name: name.trim(), updated_at: new Date() } }
      );
    }

    const clientUpdates: Record<string, any> = { updated_at: new Date() };
    if (name && typeof name === "string") clientUpdates.contact_name = name.trim();
    if (phone && typeof phone === "string") clientUpdates.contact_phone = phone.trim();
    if (address && typeof address === "string") clientUpdates.address = address.trim();
    if (pharmacy_name && typeof pharmacy_name === "string") clientUpdates.name = pharmacy_name.trim();

    await Client.updateOne({ id: session.client_id }, { $set: clientUpdates });

    if (pharmacy_name || phone || address) {
      const stateUpdates: Record<string, any> = {};
      if (pharmacy_name) stateUpdates.pharmacy_name = pharmacy_name.trim();
      if (phone) stateUpdates.pharmacy_phone = phone.trim();
      if (address) stateUpdates.pharmacy_address = address.trim();

      await OwnerPortalState.updateMany({ client_id: session.client_id }, { $set: stateUpdates });
    }

    return NextResponse.json({
      ok: true,
      message: "Profile updated successfully.",
    });
  } catch (err) {
    if (err instanceof PortalAuthError) {
      return portalAuthErrorResponse(err);
    }
    console.error("Profile PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
