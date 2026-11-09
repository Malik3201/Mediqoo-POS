import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { verifyDeviceIdentity } from "@/lib/ai/license";
import SmartPurchaseUploadSession from "@/models/SmartPurchaseUploadSession";
import SmartPurchaseUsageLog from "@/models/SmartPurchaseUsageLog";
import {
  checkRateLimit,
  decryptBufferFromTempStorage,
  hashToken,
  MAX_PAGES_PER_INVOICE,
  validateAndSanitizeImageBuffer,
} from "@/lib/smart-purchase/image-security";
import {
  extractSupplierInvoiceDocument,
  type ExtractionPageInput,
} from "@/lib/smart-purchase/document-ai";

const DEFAULT_DAILY_SCAN_LIMIT = Number(process.env.SMART_PURCHASE_DAILY_SCAN_LIMIT || 50);
const DEFAULT_MONTHLY_SCAN_LIMIT = Number(process.env.SMART_PURCHASE_MONTHLY_SCAN_LIMIT || 500);
// Estimated vision inference cost per page ($0.0018/page for 27B vision model)
const ESTIMATED_USD_PER_PAGE = 0.0018;

/**
 * POST /api/public/smart-purchase/extract
 * Authenticated Desktop POS endpoint for running AI Document Extraction on:
 * - A mobile-uploaded QR session (`sessionId` + `desktopSecret`), OR
 * - Directly uploaded desktop invoice images/PDF-rendered pages (`pages`).
 *
 * Enforces strict pharmacy & terminal isolation, configurable per-pharmacy pilot scan limits,
 * image hygiene validation, usage/latency logging, and purges temporary session buffers after completion.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "invalid_request", message: "Invalid JSON payload." },
        { status: 400 }
      );
    }

    // 1. Verify authenticated desktop identity
    const idRes = await verifyDeviceIdentity(body.license_key, body.machine_id);
    if (!idRes.ok) {
      return NextResponse.json(
        { ok: false, error: idRes.error, message: "Terminal is not authorized." },
        { status: idRes.status }
      );
    }

    const { license, seat, client } = idRes.identity;
    if (!checkRateLimit(`sp_extract:${license.id}`, 30, 10 * 60 * 1000)) {
      return NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many invoice extraction requests. Please wait a minute.",
        },
        { status: 429 }
      );
    }

    await connectToDatabase();

    // 2. Enforce configurable per-pharmacy pilot scan limits (Section 14)
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [dailyCount, monthlyCount] = await Promise.all([
      SmartPurchaseUsageLog.countDocuments({
        licenseId: license.id,
        status: "completed",
        createdAt: { $gte: startOfDay },
      }),
      SmartPurchaseUsageLog.countDocuments({
        licenseId: license.id,
        status: "completed",
        createdAt: { $gte: startOfMonth },
      }),
    ]);

    if (dailyCount >= DEFAULT_DAILY_SCAN_LIMIT || monthlyCount >= DEFAULT_MONTHLY_SCAN_LIMIT) {
      await SmartPurchaseUsageLog.create({
        licenseId: license.id,
        clientId: client?.id || null,
        seatId: seat.id,
        machineId: String(body.machine_id),
        sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
        captureMethod: typeof body.sessionId === "string" ? "mobile_qr" : "desktop_upload",
        pageCount: 1,
        lineCount: 0,
        status: "limit_exceeded",
        provider: "groq-vision",
        modelName: "qwen/qwen3.8-27b",
        processingDurationMs: Date.now() - startedAt,
        estimatedCostUsd: 0,
        errorCode: "scan_limit_exceeded",
      }).catch(() => {});

      return NextResponse.json(
        {
          ok: false,
          error: "scan_limit_exceeded",
          message:
            dailyCount >= DEFAULT_DAILY_SCAN_LIMIT
              ? `Daily pilot scan limit (${DEFAULT_DAILY_SCAN_LIMIT} scans/day) reached for this pharmacy. Normal manual purchases remain available.`
              : `Monthly pilot scan limit (${DEFAULT_MONTHLY_SCAN_LIMIT} scans/month) reached for this pharmacy. Normal manual purchases remain available.`,
        },
        { status: 429 }
      );
    }

    const extractionPages: ExtractionPageInput[] = [];
    const previewPagesForDesktop: {
      pageNumber: number;
      mimeType: string;
      width: number;
      height: number;
      sizeBytes: number;
      sha256: string;
      dataUrl: string;
    }[] = [];
    let activeSessionId: string | null = null;
    const captureMethod: "mobile_qr" | "desktop_upload" =
      typeof body.sessionId === "string" && body.sessionId.trim() ? "mobile_qr" : "desktop_upload";

    // ── Mode A: Extract from Mobile QR Session ───────────────────────────────
    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      const sessionId = body.sessionId.trim();
      const desktopSecret = typeof body.desktopSecret === "string" ? body.desktopSecret.trim() : "";
      if (!desktopSecret) {
        return NextResponse.json(
          { ok: false, error: "invalid_request", message: "Missing desktop session secret." },
          { status: 400 }
        );
      }

      const session: any = await SmartPurchaseUploadSession.findOne({ sessionId })
        .select("+pages.encryptedDataBase64 +pages.ivHex +pages.authTagHex")
        .lean();

      if (!session) {
        return NextResponse.json(
          { ok: false, error: "session_not_found", message: "Upload session not found." },
          { status: 404 }
        );
      }

      // Enforce strict pharmacy + terminal + desktopSecret ownership
      if (
        String(session.licenseId) !== String(license.id) ||
        String(session.seatId) !== String(seat.id) ||
        String(session.machineId) !== String(body.machine_id) ||
        session.desktopSecretHash !== hashToken(desktopSecret)
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "cross_pharmacy_or_terminal_denied",
            message: "Access denied: session belongs to another pharmacy or terminal.",
          },
          { status: 403 }
        );
      }

      if (!Array.isArray(session.pages) || session.pages.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "no_uploaded_pages",
            message: "No invoice images have been uploaded to this session yet.",
          },
          { status: 400 }
        );
      }

      activeSessionId = sessionId;
      await SmartPurchaseUploadSession.updateOne({ sessionId }, { $set: { status: "processing" } });

      for (const p of session.pages) {
        if (!p.encryptedDataBase64 || !p.ivHex || !p.authTagHex) continue;
        const decryptedBuf = decryptBufferFromTempStorage({
          encryptedBase64: p.encryptedDataBase64,
          ivHex: p.ivHex,
          authTagHex: p.authTagHex,
        });
        const base64Data = decryptedBuf.toString("base64");
        const mimeType = p.mimeType || "image/jpeg";
        extractionPages.push({
          pageNumber: p.pageNumber,
          mimeType,
          base64Data,
        });
        previewPagesForDesktop.push({
          pageNumber: p.pageNumber,
          mimeType,
          width: p.width || 1200,
          height: p.height || 1600,
          sizeBytes: p.sizeBytes || decryptedBuf.length,
          sha256: p.sha256 || "",
          dataUrl: `data:${mimeType};base64,${base64Data}`,
        });
      }
    }
    // ── Mode B: Extract from Direct Desktop Upload ───────────────────────────
    else if (Array.isArray(body.pages) && body.pages.length > 0) {
      if (body.pages.length > MAX_PAGES_PER_INVOICE) {
        return NextResponse.json(
          {
            ok: false,
            error: "too_many_pages",
            message: `Maximum ${MAX_PAGES_PER_INVOICE} pages allowed per invoice.`,
          },
          { status: 400 }
        );
      }

      for (let i = 0; i < body.pages.length; i++) {
        const pg = body.pages[i];
        const rawData =
          typeof pg?.base64Data === "string"
            ? pg.base64Data
            : typeof pg?.dataUrl === "string"
            ? pg.dataUrl
            : "";
        if (!rawData) {
          return NextResponse.json(
            { ok: false, error: "invalid_page", message: `Page ${i + 1} is missing image data.` },
            { status: 400 }
          );
        }
        const cleanBase64 = rawData.includes(",") ? rawData.split(",")[1] : rawData;
        const buf = Buffer.from(cleanBase64, "base64");
        const sanitized = await validateAndSanitizeImageBuffer(buf);
        if (!sanitized.ok) {
          return NextResponse.json(
            { ok: false, error: sanitized.error, message: `Page ${i + 1}: ${sanitized.message}` },
            { status: 400 }
          );
        }
        extractionPages.push({
          pageNumber:
            Number.isInteger(pg.pageNumber) && pg.pageNumber > 0 ? pg.pageNumber : i + 1,
          mimeType: sanitized.page.mimeType,
          base64Data: sanitized.page.buffer.toString("base64"),
          extractedTextHint:
            typeof pg.extractedTextHint === "string"
              ? pg.extractedTextHint.slice(0, 6000)
              : undefined,
        });
      }
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "no_pages",
          message: "Provide either a mobile sessionId or desktop invoice pages.",
        },
        { status: 400 }
      );
    }

    // 3. Run Document Extraction Service
    const extraction = await extractSupplierInvoiceDocument(extractionPages);
    const processingDurationMs = Date.now() - startedAt;

    if (!extraction.ok) {
      if (activeSessionId) {
        await SmartPurchaseUploadSession.updateOne(
          { sessionId: activeSessionId },
          { $set: { status: "failed" } }
        );
      }
      await SmartPurchaseUsageLog.create({
        licenseId: license.id,
        clientId: client?.id || null,
        seatId: seat.id,
        machineId: String(body.machine_id),
        sessionId: activeSessionId,
        captureMethod,
        pageCount: extractionPages.length,
        lineCount: 0,
        status: "failed",
        provider: "groq-vision",
        modelName: "qwen/qwen3.8-27b",
        processingDurationMs,
        estimatedCostUsd: 0,
        errorCode: extraction.error,
      }).catch(() => {});

      return NextResponse.json(
        { ok: false, error: extraction.error, message: extraction.message },
        { status: 502 }
      );
    }

    const estimatedCostUsd =
      Math.round(extractionPages.length * ESTIMATED_USD_PER_PAGE * 10000) / 10000;

    // 4. Record usage & latency metrics (Section 14)
    await SmartPurchaseUsageLog.create({
      licenseId: license.id,
      clientId: client?.id || null,
      seatId: seat.id,
      machineId: String(body.machine_id),
      sessionId: activeSessionId,
      captureMethod,
      pageCount: extractionPages.length,
      lineCount: extraction.result.lines.length,
      status: "completed",
      provider: extraction.result.provider || "groq-vision",
      modelName: extraction.result.model || "qwen/qwen3.8-27b",
      processingDurationMs,
      estimatedCostUsd,
      errorCode: null,
    }).catch(() => {});

    // 5. If extracted from a mobile session, mark completed and purge temporary encrypted buffers
    if (activeSessionId) {
      await SmartPurchaseUploadSession.updateOne(
        { sessionId: activeSessionId },
        {
          $set: {
            status: "completed",
            consumedAt: new Date(),
            "pages.$[].encryptedDataBase64": "",
            "pages.$[].ivHex": "",
            "pages.$[].authTagHex": "",
          },
        }
      );
    }

    return NextResponse.json({
      ok: true,
      extraction: extraction.result,
      pages: previewPagesForDesktop.length > 0 ? previewPagesForDesktop : undefined,
      usage: {
        pageCount: extractionPages.length,
        processingDurationMs,
        estimatedCostUsd,
        dailyScansUsed: dailyCount + 1,
        dailyScanLimit: DEFAULT_DAILY_SCAN_LIMIT,
        monthlyScansUsed: monthlyCount + 1,
        monthlyScanLimit: DEFAULT_MONTHLY_SCAN_LIMIT,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "server_error", message: "Document extraction failed unexpectedly." },
      { status: 500 }
    );
  }
}
