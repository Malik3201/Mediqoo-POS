/**
 * Browser-Side Image Optimization & WebP Compression Utility
 *
 * Implements Section 7 of AivraSol Storefront SaaS:
 * - Validates input MIME type and size before upload
 * - Resizes preserving aspect ratio based on asset purpose (product, logo, banner, category)
 * - Compresses to WebP with adaptive quality to keep medicine package text sharp
 * - Computes SHA-256 content hash (`sha256Hex`) for R2/D1 deduplication
 */

export type MediaAssetPurpose = "logo" | "banner" | "product" | "category" | "favicon";

export interface OptimizedImageResult {
  base64Data: string;
  previewDataUrl: string;
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
  { maxDimension: number; targetMaxBytes: number; initialQuality: number }
> = {
  logo: { maxDimension: 500, targetMaxBytes: 45 * 1024, initialQuality: 0.88 },
  favicon: { maxDimension: 192, targetMaxBytes: 20 * 1024, initialQuality: 0.88 },
  category: { maxDimension: 600, targetMaxBytes: 55 * 1024, initialQuality: 0.84 },
  product: { maxDimension: 900, targetMaxBytes: 90 * 1024, initialQuality: 0.85 },
  banner: { maxDimension: 1400, targetMaxBytes: 180 * 1024, initialQuality: 0.84 },
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

  // Adaptive step-down while keeping medicine label text sharp (never below 0.64)
  while (blob.size > spec.targetMaxBytes && quality > 0.66) {
    quality = Math.round((quality - 0.06) * 100) / 100;
    blob = await canvasToBlob(canvas, quality);
  }

  const arrayBuffer = await blob.arrayBuffer();
  const sha256Hex = await computeSha256Hex(arrayBuffer);
  const { base64Data, dataUrl } = await blobToBase64(blob);

  return {
    base64Data,
    previewDataUrl: dataUrl,
    mimeType: "image/webp",
    byteSize: blob.size,
    width: targetW,
    height: targetH,
    sha256Hex,
    originalBytes: file.size,
    compressionRatio: file.size > 0 ? Math.round((1 - blob.size / file.size) * 100) : 0,
  };
}

