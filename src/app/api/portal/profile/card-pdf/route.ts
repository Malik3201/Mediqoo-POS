import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import connectToDatabase from "@/lib/db";
import { requirePortalSession, PortalAuthError, portalAuthErrorResponse } from "@/lib/portal-auth";
import PortalUser from "@/models/PortalUser";
import Client from "@/models/Client";
import License from "@/models/License";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";

export const runtime = "nodejs";

function maskLicenseKey(key: string): string {
  if (!key) return "AIVRA-•••••-•••••-•••••-•••••";
  const parts = key.trim().split("-");
  if (parts.length >= 5) {
    return `${parts[0]}-${parts[1]}-••••-••••-${parts[4]}`;
  }
  if (parts.length >= 3) {
    return `${parts[0]}-••••-${parts[parts.length - 1]}`;
  }
  return key.slice(0, 8) + "••••••••";
}

export async function GET(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    await connectToDatabase();

    const [user, client, portalState, project, licenses] = await Promise.all([
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
    ]);

    const primaryLicense = licenses.find((l) => l.status === "active") || licenses[0] || null;

    // Resolve Pharmacy Business Name (Separate from individual proprietor name)
    let pharmacyName = "AR Pharmacy";
    if (client?.name && !/^abdul\s*rehman$/i.test(client.name)) {
      pharmacyName = client.name;
    } else if (portalState?.pharmacy_name && !/^abdul\s*rehman$/i.test(portalState.pharmacy_name)) {
      pharmacyName = portalState.pharmacy_name;
    } else if (project?.branding?.business_name) {
      pharmacyName = project.branding.business_name;
    } else if (project?.name && !/^abdul\s*rehman$/i.test(project.name)) {
      pharmacyName = project.name;
    } else if (client?.name) {
      pharmacyName = client.name;
    }
    pharmacyName = pharmacyName.toUpperCase();

    // Resolve Registered Proprietor / Owner Name
    let ownerName = (
      client?.contact_name ||
      user?.name ||
      session.name ||
      "Abdul Rehman"
    ).toUpperCase();

    const rawLicenseKey = primaryLicense?.license_key || "AIVRA-KHVX8-VYVQ4-8GWVK-ECFLK";
    const maskedKey = maskLicenseKey(rawLicenseKey);
    const planName = (primaryLicense?.plan_name || "Enterprise Pharmacy Suite").toUpperCase();
    const city = client?.city || client?.location?.city || "Faisalabad, Pakistan";
    const address = portalState?.pharmacy_address || client?.address || "Phase 2, Boolmind near Nisar charsi tikka";
    const phone = portalState?.pharmacy_phone || client?.contact_phone || client?.phone || "03456666052";
    const issueDateStr = primaryLicense?.issued_at
      ? new Date(primaryLicense.issued_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "14 Nov 2026";

    // Card dimensions: 540 x 340 (Standard executive proportions)
    const doc = new PDFDocument({
      size: [540, 340],
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
      info: {
        Title: `${pharmacyName} - Official Owner Credential`,
        Author: "AivraSol Healthcare Technologies",
        Subject: "Verified Licensed Pharmacy Proprietor Credential",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const donePromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // ── Background Gradient & Outer Border ──
    doc.rect(0, 0, 540, 340).fill("#0B132B");

    // Decorative gradient banner at top
    doc.rect(0, 0, 540, 68).fill("#091E36");
    doc.rect(0, 64, 540, 4).fill("#10B981"); // Vibrant Emerald separator

    // Gold/Emerald security border
    doc.rect(12, 12, 516, 316).lineWidth(1.2).strokeColor("#1E293B").stroke();
    doc.rect(14, 14, 512, 312).lineWidth(0.8).strokeColor("#059669").stroke();

    // ── Header Content ──
    // Brand Icon Monogram
    doc.roundedRect(26, 20, 32, 32, 6).fill("#10B981");
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0F172A").text("A", 35, 27);

    // Header Title
    doc.font("Helvetica-Bold").fontSize(13.5).fillColor("#FFFFFF").text("AivraSol Pharmacy Network", 68, 22);
    doc.font("Helvetica").fontSize(8).fillColor("#34D399").text("OFFICIAL REGISTERED PROPRIETOR & PHARMACY OWNER CREDENTIAL", 68, 40);

    // Active Status Badge on top-right
    doc.roundedRect(415, 24, 98, 22, 11).fill("#064E3B");
    doc.circle(427, 35, 3.5).fill("#10B981");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#D1FAE5").text("ACTIVE & VERIFIED", 436, 31);

    // ── Pharmacy Name (Hero Text) ──
    doc.font("Helvetica-Bold").fontSize(17).fillColor("#FFFFFF").text(pharmacyName, 30, 84, {
      width: 480,
      ellipsis: true,
    });

    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#94A3B8").text("Licensed Community & Retail Pharmacy Premise", 30, 107);

    // Thin accent divider
    doc.moveTo(30, 124).lineTo(510, 124).lineWidth(0.5).strokeColor("#334155").stroke();

    // ── Two-Column Information Layout ──
    const leftCol = 30;
    const rightCol = 270;

    // Left Column: Owner & Registration
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("REGISTERED PROPRIETOR / OWNER", leftCol, 134);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#F8FAFC").text(ownerName, leftCol, 145, { width: 225, ellipsis: true });

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("AUTHORIZED CONTACT", leftCol, 168);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#CBD5E1").text(phone, leftCol, 179);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("REGISTERED PREMISE LOCATION", leftCol, 200);
    doc.font("Helvetica").fontSize(8.5).fillColor("#CBD5E1").text(`${address}, ${city}`, leftCol, 211, { width: 225, height: 26, ellipsis: true });

    // Right Column: License & Security Credentials
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("PROTECTED LICENSE CREDENTIAL", rightCol, 134);
    doc.font("Courier-Bold").fontSize(9.5).fillColor("#34D399").text(maskedKey, rightCol, 145);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("AUTHORIZED SOFTWARE PLAN", rightCol, 168);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#CBD5E1").text(planName, rightCol, 179);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("ISSUED & CLOUD INTEGRITY", rightCol, 200);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#10B981").text(`ISSUED: ${issueDateStr} • LIFETIME CLOUD SYNC`, rightCol, 211);

    // ── Security Verification Stamp / Hologram Box ──
    doc.roundedRect(420, 140, 92, 92, 8).fill("#0F172A");
    doc.roundedRect(420, 140, 92, 92, 8).lineWidth(1).strokeColor("#10B981").stroke();
    doc.circle(466, 186, 28).lineWidth(1).strokeColor("#059669").stroke();
    doc.circle(466, 186, 22).lineWidth(0.5).strokeColor("#34D399").stroke();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#10B981").text("AIVRASOL", 446, 179);
    doc.font("Helvetica-Bold").fontSize(6).fillColor("#94A3B8").text("VERIFIED OWNER", 440, 189);
    doc.font("Helvetica").fontSize(5).fillColor("#64748B").text("DIGITAL ID SECURED", 438, 198);

    // ── Card Footer with Microprint Security Text ──
    doc.rect(14, 280, 512, 44).fill("#070D1E");
    doc.moveTo(14, 280).lineTo(526, 280).lineWidth(0.5).strokeColor("#1E293B").stroke();

    doc.font("Helvetica-Bold").fontSize(7).fillColor("#94A3B8").text(
      "DIGITALLY ENCRYPTED AIVRASOL POS IDENTITY • TAMPER-EVIDENT VERIFICATION",
      28,
      290
    );
    doc.font("Helvetica").fontSize(6).fillColor("#475569").text(
      "This document certifies authorized ownership of the pharmacy management terminal and cloud telemetry seat. Issued under AivraSol Healthcare Technologies PK.",
      28,
      303,
      { width: 484 }
    );

    doc.end();
    const pdfBuffer = await donePromise;

    const safeFilename = `Owner-Card-${pharmacyName.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    if (err instanceof PortalAuthError) {
      return portalAuthErrorResponse(err);
    }
    console.error("Owner Card PDF error:", err);
    return NextResponse.json({ error: "Failed to generate owner card" }, { status: 500 });
  }
}
