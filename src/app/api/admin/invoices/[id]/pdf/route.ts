import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import PDFDocument from "pdfkit";
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";

// Explicitly use Node.js runtime for pdfkit compatibility
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await connectToDatabase();

  const invoice = await LicenseRenewalInvoice.findOne({ _id: id }).lean();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // Generate PDF
  const doc = new PDFDocument({ margin: 50 });
  
  // Create a Transform stream to pipe to NextResponse
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

  try {
    const pdfBuffer = await pdfPromise;
    
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="AivraSol-Renewal-${invoice.invoice_number}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
