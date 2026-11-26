"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Zap,
  Upload,
  Copy,
  Check,
  Download,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  KeyRound,
  Building2,
  User,
  CalendarPlus,
  Award,
  Ban,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface CreatedTrialResult {
  license_id: string;
  license_key: string;
  trial_days: number;
  expires_at: string;
  client_name: string;
  pharmacy_name: string;
  logo_url: string | null;
  filename: string;
  size_bytes: number;
  content_base64: string;
}

interface TrialRow {
  id: string;
  license_key: string;
  status: string;
  trial_state: "active" | "expired" | "converted" | "suspended";
  is_trial: boolean;
  trial_days: number;
  expires_at: string | null;
  issued_at: string;
  issued_by: string;
  seats: number;
  seats_used: number;
  client_name: string;
  pharmacy_name: string;
  phone: string | null;
  city: string | null;
  logo_url: string | null;
}

function downloadBase64File(filename: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

export default function QuickTrialPage() {
  const [clientName, setClientName] = useState("");
  const [pharmacyName, setPharmacyName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [trialDays, setTrialDays] = useState(3);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoBase64, setLogoBase64] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedTrialResult | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [trials, setTrials] = useState<TrialRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadTrials = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/quick-trial", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setTrials(data.trials || []);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadTrials();
  }, [loadTrials]);

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a PNG, JPG, or WebP logo image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setLogoPreview(dataUrl);
    setLogoBase64(dataUrl);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !pharmacyName.trim()) {
      toast.error("Client Name and Pharmacy Name are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/quick-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName.trim(),
          pharmacy_name: pharmacyName.trim(),
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          trial_days: trialDays,
          logo_base64: logoBase64 || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to generate trial license");
      }
      setCreated(data);
      toast.success(`Quick ${trialDays}-Day Trial generated for ${pharmacyName.trim()}!`);
      setClientName("");
      setPharmacyName("");
      setPhone("");
      setCity("");
      setLogoPreview(null);
      setLogoBase64("");
      if (fileRef.current) fileRef.current.value = "";
      await loadTrials();
    } catch (err: any) {
      toast.error(err?.message || "Could not create trial");
    } finally {
      setCreating(false);
    }
  };

  const handleTrialAction = async (
    row: TrialRow,
    action: "extend" | "convert_full" | "suspend",
    extra?: { extend_days?: number; full_days?: number }
  ) => {
    const label =
      action === "extend"
        ? `Extend trial for "${row.pharmacy_name}" by +${extra?.extend_days || 3} days?`
        : action === "convert_full"
        ? `Convert "${row.pharmacy_name}" from Trial Mode to a Full Active License (1 Year)?`
        : `Suspend trial license for "${row.pharmacy_name}"?`;
    if (!window.confirm(label)) return;

    setBusyId(row.id);
    try {
      const res = await fetch("/api/admin/quick-trial", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_id: row.id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Update failed");
      toast.success(
        action === "extend"
          ? `Trial extended (+${extra?.extend_days || 3} days) — POS will unlock automatically!`
          : action === "convert_full"
          ? "Converted to Full Active License!"
          : "Trial license suspended."
      );
      await loadTrials();
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleRedownloadAivra = async (row: TrialRow) => {
    setBusyId(row.id);
    try {
      const res = await fetch(
        `/api/admin/quick-trial?download_license_id=${encodeURIComponent(row.id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Download failed");
      downloadBase64File(data.filename, data.content_base64);
      toast.success(`Downloaded ${data.filename}`);
    } catch (err: any) {
      toast.error(err?.message || "Could not download .aivra file");
    } finally {
      setBusyId(null);
    }
  };

  const copyShareMessage = (info: { pharmacy_name: string; license_key: string; trial_days: number; expires_at: string | null }) => {
    const expiryText = info.expires_at ? new Date(info.expires_at).toLocaleString() : `${info.trial_days} days`;
    const msg =
      `Assalam-o-Alaikum! Your ${info.trial_days}-Day AivraSol Pharmacy POS Trial is ready for *${info.pharmacy_name}*.\n\n` +
      `License Key:\n${info.license_key}\n\n` +
      `How to activate (No .aivra file needed!):\n` +
      `1. Open AivraSol POS\n` +
      `2. Paste the License Key above and click "Unlock"\n\n` +
      `Valid until: ${expiryText}`;
    navigator.clipboard?.writeText(msg).catch(() => {});
    toast.success("Trial WhatsApp message copied!");
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 px-3 py-0.5 text-xs font-bold text-orange-700 dark:text-orange-300 mb-2">
            <Zap className="h-3.5 w-3.5" /> Instant Trial Provisioning · Zero Disturbance to Standard Flow
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Quick 3-Day Trial Generator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter just Client Name, Pharmacy Name &amp; Logo to instantly generate a ready-to-use <strong>License Key</strong> + <strong>.aivra</strong> file. Unlocks full updated POS in <strong>Trial Mode</strong> and auto-locks after 3 days unless extended.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTrials()} disabled={loadingList}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingList ? "animate-spin" : ""}`} /> Refresh Trials
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr,1fr]">
        {/* Left: Instant Form */}
        <Card className="border-orange-200/70 dark:border-orange-900/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-600" /> Issue New Instant Trial
            </CardTitle>
            <CardDescription>
              Automatically creates Client, Project, 3-Day Trial License &amp; signed .aivra bundle in 1 step.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" /> Client Name *
                  </Label>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Muhammad Usman"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Pharmacy Name *
                  </Label>
                  <Input
                    value={pharmacyName}
                    onChange={(e) => setPharmacyName(e.target.value)}
                    placeholder="e.g. Al-Shifa Pharmacy"
                    required
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label>Phone (Optional)</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0300-1234567"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>City / Address (Optional)</Label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Lahore"
                  />
                </div>
              </div>

              {/* Trial Duration */}
              <div className="space-y-1.5">
                <Label>Trial Auto-Lock Duration</Label>
                <div className="flex flex-wrap gap-2">
                  {[3, 5, 7, 14].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTrialDays(d)}
                      className={`px-3.5 py-1.5 rounded-lg border text-xs font-bold transition ${
                        trialDays === d
                          ? "border-orange-600 bg-orange-600 text-white"
                          : "border-input bg-background hover:bg-muted"
                      }`}
                    >
                      {d} Days {d === 3 ? "(Default)" : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* Logo Upload */}
              <div className="space-y-1.5">
                <Label>Pharmacy Logo (Optional — Auto-Synced into POS)</Label>
                <div className="flex items-center gap-3.5 rounded-xl border border-dashed p-3 bg-muted/20">
                  <div className="h-14 w-14 rounded-xl border bg-white flex items-center justify-center overflow-hidden shrink-0">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain p-1" />
                    ) : (
                      <Upload className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        {logoPreview ? "Change Logo" : "Upload Logo"}
                      </Button>
                      {logoPreview && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setLogoPreview(null);
                            setLogoBase64("");
                            if (fileRef.current) fileRef.current.value = "";
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      PNG, JPG, or WebP (max 2 MB). Automatically appears on POS receipts &amp; lock screen.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={creating}
                className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white font-bold"
              >
                <Zap className="h-4 w-4 mr-2" />
                {creating
                  ? "Generating Trial License & .aivra…"
                  : `Generate ${trialDays}-Day Trial License & .aivra`}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right: Instant Result Card */}
        <Card className={created ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/10" : ""}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              {created ? "Trial Ready to Share!" : "How Instant Trial Works"}
            </CardTitle>
            <CardDescription>
              {created
                ? `Generated for ${created.pharmacy_name} (${created.client_name})`
                : "Fast activation with just the License Key — or with the .aivra file."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {created ? (
              <>
                <div className="rounded-xl border border-emerald-200 bg-white dark:bg-slate-900 p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Trial License Key (Works Alone — No .aivra Needed!)
                    </span>
                    <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100">
                      {created.trial_days}-Day Trial
                    </Badge>
                  </div>
                  <div className="font-mono text-base sm:text-lg font-extrabold tracking-wide text-emerald-700 dark:text-emerald-400 break-all">
                    {created.license_key}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Auto-locks on:{" "}
                    <strong className="text-foreground">
                      {new Date(created.expires_at).toLocaleString()}
                    </strong>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard?.writeText(created.license_key).catch(() => {});
                      setCopiedKey(true);
                      toast.success("Trial License Key copied!");
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                  >
                    {copiedKey ? (
                      <>
                        <Check className="h-4 w-4 mr-1.5 text-emerald-600" /> Key Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1.5" /> Copy License Key
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    onClick={() => downloadBase64File(created.filename, created.content_base64)}
                  >
                    <Download className="h-4 w-4 mr-1.5" /> Download .aivra File
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    copyShareMessage({
                      pharmacy_name: created.pharmacy_name,
                      license_key: created.license_key,
                      trial_days: created.trial_days,
                      expires_at: created.expires_at,
                    })
                  }
                >
                  <MessageSquare className="h-4 w-4 mr-1.5" /> Copy WhatsApp Activation Instructions
                </Button>
              </>
            ) : (
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">Key-Only Instant Unlock:</strong> Send just the generated <code className="font-mono text-xs">AIVRA-...</code> key to the pharmacy — they paste it on the POS Activation screen and click Unlock (no <code className="font-mono text-xs">.aivra</code> file needed!).
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Download className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">.aivra Included Too:</strong> A signed <code className="font-mono text-xs">.aivra</code> package is also created immediately if you prefer offline file activation.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Clock className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">Strict 3-Day Auto-Lock:</strong> POS runs full updated software with a clean <em>Trial Mode</em> badge and automatically locks after 3 days until you click <em>Extend</em> or <em>Convert to Full</em> below.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">Standard Flows Untouched:</strong> Your normal Clients, Projects, Licenses, and Packages workflows continue working identically.
                  </span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Issued Trials Directory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issued Trial Licenses ({trials.length})</CardTitle>
          <CardDescription>
            Extend active/expired trials in 1 click, convert them to full paid licenses, or re-download their .aivra package.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-3 px-4 text-left">Pharmacy / Client</th>
                  <th className="py-3 px-4 text-left">License Key</th>
                  <th className="py-3 px-4 text-left">Mode &amp; Expiry</th>
                  <th className="py-3 px-4 text-left">Issued By</th>
                  <th className="py-3 px-4 text-right">Quick Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingList ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      Loading quick trials…
                    </td>
                  </tr>
                ) : trials.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      No quick trials issued yet. Use the form above to generate your first 3-day trial!
                    </td>
                  </tr>
                ) : (
                  trials.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {row.logo_url ? (
                            <img
                              src={row.logo_url}
                              alt={row.pharmacy_name}
                              className="h-9 w-9 rounded-lg border bg-white object-contain p-0.5 shrink-0"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg border bg-muted flex items-center justify-center shrink-0">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{row.pharmacy_name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {row.client_name}
                              {row.city ? ` · ${row.city}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono text-xs font-bold">{row.license_key}</code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(row.license_key).catch(() => {});
                              toast.success("Key copied!");
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Copy key"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Seats used: {row.seats_used}/{row.seats}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {row.trial_state === "converted" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Full Active
                          </Badge>
                        ) : row.trial_state === "expired" ? (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" /> Trial Expired (Locked)
                          </Badge>
                        ) : row.trial_state === "suspended" ? (
                          <Badge variant="outline" className="text-rose-600 border-rose-300">
                            Suspended
                          </Badge>
                        ) : (
                          <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100">
                            <Clock className="h-3 w-3 mr-1" /> Trial · {formatRemaining(row.expires_at)}
                          </Badge>
                        )}
                        {row.expires_at && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Ends: {new Date(row.expires_at).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-semibold">{row.issued_by}</div>
                        <div className="text-muted-foreground">
                          {new Date(row.issued_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === row.id}
                            onClick={() => void handleTrialAction(row, "extend", { extend_days: 3 })}
                            title="Extend expiry by +3 days"
                          >
                            <CalendarPlus className="h-3.5 w-3.5 mr-1" /> +3d
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === row.id}
                            onClick={() => void handleTrialAction(row, "extend", { extend_days: 7 })}
                            title="Extend expiry by +7 days"
                          >
                            +7d
                          </Button>
                          {row.is_trial && (
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={busyId === row.id}
                              onClick={() => void handleTrialAction(row, "convert_full", { full_days: 365 })}
                              title="Convert Trial Mode to Full Active License"
                            >
                              <Award className="h-3.5 w-3.5 mr-1" /> Make Full
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === row.id}
                            onClick={() => void handleRedownloadAivra(row)}
                            title="Download .aivra package"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {row.status === "active" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={busyId === row.id}
                              onClick={() => void handleTrialAction(row, "suspend")}
                              title="Suspend trial"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
