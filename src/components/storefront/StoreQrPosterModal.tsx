"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Printer,
  Download,
  X,
  Copy,
  Check,
  QrCode,
  Sparkles,
} from "lucide-react";

export interface StoreQrPosterProps {
  open: boolean;
  onClose: () => void;
  pharmacyName: string;
  websiteUrl: string;
  logoUrl?: string | null;
  phone?: string | null;
  city?: string | null;
  tagline?: string | null;
  defaultAccent?: string | null;
}

type PosterThemeKey = "emerald" | "orange" | "royal" | "slate";

const POSTER_THEMES: Record<
  PosterThemeKey,
  {
    label: string;
    primary: string;
    primaryDark: string;
    softBg: string;
    borderTint: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  emerald: {
    label: "Clinical Emerald",
    primary: "#059669",
    primaryDark: "#065F46",
    softBg: "#ECFDF5",
    borderTint: "#A7F3D0",
    badgeBg: "#D1FAE5",
    badgeText: "#065F46",
  },
  orange: {
    label: "AivraSol Signature",
    primary: "#D8643D",
    primaryDark: "#9A3412",
    softBg: "#FFF7ED",
    borderTint: "#FED7AA",
    badgeBg: "#FFEDD5",
    badgeText: "#9A3412",
  },
  royal: {
    label: "Medical Royal Blue",
    primary: "#0284C7",
    primaryDark: "#075985",
    softBg: "#F0F9FF",
    borderTint: "#BAE6FD",
    badgeBg: "#E0F2FE",
    badgeText: "#075985",
  },
  slate: {
    label: "Executive Charcoal",
    primary: "#0F172A",
    primaryDark: "#020617",
    softBg: "#F8FAFC",
    borderTint: "#CBD5E1",
    badgeBg: "#E2E8F0",
    badgeText: "#0F172A",
  },
};

function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function imageUrlToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function StoreQrPosterModal({
  open,
  onClose,
  pharmacyName,
  websiteUrl,
  logoUrl,
  phone,
  city,
  tagline,
}: StoreQrPosterProps) {
  const [themeKey, setThemeKey] = useState<PosterThemeKey>("emerald");
  const [qrSvg, setQrSvg] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const cleanName = (pharmacyName || "Pharmacy").trim();
  const cleanUrl = (websiteUrl || "").trim();
  const theme = POSTER_THEMES[themeKey];

  useEffect(() => {
    if (!open || !cleanUrl) return;
    let alive = true;
    void Promise.all([
      QRCode.toString(cleanUrl, {
        type: "svg",
        errorCorrectionLevel: "H",
        margin: 1,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      }),
      QRCode.toDataURL(cleanUrl, {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 1024,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      }),
    ])
      .then(([svg, dataUrl]) => {
        if (!alive) return;
        setQrSvg(svg);
        setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!alive) return;
        setQrSvg("");
        setQrDataUrl("");
      });
    return () => {
      alive = false;
    };
  }, [open, cleanUrl]);

  if (!open) return null;

  const handleCopy = () => {
    if (!cleanUrl) return;
    navigator.clipboard?.writeText(cleanUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintPoster = async () => {
    if (!qrSvg) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const aivraLogoData =
      (await imageUrlToDataUri(`${origin}/aivrasol-wordmark-orange.png`)) ||
      `${origin}/aivrasol-wordmark-orange.png`;
    const pharmLogoData = logoUrl ? (await imageUrlToDataUri(logoUrl)) || logoUrl : null;

    const printWin = window.open("", "_blank", "width=880,height=1120");
    if (!printWin) {
      window.print();
      return;
    }

    const metaLine = [city, phone].filter(Boolean).join("  •  ");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Store QR Poster — ${escapeHtml(cleanName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 210mm;
      height: 297mm;
      background: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0F172A;
    }
    .sheet {
      width: 210mm;
      height: 297mm;
      padding: 13mm 15mm 11mm 15mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      background: #FFFFFF;
    }
    .top-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 5.5mm;
      background: linear-gradient(90deg, ${theme.primaryDark} 0%, ${theme.primary} 65%, #D8643D 100%);
    }
    .frame {
      flex: 1;
      border: 1.5pt solid #E2E8F0;
      border-radius: 18pt;
      padding: 14mm 14mm 10mm 14mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      position: relative;
      background: linear-gradient(180deg, ${theme.softBg} 0%, #FFFFFF 22%, #FFFFFF 88%, #FAFAFA 100%);
    }
    .header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4.5mm;
      width: 100%;
    }
    .pharm-logo {
      height: 20mm;
      max-width: 72mm;
      object-fit: contain;
      padding: 2mm 4mm;
      background: #FFFFFF;
      border: 1pt solid #E2E8F0;
      border-radius: 10pt;
    }
    .pharm-name {
      margin: 0;
      font-size: 30pt;
      font-weight: 900;
      letter-spacing: -0.025em;
      color: #0F172A;
      line-height: 1.12;
      max-width: 165mm;
    }
    .tagline {
      margin: 0;
      font-size: 11.5pt;
      font-weight: 500;
      color: #475569;
    }
    .qr-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8mm;
      width: 100%;
    }
    .qr-outer {
      position: relative;
      padding: 8.5mm;
      background: #FFFFFF;
      border-radius: 22pt;
      border: 2pt solid ${theme.primary};
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }
    .corner {
      position: absolute;
      width: 11mm;
      height: 11mm;
      border-color: ${theme.primaryDark};
      border-style: solid;
    }
    .c-tl { top: -2pt; left: -2pt; border-width: 4pt 0 0 4pt; border-top-left-radius: 22pt; }
    .c-tr { top: -2pt; right: -2pt; border-width: 4pt 4pt 0 0; border-top-right-radius: 22pt; }
    .c-bl { bottom: -2pt; left: -2pt; border-width: 0 0 4pt 4pt; border-bottom-left-radius: 22pt; }
    .c-br { bottom: -2pt; right: -2pt; border-width: 0 4pt 4pt 0; border-bottom-right-radius: 22pt; }
    .qr-box {
      width: 112mm;
      height: 112mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-box svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .cta-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3mm;
      max-width: 160mm;
    }
    .cta-headline {
      margin: 0;
      font-size: 22pt;
      font-weight: 800;
      letter-spacing: -0.015em;
      color: #0F172A;
      line-height: 1.28;
    }
    .cta-headline span {
      color: ${theme.primary};
    }
    .meta-line {
      margin-top: 1.5mm;
      font-size: 10.5pt;
      font-weight: 600;
      color: #64748B;
    }
    .footer {
      width: 100%;
      padding-top: 4.5mm;
      border-top: 1pt solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3mm;
    }
    .powered {
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #94A3B8;
    }
    .aivra-logo {
      height: 5.5mm;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .orange-dot {
      display: inline-block;
      width: 2.2mm;
      height: 2.2mm;
      border-radius: 1px;
      transform: rotate(45deg);
      background: #F9572B;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-bar"></div>
    <div class="frame">
      <div class="header">
        ${pharmLogoData ? `<img src="${pharmLogoData}" alt="${escapeHtml(cleanName)}" class="pharm-logo" />` : ""}
        <h1 class="pharm-name">${escapeHtml(cleanName)}</h1>
        ${tagline ? `<p class="tagline">${escapeHtml(tagline)}</p>` : `<p class="tagline">Genuine Medicines • Fast Home Delivery &amp; Counter Pickup</p>`}
      </div>

      <div class="qr-section">
        <div class="qr-outer">
          <div class="corner c-tl"></div>
          <div class="corner c-tr"></div>
          <div class="corner c-bl"></div>
          <div class="corner c-br"></div>
          <div class="qr-box">${qrSvg}</div>
        </div>

        <div class="cta-block">
          <h2 class="cta-headline">
            Scan for Online Shopping from <span>${escapeHtml(cleanName)}</span>
          </h2>
          ${metaLine ? `<div class="meta-line">${escapeHtml(metaLine)}</div>` : ""}
        </div>
      </div>

      <div class="footer">
        <span class="orange-dot"></span>
        <span class="powered">Powered by</span>
        <img src="${aivraLogoData}" alt="AivraSol" class="aivra-logo" />
      </div>
    </div>
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 250);
    };
  </script>
</body>
</html>`;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  const handleDownloadPng = async () => {
    if (!qrDataUrl) return;
    setDownloading(true);
    try {
      const W = 1654; // A4 @ 200 DPI
      const H = 2339;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // White page background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, W, H);

      // Top brand accent strip
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, theme.primaryDark);
      grad.addColorStop(0.65, theme.primary);
      grad.addColorStop(1, "#D8643D");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, 44);

      // Outer rounded border
      const padX = 110;
      const padTop = 105;
      const padBottom = 90;
      const frameW = W - padX * 2;
      const frameH = H - padTop - padBottom;
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(padX, padTop, frameW, frameH, 42);
      ctx.stroke();

      // Soft top tint inside frame
      const tintGrad = ctx.createLinearGradient(0, padTop, 0, padTop + 500);
      tintGrad.addColorStop(0, theme.softBg);
      tintGrad.addColorStop(1, "#FFFFFF");
      ctx.fillStyle = tintGrad;
      ctx.beginPath();
      ctx.roundRect(padX + 2, padTop + 2, frameW - 4, 480, [40, 40, 0, 0]);
      ctx.fill();

      // Pharmacy Name
      ctx.textAlign = "center";
      ctx.fillStyle = "#0F172A";
      ctx.font = "900 78px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText(cleanName.slice(0, 34), W / 2, padTop + 190, frameW - 140);

      // Tagline
      ctx.fillStyle = "#475569";
      ctx.font = "500 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText(
        tagline || "Genuine Medicines • Fast Home Delivery & Counter Pickup",
        W / 2,
        padTop + 260,
        frameW - 160
      );

      // Large QR Card
      const qrSize = 930;
      const qrCardPad = 64;
      const qrCardSize = qrSize + qrCardPad * 2;
      const qrCardX = (W - qrCardSize) / 2;
      const qrCardY = padTop + 360;

      ctx.fillStyle = "#FFFFFF";
      ctx.shadowColor = "rgba(15, 23, 42, 0.10)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 14;
      ctx.beginPath();
      ctx.roundRect(qrCardX, qrCardY, qrCardSize, qrCardSize, 46);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = theme.primary;
      ctx.lineWidth = 8;
      ctx.stroke();

      // Draw QR image
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrDataUrl;
      });
      ctx.drawImage(qrImg, qrCardX + qrCardPad, qrCardY + qrCardPad, qrSize, qrSize);

      // Headline below QR
      const ctaY = qrCardY + qrCardSize + 135;
      ctx.fillStyle = "#0F172A";
      ctx.font = "800 54px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText("Scan for Online Shopping from", W / 2, ctaY, frameW - 140);
      ctx.fillStyle = theme.primary;
      ctx.font = "900 62px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText(cleanName.slice(0, 36), W / 2, ctaY + 84, frameW - 140);

      // Subtle contact line (no raw URL shown on poster)
      const metaLine = [city, phone].filter(Boolean).join("  •  ");
      if (metaLine) {
        ctx.fillStyle = "#64748B";
        ctx.font = "600 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
        ctx.fillText(metaLine, W / 2, ctaY + 154, frameW - 160);
      }

      // Footer divider + small new orange AivraSol logo at bottom
      const footY = padTop + frameH - 110;
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX + 90, footY);
      ctx.lineTo(W - padX - 90, footY);
      ctx.stroke();

      try {
        const aivraImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = "/aivrasol-wordmark-orange.png";
        });
        const logoH = 42;
        const logoW = Math.round((aivraImg.width / Math.max(1, aivraImg.height)) * logoH);
        const label = "POWERED BY";
        ctx.fillStyle = "#94A3B8";
        ctx.font = "700 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
        const labelW = ctx.measureText(label).width;
        const totalW = labelW + 24 + logoW;
        const startX = (W - totalW) / 2;
        ctx.textAlign = "left";
        ctx.fillText(label, startX, footY + 66);
        ctx.drawImage(aivraImg, startX + labelW + 24, footY + 34, logoW, logoH);
      } catch {
        ctx.fillStyle = "#D8643D";
        ctx.font = "800 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Powered by aivrasol", W / 2, footY + 66);
      }

      const link = document.createElement("a");
      const safeFile = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      link.download = `${safeFile || "pharmacy"}-online-store-qr-poster.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white shrink-0">
              <QrCode className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                Printable A4 Store QR Poster — {cleanName}
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                Print on A4 paper for counter stands, glass doors, or delivery bags
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Close QR poster modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid lg:grid-cols-[1fr,310px] divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left: Live A4 Poster Preview */}
          <div className="p-5 sm:p-6 bg-slate-100/90 dark:bg-slate-950 flex items-center justify-center max-h-[76vh] overflow-y-auto">
            <div
              className="w-full max-w-[430px] aspect-[210/297] bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col relative select-none"
            >
              {/* Top Gradient Accent Bar */}
              <div
                className="h-2.5 w-full shrink-0"
                style={{
                  background: `linear-gradient(90deg, ${theme.primaryDark} 0%, ${theme.primary} 65%, #D8643D 100%)`,
                }}
              />

              {/* Inner Framed Poster Sheet */}
              <div className="flex-1 p-4 flex flex-col">
                <div
                  className="flex-1 rounded-2xl border border-slate-200 px-5 py-5 flex flex-col items-center justify-between text-center"
                  style={{
                    background: `linear-gradient(180deg, ${theme.softBg} 0%, #FFFFFF 24%, #FFFFFF 88%, #FAFAFA 100%)`,
                  }}
                >
                  {/* Pharmacy Header */}
                  <div className="space-y-2 w-full flex flex-col items-center pt-1">
                    {logoUrl && (
                      <img
                        src={logoUrl}
                        alt={cleanName}
                        className="h-11 max-w-[150px] object-contain rounded-lg border border-slate-200 bg-white px-2 py-1"
                      />
                    )}
                    <h3 className="text-2xl font-black tracking-tight text-slate-900 leading-tight">
                      {cleanName}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium leading-snug max-w-[290px]">
                      {tagline || "Genuine Medicines • Fast Home Delivery & Counter Pickup"}
                    </p>
                  </div>

                  {/* Giant Vector QR Frame */}
                  <div className="my-2 flex flex-col items-center gap-4 w-full">
                    <div
                      className="relative p-4 bg-white rounded-2xl shadow-md"
                      style={{ border: `2.5px solid ${theme.primary}` }}
                    >
                      <span
                        className="absolute -top-0.5 -left-0.5 h-5 w-5 rounded-tl-2xl border-t-4 border-l-4"
                        style={{ borderColor: theme.primaryDark }}
                      />
                      <span
                        className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-tr-2xl border-t-4 border-r-4"
                        style={{ borderColor: theme.primaryDark }}
                      />
                      <span
                        className="absolute -bottom-0.5 -left-0.5 h-5 w-5 rounded-bl-2xl border-b-4 border-l-4"
                        style={{ borderColor: theme.primaryDark }}
                      />
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-br-2xl border-b-4 border-r-4"
                        style={{ borderColor: theme.primaryDark }}
                      />
                      <div
                        className="w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                        dangerouslySetInnerHTML={{ __html: qrSvg }}
                      />
                    </div>

                    {/* Scan Callout */}
                    <div className="space-y-1.5 px-2">
                      <p className="text-base font-extrabold text-slate-900 leading-snug">
                        Scan for Online Shopping from{" "}
                        <span style={{ color: theme.primary }}>{cleanName}</span>
                      </p>
                      {(city || phone) && (
                        <p className="text-[10.5px] font-semibold text-slate-500">
                          {[city, phone].filter(Boolean).join(" • ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Bottom Footer: Small New Orange AivraSol Logo */}
                  <div className="w-full pt-2.5 border-t border-slate-200/90 flex items-center justify-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rotate-45 bg-[#F9572B]" />
                    <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      Powered by
                    </span>
                    <img
                      src="/aivrasol-wordmark-orange.png"
                      alt="AivraSol"
                      className="h-3.5 w-auto object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Controls & Print Actions */}
          <div className="p-5 flex flex-col justify-between gap-5 bg-white dark:bg-slate-900">
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600" /> Poster Accent Theme
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(POSTER_THEMES) as PosterThemeKey[]).map((key) => {
                    const t = POSTER_THEMES[key];
                    const active = themeKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setThemeKey(key)}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-bold transition ${
                          active
                            ? "border-slate-900 dark:border-white bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-900/10"
                            : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <span
                          className="h-4 w-4 rounded-full shrink-0 border border-black/10"
                          style={{ backgroundColor: t.primary }}
                        />
                        <span className="truncate text-slate-800 dark:text-slate-100">
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Embedded Website Link
                </div>
                <div className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 break-all">
                  {cleanUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied Link
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy Store Link
                    </>
                  )}
                </button>
              </div>

              <div className="rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-3 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                <strong>Print Tip:</strong> Enable <em>Background graphics</em> in your print dialog and select <strong>A4 Portrait (Scale 100%)</strong> for a border-perfect counter standee or window poster.
              </div>
            </div>

            <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={!qrSvg}
                onClick={() => void handlePrintPoster()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-3 text-xs sm:text-sm font-extrabold text-white shadow-sm transition disabled:opacity-50"
              >
                <Printer className="h-4 w-4" /> Print A4 QR Poster
              </button>
              <button
                type="button"
                disabled={!qrDataUrl || downloading}
                onClick={() => void handleDownloadPng()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-100 transition disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {downloading ? "Generating High-Res PNG…" : "Download A4 PNG (Print Shop Ready)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
