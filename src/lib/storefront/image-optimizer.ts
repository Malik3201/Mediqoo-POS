/**
 * Browser-Side Image Optimization & WebP Compression Utility
 *
 * Implements Section 7 of AivraSol Storefront SaaS:
 * - Validates input MIME type and size before upload
 * - Resizes preserving aspect ratio based on asset purpose (product, logo, banner, category)
 * - Compresses to WebP with adaptive quality to keep medicine package text sharp
 * - Computes SHA-256 content hash (`sha256Hex`) for R2/D1 deduplication
 */

export type MediaAssetPurpose =
  | "logo"
  | "banner"
  | "product"
  | "category"
  | "favicon"
  | "doctor"
  | "service";

export interface OptimizedImageResult {
  base64Data: string;
  previewDataUrl: string;
  pdfJpegDataUrl?: string;
  mimeType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
  sha256Hex: string;
  originalBytes: number;
  compressionRatio: number;
}

const PURPOSE_SPEC: Record<
  MediaAssetPurpose,
  { maxDimension: number; targetMaxBytes: number; initialQuality: number; minQuality: number }
> = {
  logo: { maxDimension: 360, targetMaxBytes: 25 * 1024, initialQuality: 0.84, minQuality: 0.56 },
  favicon: { maxDimension: 128, targetMaxBytes: 12 * 1024, initialQuality: 0.84, minQuality: 0.56 },
  category: { maxDimension: 480, targetMaxBytes: 35 * 1024, initialQuality: 0.82, minQuality: 0.54 },
  doctor: { maxDimension: 480, targetMaxBytes: 35 * 1024, initialQuality: 0.82, minQuality: 0.54 },
  product: { maxDimension: 640, targetMaxBytes: 40 * 1024, initialQuality: 0.82, minQuality: 0.54 },
  service: { maxDimension: 840, targetMaxBytes: 55 * 1024, initialQuality: 0.8, minQuality: 0.52 },
  banner: { maxDimension: 1280, targetMaxBytes: 95 * 1024, initialQuality: 0.8, minQuality: 0.52 },
};

const ALLOWED_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    const bytes = new Uint8Array(hashBuffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback deterministic hash if subtle crypto is unavailable
  const view = new Uint8Array(buffer);
  let h1 = 0xdeadbeef ^ view.length;
  let h2 = 0x41c6ce57 ^ view.length;
  for (let i = 0; i < view.length; i++) {
    const ch = view[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0") +
    view.length.toString(16).padStart(8, "0")
  );
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode image file. Please choose a valid JPG, PNG, or WebP image."));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode WebP image."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality
    );
  });
}

function blobToBase64(blob: Blob): Promise<{ base64Data: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || "");
      const commaIdx = dataUrl.indexOf(",");
      const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      resolve({ base64Data, dataUrl });
    };
    reader.onerror = () => reject(new Error("Failed to read compressed image data."));
    reader.readAsDataURL(blob);
  });
}

export async function optimizeImageForStorefront(
  file: File,
  purpose: MediaAssetPurpose = "product"
): Promise<OptimizedImageResult> {
  if (!ALLOWED_INPUT_TYPES.has(file.type.toLowerCase())) {
    throw new Error("Unsupported image format. Please upload a JPG, PNG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Image file is too large (max 10 MB before compression).");
  }

  const spec = PURPOSE_SPEC[purpose] || PURPOSE_SPEC.product;
  const img = await loadImageFromFile(file);

  const srcW = Math.max(1, img.naturalWidth || img.width);
  const srcH = Math.max(1, img.naturalHeight || img.height);
  const maxDim = spec.maxDimension;

  let targetW = srcW;
  let targetH = srcH;
  if (srcW > maxDim || srcH > maxDim) {
    if (srcW >= srcH) {
      targetW = maxDim;
      targetH = Math.max(1, Math.round((srcH * maxDim) / srcW));
    } else {
      targetH = maxDim;
      targetW = Math.max(1, Math.round((srcW * maxDim) / srcH));
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser 2D canvas context unavailable for image optimization.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let quality = spec.initialQuality;
  let blob = await canvasToBlob(canvas, quality);

  // Adaptive quality step-down to enforce ultra-lightweight KB footprint for R2 Free Tier
  while (blob.size > spec.targetMaxBytes && quality > spec.minQuality) {
    quality = Math.round((quality - 0.06) * 100) / 100;
    blob = await canvasToBlob(canvas, quality);
  }

  // If still above target bytes (e.g., dense high-detail photo), downscale dimensions smoothly once
  if (blob.size > spec.targetMaxBytes && Math.max(targetW, targetH) > 360) {
    const downscale = 0.78;
    targetW = Math.max(120, Math.round(targetW * downscale));
    targetH = Math.max(120, Math.round(targetH * downscale));
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx2 = canvas.getContext("2d");
    if (ctx2) {
      ctx2.imageSmoothingEnabled = true;
      ctx2.imageSmoothingQuality = "high";
      ctx2.drawImage(img, 0, 0, targetW, targetH);
      blob = await canvasToBlob(canvas, Math.max(spec.minQuality, quality));
    }
  }

  const arrayBuffer = await blob.arrayBuffer();
  const sha256Hex = await computeSha256Hex(arrayBuffer);
  const { base64Data, dataUrl } = await blobToBase64(blob);

  let pdfJpegDataUrl: string | undefined;
  if (purpose === "logo") {
    try {
      const pdfMax = 220;
      const pdfScale = Math.min(pdfMax / targetW, pdfMax / targetH, 1);
      const pw = Math.max(16, Math.round(targetW * pdfScale));
      const ph = Math.max(16, Math.round(targetH * pdfScale));
      const pdfCanvas = document.createElement("canvas");
      pdfCanvas.width = pw;
      pdfCanvas.height = ph;
      const pctx = pdfCanvas.getContext("2d");
      if (pctx) {
        pctx.fillStyle = "#FFFFFF";
        pctx.fillRect(0, 0, pw, ph);
        pctx.imageSmoothingEnabled = true;
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(img, 0, 0, pw, ph);
        pdfJpegDataUrl = pdfCanvas.toDataURL("image/jpeg", 0.86);
      }
    } catch {
      // Optional fallback only
    }
  }

  return {
    base64Data,
    previewDataUrl: dataUrl,
    pdfJpegDataUrl,
    mimeType: "image/webp",
    byteSize: blob.size,
    width: targetW,
    height: targetH,
    sha256Hex,
    originalBytes: file.size,
    compressionRatio: file.size > 0 ? Math.round((1 - blob.size / file.size) * 100) : 0,
  };
}

/**
 * Bulk-ZIP Medicine Packshot Optimizer (500x500 clean square WebP targeting <= 35 KB for R2 Free Tier).
 * Preserves aspect ratio inside a crisp white square canvas so packaging text is never cropped.
 */
export async function optimizeBlobForBulkCentralLibrary(
  inputBlob: Blob,
  options?: { size?: number; targetMaxBytes?: number }
): Promise<OptimizedImageResult> {
  const size = options?.size ?? 500;
  const targetMaxBytes = options?.targetMaxBytes ?? 35 * 1024;
  const objectUrl = URL.createObjectURL(inputBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image inside ZIP."));
      el.src = objectUrl;
    });

    const srcW = Math.max(1, img.naturalWidth || img.width);
    const srcH = Math.max(1, img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable.");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const padding = Math.round(size * 0.04);
    const maxDraw = size - padding * 2;
    const scale = Math.min(maxDraw / srcW, maxDraw / srcH, 1.5);
    const drawW = Math.max(1, Math.round(srcW * scale));
    const drawH = Math.max(1, Math.round(srcH * scale));
    const offsetX = Math.round((size - drawW) / 2);
    const offsetY = Math.round((size - drawH) / 2);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

    let quality = 0.82;
    let outBlob = await canvasToBlob(canvas, quality);
    while (outBlob.size > targetMaxBytes && quality > 0.62) {
      quality = Math.round((quality - 0.06) * 100) / 100;
      outBlob = await canvasToBlob(canvas, quality);
    }

    const arrayBuffer = await outBlob.arrayBuffer();
    const sha256Hex = await computeSha256Hex(arrayBuffer);
    const { base64Data, dataUrl } = await blobToBase64(outBlob);

    return {
      base64Data,
      previewDataUrl: dataUrl,
      mimeType: "image/webp",
      byteSize: outBlob.size,
      width: size,
      height: size,
      sha256Hex,
      originalBytes: inputBlob.size,
      compressionRatio:
        inputBlob.size > 0 ? Math.round((1 - outBlob.size / inputBlob.size) * 100) : 0,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

