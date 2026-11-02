import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import PDFDocument from "pdfkit";
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await connectToDatabase();

  const invoice = await LicenseRenewalInvoice.findOne({ _id: id });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // Safety to prevent rapid duplicates
  if (invoice.email_status === "sent" && invoice.email_sent_at) {
    const minTime = 60 * 1000; // 1 minute
    if (Date.now() - new Date(invoice.email_sent_at).getTime() < minTime) {
      return NextResponse.json({ error: "Please wait before resending" }, { status: 429 });
    }
  }

  // Generate PDF
  const doc = new PDFDocument({ margin: 50 });
  const chunks: any[] = [];
  
  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Build the PDF content
  doc.fontSize(20).text("Subscription Renewal Invoice", { align: "center" });
  doc.moveDown();
  
  doc.fontSize(12).text(`Invoice Number: ${invoice.invoice_number}`);
  doc.text(`Issue Date: ${new Date(invoice.issued_at).toLocaleDateString()}`);
  doc.text(`Status: ${invoice.status.toUpperCase()}`);
  doc.moveDown();
  
  doc.text("Bill From:", { underline: true });
  doc.text(invoice.seller_snapshot.name);
  if (invoice.seller_snapshot.email) doc.text(invoice.seller_snapshot.email);
  doc.moveDown();
  
  doc.text("Bill To:", { underline: true });
  doc.text(invoice.client_snapshot.name);
  if (invoice.client_snapshot.contact_name) doc.text(invoice.client_snapshot.contact_name);
  if (invoice.client_snapshot.email) doc.text(invoice.client_snapshot.email);
  if (invoice.client_snapshot.phone) doc.text(invoice.client_snapshot.phone);
  doc.moveDown();
  
  doc.text("Subscription Details:", { underline: true });
  doc.text(`Periods Settled: ${invoice.periods_settled}`);
  if (invoice.old_expiry) doc.text(`Previous Expiry: ${new Date(invoice.old_expiry).toLocaleDateString()}`);
  if (invoice.new_expiry) doc.text(`New Expiry: ${new Date(invoice.new_expiry).toLocaleDateString()}`);
  doc.moveDown();
  
  doc.text("Financial Summary:", { underline: true });
  doc.text(`Total Due: ${invoice.currency} ${invoice.total_due}`);
  doc.text(`Amount Paid: ${invoice.currency} ${invoice.amount_paid}`);
  doc.text(`Outstanding Balance: ${invoice.currency} ${invoice.balance}`);
  doc.text(`Payment Method: ${invoice.payment_method}`);
  if (invoice.payment_reference) doc.text(`Reference: ${invoice.payment_reference}`);
  doc.moveDown(2);
  
  doc.fontSize(10).text("Thank you for using AivraSol Pharmacy POS.", { align: "center" });
  doc.end();

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await pdfPromise;
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to generate PDF for attachment" }, { status: 500 });
  }

  // Send Email
  try {
    // Only attempt if we have an email configured
    const targetEmail = invoice.client_snapshot.email;
    if (!targetEmail) {
      throw new Error("Client has no email address configured in the snapshot");
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.mailtrap.io",
      port: Number(process.env.SMTP_PORT) || 2525,
      auth: {
        user: process.env.SMTP_USER || "user",
        pass: process.env.SMTP_PASS || "pass",
      },
    });

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>AivraSol Pharmacy POS</h2>
        <p>Dear ${invoice.client_snapshot.contact_name || invoice.client_snapshot.name},</p>
        <p>We have received your subscription payment for <strong>${invoice.client_snapshot.name}</strong>.</p>
        <ul>
          <li><strong>Payment:</strong> ${invoice.currency} ${invoice.amount_paid}</li>
          <li><strong>Renewed Through:</strong> ${invoice.new_expiry ? new Date(invoice.new_expiry).toLocaleDateString() : "N/A"}</li>
          <li><strong>Payment Method:</strong> ${invoice.payment_method}</li>
          <li><strong>Invoice Number:</strong> ${invoice.invoice_number}</li>
        </ul>
        <p>Your AivraSol Pharmacy POS license remains associated with your installation.</p>
        <p>A PDF copy of your renewal invoice is attached for your records.</p>
        <br/>
        <p>Thank you for using AivraSol Pharmacy POS.</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"AivraSol Billing" <${process.env.SMTP_FROM || "billing@aivrasol.com"}>`,
      to: targetEmail,
      subject: `AivraSol Pharmacy POS — Subscription Renewed Successfully`,
      html: htmlBody,
      attachments: [
        {
          filename: `AivraSol-Renewal-${invoice.invoice_number}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    invoice.email_status = "sent";
    invoice.email_sent_at = new Date();
    invoice.email_attempt_count += 1;
    invoice.email_last_error = "";
    await invoice.save();

    return NextResponse.json({ success: true, status: "sent" });
  } catch (err: any) {
    console.error("Email send failed:", err);
    invoice.email_status = "failed";
    invoice.email_attempt_count += 1;
    invoice.email_last_error = err.message || "Unknown error";
    await invoice.save();

    return NextResponse.json({ error: "Failed to send email", details: err.message }, { status: 500 });
  }
}
