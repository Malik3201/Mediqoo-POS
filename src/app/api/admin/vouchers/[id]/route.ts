import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import { resolveOrHydrateVoucher } from "@/lib/renewal-voucher";
import { generateRenewalVoucherPdfBuffer } from "@/lib/renewal-voucher-pdf";

export const runtime = "nodejs";

/**
 * GET /api/admin/vouchers/[id]
 * Retrieves an immutable AivraSol Subscription & License Renewal Voucher by id, voucher_number, or payment_id.
 * Supports ?format=pdf to download/stream the A4 PDF on demand without R2/MongoDB binary storage.
 */
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
    return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
  }

  const format = req.nextUrl.searchParams.get("format");
  if (format === "pdf") {
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
          "Cache-Control": "no-store",
        },
      });
    } catch (err: any) {
      return NextResponse.json(
        { error: "Failed to generate voucher PDF", detail: err.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    voucher,
  });
}

