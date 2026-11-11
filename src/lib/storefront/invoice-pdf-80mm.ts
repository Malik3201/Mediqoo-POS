export interface ServerInvoice80mmStorefront {
  id: string;
  pharmacy_id: string;
  slug: string;
  pharmacy_name: string;
  address_line?: string | null;
  city?: string | null;
  contact_phone?: string | null;
  whatsapp_phone?: string | null;
  contact_email?: string | null;
  drug_sale_license_no?: string | null;
  pharmacist_name?: string | null;
  primary_color?: string | null;
  logo_url?: string | null;
  logo_pdf_data_url?: string | null;
  public_url?: string | null;
}

export interface ServerInvoice80mmItem {
  product_name?: string | null;
  product_name_snapshot?: string | null;
  selling_unit_name?: string | null;
  unit_label_snapshot?: string | null;
  unit_label?: string | null;
  qty: number;
  unit_price_pkr?: number | null;
  line_total_pkr: number;
  requires_prescription?: number | boolean | null;
}

export interface ServerInvoice80mmOrder {
  order_number: string;
  pos_invoice_number?: string | null;
  status?: string | null;
  created_at?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  fulfillment_type?: string | null;
  branch_name_snapshot?: string | null;
  delivery_address?: string | null;
  delivery_city?: string | null;
  delivery_instructions?: string | null;
  customer_notes?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  subtotal_pkr?: number | null;
  discount_pkr?: number | null;
  delivery_fee_pkr?: number | null;
  total_pkr: number;
  applied_promo_code?: string | null;
  applied_promo_title?: string | null;
  items?: ServerInvoice80mmItem[];
}

const PAGE_WIDTH_PT = 226.77; // Exact 80mm thermal roll width
const MARGIN_X = 11;
const CONTENT_WIDTH = PAGE_WIDTH_PT - MARGIN_X * 2; // 204.77pt

function formatPkr(amount: number | null | undefined): string {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTimePk(iso?: string | null): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16).replace("T", " ");
    return d.toLocaleString("en-GB", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

function formatPaymentMethod(method?: string | null): string {
  const m = String(method || "cod").toLowerCase();
  if (m === "cod") return "Cash on Delivery (COD)";
  if (m === "counter_pay") return "Pay at Pharmacy Counter";
  if (m === "bank_transfer") return "Bank Transfer / Raast";
  return m.replace(/_/g, " ").toUpperCase();
}

function formatPaymentStatus(status?: string | null): string {
  const s = String(status || "pending_cod").toLowerCase();
  if (s === "paid") return "PAID";
  if (s === "pending_cod") return "COD - Payable on Receipt";
  if (s === "partially_paid") return "Partially Paid";
  if (s === "refunded") return "Refunded";
  return "Unpaid / Pending";
}

function normalizeBrandHex(hex?: string | null): string {
  const c = String(hex || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : "#176B58";
}

export async function generateStorefront80mmInvoicePdfBuffer(params: {
  storefront: ServerInvoice80mmStorefront;
  order: ServerInvoice80mmOrder;
  logoBuffer?: Buffer | null;
}): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const { storefront, order, logoBuffer } = params;
  const brandColor = normalizeBrandHex(storefront.primary_color);
  const items = Array.isArray(order.items) ? order.items : [];

  // Estimate height dynamically so the 80mm receipt renders on a single continuous thermal page
  const addressLineLen = String(order.delivery_address || "").length;
  const notesLen = String(order.customer_notes || "").length + String(order.delivery_instructions || "").length;
  const itemLinesHeight = items.reduce((acc, it) => {
    const nameLen = String(it.product_name_snapshot || it.product_name || "").length;
    const extraNameLines = Math.max(0, Math.ceil(nameLen / 24) - 1);
    return acc + 24 + extraNameLines * 9;
  }, 0);
  const logoExtra = logoBuffer ? 46 : 6;
  const promoExtra = Number(order.discount_pkr || 0) > 0 ? 14 : 0;
  const extraAddr = Math.ceil(addressLineLen / 34) * 10 + Math.ceil(notesLen / 36) * 10;
  const estimatedHeightPt = Math.max(
    360,
    275 + logoExtra + itemLinesHeight + promoExtra + extraAddr
  );

  const doc = new PDFDocument({
    size: [PAGE_WIDTH_PT, estimatedHeightPt],
    margins: { top: 0, bottom: 10, left: MARGIN_X, right: MARGIN_X },
    autoFirstPage: true,
    info: {
      Title: `Invoice ${order.order_number} - ${storefront.pharmacy_name}`,
      Author: storefront.pharmacy_name,
      Creator: "AivraSol Mediqoo Pharmacy POS",
    },
  });

  const chunks: Buffer[] = [];
  const pdfDone = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // 1. Top Brand Accent Bar
  doc.rect(0, 0, PAGE_WIDTH_PT, 4).fill(brandColor);
  let y = 12;

  // 2. Pharmacy Logo (PNG or JPEG Buffer)
  if (logoBuffer && logoBuffer.length > 0) {
    try {
      doc.image(logoBuffer, (PAGE_WIDTH_PT - 72) / 2, y, {
        fit: [72, 36],
        align: "center",
        valign: "center",
      });
      y += 42;
    } catch {
      // Fallback cleanly to typographic header if image buffer is unsupported
    }
  }

  // 3. Pharmacy Header
  const displayName = (storefront.pharmacy_name || "PHARMACY").toUpperCase();
  doc
    .font("Helvetica-Bold")
    .fontSize(11.5)
    .fillColor("#15283B")
    .text(displayName, MARGIN_X, y, { width: CONTENT_WIDTH, align: "center" });
  y = doc.y + 2;

  const fullAddress = [storefront.address_line, storefront.city].filter(Boolean).join(", ");
  if (fullAddress) {
    doc
      .font("Helvetica")
      .fontSize(7.3)
      .fillColor("#57687D")
      .text(fullAddress, MARGIN_X + 4, y, { width: CONTENT_WIDTH - 8, align: "center" });
    y = doc.y + 1.5;
  }

  if (storefront.contact_phone) {
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#15283B")
      .text(`Tel: ${storefront.contact_phone}`, MARGIN_X, y, {
        width: CONTENT_WIDTH,
        align: "center",
      });
    y = doc.y + 1.5;
  }

  if (storefront.drug_sale_license_no) {
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor("#57687D")
      .text(`License: ${storefront.drug_sale_license_no}`, MARGIN_X, y, {
        width: CONTENT_WIDTH,
        align: "center",
      });
    y = doc.y + 2;
  }

  // Official Receipt Badge
  y += 4;
  doc
    .roundedRect(MARGIN_X + 20, y, CONTENT_WIDTH - 40, 14, 3)
    .fillAndStroke("#EFF7F3", brandColor);
  doc
    .font("Helvetica-Bold")
    .fontSize(7.2)
    .fillColor(brandColor)
    .text("ONLINE ORDER INVOICE", MARGIN_X + 20, y + 3.5, {
      width: CONTENT_WIDTH - 40,
      align: "center",
    });
  y += 19;

  // Dashed divider
  doc
    .save()
    .lineWidth(0.65)
    .strokeColor("#BFCBD2")
    .dash(2.2, { space: 2 })
    .moveTo(MARGIN_X, y)
    .lineTo(PAGE_WIDTH_PT - MARGIN_X, y)
    .stroke()
    .undash()
    .restore();
  y += 5;

  // 4. Order & Customer Metadata
  const drawMetaRow = (label: string, val?: string | null, boldVal = true, mono = false) => {
    const clean = String(val || "").trim();
    if (!clean) return;
    doc.font("Helvetica").fontSize(7.2).fillColor("#57687D").text(label, MARGIN_X, y, {
      width: 62,
      lineBreak: false,
    });
    doc
      .font(mono ? "Courier-Bold" : boldVal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(7.3)
      .fillColor("#15283B")
      .text(clean, MARGIN_X + 62, y, {
        width: CONTENT_WIDTH - 62,
        align: "right",
      });
    y = Math.max(y + 10, doc.y + 1.5);
  };

  drawMetaRow("Order Ref:", order.order_number, true, true);
  if (order.pos_invoice_number) {
    drawMetaRow("POS Invoice:", order.pos_invoice_number, true, true);
  }
  drawMetaRow("Date & Time:", formatDateTimePk(order.created_at), false, false);
  drawMetaRow("Customer:", order.customer_name, true, false);
  if (order.customer_phone) drawMetaRow("Phone:", order.customer_phone, false, false);
  if (order.customer_email) drawMetaRow("Email:", order.customer_email, false, false);

  y += 3;

  // 5. Fulfillment & Payment Box
  const isPickup = String(order.fulfillment_type || "").toLowerCase() === "pickup";
  const fulfillHeading = isPickup ? "FULFILLMENT: COUNTER PICKUP" : "FULFILLMENT: HOME DELIVERY";
  const fulfillBodyLines: string[] = [];
  if (isPickup) {
    fulfillBodyLines.push(
      `Counter: ${order.branch_name_snapshot || storefront.pharmacy_name}`
    );
  } else if (order.delivery_address) {
    const addr = [order.delivery_address, order.delivery_city].filter(Boolean).join(", ");
    fulfillBodyLines.push(`Deliver To: ${addr}`);
    if (order.delivery_instructions) {
      fulfillBodyLines.push(`Note: ${order.delivery_instructions}`);
    }
  }
  fulfillBodyLines.push(`Payment: ${formatPaymentMethod(order.payment_method)}`);

  const bodyTextJoined = fulfillBodyLines.join("\n");
  doc.font("Helvetica").fontSize(6.9);
  const bodyMeasuredH = doc.heightOfString(bodyTextJoined, { width: CONTENT_WIDTH - 12 });
  const boxH = 15 + bodyMeasuredH + 6;

  doc
    .roundedRect(MARGIN_X, y, CONTENT_WIDTH, boxH, 3)
    .fillAndStroke("#F8FAF9", "#D1DDD8");
  doc
    .font("Helvetica-Bold")
    .fontSize(7.2)
    .fillColor(brandColor)
    .text(fulfillHeading, MARGIN_X + 6, y + 4.5, { width: CONTENT_WIDTH - 12 });
  doc
    .font("Helvetica")
    .fontSize(6.9)
    .fillColor("#15283B")
    .text(bodyTextJoined, MARGIN_X + 6, y + 14.5, { width: CONTENT_WIDTH - 12 });
  y += boxH + 6;

  // 6. 4-Column POS Table Header
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 14).fill("#15283B");
  doc.font("Helvetica-Bold").fontSize(6.8).fillColor("#FFFFFF");
  doc.text("ITEM & UNIT", MARGIN_X + 3, y + 3.8, { width: 98, lineBreak: false });
  doc.text("QTY", MARGIN_X + 101, y + 3.8, { width: 22, align: "right", lineBreak: false });
  doc.text("RATE", MARGIN_X + 125, y + 3.8, { width: 35, align: "right", lineBreak: false });
  doc.text("TOTAL", MARGIN_X + 162, y + 3.8, {
    width: CONTENT_WIDTH - 165,
    align: "right",
    lineBreak: false,
  });
  y += 17;

  let computedSubtotal = 0;
  items.forEach((it, idx) => {
    const itemName =
      it.product_name_snapshot || it.product_name || `Medicine Item #${idx + 1}`;
    const unitLabel =
      it.selling_unit_name || it.unit_label_snapshot || it.unit_label || "Unit";
    const qty = Math.max(1, Number(it.qty || 1));
    const lineTotal = Number(it.line_total_pkr || 0);
    computedSubtotal += lineTotal;
    const unitRate =
      it.unit_price_pkr !== undefined && it.unit_price_pkr !== null
        ? Number(it.unit_price_pkr)
        : Number((lineTotal / qty).toFixed(2));
    const isRx = Boolean(Number(it.requires_prescription || 0) === 1 || it.requires_prescription === true);

    const rowTop = y;
    doc
      .font("Helvetica-Bold")
      .fontSize(7.4)
      .fillColor("#15283B")
      .text(itemName, MARGIN_X + 2, rowTop, { width: 98 });
    const afterNameY = doc.y;

    doc
      .font("Helvetica")
      .fontSize(7.3)
      .fillColor("#15283B")
      .text(String(qty), MARGIN_X + 101, rowTop, { width: 22, align: "right", lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(7.1)
      .fillColor("#57687D")
      .text(formatPkr(unitRate), MARGIN_X + 125, rowTop, {
        width: 35,
        align: "right",
        lineBreak: false,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(7.4)
      .fillColor("#15283B")
      .text(formatPkr(lineTotal), MARGIN_X + 162, rowTop, {
        width: CONTENT_WIDTH - 164,
        align: "right",
        lineBreak: false,
      });

    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor("#57687D")
      .text(`Unit: ${unitLabel}${isRx ? " | [Rx]" : ""}`, MARGIN_X + 2, afterNameY + 1, {
        width: 130,
      });
    y = doc.y + 3.5;

    if (idx < items.length - 1) {
      doc
        .save()
        .lineWidth(0.4)
        .strokeColor("#E3EAE7")
        .moveTo(MARGIN_X, y)
        .lineTo(PAGE_WIDTH_PT - MARGIN_X, y)
        .stroke()
        .restore();
      y += 3.5;
    }
  });

  y += 2;
  doc
    .save()
    .lineWidth(0.7)
    .strokeColor("#B8C6CE")
    .dash(2.2, { space: 2 })
    .moveTo(MARGIN_X, y)
    .lineTo(PAGE_WIDTH_PT - MARGIN_X, y)
    .stroke()
    .undash()
    .restore();
  y += 5;

  // 7. Totals & Promo Discount Breakdown
  const subtotalPkr =
    order.subtotal_pkr !== undefined && order.subtotal_pkr !== null
      ? Number(order.subtotal_pkr)
      : computedSubtotal;
  const discountPkr = Math.max(0, Number(order.discount_pkr || 0));
  const deliveryFeePkr = Math.max(0, Number(order.delivery_fee_pkr || 0));
  const totalPkr = Number(order.total_pkr || 0);

  const drawTotalRow = (label: string, val: string, color = "#15283B", labelColor = "#57687D") => {
    doc.font("Helvetica").fontSize(7.5).fillColor(labelColor).text(label, MARGIN_X + 2, y, {
      width: 120,
      lineBreak: false,
    });
    doc
      .font("Helvetica-Bold")
      .fontSize(7.6)
      .fillColor(color)
      .text(val, MARGIN_X + 115, y, {
        width: CONTENT_WIDTH - 117,
        align: "right",
        lineBreak: false,
      });
    y += 10.5;
  };

  drawTotalRow(
    `Subtotal (${items.length} item${items.length === 1 ? "" : "s"}):`,
    `PKR ${formatPkr(subtotalPkr)}`
  );

  if (discountPkr > 0) {
    const codeTag = order.applied_promo_code ? ` (${order.applied_promo_code})` : "";
    drawTotalRow(
      `Promo Discount${codeTag}:`,
      `- PKR ${formatPkr(discountPkr)}`,
      brandColor,
      brandColor
    );
  }

  drawTotalRow(
    isPickup ? "Counter Pickup:" : "Delivery Charges:",
    deliveryFeePkr === 0 ? "FREE" : `PKR ${formatPkr(deliveryFeePkr)}`
  );

  y += 2;
  doc
    .roundedRect(MARGIN_X, y, CONTENT_WIDTH, 21, 3)
    .fillAndStroke("#EFF7F3", brandColor);
  doc
    .font("Helvetica-Bold")
    .fontSize(9.0)
    .fillColor("#15283B")
    .text("NET TOTAL", MARGIN_X + 6, y + 6, { width: 85, lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(10.2)
    .fillColor(brandColor)
    .text(`PKR ${formatPkr(totalPkr)}`, MARGIN_X + 85, y + 5.2, {
      width: CONTENT_WIDTH - 91,
      align: "right",
      lineBreak: false,
    });
  y += 26;

  drawTotalRow("Payment Status:", formatPaymentStatus(order.payment_status));

  if (order.customer_notes) {
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor("#57687D")
      .text(`Order Note: ${order.customer_notes}`, MARGIN_X + 2, y, {
        width: CONTENT_WIDTH - 4,
      });
    y = doc.y + 3;
  }

  // 8. POS Footer
  y += 3;
  doc
    .save()
    .lineWidth(0.65)
    .strokeColor("#BFCBD2")
    .dash(2.2, { space: 2 })
    .moveTo(MARGIN_X, y)
    .lineTo(PAGE_WIDTH_PT - MARGIN_X, y)
    .stroke()
    .undash()
    .restore();
  y += 6;

  doc
    .font("Helvetica-Bold")
    .fontSize(7.8)
    .fillColor("#15283B")
    .text("Thank you - Get well soon!", MARGIN_X, y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  y = doc.y + 2;

  doc
    .font("Helvetica")
    .fontSize(6.6)
    .fillColor("#57687D")
    .text("Keep your Order Ref to track status online anytime.", MARGIN_X, y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  y = doc.y + 2;

  doc
    .font("Helvetica-Bold")
    .fontSize(6.3)
    .fillColor("#57687D")
    .text("Powered by AivraSol Mediqoo Pharmacy POS", MARGIN_X, y, {
      width: CONTENT_WIDTH,
      align: "center",
    });

  doc.end();
  return pdfDone;
}

