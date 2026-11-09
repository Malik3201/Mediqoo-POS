"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

interface CapturedPage {
  id: string;
  originalDataUrl: string;
  dataUrl: string;
  rotation: number; // 0, 90, 180, 270
  crop: { top: number; right: number; bottom: number; left: number }; // 0..35% inset from each edge
  width: number;
  height: number;
}

interface SessionMeta {
  pharmacyLabel: string;
  terminalNumber: number | null;
  expiresAt: string;
  maxPages: number;
}

async function renderTransformedImage(
  sourceDataUrl: string,
  rotationDeg: number,
  cropPct: { top: number; right: number; bottom: number; left: number }
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rot = ((rotationDeg % 360) + 360) % 360;
      const rotCanvas = document.createElement("canvas");
      const swap = rot === 90 || rot === 270;
      const rw = swap ? img.naturalHeight : img.naturalWidth;
      const rh = swap ? img.naturalWidth : img.naturalHeight;
      rotCanvas.width = rw;
      rotCanvas.height = rh;
      const rctx = rotCanvas.getContext("2d");
      if (!rctx) return reject(new Error("Canvas unavailable"));

      rctx.save();
      rctx.translate(rw / 2, rh / 2);
      rctx.rotate((rot * Math.PI) / 180);
      rctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      rctx.restore();

      const sx = Math.round((cropPct.left / 100) * rw);
      const sy = Math.round((cropPct.top / 100) * rh);
      const sw = Math.max(64, Math.round(((100 - cropPct.left - cropPct.right) / 100) * rw));
      const sh = Math.max(64, Math.round(((100 - cropPct.top - cropPct.bottom) / 100) * rh));

      const maxDim = 2000;
      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      const outW = Math.max(64, Math.round(sw * scale));
      const outH = Math.max(64, Math.round(sh * scale));

      const outCanvas = document.createElement("canvas");
      outCanvas.width = outW;
      outCanvas.height = outH;
      const octx = outCanvas.getContext("2d");
      if (!octx) return reject(new Error("Canvas unavailable"));

      octx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
      resolve({
        dataUrl: outCanvas.toDataURL("image/jpeg", 0.88),
        width: outW,
        height: outH,
      });
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = sourceDataUrl;
  });
}

export default function MobileInvoiceScanPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [sessionState, setSessionState] = useState<"checking" | "ready" | "uploading" | "submitted" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [showCropControls, setShowCropControls] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const retakeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) {
      setSessionState("error");
      setErrorMessage("Invalid scan link.");
      return;
    }
    fetch(`/api/public/smart-purchase/mobile/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setSessionState("error");
          setErrorMessage(data.message || "This QR scan link has expired or already been used.");
          return;
        }
        setMeta({
          pharmacyLabel: data.pharmacyLabel || "AivraSol Pharmacy POS",
          terminalNumber: data.terminalNumber ?? null,
          expiresAt: data.expiresAt,
          maxPages: data.maxPages || 8,
        });
        setSessionState("ready");
      })
      .catch(() => {
        setSessionState("error");
        setErrorMessage("Network error while verifying QR code.");
      });
  }, [token]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startLiveCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError("Camera permission not granted in browser — opening device camera instead.");
      cameraInputRef.current?.click();
    }
  };

  const captureFromVideoStream = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const rawDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    stopLiveCamera();
    await addOrReplacePageFromDataUrl(rawDataUrl, false);
  };

  const addOrReplacePageFromDataUrl = async (rawDataUrl: string, replaceCurrent: boolean) => {
    const rendered = await renderTransformedImage(rawDataUrl, 0, { top: 0, right: 0, bottom: 0, left: 0 });
    const newPage: CapturedPage = {
      id: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      originalDataUrl: rawDataUrl,
      dataUrl: rendered.dataUrl,
      rotation: 0,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      width: rendered.width,
      height: rendered.height,
    };

    setPages((prev) => {
      if (replaceCurrent && prev.length > 0 && activeIndex < prev.length) {
        const next = [...prev];
        next[activeIndex] = newPage;
        return next;
      }
      const next = [...prev, newPage].slice(0, meta?.maxPages || 8);
      setActiveIndex(next.length - 1);
      return next;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, replaceCurrent = false) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      const rawUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
      await addOrReplacePageFromDataUrl(rawUrl, replaceCurrent && i === 0);
    }
  };

  const rotateActivePage = async (deltaDeg: number) => {
    const current = pages[activeIndex];
    if (!current) return;
    const nextRotation = ((current.rotation + deltaDeg) % 360 + 360) % 360;
    const rendered = await renderTransformedImage(current.originalDataUrl, nextRotation, current.crop);
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activeIndex
          ? { ...p, rotation: nextRotation, dataUrl: rendered.dataUrl, width: rendered.width, height: rendered.height }
          : p
      )
    );
  };

  const updateActiveCrop = async (edge: "top" | "right" | "bottom" | "left", value: number) => {
    const current = pages[activeIndex];
    if (!current) return;
    const clamped = Math.max(0, Math.min(35, Math.round(value)));
    const nextCrop = { ...current.crop, [edge]: clamped };
    const rendered = await renderTransformedImage(current.originalDataUrl, current.rotation, nextCrop);
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activeIndex
          ? { ...p, crop: nextCrop, dataUrl: rendered.dataUrl, width: rendered.width, height: rendered.height }
          : p
      )
    );
  };

  const movePage = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= pages.length) return;
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setActiveIndex(target);
  };

  const removePage = (idx: number) => {
    setPages((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)));
      return next;
    });
  };

  const submitInvoice = async () => {
    if (pages.length === 0 || sessionState !== "ready") return;
    setSessionState("uploading");
    setUploadProgress(15);

    const timer = setInterval(() => {
      setUploadProgress((p) => (p < 85 ? p + 12 : p));
    }, 250);

    try {
      const res = await fetch(`/api/public/smart-purchase/mobile/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: pages.map((p, idx) => ({
            pageNumber: idx + 1,
            dataUrl: p.dataUrl,
          })),
        }),
      });
      clearInterval(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setSessionState("error");
        setErrorMessage(data.message || "Could not submit invoice. Please try again.");
        return;
      }
      setUploadProgress(100);
      setSessionState("submitted");
    } catch {
      clearInterval(timer);
      setSessionState("error");
      setErrorMessage("Network connection lost during upload. Please check Wi-Fi/Mobile Data.");
    }
  };

  const activePage = pages[activeIndex];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="px-4 py-3.5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            AivraSol AI Smart Purchase
          </div>
          <h1 className="text-base font-bold text-white truncate">
            {meta?.pharmacyLabel || "Supplier Invoice Scanner"}
            {meta?.terminalNumber ? ` · Terminal #${meta.terminalNumber}` : ""}
          </h1>
        </div>
        {pages.length > 0 && sessionState === "ready" && (
          <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            {pages.length} {pages.length === 1 ? "Page" : "Pages"}
          </span>
        )}
      </header>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileChange(e, false)}
      />
      <input
        ref={retakeInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileChange(e, true)}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFileChange(e, false)}
      />

      <main className="flex-1 p-4 max-w-lg w-full mx-auto flex flex-col gap-4">
        {sessionState === "checking" && (
          <div className="my-auto text-center py-16 space-y-3">
            <div className="h-10 w-10 mx-auto rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
            <p className="text-sm text-slate-300">Connecting to desktop POS session…</p>
          </div>
        )}

        {sessionState === "error" && (
          <div className="my-auto rounded-2xl border border-rose-500/40 bg-rose-950/30 p-6 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl font-bold">
              !
            </div>
            <h2 className="text-lg font-bold text-white">Scan Session Unavailable</h2>
            <p className="text-sm text-rose-200 leading-relaxed">{errorMessage}</p>
            <p className="text-xs text-slate-400 pt-2">
              Return to your desktop POS Purchases screen and click &ldquo;Scan QR with Mobile&rdquo; to generate a fresh code.
            </p>
          </div>
        )}

        {sessionState === "submitted" && (
          <div className="my-auto rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-6 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl font-bold">
              ✓
            </div>
            <h2 className="text-xl font-bold text-white">Invoice Sent to Desktop POS</h2>
            <p className="text-sm text-emerald-200 leading-relaxed">
              {pages.length} {pages.length === 1 ? "page has" : "pages have"} been delivered securely to your desktop purchase session. AI extraction and inventory matching are starting automatically on your computer.
            </p>
            <p className="text-xs text-slate-400">You may now close this browser tab.</p>
          </div>
        )}

        {sessionState === "uploading" && (
          <div className="my-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center space-y-4">
            <h2 className="text-lg font-bold text-white">Encrypting &amp; Uploading Invoice…</h2>
            <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              Stripping camera metadata and sending {pages.length} {pages.length === 1 ? "page" : "pages"} ({uploadProgress}%)…
            </p>
          </div>
        )}

        {sessionState === "ready" && (
          <>
            {cameraError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {cameraError}
              </div>
            )}

            {/* Live WebRTC camera preview if active */}
            {cameraActive && (
              <div className="rounded-2xl border border-emerald-500/40 bg-black overflow-hidden space-y-3 p-3">
                <div className="relative aspect-[3/4] w-full bg-black rounded-xl overflow-hidden">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-4 border-2 border-dashed border-emerald-400/70 rounded-lg" />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={captureFromVideoStream}
                    className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 text-sm"
                  >
                    Capture Invoice Page
                  </button>
                  <button
                    type="button"
                    onClick={stopLiveCamera}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Empty capture prompt */}
            {!cameraActive && pages.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-center space-y-4 my-auto">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-2xl">
                  📷
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-white">Photograph Supplier Invoice</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Place the supplier bill on a flat, well-lit surface so product names, batch numbers, expiries, and prices are clear.
                  </p>
                </div>

                <div className="grid gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3.5 text-sm shadow-lg"
                  >
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={startLiveCamera}
                    className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold py-3 text-sm"
                  >
                    Live Camera Viewfinder
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium py-3 text-sm"
                  >
                    Choose from Gallery
                  </button>
                </div>
              </div>
            )}

            {/* Active Page Preview + Rotate/Crop/Retake/Reorder */}
            {!cameraActive && activePage && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Page {activeIndex + 1} of {pages.length} ({activePage.width}×{activePage.height}px)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => rotateActivePage(-90)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
                      >
                        ↺ Rotate Left
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateActivePage(90)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
                      >
                        ↻ Rotate Right
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCropControls((s) => !s)}
                        className={`rounded-lg border px-2.5 py-1 ${
                          showCropControls
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                            : "border-slate-700 bg-slate-800 text-slate-200"
                        }`}
                      >
                        ✂ Crop
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-black/80 overflow-hidden flex items-center justify-center max-h-[420px]">
                    <img
                      src={activePage.dataUrl}
                      alt={`Invoice page ${activeIndex + 1}`}
                      className="max-h-[400px] w-auto object-contain"
                    />
                  </div>

                  {showCropControls && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2 text-xs">
                      <div className="font-semibold text-slate-300">Trim Edges (% inset)</div>
                      <div className="grid grid-cols-2 gap-3">
                        {(["top", "bottom", "left", "right"] as const).map((edge) => (
                          <label key={edge} className="space-y-1">
                            <div className="flex justify-between text-slate-400 capitalize">
                              <span>{edge}</span>
                              <span>{activePage.crop[edge]}%</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={35}
                              value={activePage.crop[edge]}
                              onChange={(e) => updateActiveCrop(edge, Number(e.target.value))}
                              className="w-full accent-emerald-500"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => retakeInputRef.current?.click()}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-medium text-slate-200"
                    >
                      Retake Page
                    </button>
                    {pages.length < (meta?.maxPages || 8) && (
                      <>
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-semibold text-emerald-300"
                        >
                          + Add Another Page
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-medium text-slate-200"
                        >
                          + Gallery
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Multi-page strip & reordering */}
                {pages.length > 1 && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Page Order</div>
                    <div className="space-y-1.5">
                      {pages.map((p, idx) => (
                        <div
                          key={p.id}
                          onClick={() => setActiveIndex(idx)}
                          className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs cursor-pointer ${
                            idx === activeIndex
                              ? "border-emerald-500/60 bg-emerald-500/10 text-white"
                              : "border-slate-800 bg-slate-950/60 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <img src={p.dataUrl} alt="" className="h-9 w-9 rounded object-cover border border-slate-700" />
                            <span className="font-medium">Page {idx + 1}</span>
                          </div>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => movePage(idx, -1)}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={idx === pages.length - 1}
                              onClick={() => movePage(idx, 1)}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 disabled:opacity-40"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removePage(idx)}
                              className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-300"
                              title="Remove page"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitInvoice}
                  className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3.5 text-base shadow-lg"
                >
                  Submit Invoice ({pages.length} {pages.length === 1 ? "Page" : "Pages"})
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

