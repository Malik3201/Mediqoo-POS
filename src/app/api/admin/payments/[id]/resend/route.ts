import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicensePayment from "@/models/LicensePayment";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import { sendPaymentReceipt, sendVoucherEmail } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const payment = (await LicensePayment.findOne({
    $or: [{ id }, ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])],
  }).lean()) as any;
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  try {
    const voucher = await LicenseRenewalInvoice.findOne({ payment_id: payment.id }).lean() as any;
    if (voucher) {
      const res = await sendVoucherEmail(voucher.id);
      if (!res.sent) {
        return NextResponse.json({ error: res.error || res.reason || "Email failed" }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: `Voucher sent to ${res.email}` });
    }
    await sendPaymentReceipt(payment._id.toString());
    return NextResponse.json({ success: true, message: "Receipt sent" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
