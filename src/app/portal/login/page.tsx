"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Building2 } from "lucide-react";

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
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* ─── LEFT PANEL (BRANDING) ─── */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative flex-col justify-between overflow-hidden">
        {/* Background Decorative Pattern */}
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-emerald-800 via-slate-900 to-slate-900" />
        </div>

        <div className="relative z-10 p-12">
          <div className="flex items-center gap-4 mb-12">
            <img src="https://plain-eeur-prod-public.komododecks.com/202609/02/IqMF3ga5yS0lbwP63gtq/image.png" alt="AivraSol Logo" className="h-20 w-auto object-contain" />
            <div className="flex flex-col justify-center border-l-2 border-slate-700 pl-4">
              <span className="text-2xl font-bold text-white tracking-tight leading-tight">Pharmacy</span>
              <span className="text-2xl font-light text-emerald-400 tracking-tight leading-tight">POS</span>
            </div>
          </div>
          <div className="max-w-md">
            <h2 className="text-4xl font-bold text-white leading-tight mb-6">
              Your pharmacy, at a glance.
            </h2>
            <p className="text-lg text-slate-400 mb-8 leading-relaxed">
              Track sales, profit, inventory and business performance from anywhere, securely synchronized with your POS terminals.
            </p>
          </div>
        </div>
      </div>

      {/* ─── RIGHT PANEL (LOGIN) ─── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 relative bg-white">
        {/* Mobile Logo */}
        <div className="absolute top-6 left-6 lg:hidden flex items-center gap-3">
          <img src="https://plain-eeur-prod-public.komododecks.com/202609/02/IqMF3ga5yS0lbwP63gtq/image.png" alt="AivraSol" className="h-10 w-auto object-contain" />
          <div className="flex flex-col justify-center border-l-2 border-slate-200 pl-3 h-10">
            <span className="font-bold text-slate-800 text-xs leading-none tracking-tight">Pharmacy</span>
            <span className="font-bold text-emerald-600 text-xs leading-none tracking-tight mt-0.5">POS</span>
          </div>
        </div>

        <div className="w-full max-w-md">
          <div className="mb-10 text-center lg:text-left">
            <h2 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Owner Portal</h2>
            <p className="text-slate-500">Sign in to view your pharmacy business insights.</p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            <div className="space-y-1.5">
              <label htmlFor="portal-email" className="block text-sm font-medium text-slate-700">
                Email address
              </label>
              <input
                id="portal-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm shadow-sm"
                placeholder="you@pharmacy.com"
              />
            </div>
            
            <div className="space-y-1.5 relative">
              <label htmlFor="portal-password" className="block text-sm font-medium text-slate-700">
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
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm shadow-sm pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl" role="alert">
                <svg className="w-4 h-4 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              id="portal-login-btn"
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-70 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors text-sm shadow-sm flex items-center justify-center"
            >
              {loading ? (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : null}
              {loading ? "Signing in…" : "Sign In to Owner Portal"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
