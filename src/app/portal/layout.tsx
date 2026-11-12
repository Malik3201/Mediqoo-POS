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
  ShieldCheck,
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
    group: "pulse",
  },
  {
    href: "/portal/website",
    label: "My Website",
    shortLabel: "Website",
    subtitle: "Online storefront & domain",
    icon: Globe,
    group: "growth",
  },
  {
    href: "/portal/sales",
    label: "Sales & Invoices",
    shortLabel: "Sales",
    subtitle: "Counter bills & receipts",
    icon: Receipt,
    group: "pulse",
  },
  {
    href: "/portal/purchases",
    label: "Purchases & Suppliers",
    shortLabel: "Purchases",
    subtitle: "GRNs & supplier payables",
    icon: ShoppingBag,
    group: "ops",
  },
  {
    href: "/portal/khata",
    label: "Customers & Khata",
    shortLabel: "Khata",
    subtitle: "Credit accounts & recovery",
    icon: Users,
    group: "ops",
  },
  {
    href: "/portal/inventory",
    label: "Inventory Intelligence",
    shortLabel: "Inventory",
    subtitle: "Stock, reorder & expiry",
    icon: PackageSearch,
    group: "ops",
  },
  {
    href: "/portal/cash",
    label: "Cash & Closing",
    shortLabel: "Cash",
    subtitle: "Drawer & daily Z-closings",
    icon: Wallet,
    group: "pulse",
  },
  {
    href: "/portal/reports",
    label: "Reports Center",
    shortLabel: "Reports",
    subtitle: "Profit, sales & tax reports",
    icon: BarChart3,
    group: "growth",
  },
  {
    href: "/portal/alerts",
    label: "Owner Alerts",
    shortLabel: "Alerts",
    subtitle: "Anomalies & supervision",
    icon: BellRing,
    group: "pulse",
  },
  {
    href: "/portal/returns",
    label: "Returns",
    shortLabel: "Returns",
    subtitle: "Sales & supplier returns",
    icon: RotateCcw,
    group: "ops",
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
          json.new_unacknowledged_count ?? json.pending_confirmation_count ?? 0
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
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7F9] px-4">
        <div className="flex flex-col items-center gap-4 bg-white px-8 py-7 rounded-3xl border border-slate-200/80 shadow-sm">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <div className="w-6 h-6 border-[2.5px] border-[#009A4D] border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-0.5">
            <p className="text-sm font-extrabold text-slate-900">AivraSol Owner Portal</p>
            <p className="text-xs text-slate-500">Syncing encrypted pharmacy command center…</p>
          </div>
        </div>
      </div>
    );
  }

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/portal/dashboard" && pathname?.startsWith(href));

  const allNavItems = [...PRIMARY_NAV, ...SECONDARY_NAV];
  const currentNav = allNavItems.find((item) => isRouteActive(item.href));

  // Mobile bottom bar: 4 primary tabs + enlarged "More" sheet trigger
  const mobileBottomTabs = PRIMARY_NAV.slice(0, 4);
  const isMoreActive =
    isRouteActive("/portal/khata") ||
    isRouteActive("/portal/inventory") ||
    isRouteActive("/portal/alerts") ||
    isRouteActive("/portal/reports") ||
    isRouteActive("/portal/cash") ||
    isRouteActive("/portal/returns") ||
    isRouteActive("/portal/backups") ||
    isRouteActive("/portal/billing");

  const sidebarSections = [
    {
      title: "Daily Monitoring",
      items: PRIMARY_NAV.filter((i) => i.group === "pulse"),
    },
    {
      title: "Stock & Accounts",
      items: PRIMARY_NAV.filter((i) => i.group === "ops"),
    },
    {
      title: "Growth & Insights",
      items: PRIMARY_NAV.filter((i) => i.group === "growth"),
    },
  ];

  const renderNavLink = (item: (typeof PRIMARY_NAV)[number] | (typeof SECONDARY_NAV)[number]) => {
    const Icon = item.icon;
    const active = isRouteActive(item.href);
    const showWebBadge = item.href === "/portal/website" && onlineOrderBadgeCount > 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={sidebarCollapsed ? item.label : undefined}
        className={`relative group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
          active
            ? "bg-gradient-to-r from-[#009A4D] to-emerald-600 text-white shadow-sm shadow-emerald-600/20"
            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
        } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
      >
        <Icon
          className={`w-[18px] h-[18px] shrink-0 transition-transform ${
            active ? "text-white" : "text-slate-500 group-hover:text-[#009A4D]"
          }`}
        />
        {!sidebarCollapsed && <span className="truncate flex-1">{item.label}</span>}
        {showWebBadge && !sidebarCollapsed && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold shadow-2xs">
            {onlineOrderBadgeCount}
          </span>
        )}
        {showWebBadge && sidebarCollapsed && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold">
            {onlineOrderBadgeCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[#F3F6FA] text-slate-900 flex flex-col">
      {/* Executive Top Header Bar */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xl border-b border-slate-200/85 px-3.5 sm:px-5 lg:px-6 flex items-center justify-between gap-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          <Link href="/portal/dashboard" className="flex items-center gap-2 shrink-0">
            <img
              src="/logo-owner-portal.png"
              alt="AivraSol"
              className="h-7 sm:h-8 w-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/logo-pharmacy-pos.png";
              }}
            />
          </Link>
          <div className="h-6 w-px bg-slate-200 shrink-0" />
          {me && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200/80 hidden sm:flex items-center justify-center text-[#009A4D] shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate leading-tight">
                    {me.client_name}
                  </p>
                  {currentNav && (
                    <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[10.5px] font-bold text-slate-600 shrink-0">
                      {currentNav.shortLabel}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                  <span className="sm:hidden">{currentNav?.label || "Owner Portal"}</span>
                  <span className="hidden sm:inline">{me.email}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {onlineOrderBadgeCount > 0 && (
            <button
              type="button"
              onClick={openOnlineOrdersView}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/20 transition-all active:scale-95"
              title="New Online Orders Pending Action"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Orders</span>
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-red-700 text-[10.5px] font-extrabold">
                {onlineOrderBadgeCount}
              </span>
            </button>
          )}

          <Link
            href="/portal/alerts"
            className={`inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-xs font-semibold border transition-colors ${
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
            className={`hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/billing")
                ? "bg-emerald-50 text-[#009A4D] border-emerald-200"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span className="hidden md:inline">Plan</span>
          </Link>

          <button
            onClick={handleLogout}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Non-Blocking New Online Order Toast Banner — Clears Mobile Bottom Bar */}
      {newOrderBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[90px] lg:bottom-auto lg:top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 sm:max-w-sm rounded-2xl border border-emerald-400/50 bg-slate-900/95 backdrop-blur-md text-white p-4 shadow-2xl space-y-3 animate-portal-in"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                New Online Order
              </div>
              <div className="text-sm font-extrabold font-mono truncate pt-0.5">
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
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNewOrderBanner(null)}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={openOnlineOrdersView}
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#009A4D] hover:bg-emerald-600 text-white shadow-sm"
            >
              View Order
            </button>
          </div>
        </div>
      )}

      {/* Main Content + Desktop Collapsible Sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Executive Sidebar */}
        <aside
          className={`hidden lg:flex flex-col bg-white border-r border-slate-200/85 shrink-0 transition-all duration-200 sticky top-16 h-[calc(100vh-4rem)] ${
            sidebarCollapsed ? "w-[76px]" : "w-[260px]"
          }`}
        >
          <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto portal-scroll">
            {sidebarSections.map((group) => (
              <div key={group.title} className="space-y-1">
                {!sidebarCollapsed && (
                  <p className="px-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                    {group.title}
                  </p>
                )}
                {group.items.map(renderNavLink)}
              </div>
            ))}

            <div className="space-y-1 pt-3 border-t border-slate-100">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Backups &amp; Plan
                </p>
              )}
              {SECONDARY_NAV.map(renderNavLink)}
            </div>
          </div>

          {/* Owner Status + Collapse Control */}
          <div className="p-3 border-t border-slate-100 space-y-2">
            {!sidebarCollapsed && me && (
              <div className="px-3 py-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70 flex items-center gap-2 text-[11px]">
                <ShieldCheck className="w-4 h-4 text-[#009A4D] shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 truncate">{me.client_name}</p>
                  <p className="text-[10px] text-emerald-700 font-semibold">Live POS Cloud Sync</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
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

        {/* Main Workspace — generous bottom clearance for the mobile bottom bar */}
        <main className="flex-1 min-w-0 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] lg:pb-12">
          <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 animate-portal-in">
            {children}
          </div>
        </main>
      </div>

      {/* Enlarged, Easy-Touch Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200/90 px-1.5 pt-2 pb-[calc(0.6rem+env(safe-area-inset-bottom,0px))] min-h-[76px] flex items-center justify-around shadow-[0_-8px_28px_rgba(15,23,42,0.07)]"
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
              className="flex-1 max-w-[82px] min-h-[54px] py-1 px-0.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
            >
              <div
                className={`relative w-12 h-8 rounded-2xl flex items-center justify-center transition-all ${
                  active
                    ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/25"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-[20px] h-[20px]" strokeWidth={active ? 2.4 : 2} />
                {showWebBadge && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold shadow-xs">
                    {onlineOrderBadgeCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] tracking-tight leading-none ${
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
          className="flex-1 max-w-[82px] min-h-[54px] py-1 px-0.5 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
        >
          <div
            className={`w-12 h-8 rounded-2xl flex items-center justify-center transition-all ${
              isMoreActive || mobileMoreOpen
                ? "bg-[#009A4D] text-white shadow-sm shadow-emerald-600/25"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {mobileMoreOpen ? (
              <X className="w-[20px] h-[20px]" strokeWidth={2.4} />
            ) : (
              <MoreHorizontal className="w-[20px] h-[20px]" strokeWidth={2.2} />
            )}
          </div>
          <span
            className={`text-[11px] tracking-tight leading-none ${
              isMoreActive || mobileMoreOpen
                ? "text-[#009A4D] font-extrabold"
                : "text-slate-600 font-semibold"
            }`}
          >
            Menu
          </span>
        </button>
      </nav>

      {/* Mobile "Menu / More" Launcher Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex flex-col justify-end bg-slate-900/45 backdrop-blur-[2px]">
          <div className="flex-1" onClick={() => setMobileMoreOpen(false)} />
          <div className="bg-white rounded-t-3xl border-t border-slate-200 px-4 pt-3 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] shadow-2xl space-y-4 max-h-[84dvh] overflow-y-auto animate-portal-drawer">
            <div className="w-10 h-1.5 rounded-full bg-slate-200 mx-auto" />
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="min-w-0">
                <span className="text-sm font-extrabold text-slate-900 block truncate">
                  {me?.client_name || "Owner Portal Modules"}
                </span>
                <span className="text-xs text-slate-500 truncate block">
                  {me?.email || "Tap any section to monitor"}
                </span>
              </div>
              <button
                onClick={() => setMobileMoreOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 shrink-0"
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
                    className={`flex flex-col gap-2 p-3.5 rounded-2xl border transition-all active:scale-[0.98] ${
                      active
                        ? "bg-emerald-50/90 border-emerald-300 text-[#009A4D] shadow-2xs"
                        : "bg-slate-50/80 border-slate-200/80 text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          active
                            ? "bg-[#009A4D] text-white"
                            : "bg-white border border-slate-200/80 text-slate-600"
                        }`}
                      >
                        <Icon className="w-4.5 h-4.5" />
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold truncate">{item.shortLabel}</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                    </div>
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
