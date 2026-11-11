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
  X,
  ChevronLeft,
  ChevronRight,
  Building2,
  MoreHorizontal,
  PackageSearch,
  BellRing,
  BarChart3,
  Globe,
} from "lucide-react";

interface PortalMe {
  user_id: string;
  client_id: string;
  client_name: string;
  email: string;
  role: string;
}

const PRIMARY_NAV = [
  {
    href: "/portal/dashboard",
    label: "Overview",
    shortLabel: "Overview",
    subtitle: "Live summary & daily brief",
    icon: LayoutDashboard,
  },
  {
    href: "/portal/website",
    label: "My Website",
    shortLabel: "Website",
    subtitle: "Online storefront & domain",
    icon: Globe,
  },
  {
    href: "/portal/sales",
    label: "Sales & Invoices",
    shortLabel: "Sales",
    subtitle: "Counter bills & receipts",
    icon: Receipt,
  },
  {
    href: "/portal/purchases",
    label: "Purchases & Suppliers",
    shortLabel: "Purchases",
    subtitle: "GRNs & supplier payables",
    icon: ShoppingBag,
  },
  {
    href: "/portal/khata",
    label: "Customers & Khata",
    shortLabel: "Khata",
    subtitle: "Credit accounts & recovery",
    icon: Users,
  },
  {
    href: "/portal/inventory",
    label: "Inventory Intelligence",
    shortLabel: "Inventory",
    subtitle: "Stock, reorder & expiry",
    icon: PackageSearch,
  },
  {
    href: "/portal/cash",
    label: "Cash & Closing",
    shortLabel: "Cash",
    subtitle: "Drawer & daily Z-closings",
    icon: Wallet,
  },
  {
    href: "/portal/reports",
    label: "Reports Center",
    shortLabel: "Reports",
    subtitle: "Profit, sales & tax reports",
    icon: BarChart3,
  },
  {
    href: "/portal/alerts",
    label: "Owner Alerts",
    shortLabel: "Alerts",
    subtitle: "Anomalies & supervision",
    icon: BellRing,
  },
  {
    href: "/portal/returns",
    label: "Returns",
    shortLabel: "Returns",
    subtitle: "Sales & supplier returns",
    icon: RotateCcw,
  },
];

const SECONDARY_NAV = [
  {
    href: "/portal/backups",
    label: "Cloud Backups",
    shortLabel: "Backups",
    subtitle: "Encrypted restore points",
    icon: CloudUpload,
  },
  {
    href: "/portal/billing",
    label: "Subscription & Plan",
    shortLabel: "Billing",
    subtitle: "License & renewal vouchers",
    icon: CreditCard,
  },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [onlineOrderBadgeCount, setOnlineOrderBadgeCount] = useState(0);
  const [newOrderBanner, setNewOrderBanner] = useState<{
    id: string;
    order_number: string;
    customer_name: string;
    total_pkr: number;
    fulfillment_type?: string;
  } | null>(null);

  const isPublicPage =
    pathname === "/portal/login" ||
    pathname === "/portal/accept-invite" ||
    pathname?.startsWith("/portal/accept-invite") ||
    pathname === "/portal/forgot-password" ||
    pathname === "/portal/reset-password";

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isPublicPage || !me) return;

    let cancelled = false;
    const pollWebsiteOrders = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/portal/website?notifications_only=1", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json?.ok || !json?.exists) {
          if (!cancelled) setOnlineOrderBadgeCount(0);
          return;
        }

        const attentionCount = Number(
          json.active_attention_count ?? json.pending_confirmation_count ?? 0
        );
        setOnlineOrderBadgeCount(attentionCount);

        const sfId = String(json.storefront_id || me.client_id || "default");
        const storageKey = `mediqoo:portal-seen-orders:v1:${sfId}`;
        let seenIds: string[] = [];
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) seenIds = parsed.map(String);
          }
        } catch {
          // Ignore storage errors
        }

        const recentOrders: any[] = Array.isArray(json.recent_orders)
          ? json.recent_orders
          : [];
        const pendingRecent = recentOrders.filter(
          (o) =>
            o &&
            o.id &&
            (o.status === "pending_confirmation" || o.status === "pending")
        );

        const unseenOrder = pendingRecent.find((o) => !seenIds.includes(String(o.id)));
        if (unseenOrder) {
          const nextSeen = [
            String(unseenOrder.id),
            ...seenIds.filter((id) => id !== String(unseenOrder.id)),
          ].slice(0, 150);
          try {
            localStorage.setItem(storageKey, JSON.stringify(nextSeen));
          } catch {
            // Ignore quota errors
          }
          setNewOrderBanner({
            id: String(unseenOrder.id),
            order_number: String(unseenOrder.order_number || "ORD"),
            customer_name: String(unseenOrder.customer_name || "Online Customer"),
            total_pkr: Number(unseenOrder.total_pkr || 0),
            fulfillment_type: String(unseenOrder.fulfillment_type || "delivery"),
          });
        }
      } catch {
        // Silent background poll resilience
      }
    };

    void pollWebsiteOrders();
    const timer = window.setInterval(() => {
      void pollWebsiteOrders();
    }, 25_000);

    const onFocusOrVisible = () => {
      if (!document.hidden) void pollWebsiteOrders();
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [isPublicPage, me]);

  const openOnlineOrdersView = () => {
    setNewOrderBanner(null);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mediqoo:open-website-orders"));
    }
    router.push("/portal/website?tab=orders");
  };

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
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3.5">
          <div className="w-10 h-10 border-3 border-[#009A4D] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-slate-600">
            Loading AivraSol Owner Portal…
          </span>
        </div>
      </div>
    );
  }

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/portal/dashboard" && pathname?.startsWith(href));

  // Mobile bottom bar: 4 primary tabs + enlarged "More" sheet trigger
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
    <div className="min-h-screen bg-[#F4F7FA] text-slate-900 flex flex-col">
      {/* Clean, Spacious Top Header */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 lg:px-6 flex items-center justify-between gap-3 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/portal/dashboard" className="flex items-center gap-2.5 shrink-0">
            <img
              src="/logo-owner-portal.png"
              alt="AivraSol"
              className="h-8 sm:h-9 w-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/logo-pharmacy-pos.png";
              }}
            />
          </Link>
          <div className="h-6 w-px bg-slate-200 hidden sm:block" />
          {me && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-[#009A4D] shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate leading-tight">
                  {me.client_name}
                </p>
                <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                  {me.email}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onlineOrderBadgeCount > 0 && (
            <button
              type="button"
              onClick={openOnlineOrdersView}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors"
              title="New Online Orders Pending Action"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Online Orders</span>
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-red-700 text-[11px] font-extrabold">
                {onlineOrderBadgeCount}
              </span>
            </button>
          )}

          <Link
            href="/portal/alerts"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/alerts")
                ? "bg-emerald-50 text-[#009A4D] border-emerald-200"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100"
            }`}
            title="Owner Alerts"
          >
            <BellRing className="w-4 h-4" />
            <span className="hidden md:inline">Alerts</span>
          </Link>

          <Link
            href="/portal/billing"
            className={`hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/billing")
                ? "bg-emerald-50 text-[#009A4D] border-emerald-200"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Subscription</span>
          </Link>

          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Non-Blocking New Online Order Toast Banner */}
      {newOrderBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 right-4 sm:right-6 z-50 max-w-sm w-[calc(100vw-2rem)] rounded-2xl border border-emerald-300 bg-slate-900 text-white p-4 shadow-2xl space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                New Online Order
              </div>
              <div className="text-sm font-extrabold font-mono truncate">
                #{newOrderBanner.order_number}
              </div>
              <div className="text-xs text-slate-300 truncate">
                {newOrderBanner.customer_name} •{" "}
                <span className="font-bold text-emerald-400">
                  PKR {Number(newOrderBanner.total_pkr || 0).toLocaleString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewOrderBanner(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNewOrderBanner(null)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={openOnlineOrdersView}
              className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-[#009A4D] hover:bg-emerald-600 text-white shadow-sm"
            >
              View Order
            </button>
          </div>
        </div>
      )}

      {/* Main Content + Desktop Collapsible Sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar */}
        <aside
          className={`hidden lg:flex flex-col bg-white border-r border-slate-200/90 shrink-0 transition-all duration-200 sticky top-16 h-[calc(100vh-4rem)] ${
            sidebarCollapsed ? "w-[76px]" : "w-64"
          }`}
        >
          <div className="flex-1 py-5 px-3 space-y-6 overflow-y-auto">
            <div className="space-y-1.5">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  Pharmacy Supervision
                </p>
              )}
              {PRIMARY_NAV.map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                const showWebBadge =
                  item.href === "/portal/website" && onlineOrderBadgeCount > 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`relative flex items-center gap-3 px-3.5 py-3 rounded-2xl text-[13px] font-semibold transition-all ${
                      active
                        ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/25"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/90"
                    } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
                  >
                    <Icon
                      className={`w-[18px] h-[18px] shrink-0 ${
                        active ? "text-white" : "text-slate-500"
                      }`}
                    />
                    {!sidebarCollapsed && (
                      <span className="truncate flex-1">{item.label}</span>
                    )}
                    {showWebBadge && !sidebarCollapsed && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-extrabold">
                        {onlineOrderBadgeCount}
                      </span>
                    )}
                    {showWebBadge && sidebarCollapsed && (
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold">
                        {onlineOrderBadgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="space-y-1.5 pt-3 border-t border-slate-100">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  Backups & Plan
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
                    className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl text-[13px] font-semibold transition-all ${
                      active
                        ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/25"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/90"
                    } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
                  >
                    <Icon
                      className={`w-[18px] h-[18px] shrink-0 ${
                        active ? "text-white" : "text-slate-500"
                      }`}
                    />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="p-3 border-t border-slate-100">
            <button
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span>Collapse Sidebar</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Workspace — generous bottom clearance for the larger mobile bottom bar */}
        <main className="flex-1 min-w-0 pb-32 lg:pb-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
            {children}
          </div>
        </main>
      </div>

      {/* Enlarged, Easy-Touch Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/98 backdrop-blur-lg border-t border-slate-200/90 px-2 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom,0px))] min-h-[78px] flex items-center justify-around shadow-[0_-8px_28px_rgba(15,23,42,0.08)]"
      >
        {mobileBottomTabs.map((item) => {
          const Icon = item.icon;
          const active = isRouteActive(item.href);
          const showWebBadge =
            item.href === "/portal/website" && onlineOrderBadgeCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 max-w-[84px] min-h-[58px] py-1 px-1 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95"
            >
              <div
                className={`relative w-12 h-8 rounded-2xl flex items-center justify-center transition-all ${
                  active
                    ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/30"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-[21px] h-[21px]" strokeWidth={active ? 2.4 : 2} />
                {showWebBadge && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold shadow-xs">
                    {onlineOrderBadgeCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[11.5px] tracking-tight leading-none ${
                  active
                    ? "text-[#009A4D] font-extrabold"
                    : "text-slate-600 font-semibold"
                }`}
              >
                {item.shortLabel}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileMoreOpen((v) => !v)}
          className="flex-1 max-w-[84px] min-h-[58px] py-1 px-1 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95"
        >
          <div
            className={`w-12 h-8 rounded-2xl flex items-center justify-center transition-all ${
              isMoreActive || mobileMoreOpen
                ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/30"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {mobileMoreOpen ? (
              <X className="w-[21px] h-[21px]" strokeWidth={2.4} />
            ) : (
              <MoreHorizontal className="w-[21px] h-[21px]" strokeWidth={2.2} />
            )}
          </div>
          <span
            className={`text-[11.5px] tracking-tight leading-none ${
              isMoreActive || mobileMoreOpen
                ? "text-[#009A4D] font-extrabold"
                : "text-slate-600 font-semibold"
            }`}
          >
            More
          </span>
        </button>
      </nav>

      {/* Mobile "More" Slide-Up Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex flex-col justify-end bg-slate-900/45 backdrop-blur-[2px]">
          <div className="flex-1" onClick={() => setMobileMoreOpen(false)} />
          <div className="bg-white rounded-t-3xl border-t border-slate-200 px-4 pt-3 pb-28 shadow-2xl space-y-3.5 max-h-[82vh] overflow-y-auto">
            <div className="w-10 h-1.5 rounded-full bg-slate-200 mx-auto mb-1" />
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div>
                <span className="text-sm font-extrabold text-slate-900 block">
                  All Owner Portal Modules
                </span>
                <span className="text-xs text-slate-500">
                  Tap any section to open
                </span>
              </div>
              <button
                onClick={() => setMobileMoreOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[...PRIMARY_NAV.slice(4), ...SECONDARY_NAV].map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMoreOpen(false)}
                    className={`flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all ${
                      active
                        ? "bg-emerald-50/90 border-emerald-300 text-[#009A4D] shadow-2xs"
                        : "bg-slate-50/70 border-slate-200/80 text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        active
                          ? "bg-[#009A4D] text-white"
                          : "bg-white border border-slate-200/80 text-slate-600"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{item.label}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
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
