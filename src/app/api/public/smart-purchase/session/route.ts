import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import { verifyDeviceIdentity } from "@/lib/ai/license";
import SmartPurchaseUploadSession from "@/models/SmartPurchaseUploadSession";
import {
  checkRateLimit,
  decryptBufferFromTempStorage,
  DEFAULT_SESSION_TTL_MS,
  generateOpaqueToken,
  hashToken,
  MAX_PAGE_BYTES,
  MAX_PAGES_PER_INVOICE,
} from "@/lib/smart-purchase/image-security";

function resolvePublicBaseUrl(req: NextRequest, bodyBaseUrl?: unknown): string {
  if (typeof bodyBaseUrl === "string" && /^https?:\/\/[^\s/]+$/i.test(bodyBaseUrl.trim())) {
    return bodyBaseUrl.trim().replace(/\/+$/, "");
  }
  const envUrl = process.env.SMART_PURCHASE_PUBLIC_URL || process.env.NEXTAUTH_URL;
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, "");
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "mediqoo.vercel.app";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "invalid_request", message: "Invalid JSON payload." }, { status: 400 });
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
    await connectToDatabase();

    const action = String(body.action || "create");

    // ── ACTION 1: CREATE SHORT-LIVED QR UPLOAD SESSION ──────────────────────────
    if (action === "create") {
      const rateOk = checkRateLimit(`sp_create:${license.id}:${seat.id}`, 25, 10 * 60 * 1000);
      if (!rateOk) {
        return NextResponse.json(
          { ok: false, error: "rate_limited", message: "Too many QR sessions created recently. Please wait a moment." },
          { status: 429 }
        );
      }

      const draftId = typeof body.draftId === "string" && body.draftId.trim()
        ? body.draftId.trim().slice(0, 64)
        : `draft_${crypto.randomUUID()}`;

      const ttlSeconds = typeof body.ttlSeconds === "number"
        ? Math.max(60, Math.min(900, Math.floor(body.ttlSeconds)))
        : Math.floor(DEFAULT_SESSION_TTL_MS / 1000);

      const sessionId = `sps_${crypto.randomUUID().replace(/-/g, "")}`;
      const uploadToken = generateOpaqueToken("spu");
      const desktopSecret = generateOpaqueToken("spd");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      await SmartPurchaseUploadSession.create({
        sessionId,
        uploadTokenHash: hashToken(uploadToken),
        desktopSecretHash: hashToken(desktopSecret),
        licenseId: String(license.id),
        clientId: String(license.client_id),
        seatId: String(seat.id),
        machineId: String(body.machine_id),
        terminalNumber: seat.terminal_number ?? null,
        pharmacyName: client?.name ? String(client.name).slice(0, 80) : "AivraSol Pharmacy POS",
        draftId,
        status: "pending",
        pages: [],
        createdAt: now,
        expiresAt,
      });

      const baseUrl = resolvePublicBaseUrl(req, body.publicBaseUrl);
      const mobileUploadUrl = `${baseUrl}/scan/${encodeURIComponent(uploadToken)}`;

      return NextResponse.json({
        ok: true,
        sessionId,
        draftId,
        uploadToken,
        desktopSecret,
        mobileUploadUrl,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttlSeconds,
        maxPages: MAX_PAGES_PER_INVOICE,
        maxPageBytes: MAX_PAGE_BYTES,
      });
    }

    // ── ACTION 2: CHECK STATUS / FETCH UPLOADED PAGES FOR AUTHENTICATED DESKTOP ──
    if (action === "status") {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      const desktopSecret = typeof body.desktopSecret === "string" ? body.desktopSecret.trim() : "";
      if (!sessionId || !desktopSecret) {
        return NextResponse.json({ ok: false, error: "invalid_request", message: "Missing session credentials." }, { status: 400 });
      }

      const session: any = await SmartPurchaseUploadSession.findOne({ sessionId })
        .select("+pages.encryptedDataBase64 +pages.ivHex +pages.authTagHex")
        .lean();

      if (!session) {
        return NextResponse.json({ ok: false, error: "session_not_found", message: "Upload session not found." }, { status: 404 });
      }

      // Strict tenant + terminal + secret isolation check
      if (
        String(session.licenseId) !== String(license.id) ||
        String(session.seatId) !== String(seat.id) ||
        String(session.machineId) !== String(body.machine_id) ||
        session.desktopSecretHash !== hashToken(desktopSecret)
      ) {
        return NextResponse.json(
          { ok: false, error: "cross_pharmacy_or_terminal_denied", message: "Access denied: session belongs to a different pharmacy or terminal." },
          { status: 403 }
        );
      }

      const now = new Date();
      let currentStatus = session.status;
      if ((currentStatus === "pending" || currentStatus === "uploading") && new Date(session.expiresAt) <= now) {
        currentStatus = "expired";
        await SmartPurchaseUploadSession.updateOne({ sessionId }, { $set: { status: "expired" } });
      }

      const includePages = Boolean(body.includePages);
      let decryptedPages: any[] | undefined;

      if (includePages && (currentStatus === "uploaded" || currentStatus === "processing" || currentStatus === "completed")) {
        decryptedPages = [];
        for (const p of session.pages || []) {
          if (p.encryptedDataBase64 && p.ivHex && p.authTagHex) {
            try {
              const buf = decryptBufferFromTempStorage({
                encryptedBase64: p.encryptedDataBase64,
                ivHex: p.ivHex,
                authTagHex: p.authTagHex,
              });
              decryptedPages.push({
                pageId: p.pageId,
                pageNumber: p.pageNumber,
                mimeType: p.mimeType,
                width: p.width,
                height: p.height,
                sizeBytes: p.sizeBytes,
                sha256: p.sha256,
                dataUrl: `data:${p.mimeType};base64,${buf.toString("base64")}`,
              });
            } catch {
              /* ignore corrupt temp buffer */
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        sessionId: session.sessionId,
        draftId: session.draftId,
        status: currentStatus,
        pageCount: Array.isArray(session.pages) ? session.pages.length : 0,
        submissionFingerprint: session.submissionFingerprint || null,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        uploadedAt: session.uploadedAt ? new Date(session.uploadedAt).toISOString() : null,
        pages: decryptedPages,
      });
    }

    // ── ACTION 3: CANCEL SESSION & PURGE TEMP DATA ─────────────────────────────
    if (action === "cancel") {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      const desktopSecret = typeof body.desktopSecret === "string" ? body.desktopSecret.trim() : "";
      if (!sessionId || !desktopSecret) {
        return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
      }

      const session: any = await SmartPurchaseUploadSession.findOne({ sessionId }).lean();
      if (!session) {
        return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
      }

      if (
        String(session.licenseId) !== String(license.id) ||
        String(session.seatId) !== String(seat.id) ||
        String(session.machineId) !== String(body.machine_id) ||
        session.desktopSecretHash !== hashToken(desktopSecret)
      ) {
        return NextResponse.json({ ok: false, error: "cross_pharmacy_or_terminal_denied" }, { status: 403 });
      }

      await SmartPurchaseUploadSession.updateOne(
        { sessionId },
        {
          $set: {
            status: "cancelled",
            pages: [],
            cancelledAt: new Date(),
          },
        }
      );

      return NextResponse.json({ ok: true, sessionId, status: "cancelled" });
    }

    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: "Could not process upload session request." },
      { status: 500 }
    );
  }
}

