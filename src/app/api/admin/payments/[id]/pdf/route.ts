import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicensePayment from "@/models/LicensePayment";
import License from "@/models/License";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const payment = await LicensePayment.findById(id).lean();
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  const license = await License.findOne({ id: payment.license_id }).lean();
  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });

  const clientName = license.client_snapshot?.name || "Client";
  const contactName = license.client_snapshot?.contact_name || "";
  const contactEmail = license.client_snapshot?.email || "";
  const phone = license.client_snapshot?.phone || "";

  // Generate PDF
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks: any[] = [];
  
  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // --- PDF Layout (Professional SaaS Receipt) ---
  // Header
  doc.fillColor("#009A4D").fontSize(28).text("AIVRASOL", { align: "left" });
  doc.fillColor("#64748B").fontSize(10).text("Pharmacy POS", { align: "left" });
  
  doc.moveUp(2);
  doc.fillColor("#0F172A").fontSize(20).text("Payment Receipt", { align: "right" });
  doc.fillColor("#64748B").fontSize(10).text(`Receipt No: ${payment.receipt_number || payment.id}`, { align: "right" });
  doc.text(`Payment Date: ${new Date(payment.paid_at).toLocaleDateString()}`, { align: "right" });
  
  doc.moveDown(3);

  // Billed To
  doc.fillColor("#0F172A").fontSize(12).text("BILLED TO", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(clientName);
  if (contactName) doc.text(`Owner: ${contactName}`);
  if (phone) doc.text(`Phone: ${phone}`);
  if (contactEmail) doc.text(`Email: ${contactEmail}`);
  
  doc.moveDown(2);

  // Subscription Details
  const isPerInvoice = license.billing?.model === "per_invoice";
  doc.fillColor("#0F172A").fontSize(12).text("SUBSCRIPTION", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(`Plan: ${isPerInvoice ? "Pay Per Invoice" : "Fixed Subscription"}`);
  if (isPerInvoice && payment.rate_snapshot) {
    doc.text(`Rate: ${payment.currency} ${payment.rate_snapshot} / invoice`);
  }
  
  doc.moveDown(2);

  // Billing Summary
  doc.fillColor("#0F172A").fontSize(12).text("BILLING SUMMARY", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  if (isPerInvoice) {
    doc.text(`Billable Invoices (Snapshot): ${payment.usage_count_snapshot || 0}`);
    doc.text(`Usage Charges (Snapshot): ${payment.currency} ${payment.usage_amount_snapshot || 0}`);
  }
  doc.text(`Previous Outstanding: ${payment.currency} ${payment.outstanding_before || 0}`);
  doc.fillColor("#009A4D").text(`Amount Paid: ${payment.currency} ${payment.amount_paid}`);
  doc.fillColor("#334155").text(`Outstanding After Payment: ${payment.currency} ${payment.outstanding_after || 0}`);
  
  doc.moveDown(2);

  // Payment Details
  doc.fillColor("#0F172A").fontSize(12).text("PAYMENT DETAILS", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(`Method: ${payment.payment_method || "N/A"}`);
  if (payment.payment_reference) doc.text(`Reference: ${payment.payment_reference}`);
  if (payment.recorded_by) doc.text(`Recorded By: ${payment.recorded_by}`);

  doc.moveDown(2);

  // License Info
  doc.fillColor("#0F172A").fontSize(12).text("LICENSE INFORMATION", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  if (payment.action === "payment_only") {
    doc.text(`Current Expiry: ${new Date(license.expires_at).toLocaleDateString()}`);
    doc.fillColor("#64748B").text("License expiry is unchanged by this payment.");
  } else {
    doc.text(`Renewed Until: ${new Date(license.expires_at).toLocaleDateString()}`);
  }

  // Footer
  doc.moveDown(4);
  doc.fillColor("#64748B").fontSize(9).text("Thank you for choosing AivraSol.", { align: "center" });
  doc.text("support@aivrasol.com | www.aivrasol.com", { align: "center" });

  doc.end();

  try {
    const pdfBuffer = await pdfPromise;
    
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="AivraSol-Receipt-${payment.receipt_number || payment.id}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
