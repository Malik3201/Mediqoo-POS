"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Check, Image as ImageIcon, Loader2, RotateCcw, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { PortalActionButton, PortalConfirmModal } from "@/components/portal/PortalUI";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const CROP_VIEWPORT_PX = 240;

export function PortalPharmacyLogoCard({
  pharmacyName,
  currentLogoUrl,
  canEdit,
  onChanged,
}: {
  pharmacyName: string;
  currentLogoUrl?: string | null;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setImgError(false);
  }, [currentLogoUrl]);

  const renderCropped = useCallback(
    (sizePx: number): string | null => {
      const img = loadedImgRef.current;
      if (!img || !naturalSize.w || !naturalSize.h) return null;
      const canvas = document.createElement("canvas");
      canvas.width = sizePx;
      canvas.height = sizePx;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.clearRect(0, 0, sizePx, sizePx);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const baseScale = Math.min(CROP_VIEWPORT_PX / naturalSize.w, CROP_VIEWPORT_PX / naturalSize.h);
      const drawW = naturalSize.w * baseScale * zoom;
      const drawH = naturalSize.h * baseScale * zoom;
      const ratio = sizePx / CROP_VIEWPORT_PX;
      const cx = sizePx / 2 + offset.x * ratio;
      const cy = sizePx / 2 + offset.y * ratio;
      ctx.drawImage(img, cx - (drawW * ratio) / 2, cy - (drawH * ratio) / 2, drawW * ratio, drawH * ratio);
      return canvas.toDataURL("image/png");
    },
    [naturalSize.h, naturalSize.w, offset.x, offset.y, zoom]
  );

  useEffect(() => {
    if (!cropSrc || !loadedImgRef.current) return;
    const url = renderCropped(144);
    if (url) setPreviewDataUrl(url);
  }, [cropSrc, renderCropped]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    if (!ACCEPTED_TYPES.has(file.type.toLowerCase())) {
      setMsg({ type: "error", text: "Unsupported file type. Use PNG, JPG, or WebP." });
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setMsg({ type: "error", text: "Image exceeds 5 MB limit." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        loadedImgRef.current = img;
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setCropSrc(dataUrl);
      };
      img.onerror = () => setMsg({ type: "error", text: "Could not read selected image." });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const closeCrop = () => {
    setCropSrc(null);
    setPreviewDataUrl(null);
    loadedImgRef.current = null;
  };

  const handleSave = async () => {
    const fullPng = renderCropped(512);
    const thumbPng = renderCropped(128);
    if (!fullPng) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/portal/branding/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: fullPng, thumbBase64: thumbPng }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || "Failed to upload logo.");
      }
      closeCrop();
      setMsg({ type: "success", text: "Pharmacy logo updated and synced across Portal and POS." });
      await onChanged();
    } catch (err: any) {
      setMsg({ type: "error", text: err?.message || "Upload failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/portal/branding/logo", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || json.error || "Failed to remove logo.");
      setConfirmRemoveOpen(false);
      setMsg({ type: "success", text: "Pharmacy logo removed." });
      await onChanged();
    } catch (err: any) {
      setMsg({ type: "error", text: err?.message || "Removal failed." });
    } finally {
      setBusy(false);
    }
  };

  const baseScale =
    naturalSize.w > 0 && naturalSize.h > 0
      ? Math.min(CROP_VIEWPORT_PX / naturalSize.w, CROP_VIEWPORT_PX / naturalSize.h)
      : 1;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 grid place-items-center overflow-hidden shadow-xs">
            {currentLogoUrl && !imgError ? (
              <img
                src={currentLogoUrl}
                alt={pharmacyName}
                className="h-full w-full object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <Building2 className="h-6 w-6 text-slate-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900">Pharmacy Logo</p>
            <p className="text-[11px] text-slate-500">
              Displayed across Owner Portal, POS terminals, receipts, and A4 invoices.
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onFileSelected}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" />
              {currentLogoUrl && !imgError ? "Change Logo" : "Upload Logo"}
            </button>
            {currentLogoUrl && !imgError && (
              <PortalActionButton
                variant="danger"
                size="sm"
                disabled={busy}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmRemoveOpen(true)}
              >
                Remove
              </PortalActionButton>
            )}
          </div>
        )}
      </div>

      {msg && (
        <p className={`text-xs font-medium ${msg.type === "success" ? "text-emerald-700" : "text-rose-600"}`}>
          {msg.text}
        </p>
      )}

      {cropSrc && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => !busy && closeCrop()}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-extrabold text-slate-900">Crop Pharmacy Logo</h3>
              </div>
              <button type="button" onClick={closeCrop} disabled={busy} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[240px_1fr] items-start">
                <div className="space-y-2.5">
                  <div
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragging(true);
                      dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
                    }}
                    onPointerMove={(e) => {
                      if (!dragging) return;
                      setOffset({
                        x: Math.max(-200, Math.min(200, dragStartRef.current.ox + (e.clientX - dragStartRef.current.x))),
                        y: Math.max(-200, Math.min(200, dragStartRef.current.oy + (e.clientY - dragStartRef.current.y))),
                      });
                    }}
                    onPointerUp={() => setDragging(false)}
                    onPointerCancel={() => setDragging(false)}
                    className="relative mx-auto overflow-hidden rounded-xl border-2 border-emerald-500 cursor-grab active:cursor-grabbing select-none touch-none bg-slate-50"
                    style={{ width: CROP_VIEWPORT_PX, height: CROP_VIEWPORT_PX }}
                  >
                    <img
                      src={cropSrc}
                      alt="Crop"
                      draggable={false}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        width: naturalSize.w * baseScale * zoom,
                        height: naturalSize.h * baseScale * zoom,
                        maxWidth: "none",
                        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <ZoomOut className="h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="range"
                      min={0.6}
                      max={3}
                      step={0.05}
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="flex-1 accent-emerald-600"
                    />
                    <ZoomIn className="h-3.5 w-3.5 text-slate-400" />
                    <button
                      type="button"
                      onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
                      className="rounded border border-slate-200 p-1 text-slate-500 hover:text-slate-900"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Live Previews</p>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-lg border border-slate-200 bg-white p-0.5 grid place-items-center overflow-hidden shrink-0">
                      {previewDataUrl && <img src={previewDataUrl} alt="Header" className="h-full w-full object-contain" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{pharmacyName}</p>
                      <p className="text-[10px] text-slate-500">Owner Portal &amp; POS</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                    {previewDataUrl && (
                      <img src={previewDataUrl} alt="Invoice" className="mx-auto h-11 w-11 object-contain mb-1" />
                    )}
                    <p className="text-xs font-black text-slate-900 uppercase truncate">{pharmacyName}</p>
                    <p className="text-[10px] text-slate-400">RECEIPT / INVOICE HEADER</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={closeCrop}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {busy ? "Saving..." : "Save Logo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <PortalConfirmModal
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={handleRemove}
        loading={busy}
        tone="danger"
        title="Remove Custom Pharmacy Logo?"
        description="Your pharmacy logo will be removed from Owner Portal, POS receipts, and invoices, reverting to the default monogram."
        details={pharmacyName}
        confirmLabel="Yes, Remove Logo"
      />
    </div>
  );
}
