import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import { persistVoucherFromHistoricalPayment } from "@/lib/renewal-voucher";
import { sendVoucherEmail } from "@/lib/email";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await connectToDatabase();

    const body = await req.json().catch(() => ({}));
    const includeTerms =
      body.include_acceptance_terms !== undefined
        ? Boolean(body.include_acceptance_terms)
        : undefined;

    const voucher = await persistVoucherFromHistoricalPayment(id, {
      includeAcceptanceTerms: includeTerms,
    });

    if (!voucher) {
      return NextResponse.json(
        { error: "Payment record not found" },
        { status: 404 }
      );
    }

    let emailResult: any = null;
    if (body.send_email === true) {
      try {
        emailResult = await sendVoucherEmail(voucher.id, {
          recipientEmail: body.recipient_email,
        });
      } catch (err: any) {
        emailResult = {
          sent: false,
          error: err?.message || "Email dispatch failed",
        };
      }
    }

    const voucherObj = voucher.toJSON();
    if (emailResult) {
      voucherObj.email_status = emailResult.sent
        ? "sent"
        : emailResult.reason
        ? "skipped"
        : "failed";
    }

    return NextResponse.json({
      success: true,
      voucher: voucherObj,
      email_result: emailResult,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to generate voucher from payment" },
      { status: 500 }
    );
  }
}

