import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import SmartPurchaseUploadSession from "@/models/SmartPurchaseUploadSession";
import {
  checkRateLimit,
  encryptBufferForTempStorage,
  hashToken,
  MAX_PAGE_BYTES,
  MAX_PAGES_PER_INVOICE,
  MAX_TOTAL_UPLOAD_BYTES,
  validateAndSanitizeImageBuffer,
} from "@/lib/smart-purchase/image-security";

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * GET /api/public/smart-purchase/mobile/[token]
 * Upload-only session check for mobile browser. Never exposes pharmacy inventory,
 * supplier data, license keys, or financial records.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`sp_mob_get:${ip}`, 40, 5 * 60 * 1000)) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", message: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const { token } = await context.params;
    const cleanToken = String(token || "").trim();
    if (!cleanToken || cleanToken.length < 16 || cleanToken.length > 128) {
      return NextResponse.json(
        { ok: false, error: "invalid_session", message: "Invalid or unrecognized QR code." },
        { status: 404 }
      );
    }

    await connectToDatabase();
    const tokenHash = hashToken(cleanToken);
    const session: any = await SmartPurchaseUploadSession.findOne({ uploadTokenHash: tokenHash }).lean();

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "invalid_session", message: "This QR session does not exist or has expired." },
        { status: 404 }
      );
    }

    const now = new Date();
    if (session.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "session_cancelled", message: "This scan session was cancelled on the desktop POS." },
        { status: 410 }
      );
    }

    if (session.status === "uploaded" || session.status === "processing" || session.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "already_submitted", message: "An invoice has already been submitted for this QR code. Generate a new QR on the POS to scan another bill." },
        { status: 409 }
      );
    }

    if (new Date(session.expiresAt) <= now || session.status === "expired") {
      if (session.status !== "expired") {
        await SmartPurchaseUploadSession.updateOne({ _id: session._id }, { $set: { status: "expired" } });
      }
      return NextResponse.json(
        { ok: false, error: "session_expired", message: "This QR code has expired. Please click 'Refresh QR' on your desktop POS." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: "ready",
      pharmacyLabel: session.pharmacyName || "AivraSol Pharmacy POS",
      terminalNumber: session.terminalNumber ?? null,
      expiresAt: new Date(session.expiresAt).toISOString(),
      maxPages: MAX_PAGES_PER_INVOICE,
      maxPageBytes: MAX_PAGE_BYTES,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "server_error", message: "Unable to verify scan session." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/public/smart-purchase/mobile/[token]
 * Upload-only endpoint for submitting 1..N captured invoice pages from mobile browser.
 * Enforces single-use atomic lock (preventing QR reuse & duplicate submissions),
 * magic-byte validation, EXIF stripping, dimension limits, and encrypted temporary storage.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  let lockedSessionId: string | null = null;
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`sp_mob_post:${ip}`, 15, 5 * 60 * 1000)) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", message: "Too many upload attempts. Please wait a minute." },
        { status: 429 }
      );
    }

    const { token } = await context.params;
    const cleanToken = String(token || "").trim();
    if (!cleanToken || cleanToken.length < 16 || cleanToken.length > 128) {
      return NextResponse.json(
        { ok: false, error: "invalid_session", message: "Invalid upload session token." },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.pages) || body.pages.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_pages", message: "Please capture at least one invoice page before submitting." },
        { status: 400 }
      );
    }

    if (body.pages.length > MAX_PAGES_PER_INVOICE) {
      return NextResponse.json(
        { ok: false, error: "too_many_pages", message: `Maximum ${MAX_PAGES_PER_INVOICE} pages allowed per invoice.` },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const tokenHash = hashToken(cleanToken);
    const now = new Date();

    // First inspect existing session to give exact reason if not pending
    const existing: any = await SmartPurchaseUploadSession.findOne({ uploadTokenHash: tokenHash }).lean();
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "invalid_session", message: "This QR session does not exist." },
        { status: 404 }
      );
    }
    if (existing.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "session_cancelled", message: "This scan session was cancelled on the desktop POS." },
        { status: 410 }
      );
    }
    if (existing.status === "uploaded" || existing.status === "processing" || existing.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "already_submitted", message: "This QR code has already been used to submit an invoice." },
        { status: 409 }
      );
    }
    if (new Date(existing.expiresAt) <= now || existing.status === "expired") {
      await SmartPurchaseUploadSession.updateOne({ _id: existing._id }, { $set: { status: "expired" } });
      return NextResponse.json(
        { ok: false, error: "session_expired", message: "This QR code has expired." },
        { status: 410 }
      );
    }

    // Atomic transition pending -> uploading to prevent race / duplicate submission
    const locked: any = await SmartPurchaseUploadSession.findOneAndUpdate(
      {
        uploadTokenHash: tokenHash,
        status: "pending",
        expiresAt: { $gt: now },
      },
      {
        $set: { status: "uploading" },
        $inc: { uploadAttempts: 1 },
      },
      { new: true }
    ).lean();

    if (!locked) {
      return NextResponse.json(
        { ok: false, error: "already_submitted", message: "An upload is already in progress or completed for this QR code." },
        { status: 409 }
      );
    }
    lockedSessionId = locked.sessionId;

    let totalBytes = 0;
    const processedPages: any[] = [];
    const pageHashes: string[] = [];

    for (let i = 0; i < body.pages.length; i++) {
      const item = body.pages[i];
      const rawData = typeof item === "string" ? item : item?.dataUrl || item?.base64Data || "";
      if (typeof rawData !== "string" || !rawData) {
        await SmartPurchaseUploadSession.updateOne({ sessionId: lockedSessionId }, { $set: { status: "pending" } });
        return NextResponse.json(
          { ok: false, error: "invalid_page_data", message: `Page ${i + 1} is empty or invalid.` },
          { status: 400 }
        );
      }

      const base64Clean = rawData.includes(",") ? rawData.split(",")[1] : rawData;
      const buf = Buffer.from(base64Clean, "base64");
      totalBytes += buf.length;

      if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
        await SmartPurchaseUploadSession.updateOne({ sessionId: lockedSessionId }, { $set: { status: "pending" } });
        return NextResponse.json(
          { ok: false, error: "payload_too_large", message: "Total upload size exceeds 25 MB limit." },
          { status: 413 }
        );
      }

      const validated = await validateAndSanitizeImageBuffer(buf);
      if (!validated.ok) {
        await SmartPurchaseUploadSession.updateOne({ sessionId: lockedSessionId }, { $set: { status: "pending" } });
        return NextResponse.json(
          { ok: false, error: validated.error, message: `Page ${i + 1}: ${validated.message}` },
          { status: 400 }
        );
      }

      const enc = encryptBufferForTempStorage(validated.page.buffer);
      pageHashes.push(validated.page.sha256);

      processedPages.push({
        pageId: `pg_${i + 1}_${crypto.randomBytes(4).toString("hex")}`,
        pageNumber: i + 1,
        mimeType: validated.page.mimeType,
        width: validated.page.width,
        height: validated.page.height,
        sizeBytes: validated.page.sizeBytes,
        sha256: validated.page.sha256,
        encryptedDataBase64: enc.encryptedBase64,
        ivHex: enc.ivHex,
        authTagHex: enc.authTagHex,
        uploadedAt: new Date(),
      });
    }

    const submissionFingerprint = crypto
      .createHash("sha256")
      .update(pageHashes.join("|"))
      .digest("hex");

    await SmartPurchaseUploadSession.updateOne(
      { sessionId: lockedSessionId },
      {
        $set: {
          status: "uploaded",
          pages: processedPages,
          submissionFingerprint,
          uploadedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      ok: true,
      status: "uploaded",
      pageCount: processedPages.length,
      submissionFingerprint,
      message: "Invoice uploaded securely to your desktop POS.",
    });
  } catch {
    if (lockedSessionId) {
      try {
        await SmartPurchaseUploadSession.updateOne({ sessionId: lockedSessionId }, { $set: { status: "pending" } });
      } catch {}
    }
    return NextResponse.json(
      { ok: false, error: "server_error", message: "Upload failed due to a server error. Please try again." },
      { status: 500 }
    );
  }
}

