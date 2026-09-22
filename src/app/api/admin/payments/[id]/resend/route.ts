import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import LicensePayment from "@/models/LicensePayment";
import { sendPaymentReceipt } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const payment = await LicensePayment.findById(id);
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  try {
    await sendPaymentReceipt(id);
    return NextResponse.json({ success: true, message: "Receipt queued for sending" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
