"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck, Activity, Wallet, PackageCheck } from "lucide-react";

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid email or password.");
        return;
      }
      router.push("/portal/dashboard");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F4F8F6] font-sans">
      {/* Desktop Executive Branding Panel */}
      <div className="hidden lg:flex lg:w-[48%] bg-gradient-to-br from-slate-900 via-[#0C251D] to-[#052E1E] relative flex-col justify-between p-12 overflow-hidden text-white">
        <div className="absolute -top-28 -right-28 w-80 h-80 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-10">
          <div className="flex items-center gap-4">
            <img
              src="https://plain-eeur-prod-public.komododecks.com/202609/02/IqMF3ga5yS0lbwP63gtq/image.png"
              alt="AivraSol Logo"
              className="h-14 w-auto object-contain"
            />
            <div className="flex flex-col justify-center border-l border-emerald-400/30 pl-4">
              <span className="text-xl font-extrabold text-white tracking-tight leading-tight">
                Pharmacy POS
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                Owner Cloud Portal
              </span>
            </div>
          </div>

          <div className="max-w-md space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              Real-Time Store Monitoring
            </span>
            <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
              Your entire pharmacy, clearly in control.
            </h2>
            <p className="text-base text-slate-300 leading-relaxed">
              Monitor live counter sales, gross profit, cash drawer reconciliations, supplier GRNs, Khata credit recovery, and expiry risks from anywhere.
            </p>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-3 max-w-lg">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-1.5 backdrop-blur-sm">
            <Activity className="w-4 h-4 text-emerald-400" />
            <p className="text-xs font-bold text-white">Live Sales &amp; GP</p>
            <p className="text-[11px] text-slate-400 leading-snug">Verified net sales &amp; WAC margins</p>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-1.5 backdrop-blur-sm">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <p className="text-xs font-bold text-white">Cash &amp; Khata</p>
            <p className="text-[11px] text-slate-400 leading-snug">Shift variances &amp; customer dues</p>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-1.5 backdrop-blur-sm">
            <PackageCheck className="w-4 h-4 text-emerald-400" />
            <p className="text-xs font-bold text-white">Stock Guard</p>
            <p className="text-[11px] text-slate-400 leading-snug">Expiry alerts &amp; price changes</p>
          </div>
        </div>
      </div>

      {/* Right Panel — Mobile-First Flow (Zero Absolute Overlap) */}
      <div className="w-full lg:w-[52%] flex flex-col justify-center items-center p-5 sm:p-10 bg-white lg:bg-[#F4F8F6]">
        {/* Mobile Header (Normal Flow, Responsive Spacing) */}
        <div className="w-full max-w-md lg:hidden flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <img
              src="https://plain-eeur-prod-public.komododecks.com/202609/02/IqMF3ga5yS0lbwP63gtq/image.png"
              alt="AivraSol"
              className="h-9 w-auto object-contain"
            />
            <div className="flex flex-col border-l border-slate-200 pl-2.5">
              <span className="font-extrabold text-slate-900 text-xs leading-none">
                AivraSol Pharmacy
              </span>
              <span className="font-bold text-[#009A4D] text-[11px] leading-none mt-1">
                Owner Portal
              </span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[#009A4D] text-[10px] font-bold">
            <ShieldCheck className="w-3 h-3" /> Cloud Sync
          </span>
        </div>

        <div className="w-full max-w-md lg:bg-white lg:rounded-3xl lg:border lg:border-slate-200/80 lg:shadow-lg lg:shadow-slate-900/5 lg:p-9">
          <div className="mb-7 space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Owner Sign In
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Sign in to monitor your pharmacy&apos;s live daily performance.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="portal-email"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600"
              >
                Email address
              </label>
              <input
                id="portal-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 px-4 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all text-sm shadow-2xs"
                placeholder="you@pharmacy.com"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="portal-password"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="portal-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 pr-12 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all text-sm shadow-2xs"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-slate-400 hover:text-slate-700 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm font-medium px-4 py-3 rounded-xl"
                role="alert"
              >
                <svg
                  className="w-4 h-4 flex-shrink-0 text-red-500"
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

            <button
              type="submit"
              disabled={loading}
              id="portal-login-btn"
              className="w-full h-12 px-4 bg-[#009A4D] hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all text-sm shadow-sm shadow-emerald-600/20 flex items-center justify-center"
            >
              {loading && (
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {loading ? "Signing in…" : "Sign In to Owner Portal"}
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-slate-400">
            Encrypted POS Snapshot Sync • Designed for Pharmacy Owners
          </p>
        </div>
      </div>
    </div>
  );
}
