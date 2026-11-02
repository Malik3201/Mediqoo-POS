import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import { resolveOrHydrateVoucher } from "@/lib/renewal-voucher";
import { generateRenewalVoucherPdfBuffer } from "@/lib/renewal-voucher-pdf";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await connectToDatabase();

  const voucher = await resolveOrHydrateVoucher(id);
  if (!voucher) {
    return NextResponse.json({ error: "Payment or voucher not found" }, { status: 404 });
  }

  try {
    const pdfBuffer = await generateRenewalVoucherPdfBuffer(voucher);
    const filename = `AivraSol-Voucher-${
      voucher.voucher_number || voucher.invoice_number || voucher.id
    }.pdf`;

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to generate PDF", detail: err.message },
      { status: 500 }
    );
  }
}
