import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import PDFDocument from "pdfkit";
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";
import "pdfkit/standard-fonts/Courier";
import "pdfkit/standard-fonts/CourierBold";
import connectToDatabase from "@/lib/db";
import LicensePayment from "@/models/LicensePayment";
import License from "@/models/License";
import Client from "@/models/Client";
import Project from "@/models/Project";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import {
  drawAbdulrehmanSignaturePdf,
  getAivraSolLogoBuffer,
} from "@/lib/renewal-voucher-pdf";

export const runtime = "nodejs";

function fmtDate(d: any): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtDateTime(d: any): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtMoney(currency: string, n: any): string {
  const val = Number(n || 0);
  return `${currency || "PKR"} ${val.toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const sp = req.nextUrl.searchParams;
    const preset = sp.get("preset") || "all";
    const fromStr = sp.get("from") || "";
    const toStr = sp.get("to") || "";
    const clientId = sp.get("clientId") || "all";
    const method = sp.get("method") || "all";
    const search = (sp.get("q") || "").trim().toLowerCase();

    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let periodLabel = "All Recorded History";

    if (preset === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      periodLabel = `Today (${fmtDate(startDate)})`;
    } else if (preset === "7d") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      periodLabel = `Last 7 Days (${fmtDate(startDate)} – ${fmtDate(endDate)})`;
    } else if (preset === "this_month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      periodLabel = `This Month (${fmtDate(startDate)} – ${fmtDate(endDate)})`;
    } else if (preset === "last_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      periodLabel = `Last Month (${fmtDate(startDate)} – ${fmtDate(endDate)})`;
    } else if (preset === "this_year") {
      startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      periodLabel = `This Year (${now.getFullYear()})`;
    } else if (preset === "custom" && (fromStr || toStr)) {
      if (fromStr) {
        startDate = new Date(`${fromStr}T00:00:00.000`);
      }
      if (toStr) {
        endDate = new Date(`${toStr}T23:59:59.999`);
      }
      periodLabel = `${fromStr ? fmtDate(startDate) : "Beginning"} – ${
        toStr ? fmtDate(endDate) : "Present"
      }`;
    }

    const [rawPayments, licenses, clients, projects, vouchers] = await Promise.all([
      LicensePayment.find({}).sort({ paid_at: -1 }).lean(),
      License.find({}).lean(),
      Client.find({}).lean(),
      Project.find({}).lean(),
      LicenseRenewalInvoice.find({}).lean(),
    ]);

    const licenseMap = new Map<string, any>();
    for (const l of licenses as any[]) licenseMap.set(l.id, l);

    const clientMap = new Map<string, any>();
    for (const c of clients as any[]) clientMap.set(c.id, c);

    const projectMap = new Map<string, any>();
    for (const p of projects as any[]) projectMap.set(p.id, p);

    const voucherByPaymentId = new Map<string, any>();
    for (const v of vouchers as any[]) {
      if (v.payment_id) voucherByPaymentId.set(v.payment_id, v);
    }

    const enriched = (rawPayments as any[])
      .filter((p) => Number(p.amount_paid || 0) > 0)
      .map((p) => {
        const lic = licenseMap.get(p.license_id);
        const cli = clientMap.get(p.client_id || lic?.client_id);
        const proj = projectMap.get(lic?.project_id);
        const linkedVoucher = voucherByPaymentId.get(p.id);
        const paidAt = p.paid_at ? new Date(p.paid_at) : new Date(p.created_at);

        return {
          id: p.id,
          paid_at: paidAt,
          receipt_number:
            linkedVoucher?.voucher_number ||
            linkedVoucher?.invoice_number ||
            p.receipt_number ||
            `AV-RNW-${String(p.id).slice(0, 8).toUpperCase()}`,
          client_id: p.client_id || lic?.client_id || "",
          client_name: cli?.name || "Pharmacy Client",
          contact_name: cli?.contact_name || "",
          project_name: proj?.name || "AivraSol Pharmacy POS",
          billing_model:
            lic?.billing?.model === "per_invoice" ? "Per Invoice" : "Fixed Plan",
          payment_method: p.payment_method || "Bank Transfer",
          payment_reference: p.payment_reference || "—",
          currency: p.currency || lic?.billing?.currency || "PKR",
          amount_paid: Number(p.amount_paid || 0),
          recorded_by: p.recorded_by || "Super Admin",
          notes: p.notes || "",
        };
      })
      .filter((row) => {
        if (startDate && row.paid_at < startDate) return false;
        if (endDate && row.paid_at > endDate) return false;
        if (clientId !== "all" && row.client_id !== clientId) return false;
        if (
          method !== "all" &&
          row.payment_method.toLowerCase() !== method.toLowerCase()
        ) {
          return false;
        }
        if (search) {
          const hay = `${row.client_name} ${row.contact_name} ${row.project_name} ${row.receipt_number} ${row.payment_reference} ${row.payment_method}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

    // Aggregate totals
    let totalAmount = 0;
    let bankAndDigitalAmount = 0;
    let cashAmount = 0;
    const currency = enriched[0]?.currency || "PKR";

    for (const r of enriched) {
      totalAmount += r.amount_paid;
      if (r.payment_method.toLowerCase().includes("cash")) {
        cashAmount += r.amount_paid;
      } else {
        bankAndDigitalAmount += r.amount_paid;
      }
    }

    const doc = new PDFDocument({ margin: 36, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const pageWidth = 595.28;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const logoBuffer = getAivraSolLogoBuffer();

    const drawPageDecorations = () => {
      // Top Emerald Brand Bar
      doc.rect(0, 0, pageWidth, 8).fill("#009A4D");
      // Light Centered Watermark
      try {
        doc.save();
        doc.opacity(0.045);
        doc.image(logoBuffer, (pageWidth - 320) / 2, 250, { width: 320 });
        doc.opacity(1);
        doc.restore();
      } catch {
        // Ignore watermark error
      }
    };

    drawPageDecorations();

    // Header Logo on White Background
    try {
      doc.image(logoBuffer, margin - 10, 12, { width: 98 });
    } catch {
      // Ignore logo error
    }

    const stmtNo = `AV-STMT-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(
      enriched.length
    ).padStart(3, "0")}`;

    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("OFFICIAL STATEMENT OF RECORDED PAYMENTS", margin, 24, {
        align: "right",
        width: contentWidth,
      });
    doc
      .fillColor("#009A4D")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(
        "CERTIFIED PROOF OF PAYMENT LEDGER FOR BANKING, TAX & AUDIT PURPOSES",
        margin,
        41,
        {
          align: "right",
          width: contentWidth,
        }
      );
    doc
      .fillColor("#334155")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`Statement Ref: ${stmtNo}`, margin, 56, {
        align: "right",
        width: contentWidth,
      });
    doc
      .fillColor("#64748B")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Reporting Period: ${periodLabel}  •  Generated: ${fmtDateTime(now)}`,
        margin,
        70,
        {
          align: "right",
          width: contentWidth,
        }
      );

    // Verified Banking Badge
    const badgeW = 190;
    const badgeX = pageWidth - margin - badgeW;
    doc.roundedRect(badgeX, 85, badgeW, 17, 4).fill("#DCFCE7");
    doc
      .fillColor("#15803D")
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text("VERIFIED PROOF OF PAYMENT RECORD", badgeX, 90, {
        width: badgeW,
        align: "center",
      });

    let y = 114;
    doc
      .moveTo(margin, y)
      .lineTo(pageWidth - margin, y)
      .strokeColor("#E2E8F0")
      .lineWidth(1)
      .stroke();

    y += 12;

    // 4 Executive Summary Cards
    const cardGap = 10;
    const cardW = (contentWidth - cardGap * 3) / 4;
    const summaryCards = [
      {
        label: "VERIFIED TRANSACTIONS",
        value: `${enriched.length} Payment(s)`,
        sub: "Settled in ledger",
        color: "#0F172A",
      },
      {
        label: "TOTAL SETTLED VOLUME",
        value: fmtMoney(currency, totalAmount),
        sub: "Gross verified receipts",
        color: "#009A4D",
      },
      {
        label: "BANK & DIGITAL TRANSFERS",
        value: fmtMoney(currency, bankAndDigitalAmount),
        sub: "Bank / Online / Cheque",
        color: "#1D4ED8",
      },
      {
        label: "CASH COLLECTIONS",
        value: fmtMoney(currency, cashAmount),
        sub: "Direct cash receipts",
        color: "#0F172A",
      },
    ];

    summaryCards.forEach((c, idx) => {
      const cx = margin + idx * (cardW + cardGap);
      doc.save();
      doc.fillOpacity(0.75);
      doc.roundedRect(cx, y, cardW, 54, 5).fill("#F8FAFC");
      doc.restore();
      doc.roundedRect(cx, y, cardW, 54, 5).strokeColor("#E2E8F0").lineWidth(0.75).stroke();

      doc
        .fillColor("#64748B")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(c.label, cx + 8, y + 8, { width: cardW - 16 });
      doc
        .fillColor(c.color)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(c.value, cx + 8, y + 21, { width: cardW - 16 });
      doc
        .fillColor("#94A3B8")
        .font("Helvetica")
        .fontSize(7)
        .text(c.sub, cx + 8, y + 38, { width: cardW - 16 });
    });

    y += 66;

    // Provider & Filter Scope Bar
    doc.save();
    doc.fillOpacity(0.75);
    doc.roundedRect(margin, y, contentWidth, 34, 5).fill("#F1F5F9");
    doc.restore();
    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        "CERTIFYING ENTITY: AivraSol Technologies (Mediqoo Cloud)  •  support@aivrasol.com  •  www.aivrasol.com",
        margin + 10,
        y + 7
      );
    doc
      .fillColor("#475569")
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        `Statement Scope: Period = ${periodLabel}   |   Payment Method = ${
          method === "all" ? "All Methods" : method
        }   |   Client Filter = ${clientId === "all" ? "All Clients" : clientId}`,
        margin + 10,
        y + 19
      );

    y += 46;

    // Table Columns Definition
    const cols = [
      { label: "#", x: margin + 6, w: 20, align: "left" as const },
      { label: "DATE", x: margin + 28, w: 62, align: "left" as const },
      { label: "VOUCHER / RECEIPT #", x: margin + 92, w: 105, align: "left" as const },
      { label: "PHARMACY / CLIENT", x: margin + 200, w: 122, align: "left" as const },
      { label: "METHOD & REF", x: margin + 325, w: 105, align: "left" as const },
      { label: "AMOUNT PAID", x: margin + 432, w: contentWidth - 438, align: "right" as const },
    ];

    const drawTableHeader = (topY: number) => {
      doc.rect(margin, topY, contentWidth, 20).fill("#0F172A");
      for (const col of cols) {
        doc
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .text(col.label, col.x, topY + 6, {
            width: col.w,
            align: col.align,
          });
      }
      return topY + 20;
    };

    y = drawTableHeader(y);

    if (enriched.length === 0) {
      doc
        .roundedRect(margin, y, contentWidth, 40, 4)
        .strokeColor("#E2E8F0")
        .lineWidth(0.75)
        .stroke();
      doc
        .fillColor("#64748B")
        .font("Helvetica")
        .fontSize(9)
        .text(
          "No recorded payments matched the selected date range or filters.",
          margin,
          y + 15,
          { width: contentWidth, align: "center" }
        );
      y += 50;
    } else {
      for (let i = 0; i < enriched.length; i++) {
        const row = enriched[i];
        if (y > 670) {
          doc.addPage();
          drawPageDecorations();
          y = 42;
          y = drawTableHeader(y);
        }

        const rowH = 22;
        if (i % 2 === 1) {
          doc.save();
          doc.fillOpacity(0.55);
          doc.rect(margin, y, contentWidth, rowH).fill("#F8FAFC");
          doc.restore();
        }

        doc
          .fillColor("#64748B")
          .font("Helvetica")
          .fontSize(8)
          .text(String(i + 1), cols[0].x, y + 6.5, { width: cols[0].w });

        doc
          .fillColor("#0F172A")
          .font("Helvetica")
          .fontSize(8)
          .text(fmtDate(row.paid_at), cols[1].x, y + 6.5, { width: cols[1].w });

        doc
          .fillColor("#0F172A")
          .font("Courier-Bold")
          .fontSize(7.5)
          .text(row.receipt_number.slice(0, 22), cols[2].x, y + 6.5, {
            width: cols[2].w,
          });

        doc
          .fillColor("#0F172A")
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(row.client_name.slice(0, 26), cols[3].x, y + 6.5, {
            width: cols[3].w,
          });

        const methodRef =
          row.payment_reference && row.payment_reference !== "—"
            ? `${row.payment_method} (${row.payment_reference.slice(0, 12)})`
            : row.payment_method;
        doc
          .fillColor("#334155")
          .font("Helvetica")
          .fontSize(7.5)
          .text(methodRef, cols[4].x, y + 6.5, { width: cols[4].w });

        doc
          .fillColor("#009A4D")
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .text(fmtMoney(row.currency, row.amount_paid), cols[5].x, y + 6.5, {
            width: cols[5].w,
            align: "right",
          });

        doc
          .moveTo(margin, y + rowH)
          .lineTo(pageWidth - margin, y + rowH)
          .strokeColor("#E2E8F0")
          .lineWidth(0.5)
          .stroke();

        y += rowH;
      }

      // Grand Total Row
      if (y > 685) {
        doc.addPage();
        drawPageDecorations();
        y = 42;
      }
      doc.rect(margin, y, contentWidth, 24).fill("#ECFDF5");
      doc
        .rect(margin, y, contentWidth, 24)
        .strokeColor("#A7F3D0")
        .lineWidth(0.75)
        .stroke();
      doc
        .fillColor("#0F172A")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          `TOTAL VERIFIED PAYMENTS RECEIVED (${enriched.length} Transaction${
            enriched.length === 1 ? "" : "s"
          })`,
          margin + 10,
          y + 7
        );
      doc
        .fillColor("#009A4D")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(fmtMoney(currency, totalAmount), cols[5].x - 30, y + 6.5, {
          width: cols[5].w + 30,
          align: "right",
        });
      y += 34;
    }

    // Ensure enough room for Banking Certification & Signature Block
    if (y > 660) {
      doc.addPage();
      drawPageDecorations();
      y = 50;
    } else {
      y = Math.max(y + 10, 665);
    }

    // Left: Official Banking & Financial Proof Certification Box
    const certBoxW = contentWidth - 205;
    doc.save();
    doc.fillOpacity(0.8);
    doc.roundedRect(margin, y, certBoxW, 74, 6).fill("#F8FAFC");
    doc.restore();
    doc
      .roundedRect(margin, y, certBoxW, 74, 6)
      .strokeColor("#CBD5E1")
      .lineWidth(0.75)
      .stroke();

    doc
      .fillColor("#009A4D")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        "OFFICIAL BANKING, TAX & AUDIT PROOF OF PAYMENT CERTIFICATION",
        margin + 10,
        y + 9
      );
    doc
      .fillColor("#334155")
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        "This Official Statement of Recorded Payments certifies that the transactions listed above have been duly received, verified, and settled in the AivraSol Technologies financial ledger. This document is valid as official proof of payment for banking, financial institution, accounting, and audit purposes.",
        margin + 10,
        y + 22,
        { width: certBoxW - 20, lineGap: 1.5 }
      );

    // Right: Handwritten Verified Signature (Abdulrehman graphic stroke)
    const sigBoxW = 185;
    const sigBoxX = pageWidth - margin - sigBoxW;
    drawAbdulrehmanSignaturePdf(doc, sigBoxX + 4, y - 4, 0.78);

    doc
      .moveTo(sigBoxX, y + 40)
      .lineTo(sigBoxX + sigBoxW, y + 40)
      .strokeColor("#334155")
      .lineWidth(1)
      .stroke();
    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text("Authorized & Verified Signature", sigBoxX, y + 44, {
        width: sigBoxW,
        align: "center",
      });
    doc
      .fillColor("#009A4D")
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text("AivraSol Financial & Licensing Authority", sigBoxX, y + 55, {
        width: sigBoxW,
        align: "center",
      });

    doc.end();
    const pdfBuffer = await pdfPromise;

    const filename = `AivraSol-Proof-Of-Payments-${now
      .toISOString()
      .slice(0, 10)}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to generate payments statement PDF", detail: err.message },
      { status: 500 }
    );
  }
}
