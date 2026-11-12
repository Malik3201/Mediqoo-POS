"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, ShieldCheck, KeyRound, CheckCircle2 } from "lucide-react";

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid invite link. The token is missing.");
    }
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/portal/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Failed to activate account.");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/portal/dashboard"), 1500);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-[#009A4D]">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-extrabold text-slate-900">Account Activated!</h3>
        <p className="text-slate-500 text-sm">Redirecting to your Owner Portal dashboard…</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="new-password"
          className="block text-xs font-bold uppercase tracking-wider text-slate-600"
        >
          New Password
        </label>
        <div className="relative">
          <input
            id="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 pr-12 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all text-sm"
            placeholder="Minimum 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-slate-400 hover:text-slate-700"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="confirm-password"
          className="block text-xs font-bold uppercase tracking-wider text-slate-600"
        >
          Confirm Password
        </label>
        <input
          id="confirm-password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full h-12 px-4 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all text-sm"
          placeholder="Re-enter password"
        />
      </div>

      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-[#009A4D] shrink-0" />
        <span>Use at least 8 characters including letters and numbers.</span>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm font-medium px-4 py-3 rounded-xl"
          role="alert"
        >
          <svg
            className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {!token && (
        <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs font-medium">
          This invite link appears to be invalid. Please use the link from your invitation email.
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !token}
        id="activate-account-btn"
        className="w-full h-11 px-4 bg-[#059669] hover:bg-[#047857] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all text-sm shadow-xs"
      >
        {loading ? "Activating Account…" : "Set Password & Activate Account"}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#E3E8EE]">
      <div className="bg-[#0F172B] text-white px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="bg-white rounded-lg px-2 py-1 shadow-xs flex items-center">
            <img src="/logo-owner-portal.png" alt="AivraSol" className="h-5 w-auto object-contain" />
          </div>
          <span className="text-xs font-bold text-slate-300 border-l border-slate-700 pl-2.5">
            Account Activation
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" /> Encrypted
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#0F172B] border border-slate-800 shadow-xs text-emerald-400">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold text-[#0F172B] tracking-tight">
              Set Your Portal Password
            </h1>
            <p className="text-slate-600 text-xs sm:text-sm">
              Activate your AivraSol Pharmacy Owner Portal account
            </p>
          </div>

          <div className="bg-white border border-slate-300 border-t-[3px] border-t-[#059669] rounded-xl shadow-sm p-6 sm:p-7">
            <Suspense fallback={<div className="text-slate-500 text-sm text-center py-6">Loading invite…</div>}>
              <AcceptInviteForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
