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
import { ABDULREHMAN_SIGNATURE_PATHS, getAivraSolLogoBuffer } from "@/lib/renewal-voucher-pdf";

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

function drawSmartEmvChip(doc: PDFKit.PDFDocument, x: number, y: number, w = 28, h = 20) {
  doc.save();
  // Brushed champagne-gold EMV chip base
  doc.roundedRect(x, y, w, h, 3.2).fill("#E8C872");
  doc.roundedRect(x, y, w, h, 3.2).lineWidth(0.65).strokeColor("#B38D32").stroke();

  // Inner subtle highlight bevel
  doc.roundedRect(x + 1, y + 1, w - 2, h - 2, 2.4).lineWidth(0.4).strokeColor("#F6E3A6").stroke();

  // Etched circuit pads
  const bronze = "#8A681E";
  doc.lineWidth(0.55).strokeColor(bronze);
  // Horizontal contact lines
  doc.moveTo(x + 1, y + h * 0.34).lineTo(x + w * 0.34, y + h * 0.34).stroke();
  doc.moveTo(x + 1, y + h * 0.66).lineTo(x + w * 0.34, y + h * 0.66).stroke();
  doc.moveTo(x + w * 0.66, y + h * 0.34).lineTo(x + w - 1, y + h * 0.34).stroke();
  doc.moveTo(x + w * 0.66, y + h * 0.66).lineTo(x + w - 1, y + h * 0.66).stroke();
  // Center micro-module rectangle
  doc.roundedRect(x + w * 0.33, y + 2, w * 0.34, h - 4, 2).stroke();
  // Vertical split lines inside center pad
  doc.moveTo(x + w * 0.5, y + 2).lineTo(x + w * 0.5, y + h * 0.36).stroke();
  doc.moveTo(x + w * 0.5, y + h * 0.64).lineTo(x + w * 0.5, y + h - 2).stroke();
  doc.restore();
}

function drawContactlessWaves(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.save();
  doc.lineCap("round").strokeColor("#34D399").opacity(0.8);
  for (let i = 0; i < 3; i++) {
    const r = 3.5 + i * 3.1;
    doc.lineWidth(0.9);
    doc
      .moveTo(x + r * 0.45, y - r * 0.65)
      .quadraticCurveTo(x + r * 1.05, y, x + r * 0.45, y + r * 0.65)
      .stroke();
  }
  doc.restore();
}

function drawWhiteEmeraldSignature(doc: PDFKit.PDFDocument, x: number, y: number, scale = 0.34) {
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc.lineCap("round").lineJoin("round");
  doc.path(ABDULREHMAN_SIGNATURE_PATHS.mainStroke).lineWidth(2.3).strokeColor("#F8FAFC").stroke();
  doc.path(ABDULREHMAN_SIGNATURE_PATHS.crossAndFlourish).lineWidth(1.8).strokeColor("#10B981").stroke();
  doc.path(ABDULREHMAN_SIGNATURE_PATHS.dots).lineWidth(2.5).strokeColor("#34D399").stroke();
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
    const planName = (primaryLicense?.plan_name || "Enterprise Pharmacy Suite").toUpperCase();
    const city = client?.city || client?.location?.city || "Pakistan";
    const address = portalState?.pharmacy_address || client?.address || "Registered Pharmacy Premise";
    const phone = portalState?.pharmacy_phone || client?.contact_phone || client?.phone || "+92 300 0000000";

    const rawStatus = String(primaryLicense?.status || "active").toLowerCase();
    const isVerifiedActive = rawStatus === "active";
    const statusLabel = isVerifiedActive
      ? "ACTIVE & VERIFIED"
      : rawStatus === "grace"
        ? "GRACE PERIOD"
        : rawStatus.toUpperCase();

    const rawClientId = String(client?.id || session.client_id || "0001");
    const cardCode = rawClientId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() || "0001";
    const seatLabel = `${Math.max(1, activeSeatsCount)} ${Math.max(1, activeSeatsCount) === 1 ? "Seat" : "Seats"}`;
    const issuedDate = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const customLogoBuffer = parseSafeImageBuffer(
      portalState?.pharmacy_logo || project?.branding?.logo_url || null
    );
    const aivraMarkLogoBuffer = getAivraSolLogoBuffer();

    // Compact executive smart ID card dimensions (CR-80 / wallet proportions: 360 x 218 pt)
    const W = 360;
    const H = 218;
    const HEADER_H = 44;
    const FOOTER_H = 42;
    const FOOTER_Y = H - FOOTER_H;

    const doc = new PDFDocument({
      size: [W, H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `${pharmacyName} - Official AivraSol Owner Card`,
        Author: "AivraSol Healthcare Technologies",
        Subject: "Verified Pharmacy Proprietor Identity Card",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const donePromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // 1. Deep Pharmacy Forest-Emerald Base Canvas
    doc.rect(0, 0, W, H).fill("#04261D");

    // Subtle geometric facets & guilloche security arcs clipped to card body
    doc.save();
    doc.rect(0, HEADER_H, W, FOOTER_Y - HEADER_H).clip();

    doc.save();
    doc.opacity(0.45);
    doc.polygon([178, HEADER_H], [W, HEADER_H], [W, FOOTER_Y], [116, FOOTER_Y]).fill("#073C2D");
    doc.restore();

    doc.save();
    doc.opacity(0.08);
    doc.strokeColor("#34D399").lineWidth(0.55);
    for (let r = 42; r <= 140; r += 16) {
      doc.circle(312, 122, r).stroke();
    }
    doc.restore();

    // Official transparent AivraSol company mark watermark in body
    try {
      doc.save();
      doc.opacity(0.095);
      doc.image(aivraMarkLogoBuffer, 242, 72, { width: 98 });
      doc.restore();
    } catch {
      // Ignore if watermark fails
    }

    doc.restore();

    // 2. Crisp Pure White Top Brand Header (studio-clean AivraSol brand mark & emerald trim)
    doc.rect(0, 0, W, HEADER_H).fill("#FFFFFF");

    // Emerald & champagne-gold separator lines beneath header
    doc.rect(0, HEADER_H - 1, W, 2.2).fill("#009A4D");
    doc.rect(0, HEADER_H + 1.2, W, 0.7).fill("#D4AF37");

    // Official AivraSol Transparent Logo Mark
    try {
      doc.image(aivraMarkLogoBuffer, 15, 4, { width: 35 });
    } catch {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#009A4D").text("Ai", 18, 15);
    }

    // Divider & Card Title in Header
    doc.moveTo(57, 11).lineTo(57, 32).lineWidth(0.8).strokeColor("#CBD5E1").stroke();
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor("#064E3B").text("OWNER IDENTITY CARD", 65, 12.5, {
      characterSpacing: 0.45,
    });
    doc.font("Helvetica-Bold").fontSize(5.4).fillColor("#059669").text("AIVRASOL OWNER PORTAL · VERIFIED PASS", 65, 23.5, {
      characterSpacing: 0.25,
    });

    // Status Pill on Header Right
    const pillBg = isVerifiedActive ? "#ECFDF5" : "#FEF3C7";
    const pillStroke = isVerifiedActive ? "#059669" : "#D97706";
    const pillDot = isVerifiedActive ? "#009A4D" : "#D97706";
    const pillFg = isVerifiedActive ? "#065F46" : "#92400E";

    doc.roundedRect(264, 13, 81, 17.5, 8.75).fill(pillBg);
    doc.roundedRect(264, 13, 81, 17.5, 8.75).lineWidth(0.75).strokeColor(pillStroke).stroke();
    doc.circle(273, 21.75, 2.3).fill(pillDot);
    doc.font("Helvetica-Bold").fontSize(5.5).fillColor(pillFg).text(statusLabel, 279, 19.2, {
      width: 62,
      ellipsis: true,
      characterSpacing: 0.2,
    });

    // 3. Upper Hero Row: Smart Chip + Contactless Waves + Pharmacy Name + Seal/Logo
    drawSmartEmvChip(doc, 16, 56, 28, 20);
    drawContactlessWaves(doc, 49, 66);

    const heroFontSize = pharmacyName.length > 26 ? 9.8 : 11.2;
    doc.font("Helvetica-Bold").fontSize(heroFontSize).fillColor("#FFFFFF").text(pharmacyName, 67, 55, {
      width: 228,
      height: 14,
      ellipsis: true,
    });

    const locationStr = `${address}${city ? ` · ${city}` : ""}`;
    doc.font("Helvetica").fontSize(6.6).fillColor("#A7F3D0").text(locationStr, 67, 69.5, {
      width: 226,
      height: 11,
      ellipsis: true,
    });

    // Pharmacy Custom Logo or Executive Initial Crest on right
    const crestX = 305;
    const crestY = 53;
    const crestSize = 39;
    let renderedCustomLogo = false;
    if (customLogoBuffer) {
      try {
        doc.roundedRect(crestX, crestY, crestSize, crestSize, 7).fill("#FFFFFF");
        doc.roundedRect(crestX, crestY, crestSize, crestSize, 7).lineWidth(0.9).strokeColor("#10B981").stroke();
        doc.image(customLogoBuffer, crestX + 3, crestY + 3, {
          fit: [crestSize - 6, crestSize - 6],
          align: "center",
          valign: "center",
        });
        renderedCustomLogo = true;
      } catch {
        renderedCustomLogo = false;
      }
    }
    if (!renderedCustomLogo) {
      doc.roundedRect(crestX, crestY, crestSize, crestSize, 7).fill("#064E3B");
      doc.roundedRect(crestX, crestY, crestSize, crestSize, 7).lineWidth(0.9).strokeColor("#10B981").stroke();
      doc
        .roundedRect(crestX + 2.5, crestY + 2.5, crestSize - 5, crestSize - 5, 5)
        .lineWidth(0.4)
        .strokeColor("#6EE7B7")
        .stroke();
      const initials = getPharmacyInitials(pharmacyName);
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#ECFDF5").text(initials, crestX, crestY + 10.5, {
        width: crestSize,
        align: "center",
      });
      doc.font("Helvetica-Bold").fontSize(4.3).fillColor("#6EE7B7").text("PHARMACY", crestX, crestY + 26.5, {
        width: crestSize,
        align: "center",
        characterSpacing: 0.4,
      });
    }

    // Subtle divider between hero and credential fields
    doc.save();
    doc.opacity(0.28);
    doc.moveTo(16, 97).lineTo(W - 16, 97).lineWidth(0.6).strokeColor("#34D399").stroke();
    doc.restore();

    // 4. Two-Row Credential Details Block
    // Row 1: Registered Proprietor & Digital License Key
    doc.font("Helvetica-Bold").fontSize(5.3).fillColor("#6EE7B7").text("PROPRIETOR / OWNER", 16, 103, {
      characterSpacing: 0.45,
    });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text(ownerName, 16, 112, {
      width: 178,
      height: 14,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(5.3).fillColor("#6EE7B7").text("DIGITAL LICENSE KEY", 204, 103, {
      characterSpacing: 0.45,
    });
    doc.roundedRect(204, 111.5, 140, 15.5, 3.5).fill("#021913");
    doc.roundedRect(204, 111.5, 140, 15.5, 3.5).lineWidth(0.6).strokeColor("#059669").stroke();
    doc.font("Courier-Bold").fontSize(7.5).fillColor("#34D399").text(licenseKey, 209, 115.8, {
      width: 130,
      height: 10,
      ellipsis: true,
      align: "center",
    });

    // Row 2: Contact Phone, Authorized Plan, Active Seats & ID
    doc.font("Helvetica-Bold").fontSize(5.3).fillColor("#6EE7B7").text("CONTACT PHONE", 16, 138, {
      characterSpacing: 0.45,
    });
    doc.font("Helvetica-Bold").fontSize(7.8).fillColor("#ECFDF5").text(phone, 16, 147, {
      width: 98,
      height: 11,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(5.3).fillColor("#6EE7B7").text("AUTHORIZED PLAN", 120, 138, {
      characterSpacing: 0.45,
    });
    doc.font("Helvetica-Bold").fontSize(7.8).fillColor("#ECFDF5").text(planName, 120, 147, {
      width: 120,
      height: 11,
      ellipsis: true,
    });

    doc.font("Helvetica-Bold").fontSize(5.3).fillColor("#6EE7B7").text("PORTAL PASS ID", 248, 138, {
      characterSpacing: 0.45,
    });
    doc.font("Courier-Bold").fontSize(7.5).fillColor("#A7F3D0").text(`#${cardCode} · ${seatLabel}`, 248, 147, {
      width: 96,
      height: 11,
      ellipsis: true,
    });

    // 5. Sleek Obsidian-Emerald Executive Footer
    doc.rect(0, FOOTER_Y, W, FOOTER_H).fill("#021510");
    doc.save();
    doc.opacity(0.6);
    doc.moveTo(0, FOOTER_Y).lineTo(W, FOOTER_Y).lineWidth(0.7).strokeColor("#059669").stroke();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(5.8).fillColor("#FFFFFF").text("AIVRASOL HEALTHCARE TECHNOLOGIES", 16, FOOTER_Y + 9, {
      characterSpacing: 0.4,
    });
    doc.font("Helvetica").fontSize(5.3).fillColor("#6EE7B7").text("Verified Digital Proprietor Credential  •  www.aivrasol.com", 16, FOOTER_Y + 18.5);
    doc.font("Helvetica").fontSize(5.0).fillColor("#94A3B8").text(`Issued ${issuedDate}  •  Cloud Integrity Verified`, 16, FOOTER_Y + 27.5);

    // Authorized Handwritten Signature Stroke on Bottom Right
    drawWhiteEmeraldSignature(doc, 265, FOOTER_Y + 3, 0.34);
    doc.save();
    doc.opacity(0.55);
    doc.moveTo(260, FOOTER_Y + 25.5).lineTo(344, FOOTER_Y + 25.5).lineWidth(0.55).strokeColor("#34D399").stroke();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(4.7).fillColor("#A7F3D0").text("AUTHORIZED SIGNATORY", 260, FOOTER_Y + 29, {
      width: 84,
      align: "center",
      characterSpacing: 0.35,
    });

    // Crisp outer emerald border frame
    doc.rect(0.5, 0.5, W - 1, H - 1).lineWidth(1).strokeColor("#059669").stroke();

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
