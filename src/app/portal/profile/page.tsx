"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Building2,
  KeyRound,
  Download,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  MapPin,
  Lock,
  LogOut,
} from "lucide-react";
import { PortalPharmacyLogoCard } from "@/components/portal/pharmacy-logo-card";
import { PortalActionButton, PortalConfirmModal } from "@/components/portal/PortalUI";
import {
  clearPortalSessionCache,
  fetchPortalCached,
  getPortalCached,
  invalidatePortalCache,
} from "@/lib/portal-cache";

interface ProfileData {
  profile: {
    id: string;
    name: string;
    email: string;
    role: string;
    last_login_at?: string;
    created_at?: string;
  };
  pharmacy: {
    id: string;
    name: string;
    logo?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string;
    timezone?: string;
    license_key?: string | null;
    plan_name?: string;
    license_status?: string;
    expires_at?: string | null;
    active_terminals?: number;
  };
}

export default function OwnerProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmPwOpen, setConfirmPwOpen] = useState(false);

  // Edit Profile state
  const [isEditing, setIsEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    pharmacy_name: "",
    phone: "",
    address: "",
  });

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void fetchProfile(false);
  }, []);

  function applyProfile(json: any) {
    setData(json);
    setFormData({
      name: json.profile?.name || "",
      pharmacy_name: json.pharmacy?.name || "",
      phone: json.pharmacy?.phone || "",
      address: json.pharmacy?.address || "",
    });
  }

  async function fetchProfile(forceRefresh = false) {
    const url = "/api/portal/profile";
    const cached = getPortalCached<any>(url, 60_000);
    if (cached && cached.data?.ok) {
      applyProfile(cached.data);
      setLoading(false);
      if (!forceRefresh && cached.isFresh) return;
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const { data: json } = await fetchPortalCached<any>(url, {
        ttlMs: 60_000,
        forceRefresh,
      });
      if (json.ok) {
        applyProfile(json);
      } else {
        throw new Error(json.error || "Failed to load profile data");
      }
    } catch (err: any) {
      if (!cached) setError(err.message || "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSavingProfile(true);
      setProfileMsg(null);
      const res = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || "Failed to update profile.");
      }
      setProfileMsg({ type: "success", text: "Profile details updated successfully!" });
      setIsEditing(false);
      invalidatePortalCache("/api/portal/profile");
      invalidatePortalCache("/api/portal/overview");
      await fetchProfile(true);
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Failed to save profile." });
    } finally {
      setSavingProfile(false);
    }
  }

  function handleChangePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);

    if (!currentPassword || !newPassword) {
      setPwMsg({ type: "error", text: "Please enter your current and new password." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "error", text: "New password and confirmation do not match." });
      return;
    }

    if (newPassword.length < 8) {
      setPwMsg({ type: "error", text: "New password must be at least 8 characters long." });
      return;
    }

    setConfirmPwOpen(true);
  }

  async function executeChangePassword() {
    try {
      setChangingPassword(true);
      const res = await fetch("/api/portal/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || "Failed to change password.");
      }
      setConfirmPwOpen(false);
      setPwMsg({ type: "success", text: "Password changed successfully! Keep it confidential." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setConfirmPwOpen(false);
      setPwMsg({ type: "error", text: err.message || "Unable to change password." });
    } finally {
      setChangingPassword(false);
    }
  }

  async function executeProfileLogout() {
    setLoggingOut(true);
    try {
      clearPortalSessionCache();
      await fetch("/api/portal/auth/logout", { method: "POST" });
      setConfirmLogoutOpen(false);
      router.replace("/portal/login");
    } finally {
      setLoggingOut(false);
    }
  }

  async function downloadOwnerCardPdf() {
    try {
      setDownloadingCard(true);
      const res = await fetch("/api/portal/profile/card-pdf");
      if (!res.ok) throw new Error("Card download request failed.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanName = (data?.pharmacy.name || "AivraSol_Pharmacy").replace(/[^a-zA-Z0-9_-]/g, "_");
      a.download = `Owner-Card-${cleanName}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert("Failed to download Owner Card: " + (err.message || String(err)));
    } finally {
      setDownloadingCard(false);
    }
  }

  function copyLicenseKey() {
    if (!data?.pharmacy.license_key) return;
    navigator.clipboard.writeText(data.pharmacy.license_key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-slate-600">Loading verified owner credentials…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error || "Failed to load profile details."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-300 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-extrabold uppercase tracking-wider mb-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Verified Pharmacy Proprietor
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Owner Profile & Identity Card
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Official pharmacy credentials, encryption keys, and digital proprietor verification.
          </p>
        </div>

        <button
          onClick={downloadOwnerCardPdf}
          disabled={downloadingCard}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-extrabold text-sm shadow-sm transition-all shrink-0 cursor-pointer disabled:opacity-70"
        >
          {downloadingCard ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Download Official Owner Card (PDF)
        </button>
      </div>

      {/* Compact Executive Owner Card Showcase */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Authentic Compact Owner Identity Card (Pearl White + Deep Forest-Emerald CR-80 Design) */}
        <div className="lg:col-span-6 flex justify-center lg:justify-start">
          <div className="w-full max-w-[440px] rounded-2xl overflow-hidden border border-slate-300/90 shadow-xl bg-white relative flex min-h-[258px]">
            {/* Left Vertical Brand Accent Spine */}
            <div className="w-1.5 shrink-0 flex flex-col">
              <div className="flex-[3] bg-[#009A4D]" />
              <div className="flex-[2] bg-[#04291F]" />
            </div>

            {/* Left Pearl-White Main Credential Surface */}
            <div className="flex-1 min-w-0 relative flex flex-col justify-between p-4 pr-3 bg-white overflow-hidden">
              {/* Subtle translucent AivraSol watermark */}
              <img
                src="/logo-aivrasol-voucher.png"
                alt=""
                aria-hidden="true"
                className="pointer-events-none select-none absolute right-2 top-14 w-28 h-28 object-contain opacity-[0.045]"
              />

              {/* Top Brand Lockup */}
              <div className="relative z-10 flex items-center gap-2.5 pb-2.5 border-b border-emerald-950/10">
                <img
                  src="/logo-aivrasol-voucher.png"
                  alt="AivraSol"
                  className="h-8 w-8 object-contain shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-[10.5px] font-black tracking-wider text-[#053427] uppercase leading-tight truncate">
                    AivraSol Technologies
                  </p>
                  <p className="text-[7.5px] font-extrabold text-[#009A4D] uppercase tracking-widest leading-tight mt-0.5 truncate">
                    Official Owner Identity Card
                  </p>
                </div>
              </div>

              {/* Center Pharmacy & Proprietor Details */}
              <div className="relative z-10 space-y-2.5 py-2.5">
                <div>
                  <p className="text-[7.5px] font-bold uppercase tracking-widest text-slate-400">
                    Authorized Pharmacy
                  </p>
                  <h2 className="text-sm sm:text-[15px] font-black text-[#0B1F19] tracking-tight uppercase truncate leading-snug mt-0.5">
                    {data.pharmacy.name}
                  </h2>
                  <p className="text-[9.5px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 text-[#009A4D] shrink-0" />
                    <span className="truncate">
                      {data.pharmacy.address ? `${data.pharmacy.address} · ` : ""}
                      {data.pharmacy.city || "Pakistan"}
                    </span>
                  </p>
                </div>

                <div>
                  <p className="text-[7.5px] font-bold uppercase tracking-widest text-slate-400">
                    Registered Proprietor
                  </p>
                  <p className="text-xs sm:text-[13px] font-extrabold text-[#064E3B] uppercase truncate mt-0.5">
                    {data.profile.name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div className="min-w-0">
                    <p className="text-[7px] font-bold uppercase tracking-widest text-slate-400">Contact</p>
                    <p className="text-[10px] font-bold text-slate-900 truncate mt-0.5">
                      {data.pharmacy.phone || "+92 300 0000000"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[7px] font-bold uppercase tracking-widest text-slate-400">Plan</p>
                    <p className="text-[10px] font-bold text-slate-900 uppercase truncate mt-0.5">
                      {data.pharmacy.plan_name || "Enterprise POS"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Signature & Branding Row */}
              <div className="relative z-10 pt-2 border-t border-emerald-950/10 flex items-end justify-between gap-2 bg-[#F7FBF9] -mx-4 -mb-4 px-4 py-2">
                <div>
                  <svg viewBox="0 0 225 58" className="w-16 h-4 overflow-visible" fill="none">
                    <path
                      d="M 16 44 C 21 20, 31 6, 38 8 C 44 10, 39 34, 34 44 C 33 46, 42 26, 49 23 C 54 21, 52 36, 57 36 C 62 36, 67 11, 63 9 C 59 7, 56 35, 64 36 C 70 37, 75 23, 72 21 C 68 19, 67 35, 74 36 C 79 36, 82 26, 85 35 C 88 36, 94 11, 90 9 C 86 7, 84 35, 92 36 C 96 25, 102 24, 105 34 C 108 35, 114 24, 110 22 C 106 20, 105 35, 113 35 C 118 35, 124 10, 120 8 C 116 6, 115 35, 121 35 C 125 25, 129 25, 132 35 C 135 25, 140 25, 143 34 C 146 25, 151 25, 154 34 C 158 35, 164 24, 160 22 C 156 20, 155 35, 163 35 C 168 25, 173 25, 177 34 C 181 25, 187 26, 192 35 C 197 37, 206 31, 214 22"
                      stroke="#0F172A"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 12 27 C 46 22, 92 19, 134 17 M 22 49 C 72 41, 146 38, 208 41 C 216 42, 188 49, 154 52"
                      stroke="#009A4D"
                      strokeWidth="2.0"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="w-20 border-t border-slate-400/70 pt-0.5 text-[6.5px] font-bold tracking-wider text-slate-600 uppercase">
                    Authorized Signatory
                  </div>
                  <p className="text-[7px] font-extrabold text-[#009A4D] leading-tight">
                    AivraSol Technologies
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[7px] font-bold uppercase tracking-wider text-slate-400">Portal</p>
                  <p className="text-[8.5px] font-semibold text-slate-600">www.aivrasol.com</p>
                </div>
              </div>
            </div>

            {/* Right Deep Pharmacy Forest-Emerald Credential Wing */}
            <div className="w-[144px] sm:w-[152px] shrink-0 bg-gradient-to-b from-[#063B2C] via-[#04291F] to-[#021B14] border-l-[3px] border-[#009A4D] p-3 text-white flex flex-col items-center justify-between text-center relative overflow-hidden">
              {/* Subtle Gold Edge Accent */}
              <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-amber-400/50" />
              {/* Concentric Security Rings */}
              <div className="pointer-events-none absolute -right-10 -bottom-10 w-36 h-36 rounded-full border border-emerald-400/15" />
              <div className="pointer-events-none absolute -right-6 -bottom-6 w-28 h-28 rounded-full border border-emerald-400/15" />

              {/* Status Badge */}
              <span className="relative z-10 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#064E3B] border border-emerald-500/80 text-[8.5px] font-extrabold tracking-wider text-emerald-50 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {data.pharmacy.license_status === "active" || !data.pharmacy.license_status
                  ? "VERIFIED"
                  : data.pharmacy.license_status.toUpperCase()}
              </span>

              {/* Pharmacy Crest / Custom Logo */}
              <div className="relative z-10 flex flex-col items-center gap-2.5 my-1">
                {data.pharmacy.logo ? (
                  <div className="w-12 h-12 rounded-xl bg-white border border-emerald-400/80 p-1 flex items-center justify-center shadow-sm">
                    <img
                      src={data.pharmacy.logo}
                      alt={data.pharmacy.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#064E3B] border border-emerald-400/70 p-0.5 shadow-sm">
                    <div className="w-full h-full rounded-[9px] border border-amber-300/45 flex flex-col items-center justify-center">
                      <span className="text-base font-black text-white leading-none">
                        {data.pharmacy.name
                          .trim()
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((w) => w[0]?.toUpperCase() || "")
                          .join("") || "AP"}
                      </span>
                      <span className="text-[6px] font-bold tracking-widest text-emerald-300 mt-0.5 uppercase">
                        OWNER
                      </span>
                    </div>
                  </div>
                )}

                {/* Champagne-Gold Smart EMV Chip */}
                <div className="w-8 h-5 rounded-[4px] bg-gradient-to-br from-[#F3DA8B] via-[#DFB958] to-[#B68E31] border border-amber-300/80 p-0.5 shadow-xs">
                  <div className="w-full h-full border border-amber-950/35 rounded-[2px] flex items-center justify-center">
                    <div className="w-3 h-full border-x border-amber-950/35" />
                  </div>
                </div>
              </div>

              {/* License Key & Pass ID */}
              <div className="relative z-10 w-full space-y-1.5">
                <div>
                  <p className="text-[6.5px] font-bold uppercase tracking-widest text-emerald-300/90">
                    License Key
                  </p>
                  <div className="mt-0.5 px-1.5 py-1 rounded bg-[#021B14] border border-emerald-500/60 font-mono text-[8.5px] font-bold text-emerald-300 truncate">
                    {data.pharmacy.license_key || "AIVRA-PRO"}
                  </div>
                </div>
                <div>
                  <p className="text-[6.5px] font-bold uppercase tracking-widest text-emerald-300/85">
                    Pass ID · Seats
                  </p>
                  <p className="font-mono text-[8.5px] font-bold text-emerald-50 truncate mt-0.5">
                    #{(data.pharmacy.id || "0001").replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() || "0001"} ·{" "}
                    {Math.max(1, data.pharmacy.active_terminals ?? 1)} Seat
                    {Math.max(1, data.pharmacy.active_terminals ?? 1) === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="pt-1 border-t border-emerald-400/20 text-[6.5px] font-bold tracking-widest text-emerald-300/90 uppercase">
                  AivraSol Cloud Verified
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Executive Credential Summary & Download Actions */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-300/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 leading-tight">
                    Executive Owner Credential
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Compact CR-80 ID card · Issued by AivraSol Technologies
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10.5px] font-bold">
                CR-80 Format
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Your digital Owner Card authenticates pharmacy proprietorship, active software licensing, and registered cloud terminals under AivraSol Technologies.
            </p>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Active Terminals</p>
                <p className="text-sm font-black text-slate-900 mt-0.5">
                  {Math.max(1, data.pharmacy.active_terminals ?? 1)} Seat
                  {Math.max(1, data.pharmacy.active_terminals ?? 1) === 1 ? "" : "s"}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Region / City</p>
                <p className="text-sm font-black text-slate-900 mt-0.5 truncate">
                  {data.pharmacy.city || "Pakistan"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200">
            <button
              onClick={downloadOwnerCardPdf}
              disabled={downloadingCard}
              className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#009A4D] hover:bg-[#047857] active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm shadow-sm transition-all cursor-pointer disabled:opacity-70"
            >
              {downloadingCard ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Download Official Owner Card (PDF)
            </button>
            {data.pharmacy.license_key && (
              <button
                type="button"
                onClick={copyLicenseKey}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/60 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
                title="Copy License Key"
              >
                {copiedKey ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Two-Column Forms: Profile Details & Password Security */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Pharmacy & Owner Information (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-300/90 p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-extrabold text-slate-900">
                Pharmacy & Proprietor Information
              </h3>
            </div>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-3 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                Edit Info
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1 rounded-lg border border-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>

          {profileMsg && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                profileMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              {profileMsg.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              {profileMsg.text}
            </div>
          )}

          {!isEditing ? (
            <div className="space-y-4">
              <PortalPharmacyLogoCard
                pharmacyName={data.pharmacy.name}
                currentLogoUrl={data.pharmacy.logo}
                canEdit={data.profile.role === "owner" || data.profile.role === "admin"}
                onChanged={() => {
                  invalidatePortalCache("/api/portal/profile");
                  return fetchProfile(true);
                }}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">Pharmacy Legal Name</p>
                  <p className="text-sm font-extrabold text-slate-900 mt-1">{data.pharmacy.name}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">Proprietor Name</p>
                  <p className="text-sm font-extrabold text-slate-900 mt-1">{data.profile.name}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">Account Email</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1 truncate">{data.profile.email}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">Contact Phone</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">
                    {data.pharmacy.phone || "Not configured"}
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Registered Address</p>
                <p className="text-sm font-medium text-slate-800 mt-1">
                  {data.pharmacy.address || "Main Commercial Market"}
                </p>
              </div>

              {/* License Details Panel */}
              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      License & Cloud Subscription
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10.5px] font-extrabold">
                    {data.pharmacy.plan_name}
                  </span>
                </div>

                {data.pharmacy.license_key && (
                  <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="font-mono text-xs text-emerald-400 select-all truncate">
                      {data.pharmacy.license_key}
                    </span>
                    <button
                      onClick={copyLicenseKey}
                      className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer shrink-0 ml-2"
                      title="Copy License Key"
                    >
                      {copiedKey ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>Active Terminals: {data.pharmacy.active_terminals ?? 1}</span>
                  <span>Timezone: {data.pharmacy.timezone || "Asia/Karachi"}</span>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Pharmacy Name
                </label>
                <input
                  type="text"
                  value={formData.pharmacy_name}
                  onChange={(e) => setFormData({ ...formData, pharmacy_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:outline-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Proprietor / Owner Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:outline-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Contact Phone Number
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-emerald-500"
                  placeholder="+92 300 1234567"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Registered Address
                </label>
                <textarea
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-emerald-500"
                  placeholder="Phase 2, Boolmind near Nisar charsi tikka"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {savingProfile ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Column: Security & Change Password (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-300/90 p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <Lock className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-extrabold text-slate-900">
              Security & Password
            </h3>
          </div>

          <p className="text-xs text-slate-500">
            Update your Owner Portal login credentials. Requires entering your existing password for verification.
          </p>

          {pwMsg && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                pwMsg.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              {pwMsg.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              {pwMsg.text}
            </div>
          )}

          <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrentPw ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-emerald-500 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNewPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-emerald-500 pr-10"
                  placeholder="Min. 8 characters with letters & numbers"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-emerald-500"
                required
              />
            </div>

            <PortalActionButton
              type="submit"
              variant="dark"
              size="md"
              fullWidth
              loading={changingPassword}
              loadingText="Updating Password…"
            >
              Update Password
            </PortalActionButton>
          </form>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold text-[#0F172A]">Active Portal Session</p>
              <p className="text-[11px] text-slate-500">Sign out safely from this device</p>
            </div>
            <PortalActionButton
              variant="danger"
              size="sm"
              icon={<LogOut className="w-3.5 h-3.5" />}
              onClick={() => setConfirmLogoutOpen(true)}
            >
              Sign Out
            </PortalActionButton>
          </div>
        </div>
      </div>

      {/* Password Update Confirmation Modal */}
      <PortalConfirmModal
        open={confirmPwOpen}
        onClose={() => setConfirmPwOpen(false)}
        onConfirm={executeChangePassword}
        loading={changingPassword}
        tone="warning"
        title="Update Owner Portal Password?"
        description="Your Owner Portal login password will be updated immediately. Make sure you remember your new password."
        details={`Account: ${data.profile.email}`}
        confirmLabel="Yes, Update Password"
      />

      {/* Sign Out Confirmation Modal */}
      <PortalConfirmModal
        open={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        onConfirm={executeProfileLogout}
        loading={loggingOut}
        tone="danger"
        title="Log out of Owner Portal?"
        description="You will be signed out of your pharmacy owner session on this device."
        details={`${data.pharmacy.name} (${data.profile.email})`}
        confirmLabel="Yes, Log Out"
        cancelLabel="Stay Logged In"
      />
    </div>
  );
}
