import PDFDocument from "pdfkit";
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";
import "pdfkit/standard-fonts/HelveticaOblique";
import "pdfkit/standard-fonts/HelveticaBoldOblique";
import "pdfkit/standard-fonts/Courier";
import "pdfkit/standard-fonts/CourierBold";
import fs from "fs";
import path from "path";
import { VOUCHER_LOGO_BASE64 } from "./voucher-logo-data";

const ABDULREHMAN_SIGNATURE_PATHS = {
  mainStroke:
    "M 16 44 C 21 20, 31 6, 38 8 C 44 10, 39 34, 34 44 C 33 46, 42 26, 49 23 C 54 21, 52 36, 57 36 C 62 36, 67 11, 63 9 C 59 7, 56 35, 64 36 C 70 37, 75 23, 72 21 C 68 19, 67 35, 74 36 C 79 36, 82 26, 85 35 C 88 36, 94 11, 90 9 C 86 7, 84 35, 92 36 C 96 25, 102 24, 105 34 C 108 35, 114 24, 110 22 C 106 20, 105 35, 113 35 C 118 35, 124 10, 120 8 C 116 6, 115 35, 121 35 C 125 25, 129 25, 132 35 C 135 25, 140 25, 143 34 C 146 25, 151 25, 154 34 C 158 35, 164 24, 160 22 C 156 20, 155 35, 163 35 C 168 25, 173 25, 177 34 C 181 25, 187 26, 192 35 C 197 37, 206 31, 214 22",
  crossAndFlourish:
    "M 12 27 C 46 22, 92 19, 134 17 M 22 49 C 72 41, 146 38, 208 41 C 216 42, 188 49, 154 52",
  dots: "M 172 54 L 175 54 M 183 53 L 186 53",
};

export function drawAbdulrehmanSignaturePdf(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  scale = 0.78
) {
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc.lineCap("round").lineJoin("round");
  doc
    .path(ABDULREHMAN_SIGNATURE_PATHS.mainStroke)
    .lineWidth(2.1)
    .strokeColor("#0F172A")
    .stroke();
  doc
    .path(ABDULREHMAN_SIGNATURE_PATHS.crossAndFlourish)
    .lineWidth(1.6)
    .strokeColor("#009A4D")
    .stroke();
  doc
    .path(ABDULREHMAN_SIGNATURE_PATHS.dots)
    .lineWidth(2.4)
    .strokeColor("#009A4D")
    .stroke();
  doc.restore();
}

export function getAivraSolLogoBuffer(): Buffer {
  const logoPath = path.join(process.cwd(), "public", "logo-aivrasol-voucher.png");
  try {
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath);
    }
  } catch {
    // Fallback to embedded base64
  }
  return Buffer.from(VOUCHER_LOGO_BASE64, "base64");
}

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

function statusDisplay(status: string): {
  label: string;
  bg: string;
  fg: string;
} {
  switch (status) {
    case "paid":
      return { label: "PAID", bg: "#DCFCE7", fg: "#15803D" };
    case "partially_paid":
      return { label: "PARTIALLY PAID", bg: "#FEF3C7", fg: "#B45309" };
    case "payment_pending":
      return { label: "PAYMENT PENDING", bg: "#FEE2E2", fg: "#B91C1C" };
    case "unpaid":
      return { label: "UNPAID (EXTENSION ONLY)", bg: "#F1F5F9", fg: "#475569" };
    default:
      return { label: (status || "UNPAID").toUpperCase(), bg: "#F1F5F9", fg: "#475569" };
  }
}

/**
 * Generates an on-demand A4 PDF Buffer for an AivraSol Subscription & License Renewal Voucher.
 * Does NOT write to R2 or MongoDB.
 */
export async function generateRenewalVoucherPdfBuffer(
  voucher: any
): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks: Buffer[] = [];

  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = 595.28;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const currency =
    voucher.financial_snapshot?.currency || voucher.currency || "PKR";

  const logoBuffer = getAivraSolLogoBuffer();

  // 0. Centered Full AivraSol Light Watermark Behind Voucher Content
  try {
    doc.save();
    doc.opacity(0.055);
    doc.image(logoBuffer, (pageWidth - 330) / 2, 240, { width: 330 });
    doc.opacity(1);
    doc.restore();
  } catch {
    // Ignore watermark error if any
  }

  // Top Emerald Brand Bar
  doc.rect(0, 0, pageWidth, 8).fill("#009A4D");

  // Left Header: Large AivraSol Logo on clean white background (no extra subtitle text)
  try {
    doc.image(logoBuffer, margin - 12, 12, { width: 102 });
  } catch {
    // Ignore if image fails
  }

  // Right Header: Voucher Title & Meta
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("AivraSol Subscription & License Renewal Voucher", margin, 26, {
      align: "right",
      width: contentWidth,
    });
  doc
    .fillColor("#64748B")
    .font("Helvetica")
    .fontSize(8.5)
    .text("Official Payment & License Extension Confirmation", margin, 43, {
      align: "right",
      width: contentWidth,
    });

  const voucherNo =
    voucher.voucher_number || voucher.invoice_number || voucher.id;
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(`Voucher #: ${voucherNo}`, margin, 60, {
      align: "right",
      width: contentWidth,
    });
  doc
    .fillColor("#64748B")
    .font("Helvetica")
    .fontSize(8.5)
    .text(`Issued: ${fmtDateTime(voucher.issued_at)}`, margin, 74, {
      align: "right",
      width: contentWidth,
    });

  // Payment Status Badge
  const st = statusDisplay(voucher.status);
  const badgeWidth = 145;
  const badgeX = pageWidth - margin - badgeWidth;
  doc.roundedRect(badgeX, 90, badgeWidth, 18, 4).fill(st.bg);
  doc
    .fillColor(st.fg)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(st.label, badgeX, 95, { width: badgeWidth, align: "center" });

  // Divider
  let y = 118;
  doc
    .moveTo(margin, y)
    .lineTo(pageWidth - margin, y)
    .strokeColor("#E2E8F0")
    .lineWidth(1)
    .stroke();

  y += 12;

  // Two-column Issuer vs License Holder box (semi-transparent so watermark shows softly)
  const colWidth = (contentWidth - 16) / 2;
  doc.save();
  doc.fillOpacity(0.68);
  doc.roundedRect(margin, y, colWidth, 84, 6).fill("#F8FAFC");
  doc.roundedRect(margin + colWidth + 16, y, colWidth, 84, 6).fill("#F8FAFC");
  doc.restore();
  doc.roundedRect(margin, y, colWidth, 84, 6).strokeColor("#E2E8F0").lineWidth(0.75).stroke();
  doc
    .roundedRect(margin + colWidth + 16, y, colWidth, 84, 6)
    .strokeColor("#E2E8F0")
    .lineWidth(0.75)
    .stroke();

  // Issuer
  doc
    .fillColor("#009A4D")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("ISSUED BY (PROVIDER)", margin + 12, y + 10);
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(
      voucher.seller_snapshot?.name || "AivraSol Technologies (Mediqoo)",
      margin + 12,
      y + 24
    );
  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Email: ${voucher.seller_snapshot?.email || "support@aivrasol.com"}`,
      margin + 12,
      y + 40
    )
    .text(
      `Website: ${voucher.seller_snapshot?.website || "www.aivrasol.com"}`,
      margin + 12,
      y + 53
    )
    .text(
      `Location: ${voucher.seller_snapshot?.address || "Pakistan"}`,
      margin + 12,
      y + 66
    );

  // Pharmacy / License Holder
  const rightX = margin + colWidth + 28;
  doc
    .fillColor("#009A4D")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PHARMACY / LICENSE HOLDER", rightX, y + 10);
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(voucher.client_snapshot?.name || "Pharmacy Client", rightX, y + 24);
  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Owner / Contact: ${voucher.client_snapshot?.contact_name || "—"}`,
      rightX,
      y + 40
    )
    .text(
      `Phone / Email: ${
        [voucher.client_snapshot?.phone, voucher.client_snapshot?.email]
          .filter(Boolean)
          .join(" • ") || "—"
      }`,
      rightX,
      y + 53
    )
    .text(
      `Tenant ID: ${voucher.client_snapshot?.id || voucher.client_id || "—"}`,
      rightX,
      y + 66
    );

  y += 98;

  // Section: Subscription & License Details
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("SUBSCRIPTION & LICENSE ENTITLEMENT DETAILS", margin, y);
  y += 15;

  doc.roundedRect(margin, y, contentWidth, 88, 6).strokeColor("#E2E8F0").lineWidth(0.75).stroke();

  const lic = voucher.license_snapshot || {};
  const per = voucher.period_snapshot || {};

  const drawGridPair = (
    label1: string,
    val1: string,
    label2: string,
    val2: string,
    rowY: number
  ) => {
    doc
      .fillColor("#64748B")
      .font("Helvetica")
      .fontSize(8.5)
      .text(label1, margin + 12, rowY);
    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(val1, margin + 115, rowY);

    doc
      .fillColor("#64748B")
      .font("Helvetica")
      .fontSize(8.5)
      .text(label2, margin + colWidth + 16, rowY);
    doc
      .fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(val2, margin + colWidth + 125, rowY);
  };

  drawGridPair(
    "Product:",
    lic.product_name || "AivraSol Pharmacy POS",
    "Previous Expiry:",
    per.previous_expiry ? fmtDate(per.previous_expiry) : "Initial / None",
    y + 11
  );
  drawGridPair(
    "License Key:",
    lic.license_key_masked || lic.license_key || "—",
    "New Expiry:",
    per.is_lifetime
      ? "Lifetime / Never"
      : per.new_expiry
      ? fmtDate(per.new_expiry)
      : fmtDate(voucher.new_expiry),
    y + 29
  );
  drawGridPair(
    "Billing Plan:",
    lic.plan_label ||
      (lic.billing_model === "per_invoice"
        ? "Pay Per Invoice"
        : "Fixed Subscription"),
    "Extension Duration:",
    per.extension_duration_label || "Standard Cycle",
    y + 47
  );
  drawGridPair(
    "Allowed Terminals:",
    `${lic.allowed_seats || 1} POS Seat(s)`,
    "Status After Action:",
    lic.status_after_renewal || "Active",
    y + 65
  );

  y += 102;

  // Section: Financial Breakdown
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("FINANCIAL BREAKDOWN", margin, y);
  y += 15;

  const fin = voucher.financial_snapshot || {
    plan_charge: voucher.subtotal || 0,
    usage_invoice_count: 0,
    usage_rate: 0,
    invoice_overage_charge: 0,
    arrears_included: 0,
    subtotal: voucher.subtotal || 0,
    discount: voucher.discount || 0,
    tax: voucher.tax || 0,
    total_payable: voucher.total_due || 0,
    amount_paid: voucher.amount_paid || 0,
    remaining_balance: voucher.balance || 0,
  };

  // Table Header
  doc.rect(margin, y, contentWidth, 21).fill("#0F172A");
  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("DESCRIPTION", margin + 12, y + 6.5)
    .text("AMOUNT", margin, y + 6.5, {
      align: "right",
      width: contentWidth - 12,
    });
  y += 21;

  const drawFinRow = (
    desc: string,
    amt: string,
    bold = false,
    highlightBg?: string,
    textColor = "#0F172A"
  ) => {
    if (highlightBg) {
      doc.save();
      doc.fillOpacity(0.7);
      doc.rect(margin, y, contentWidth, 21).fill(highlightBg);
      doc.restore();
    }
    doc
      .fillColor(textColor)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .text(desc, margin + 12, y + 6)
      .text(amt, margin, y + 6, {
        align: "right",
        width: contentWidth - 12,
      });
    doc
      .moveTo(margin, y + 21)
      .lineTo(pageWidth - margin, y + 21)
      .strokeColor("#E2E8F0")
      .lineWidth(0.5)
      .stroke();
    y += 21;
  };

  if (lic.billing_model === "per_invoice") {
    drawFinRow(
      `Metered POS Invoice Usage (${fin.usage_invoice_count || 0} invoices @ ${fmtMoney(
        currency,
        fin.usage_rate || 0
      )}/invoice)`,
      fmtMoney(currency, fin.invoice_overage_charge || fin.subtotal || 0)
    );
  } else {
    drawFinRow(
      `Subscription Plan Charge (${lic.plan_label || "Standard Cycle"})`,
      fmtMoney(currency, fin.plan_charge || 0)
    );
  }

  if (Number(fin.arrears_included || 0) > 0) {
    drawFinRow(
      "Previous Unpaid Arrears / Balance Included",
      fmtMoney(currency, fin.arrears_included)
    );
  }

  drawFinRow("Subtotal", fmtMoney(currency, fin.subtotal || 0));

  if (Number(fin.discount || 0) > 0) {
    drawFinRow("Discount / Waiver", `- ${fmtMoney(currency, fin.discount)}`);
  }
  if (Number(fin.tax || 0) > 0) {
    drawFinRow("Tax", fmtMoney(currency, fin.tax));
  }

  drawFinRow(
    "Total Payable",
    fmtMoney(currency, fin.total_payable ?? voucher.total_due ?? 0),
    true,
    "#F8FAFC"
  );
  drawFinRow(
    "Amount Paid",
    fmtMoney(currency, fin.amount_paid ?? voucher.amount_paid ?? 0),
    true,
    "#ECFDF5",
    "#009A4D"
  );
  drawFinRow(
    "Remaining Balance",
    fmtMoney(currency, fin.remaining_balance ?? voucher.balance ?? 0),
    true,
    Number(fin.remaining_balance ?? voucher.balance ?? 0) > 0
      ? "#FEF2F2"
      : "#F8FAFC",
    Number(fin.remaining_balance ?? voucher.balance ?? 0) > 0
      ? "#DC2626"
      : "#0F172A"
  );

  y += 14;

  // Section: Payment & Processing Details
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("PAYMENT & SETTLEMENT RECORD", margin, y);
  y += 14;

  const pay = voucher.payment_snapshot || {};
  doc.save();
  doc.fillOpacity(0.68);
  doc.roundedRect(margin, y, contentWidth, 68, 6).fill("#F8FAFC");
  doc.restore();
  doc.roundedRect(margin, y, contentWidth, 68, 6).strokeColor("#E2E8F0").lineWidth(0.75).stroke();

  drawGridPair(
    "Payment Method:",
    pay.payment_method || voucher.payment_method || "—",
    "Payment Date:",
    pay.paid_at ? fmtDateTime(pay.paid_at) : "No Payment Recorded",
    y + 11
  );
  drawGridPair(
    "Reference / Tx ID:",
    pay.transaction_reference || voucher.payment_reference || "—",
    "Processed By:",
    pay.processed_by || "Super Admin",
    y + 29
  );
  drawGridPair(
    "Remarks / Notes:",
    (pay.notes || "—").slice(0, 50),
    "Verification Hash:",
    voucher.verification_hash || "—",
    y + 47
  );

  // Digital Verification & Handwritten Verified Signature Block
  const sigBlockY = 695;
  doc
    .fillColor("#009A4D")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("DIGITAL VERIFICATION RECORD", margin, sigBlockY + 14);
  doc
    .fillColor("#334155")
    .font("Courier-Bold")
    .fontSize(8.5)
    .text(`Hash: ${voucher.verification_hash || voucherNo}`, margin, sigBlockY + 26);
  doc
    .fillColor("#64748B")
    .font("Helvetica")
    .fontSize(8)
    .text("support@aivrasol.com • www.aivrasol.com", margin, sigBlockY + 38);

  // Right-side Handwritten Verified Signature (Abdulrehman graphic stroke)
  const sigBoxWidth = 185;
  const sigBoxX = pageWidth - margin - sigBoxWidth;
  drawAbdulrehmanSignaturePdf(doc, sigBoxX + 4, sigBlockY - 6, 0.78);

  doc
    .moveTo(sigBoxX, sigBlockY + 38)
    .lineTo(sigBoxX + sigBoxWidth, sigBlockY + 38)
    .strokeColor("#334155")
    .lineWidth(1)
    .stroke();
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("Authorized & Verified Signature", sigBoxX, sigBlockY + 42, {
      width: sigBoxWidth,
      align: "center",
    });
  doc
    .fillColor("#009A4D")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("AivraSol Billing & Licensing Authority", sigBoxX, sigBlockY + 53, {
      width: sigBoxWidth,
      align: "center",
    });

  // Footer & Non-Banking Digital Receipt Disclaimer
  const footerY = 766;
  doc
    .roundedRect(margin, footerY, contentWidth, 28, 4)
    .fillAndStroke("#F8FAFC", "#CBD5E1");

  doc
    .fillColor("#475569")
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      "Disclaimer: This payment voucher is a digital receipt issued by AivraSol for subscription and license verification only and is not valid for banking, tax, or official financial institution purposes.",
      margin + 10,
      footerY + 7,
      { align: "center", width: contentWidth - 20 }
    );

  doc.end();
  return pdfPromise;
}
