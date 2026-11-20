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
import LicenseSeat from "@/models/LicenseSeat";
import OwnerPortalState from "@/models/OwnerPortalState";
import Project from "@/models/Project";
import { drawAbdulrehmanSignaturePdf, getAivraSolLogoBuffer } from "@/lib/renewal-voucher-pdf";

export const runtime = "nodejs";

function parseSafeImageBuffer(dataUrl?: string | null): Buffer | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.trim().match(/^data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[1], "base64");
    if (buf.length < 16) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    return isPng || isJpg ? buf : null;
  } catch {
    return null;
  }
}

function getPharmacyInitials(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "AP";
}

function drawSmartEmvChip(doc: PDFKit.PDFDocument, x: number, y: number, w = 26, h = 19) {
  doc.save();
  doc.roundedRect(x, y, w, h, 3).fill("#E8C872");
  doc.roundedRect(x, y, w, h, 3).lineWidth(0.6).strokeColor("#B38D32").stroke();
  doc.roundedRect(x + 0.9, y + 0.9, w - 1.8, h - 1.8, 2.2).lineWidth(0.35).strokeColor("#F7E5AE").stroke();

  doc.lineWidth(0.5).strokeColor("#8A681E");
  doc.moveTo(x + 1, y + h * 0.34).lineTo(x + w * 0.34, y + h * 0.34).stroke();
  doc.moveTo(x + 1, y + h * 0.66).lineTo(x + w * 0.34, y + h * 0.66).stroke();
  doc.moveTo(x + w * 0.66, y + h * 0.34).lineTo(x + w - 1, y + h * 0.34).stroke();
  doc.moveTo(x + w * 0.66, y + h * 0.66).lineTo(x + w - 1, y + h * 0.66).stroke();
  doc.roundedRect(x + w * 0.33, y + 1.8, w * 0.34, h - 3.6, 1.8).stroke();
  doc.moveTo(x + w * 0.5, y + 1.8).lineTo(x + w * 0.5, y + h * 0.36).stroke();
  doc.moveTo(x + w * 0.5, y + h * 0.64).lineTo(x + w * 0.5, y + h - 1.8).stroke();
  doc.restore();
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
    const activeSeatsCount = primaryLicense
      ? await LicenseSeat.countDocuments({ license_id: primaryLicense.id, status: "active" })
      : 0;

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
    const planName = (primaryLicense?.plan_name || "Enterprise POS").toUpperCase();
    const city = client?.city || client?.location?.city || "Pakistan";
    const address = portalState?.pharmacy_address || client?.address || "Registered Pharmacy Premise";
    const phone = portalState?.pharmacy_phone || client?.contact_phone || client?.phone || "+92 300 0000000";

    const rawStatus = String(primaryLicense?.status || "active").toLowerCase();
    const isVerifiedActive = rawStatus === "active";
    const statusLabel = isVerifiedActive
      ? "VERIFIED"
      : rawStatus === "grace"
        ? "GRACE"
        : rawStatus.toUpperCase();

    const rawClientId = String(client?.id || session.client_id || "0001");
    const cardCode = rawClientId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() || "0001";
    const seats = Math.max(1, activeSeatsCount);
    const seatLabel = `${seats} ${seats === 1 ? "Seat" : "Seats"}`;
    const issuedDate = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const customLogoBuffer = parseSafeImageBuffer(
      portalState?.pharmacy_logo || project?.branding?.logo_url || null
    );
    const aivraLogoBuffer = getAivraSolLogoBuffer();

    // Compact ISO CR-80 executive wallet card proportions (342 x 214 pt)
    const W = 342;
    const H = 214;

    const doc = new PDFDocument({
      size: [W, H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `${pharmacyName} - Official AivraSol Owner Card`,
        Author: "AivraSol Technologies",
        Subject: "Official Pharmacy Proprietor Identity Card",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const donePromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // 1. Clean Pearl-White Executive Base Canvas
    doc.rect(0, 0, W, H).fill("#FFFFFF");

    // Subtle soft mint tint strip along bottom of white zone
    doc.rect(0, H - 46, 232, 46).fill("#F7FBF9");

    // Subtle translucent AivraSol watermark on pearl-white canvas
    try {
      doc.save();
      doc.opacity(0.038);
      doc.image(aivraLogoBuffer, 118, 52, { width: 100 });
      doc.restore();
    } catch {
      // Ignore watermark error
    }

    // 2. Sculpted Deep Pharmacy Forest-Emerald Architectural Right Panel
    const splitTopX = 236;
    const splitBottomX = 218;

    doc.save();
    doc
      .moveTo(splitTopX, 0)
      .lineTo(W, 0)
      .lineTo(W, H)
      .lineTo(splitBottomX, H)
      .closePath()
      .clip();

    // Deep forest-emerald fill
    doc.rect(210, 0, W - 210, H).fill("#04291F");

    // Subtle layered geometric sheen inside right panel
    doc.save();
    doc.opacity(0.45);
    doc.polygon([238, 0], [W, 0], [W, 130], [268, 130]).fill("#074232");
    doc.restore();

    // Fine concentric guilloche rings inside right panel
    doc.save();
    doc.opacity(0.11);
    doc.strokeColor("#34D399").lineWidth(0.55);
    for (let r = 30; r <= 120; r += 15) {
      doc.circle(312, 182, r).stroke();
    }
    doc.restore();
    doc.restore();

    // Crisp diagonal emerald & metallic champagne-gold accent edge along architectural split
    doc
      .moveTo(splitTopX, 0)
      .lineTo(splitBottomX, H)
      .lineWidth(2.6)
      .strokeColor("#009A4D")
      .stroke();
    doc
      .moveTo(splitTopX + 2.3, 0)
      .lineTo(splitBottomX + 2.3, H)
      .lineWidth(0.75)
      .strokeColor("#D4AF37")
      .stroke();

    // Left vertical brand accent spine
    doc.rect(0, 0, 5, 130).fill("#009A4D");
    doc.rect(0, 130, 5, H - 130).fill("#04291F");

    // 3. LEFT EXECUTIVE CONTENT ZONE (x = 18 .. 216)
    // Top Company Logo & Brand Identity
    try {
      doc.image(aivraLogoBuffer, 17, 13, { width: 31 });
    } catch {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#009A4D").text("Ai", 18, 20);
    }

    doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#053427").text("AIVRASOL TECHNOLOGIES", 53, 17.5, {
      characterSpacing: 0.55,
    });
    doc.font("Helvetica-Bold").fontSize(5.4).fillColor("#009A4D").text("OFFICIAL OWNER IDENTITY CARD", 53, 28.5, {
      characterSpacing: 0.5,
    });

    // Clean subtle horizontal divider under brand lockup
    doc.moveTo(18, 49).lineTo(212, 49).lineWidth(0.6).strokeColor("#DCE9E2").stroke();

    // Authorized Pharmacy (Hero)
    doc.font("Helvetica-Bold").fontSize(5.1).fillColor("#64748B").text("AUTHORIZED PHARMACY", 18, 56, {
      characterSpacing: 0.55,
    });
    const heroFontSize = pharmacyName.length > 26 ? 9.6 : pharmacyName.length > 20 ? 10.6 : 11.8;
    doc.font("Helvetica-Bold").fontSize(heroFontSize).fillColor("#0B1F19").text(pharmacyName, 18, 64.5, {
      width: 196,
      height: 15,
      ellipsis: true,
    });

    const locationStr = `${address}${city ? ` · ${city}` : ""}`;
    doc.font("Helvetica").fontSize(6.5).fillColor("#475569").text(locationStr, 18, 80, {
      width: 194,
      height: 10,
      ellipsis: true,
    });

    // Registered Proprietor / Owner
    doc.font("Helvetica-Bold").fontSize(5.1).fillColor("#64748B").text("REGISTERED PROPRIETOR", 18, 97, {
      characterSpacing: 0.55,
    });
    doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#064E3B").text(ownerName, 18, 105.5, {
      width: 192,
      height: 13,
      ellipsis: true,
    });

    // Contact Phone & Plan (Clean 2-Column Row)
    doc.font("Helvetica-Bold").fontSize(5.0).fillColor("#64748B").text("CONTACT", 18, 126, {
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor("#0F172A").text(phone, 18, 134, {
      width: 90,
      height: 11,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(5.0).fillColor("#64748B").text("SUBSCRIPTION PLAN", 112, 126, {
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor("#0F172A").text(planName, 112, 134, {
      width: 96,
      height: 11,
      ellipsis: true,
    });

    // Bottom Divider above Signature & Issue Date
    doc.moveTo(18, 168).lineTo(206, 168).lineWidth(0.55).strokeColor("#DCE9E2").stroke();

    // Handwritten Authentic Dark-Ink + Emerald Signature on Crisp Pearl Background
    drawAbdulrehmanSignaturePdf(doc, 16, 167, 0.34);
    doc.moveTo(18, 189).lineTo(96, 189).lineWidth(0.55).strokeColor("#94A3B8").stroke();
    doc.font("Helvetica-Bold").fontSize(4.7).fillColor("#475569").text("AUTHORIZED SIGNATORY", 18, 192.5, {
      width: 78,
      characterSpacing: 0.35,
    });
    doc.font("Helvetica-Bold").fontSize(5.0).fillColor("#009A4D").text("AivraSol Technologies", 18, 199.5, {
      width: 82,
    });

    // Issue Date & Portal Website (aligned cleanly with bottom signatory baseline)
    doc.font("Helvetica-Bold").fontSize(4.7).fillColor("#94A3B8").text("ISSUED", 114, 178.5, {
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(6.6).fillColor("#1E293B").text(issuedDate, 114, 186, {
      width: 88,
    });
    doc.font("Helvetica").fontSize(5.2).fillColor("#64748B").text("www.aivrasol.com", 114, 199, {
      width: 88,
    });

    // 4. RIGHT DEEP-EMERALD EXECUTIVE CREDENTIAL PANEL (optically centered inside diagonal trapezoid)
    const panelCenterX = 286;

    // Status Pill Top-Right (trapezoid center at y=22 is ~288)
    const statusPillW = 64;
    const statusPillX = 288 - statusPillW / 2;
    const pillBg = isVerifiedActive ? "#064E3B" : "#78350F";
    const pillBorder = isVerifiedActive ? "#10B981" : "#F59E0B";
    const pillDot = isVerifiedActive ? "#34D399" : "#FBBF24";
    const pillText = isVerifiedActive ? "#ECFDF5" : "#FEF3C7";

    doc.roundedRect(statusPillX, 14, statusPillW, 16, 8).fill(pillBg);
    doc.roundedRect(statusPillX, 14, statusPillW, 16, 8).lineWidth(0.7).strokeColor(pillBorder).stroke();
    doc.circle(statusPillX + 10.5, 22, 2.2).fill(pillDot);
    doc.font("Helvetica-Bold").fontSize(5.5).fillColor(pillText).text(statusLabel, statusPillX + 15.5, 19.4, {
      width: statusPillW - 19,
      align: "center",
      characterSpacing: 0.4,
    });

    // Pharmacy Custom Logo or Clean Monogram Crest
    const crestSize = 44;
    const crestX = panelCenterX - crestSize / 2;
    const crestY = 42;
    let renderedCustomLogo = false;
    if (customLogoBuffer) {
      try {
        doc.roundedRect(crestX, crestY, crestSize, crestSize, 9).fill("#FFFFFF");
        doc.roundedRect(crestX, crestY, crestSize, crestSize, 9).lineWidth(0.9).strokeColor("#10B981").stroke();
        doc.image(customLogoBuffer, crestX + 4, crestY + 4, {
          fit: [crestSize - 8, crestSize - 8],
          align: "center",
          valign: "center",
        });
        renderedCustomLogo = true;
      } catch {
        renderedCustomLogo = false;
      }
    }
    if (!renderedCustomLogo) {
      doc.roundedRect(crestX, crestY, crestSize, crestSize, 9).fill("#064E3B");
      doc.roundedRect(crestX, crestY, crestSize, crestSize, 9).lineWidth(0.9).strokeColor("#34D399").stroke();
      doc
        .roundedRect(crestX + 2.8, crestY + 2.8, crestSize - 5.6, crestSize - 5.6, 6.5)
        .lineWidth(0.45)
        .strokeColor("#D4AF37")
        .stroke();
      const initials = getPharmacyInitials(pharmacyName);
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#FFFFFF").text(initials, crestX, crestY + 11.5, {
        width: crestSize,
        align: "center",
      });
      doc.font("Helvetica-Bold").fontSize(4.4).fillColor("#6EE7B7").text("OWNER", crestX, crestY + 30, {
        width: crestSize,
        align: "center",
        characterSpacing: 0.7,
      });
    }

    // Metallic Gold EMV Smart Chip centered neatly below crest (trapezoid center at y=107 is ~285)
    drawSmartEmvChip(doc, 285 - 13, 98, 26, 19);

    // License Key & Pass ID on Rich Emerald Surface (trapezoid center at y=160 is ~282.5)
    const panelInnerX = 235;
    const panelInnerW = 95;

    doc.font("Helvetica-Bold").fontSize(4.8).fillColor("#6EE7B7").text("DIGITAL LICENSE KEY", panelInnerX, 128, {
      width: panelInnerW,
      align: "center",
      characterSpacing: 0.45,
    });
    doc.roundedRect(panelInnerX, 136, panelInnerW, 15, 3.5).fill("#021B14");
    doc.roundedRect(panelInnerX, 136, panelInnerW, 15, 3.5).lineWidth(0.6).strokeColor("#10B981").stroke();
    doc.font("Courier-Bold").fontSize(6.6).fillColor("#34D399").text(licenseKey, panelInnerX + 3, 140.4, {
      width: panelInnerW - 6,
      height: 10,
      ellipsis: true,
      align: "center",
    });

    doc.font("Helvetica-Bold").fontSize(4.8).fillColor("#6EE7B7").text("PASS ID · TERMINALS", panelInnerX, 160, {
      width: panelInnerW,
      align: "center",
      characterSpacing: 0.45,
    });
    doc.font("Courier-Bold").fontSize(6.8).fillColor("#ECFDF5").text(`#${cardCode} · ${seatLabel}`, panelInnerX, 168.5, {
      width: panelInnerW,
      height: 10,
      ellipsis: true,
      align: "center",
    });

    // Subtle bottom verification caption inside emerald panel
    doc.save();
    doc.opacity(0.35);
    doc.moveTo(panelInnerX + 12, 187).lineTo(panelInnerX + panelInnerW - 12, 187).lineWidth(0.5).strokeColor("#6EE7B7").stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(4.7).fillColor("#A7F3D0").text("AIVRASOL CLOUD VERIFIED", panelInnerX, 193, {
      width: panelInnerW,
      align: "center",
      characterSpacing: 0.5,
    });

    // 5. Crisp Subtle Outer Frame
    doc.rect(0.5, 0.5, W - 1, H - 1).lineWidth(0.8).strokeColor("#CBD5E1").stroke();

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
