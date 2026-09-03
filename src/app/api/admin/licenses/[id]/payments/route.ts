import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicensePayment from "@/models/LicensePayment";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();
  
  const searchParams = req.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "10", 10);
  
  try {
    const total = await LicensePayment.countDocuments({ license_id: id });
    const payments = await LicensePayment.find({ license_id: id })
      .sort({ created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    // Fetch corresponding invoices
    const paymentIds = payments.map((p: any) => p._id.toString());
    const invoices = await LicenseRenewalInvoice.find({ payment_id: { $in: paymentIds } }).lean();

    const items = payments.map((p: any) => {
      const invoice = invoices.find((inv: any) => inv.payment_id === p._id.toString());
      return {
        ...p,
        invoice_id: invoice?._id || null,
        invoice_number: invoice?.invoice_number || null,
      };
    });

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
