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
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  const chunks: Buffer[] = [];

  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = 595.28;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const currency =
    voucher.financial_snapshot?.currency || voucher.currency || "PKR";

  // Top Emerald Brand Bar
  doc.rect(0, 0, pageWidth, 8).fill("#009A4D");

  // Left Header: Large AivraSol Logo on clean white background (no subtitle text)
  const logoPath = path.join(process.cwd(), "public", "logo-aivrasol-voucher.png");
  try {
    const logoSource = fs.existsSync(logoPath)
      ? fs.readFileSync(logoPath)
      : Buffer.from(VOUCHER_LOGO_BASE64, "base64");
    doc.image(logoSource, margin - 12, 12, { width: 102 });
  } catch {
    try {
      doc.image(Buffer.from(VOUCHER_LOGO_BASE64, "base64"), margin - 12, 12, { width: 102 });
    } catch {
      // Ignore if image fails
    }
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
  let y = 120;
  doc
    .moveTo(margin, y)
    .lineTo(pageWidth - margin, y)
    .strokeColor("#E2E8F0")
    .lineWidth(1)
    .stroke();

  y += 14;

  // Two-column Issuer vs License Holder box
  const colWidth = (contentWidth - 16) / 2;
  doc.roundedRect(margin, y, colWidth, 86, 6).fill("#F8FAFC");
  doc.roundedRect(margin + colWidth + 16, y, colWidth, 86, 6).fill("#F8FAFC");

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

  y += 102;

  // Section: Subscription & License Details
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("SUBSCRIPTION & LICENSE ENTITLEMENT DETAILS", margin, y);
  y += 16;

  doc.roundedRect(margin, y, contentWidth, 92, 6).strokeColor("#E2E8F0").stroke();

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
    y + 12
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
    y + 30
  );
  drawGridPair(
    "Billing Plan:",
    lic.plan_label ||
      (lic.billing_model === "per_invoice"
        ? "Pay Per Invoice"
        : "Fixed Subscription"),
    "Extension Duration:",
    per.extension_duration_label || "Standard Cycle",
    y + 48
  );
  drawGridPair(
    "Allowed Terminals:",
    `${lic.allowed_seats || 1} POS Seat(s)`,
    "Status After Action:",
    lic.status_after_renewal || "Active",
    y + 66
  );

  y += 108;

  // Section: Financial Breakdown
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("FINANCIAL BREAKDOWN", margin, y);
  y += 16;

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
  doc.rect(margin, y, contentWidth, 22).fill("#0F172A");
  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("DESCRIPTION", margin + 12, y + 7)
    .text("AMOUNT", margin, y + 7, {
      align: "right",
      width: contentWidth - 12,
    });
  y += 22;

  const drawFinRow = (
    desc: string,
    amt: string,
    bold = false,
    highlightBg?: string,
    textColor = "#0F172A"
  ) => {
    if (highlightBg) {
      doc.rect(margin, y, contentWidth, 22).fill(highlightBg);
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
      .moveTo(margin, y + 22)
      .lineTo(pageWidth - margin, y + 22)
      .strokeColor("#E2E8F0")
      .lineWidth(0.5)
      .stroke();
    y += 22;
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

  y += 16;

  // Section: Payment & Processing Details
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("PAYMENT & SETTLEMENT RECORD", margin, y);
  y += 14;

  const pay = voucher.payment_snapshot || {};
  doc.roundedRect(margin, y, contentWidth, 72, 6).fill("#F8FAFC");

  drawGridPair(
    "Payment Method:",
    pay.payment_method || voucher.payment_method || "—",
    "Payment Date:",
    pay.paid_at ? fmtDateTime(pay.paid_at) : "No Payment Recorded",
    y + 12
  );
  drawGridPair(
    "Reference / Tx ID:",
    pay.transaction_reference || voucher.payment_reference || "—",
    "Processed By:",
    pay.processed_by || "Super Admin",
    y + 30
  );
  drawGridPair(
    "Remarks / Notes:",
    (pay.notes || "—").slice(0, 50),
    "Verification Hash:",
    voucher.verification_hash || "—",
    y + 48
  );

  // Footer
  const footerY = 765;
  doc
    .moveTo(margin, footerY)
    .lineTo(pageWidth - margin, footerY)
    .strokeColor("#E2E8F0")
    .lineWidth(1)
    .stroke();

  doc
    .fillColor("#64748B")
    .font("Helvetica")
    .fontSize(8)
    .text(
      "This is an official computer-generated AivraSol Subscription & License Renewal Voucher and does not require a physical signature.",
      margin,
      footerY + 10,
      { align: "center", width: contentWidth }
    )
    .text(
      `Verification ID: ${voucher.verification_hash || voucherNo} • AivraSol Technologies (support@aivrasol.com | www.aivrasol.com)`,
      margin,
      footerY + 23,
      { align: "center", width: contentWidth }
    );

  doc.end();
  return pdfPromise;
}

