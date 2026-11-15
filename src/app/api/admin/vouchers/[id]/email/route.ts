import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
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
    const result = await sendVoucherEmail(id, {
      recipientEmail:
        typeof body?.recipient_email === "string"
          ? body.recipient_email.trim()
          : undefined,
    });

    if (result.error === "Voucher not found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    if (result.reason === "no_client_email") {
      return NextResponse.json(
        {
          success: false,
          error: "Client email address is missing on this license/voucher.",
          ...result,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: result.sent,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to send voucher email" },
      { status: 500 }
    );
  }
}

