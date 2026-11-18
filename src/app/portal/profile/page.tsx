"use client";

import React, { useEffect, useState } from "react";
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
  User,
  Phone,
  MapPin,
  Mail,
  Lock,
  Layers,
  Sparkles,
} from "lucide-react";

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
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadingCard, setDownloadingCard] = useState(false);

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
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/portal/profile");
      if (!res.ok) throw new Error("Failed to load owner profile.");
      const json = await res.json();
      if (json.ok) {
        setData(json);
        setFormData({
          name: json.profile?.name || "",
          pharmacy_name: json.pharmacy?.name || "",
          phone: json.pharmacy?.phone || "",
          address: json.pharmacy?.address || "",
        });
      } else {
        throw new Error(json.error || "Failed to load profile data");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load profile.");
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
      await fetchProfile();
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Failed to save profile." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
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
      setPwMsg({ type: "success", text: "Password changed successfully! Keep it confidential." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPwMsg({ type: "error", text: err.message || "Unable to change password." });
    } finally {
      setChangingPassword(false);
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

      {/* Visual Identity Card Showcase */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0B132B] via-[#0F1E36] to-[#081B2E] border border-slate-800 p-5 sm:p-7 text-white shadow-xl relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6">
          <div className="space-y-4 max-w-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-[#0B132B] text-xl shadow-md">
                A
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-400 tracking-wider uppercase">
                  AivraSol Pharmacy Network
                </p>
                <p className="text-[11px] text-slate-400">
                  Proprietor Identity Credential
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Authorized Pharmacy
              </p>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
                {data.pharmacy.name}
              </h2>
              <p className="text-xs text-slate-300 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {data.pharmacy.address ? `${data.pharmacy.address}, ` : ""}{data.pharmacy.city}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
              <div>
                <p className="text-[10.5px] text-slate-400 uppercase font-medium">Proprietor Name</p>
                <p className="text-xs sm:text-sm font-bold text-white mt-0.5">{data.profile.name}</p>
              </div>
              <div>
                <p className="text-[10.5px] text-slate-400 uppercase font-medium">Digital License</p>
                <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5 truncate">
                  {data.pharmacy.license_key || "ACTIVE"}
                </p>
              </div>
              <div>
                <p className="text-[10.5px] text-slate-400 uppercase font-medium">Status</p>
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-300 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active & Verified
                </span>
              </div>
            </div>
          </div>

          {/* Action on Card */}
          <div className="flex flex-col sm:flex-row md:flex-col items-center justify-center gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-700/60 shrink-0 backdrop-blur-xs">
            <div className="w-20 h-20 rounded-xl bg-white p-2 flex items-center justify-center shrink-0 shadow-md">
              {data.pharmacy.logo ? (
                <img
                  src={data.pharmacy.logo}
                  alt={data.pharmacy.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full border border-slate-900 flex flex-col items-center justify-center text-center p-1 rounded-lg">
                  <Sparkles className="w-6 h-6 text-emerald-600 mb-1" />
                  <span className="text-[8px] font-black text-slate-900 leading-tight">OFFICIAL SEAL</span>
                </div>
              )}
            </div>
            <button
              onClick={downloadOwnerCardPdf}
              disabled={downloadingCard}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0B132B] font-extrabold text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
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

          <form onSubmit={handleChangePassword} className="space-y-4">
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

            <button
              type="submit"
              disabled={changingPassword}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs font-extrabold shadow-sm transition-all disabled:opacity-60 cursor-pointer"
            >
              {changingPassword ? "Updating Password…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
