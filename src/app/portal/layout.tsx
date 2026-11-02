"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  Users,
  Wallet,
  RotateCcw,
  CloudUpload,
  CreditCard,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Building2,
  MoreHorizontal,
  PackageSearch,
  BellRing,
  BarChart3,
} from "lucide-react";

interface PortalMe {
  user_id: string;
  client_id: string;
  client_name: string;
  email: string;
  role: string;
}

const PRIMARY_NAV = [
  { href: "/portal/dashboard", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { href: "/portal/sales", label: "Sales & Invoices", shortLabel: "Sales", icon: Receipt },
  { href: "/portal/purchases", label: "Purchases & Suppliers", shortLabel: "Purchases", icon: ShoppingBag },
  { href: "/portal/khata", label: "Customers & Khata", shortLabel: "Khata", icon: Users },
  { href: "/portal/inventory", label: "Inventory Intelligence", shortLabel: "Inventory", icon: PackageSearch },
  { href: "/portal/alerts", label: "Owner Alerts", shortLabel: "Alerts", icon: BellRing },
  { href: "/portal/reports", label: "Reports Center", shortLabel: "Reports", icon: BarChart3 },
  { href: "/portal/cash", label: "Cash & Closing", shortLabel: "Cash", icon: Wallet },
  { href: "/portal/returns", label: "Returns", shortLabel: "Returns", icon: RotateCcw },
];

const SECONDARY_NAV = [
  { href: "/portal/backups", label: "Cloud Backups", shortLabel: "Backups", icon: CloudUpload },
  { href: "/portal/billing", label: "Subscription & Plan", shortLabel: "Billing", icon: CreditCard },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const isPublicPage =
    pathname === "/portal/login" ||
    pathname === "/portal/forgot-password" ||
    pathname === "/portal/reset-password";

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isPublicPage) {
      setChecking(false);
      return;
    }

    fetch("/api/portal/auth/me")
      .then((res) => {
        if (!res.ok) {
          router.replace("/portal/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setMe(data);
      })
      .catch(() => router.replace("/portal/login"))
      .finally(() => setChecking(false));
  }, [pathname, isPublicPage, router]);

  async function handleLogout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-[#009A4D] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-500">Loading AivraSol Owner Portal…</span>
        </div>
      </div>
    );
  }

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/portal/dashboard" && pathname?.startsWith(href));

  // Mobile bottom tabs: first 4 primary + "More" sheet trigger
  const mobileBottomTabs = PRIMARY_NAV.slice(0, 4);
  const isMoreActive =
    isRouteActive("/portal/inventory") ||
    isRouteActive("/portal/alerts") ||
    isRouteActive("/portal/reports") ||
    isRouteActive("/portal/cash") ||
    isRouteActive("/portal/returns") ||
    isRouteActive("/portal/backups") ||
    isRouteActive("/portal/billing");

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 lg:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/portal/dashboard" className="flex items-center gap-2.5 shrink-0">
            <img
              src="/logo-owner-portal.png"
              alt="AivraSol"
              className="h-8 w-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/logo-pharmacy-pos.png";
              }}
            />
          </Link>
          <div className="h-5 w-px bg-slate-200 hidden sm:block" />
          {me && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-[#009A4D] shrink-0">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {me.client_name}
                </p>
                <p className="text-[10px] text-slate-500 truncate hidden sm:block">{me.email}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/portal/billing"
            className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/billing")
                ? "bg-emerald-50 text-[#009A4D] border-emerald-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Subscription</span>
          </Link>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content + Desktop Collapsible Sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar */}
        <aside
          className={`hidden lg:flex flex-col bg-white border-r border-slate-200/90 shrink-0 transition-all duration-200 sticky top-14 h-[calc(100vh-3.5rem)] ${
            sidebarCollapsed ? "w-[68px]" : "w-60"
          }`}
        >
          <div className="flex-1 py-4 px-2.5 space-y-6 overflow-y-auto">
            <div className="space-y-1">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Operations
                </p>
              )}
              {PRIMARY_NAV.map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      active
                        ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/20"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
                    } ${sidebarCollapsed ? "justify-center" : ""}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? "text-white" : "text-slate-500"}`} />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>

            <div className="space-y-1 pt-2 border-t border-slate-100">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  System & Billing
                </p>
              )}
              {SECONDARY_NAV.map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      active
                        ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/20"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
                    } ${sidebarCollapsed ? "justify-center" : ""}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? "text-white" : "text-slate-500"}`} />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="p-2.5 border-t border-slate-100">
            <button
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span>Collapse Menu</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-10">
          <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 py-1.5 flex items-center justify-around shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
        {mobileBottomTabs.map((item) => {
          const Icon = item.icon;
          const active = isRouteActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl min-w-[60px] transition-colors ${
                active ? "text-[#009A4D] font-bold" : "text-slate-500 hover:text-slate-900 font-medium"
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  active ? "bg-emerald-50 text-[#009A4D]" : ""
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] leading-none">{item.shortLabel}</span>
            </Link>
          );
        })}

        <button
          onClick={() => setMobileMoreOpen((v) => !v)}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl min-w-[60px] transition-colors ${
            isMoreActive || mobileMoreOpen
              ? "text-[#009A4D] font-bold"
              : "text-slate-500 hover:text-slate-900 font-medium"
          }`}
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isMoreActive || mobileMoreOpen ? "bg-emerald-50 text-[#009A4D]" : ""
            }`}
          >
            {mobileMoreOpen ? <X className="w-4 h-4" /> : <MoreHorizontal className="w-4 h-4" />}
          </div>
          <span className="text-[10px] leading-none">More</span>
        </button>
      </nav>

      {/* Mobile "More" Slide-Up Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end bg-slate-900/40 backdrop-blur-[1px]">
          <div className="flex-1" onClick={() => setMobileMoreOpen(false)} />
          <div className="bg-white rounded-t-2xl border-t border-slate-200 p-4 pb-20 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                More Modules
              </span>
              <button
                onClick={() => setMobileMoreOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[...PRIMARY_NAV.slice(4), ...SECONDARY_NAV].map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-semibold transition-colors ${
                      active
                        ? "bg-emerald-50 border-emerald-200 text-[#009A4D]"
                        : "bg-slate-50/80 border-slate-200/80 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
