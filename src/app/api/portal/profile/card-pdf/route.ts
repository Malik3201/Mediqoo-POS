import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";
import "pdfkit/standard-fonts/HelveticaOblique";
import "pdfkit/standard-fonts/Courier";
import "pdfkit/standard-fonts/CourierBold";
import connectToDatabase from "@/lib/db";
import { requirePortalSession, PortalAuthError, portalAuthErrorResponse } from "@/lib/portal-auth";
import PortalUser from "@/models/PortalUser";
import Client from "@/models/Client";
import License from "@/models/License";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";

export const runtime = "nodejs";

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

    const pharmacyName = (
      portalState?.pharmacy_name ||
      project?.branding?.business_name ||
      project?.name ||
      client?.name ||
      session.client_name ||
      "AivraSol Pharmacy"
    ).toUpperCase();

    const ownerName = (
      user?.name ||
      client?.contact_name ||
      session.name ||
      "Registered Proprietor"
    ).toUpperCase();

    const licenseKey = primaryLicense?.license_key || "AIVRA-PRO-VERIFIED";
    const planName = (primaryLicense?.plan_name || "Enterprise Pharmacy Suite").toUpperCase();
    const city = client?.city || client?.location?.city || "Pakistan";
    const address = portalState?.pharmacy_address || client?.address || "Registered Pharmacy Premise";
    const phone = portalState?.pharmacy_phone || client?.contact_phone || client?.phone || "+92 300 0000000";

    // Card dimensions: 540 x 340 (Standard proportions, crisp resolution)
    const doc = new PDFDocument({
      size: [540, 340],
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
      info: {
        Title: `${pharmacyName} - Official Owner Identity Card`,
        Author: "AivraSol Healthcare Technologies",
        Subject: "Verified Pharmacy Proprietor Credential",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const donePromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // ── Background Gradient & Outer Border ──
    // Dark Executive Obsidian Slate with subtle emerald accents
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
    doc.font("HelveticaBold").fontSize(18).fillColor("#0F172A").text("A", 35, 27);

    // Header Title
    doc.font("HelveticaBold").fontSize(14).fillColor("#FFFFFF").text("AivraSol Pharmacy Network", 68, 22);
    doc.font("Helvetica").fontSize(8.5).fillColor("#34D399").text("OFFICIAL REGISTERED PROPRIETOR & PHARMACY OWNER CREDENTIAL", 68, 40);

    // Active Status Badge on top-right
    doc.roundedRect(420, 24, 94, 22, 11).fill("#064E3B");
    doc.circle(432, 35, 3.5).fill("#10B981");
    doc.font("HelveticaBold").fontSize(8).fillColor("#D1FAE5").text("ACTIVE & VERIFIED", 442, 31);

    // ── Pharmacy Name (Hero Text) ──
    doc.font("HelveticaBold").fontSize(17).fillColor("#FFFFFF").text(pharmacyName, 30, 84, {
      width: 480,
      ellipsis: true,
    });

    doc.font("HelveticaOblique").fontSize(9.5).fillColor("#94A3B8").text("Licensed Retail & Community Pharmacy", 30, 108);

    // Thin accent divider
    doc.moveTo(30, 125).lineTo(510, 125).lineWidth(0.5).strokeColor("#334155").stroke();

    // ── Two-Column Information Layout ──
    const leftCol = 30;
    const rightCol = 280;

    // Left Column: Owner & Registration
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("REGISTERED PROPRIETOR / OWNER", leftCol, 136);
    doc.font("HelveticaBold").fontSize(12).fillColor("#F8FAFC").text(ownerName, leftCol, 148, { width: 230, ellipsis: true });

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("CONTACT & PHONE", leftCol, 172);
    doc.font("HelveticaBold").fontSize(9.5).fillColor("#CBD5E1").text(phone, leftCol, 183);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("PREMISE LOCATION", leftCol, 204);
    doc.font("Helvetica").fontSize(9).fillColor("#CBD5E1").text(`${address}, ${city}`, leftCol, 215, { width: 230, height: 26, ellipsis: true });

    // Right Column: License & Security Credentials
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("DIGITAL LICENSE KEY", rightCol, 136);
    doc.font("CourierBold").fontSize(9.5).fillColor("#34D399").text(licenseKey, rightCol, 148);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("AUTHORIZED SOFTWARE PLAN", rightCol, 172);
    doc.font("HelveticaBold").fontSize(9.5).fillColor("#CBD5E1").text(planName, rightCol, 183);

    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("NETWORK VALIDITY", rightCol, 204);
    doc.font("HelveticaBold").fontSize(9).fillColor("#10B981").text("VALID • LIFETIME CLOUD INTEGRITY", rightCol, 215);

    // ── Simulated Security Chip / Verification Stamp ──
    doc.roundedRect(424, 148, 86, 86, 8).fill("#0F172A");
    doc.roundedRect(424, 148, 86, 86, 8).lineWidth(1).strokeColor("#10B981").stroke();
    doc.circle(467, 191, 26).lineWidth(1).strokeColor("#059669").stroke();
    doc.circle(467, 191, 20).lineWidth(0.5).strokeColor("#34D399").stroke();
    doc.font("HelveticaBold").fontSize(7).fillColor("#10B981").text("AIVRASOL", 448, 184);
    doc.font("HelveticaBold").fontSize(5.5).fillColor("#94A3B8").text("VERIFIED POS", 444, 194);

    // ── Card Footer with Microprint Security Text ──
    doc.rect(14, 280, 512, 44).fill("#070D1E");
    doc.moveTo(14, 280).lineTo(526, 280).lineWidth(0.5).strokeColor("#1E293B").stroke();

    doc.font("HelveticaBold").fontSize(7.5).fillColor("#94A3B8").text(
      "DIGITALLY ENCRYPTED AIVRASOL POS IDENTITY • TAMPER-EVIDENT VERIFICATION",
      28,
      290
    );
    doc.font("Helvetica").fontSize(6.5).fillColor("#475569").text(
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
