import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendStorefrontOrderInvoiceEmail } from "@/lib/email";
import {
  generateStorefront80mmInvoicePdfBuffer,
  type ServerInvoice80mmOrder,
  type ServerInvoice80mmStorefront,
} from "@/lib/storefront/invoice-pdf-80mm";
import { getPosProjectLogoForPharmacy } from "@/lib/storefront/pos-logo-sync";

function verifyAdminWebhookSecret(req: NextRequest): boolean {
  const configured = (process.env.STOREFRONT_ADMIN_SECRET || "").trim();
  const provided = (req.headers.get("x-storefront-admin-secret") || "").trim();
  if (!configured || !provided) return false;
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function decodeDataUrlToPdfCompatibleBuffer(dataUrl?: string | null): Buffer | null {
  if (!dataUrl) return null;
  const match = dataUrl.trim().match(/^data:(image\/(?:png|jpeg|jpg));base64,([\s\S]+)$/i);
  if (!match) return null;
  const buf = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return buf.length > 0 ? buf : null;
}

async function resolveLogoBufferForPdf(
  sf: ServerInvoice80mmStorefront
): Promise<Buffer | null> {
  // 1. Pre-rendered JPEG variant from Owner Panel WebP logo optimizer
  const fromVariant = decodeDataUrlToPdfCompatibleBuffer(sf.logo_pdf_data_url);
  if (fromVariant) return fromVariant;

  // 2. Direct PNG/JPEG data URL or HTTPS public media URL
  if (sf.logo_url) {
    const fromInline = decodeDataUrlToPdfCompatibleBuffer(sf.logo_url);
    if (fromInline) return fromInline;

    if (/^https?:\/\//i.test(sf.logo_url)) {
      try {
        const res = await fetch(sf.logo_url, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
          const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          if (ct === "image/png" || ct === "image/jpeg" || ct === "image/jpg") {
            const arr = await res.arrayBuffer();
            const buf = Buffer.from(arr);
            if (buf.length > 0) return buf;
          }
        }
      } catch {
        // Fallback to POS Project logo in MongoDB
      }
    }
  }

  // 3. Fallback to POS Project branding logo in MongoDB (if PNG/JPEG)
  if (sf.pharmacy_id) {
    const posLogo = await getPosProjectLogoForPharmacy(sf.pharmacy_id);
    if (
      posLogo &&
      (posLogo.mimeType === "image/png" || posLogo.mimeType === "image/jpeg")
    ) {
      return posLogo.buffer;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  if (!verifyAdminWebhookSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const storefront = body?.storefront as ServerInvoice80mmStorefront | undefined;
    const order = body?.order as ServerInvoice80mmOrder | undefined;

    if (!storefront || !order || !order.order_number) {
      return NextResponse.json(
        { ok: false, error: "missing_order_or_storefront" },
        { status: 400 }
      );
    }

    const customerEmail = String(order.customer_email || "").trim();
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no_customer_email",
      });
    }

    const logoBuffer = await resolveLogoBufferForPdf(storefront);
    const pdfBuffer = await generateStorefront80mmInvoicePdfBuffer({
      storefront,
      order,
      logoBuffer,
    });

    const mailRes = await sendStorefrontOrderInvoiceEmail({
      storefront,
      order: {
        ...order,
        customer_email: customerEmail,
      },
      pdfBuffer,
    });

    return NextResponse.json({
      ok: true,
      emailed: mailRes.sent,
      recipient: customerEmail,
      pdf_bytes: pdfBuffer.length,
    });
  } catch (err: any) {
    console.error("[OrderInvoiceEmailWebhook] Error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "invoice_email_failed" },
      { status: 500 }
    );
  }
}

