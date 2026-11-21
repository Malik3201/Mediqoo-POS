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
  pharmacy_logo?: string | null;
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
    href: "/portal/profile",
    label: "Owner Profile & Card",
    shortLabel: "Profile",
    subtitle: "Owner card & security",
    icon: ShieldCheck,
  },
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
  const [logoError, setLogoError] = useState(false);
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
        if (!data) return;
        const u = data.user ?? data;
        const clientId = u?.client_id ?? data?.client_id ?? "";
        let cachedPharmacyName = "";
        try {
          if (clientId) {
            cachedPharmacyName =
              sessionStorage.getItem(`aivrasol_pharmacy_name:${clientId}`) || "";
          }
        } catch {
          // ignore storage errors
        }
        const resolvedName =
          data.pharmacy_name ||
          cachedPharmacyName ||
          u?.client?.name ||
          u?.client_name ||
          data?.client_name ||
          u?.name ||
          "My Pharmacy";

        const resolvedLogo =
          data.pharmacy_logo ||
          u?.pharmacy_logo ||
          null;

        setMe({
          user_id: u?.id || u?.user_id || "",
          client_id: clientId,
          client_name: resolvedName,
          pharmacy_logo: resolvedLogo,
          email: u?.email || data?.email || "",
          role: u?.role || data?.role || "owner",
        });
      })
      .catch(() => router.replace("/portal/login"))
      .finally(() => setChecking(false));
  }, [pathname, isPublicPage, router]);

  useEffect(() => {
    const onPharmacyMeta = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; logo?: string | null }>).detail;
      const nextName = detail?.name?.trim();
      const nextLogo = detail?.logo;
      setMe((prev) => {
        if (!prev) return prev;
        const nameChanged = nextName && prev.client_name !== nextName;
        const logoChanged = nextLogo !== undefined && prev.pharmacy_logo !== nextLogo;
        if (!nameChanged && !logoChanged) return prev;
        try {
          if (nextName && prev.client_id) {
            sessionStorage.setItem(`aivrasol_pharmacy_name:${prev.client_id}`, nextName);
          }
        } catch {
          // ignore storage errors
        }
        return {
          ...prev,
          ...(nameChanged ? { client_name: nextName } : {}),
          ...(logoChanged ? { pharmacy_logo: nextLogo } : {}),
        };
      });
    };
    window.addEventListener("aivrasol:pharmacy-meta", onPharmacyMeta);
    return () => window.removeEventListener("aivrasol:pharmacy-meta", onPharmacyMeta);
  }, []);

  async function handleLogout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F5FA] px-4">
        <div className="flex flex-col items-center gap-4 bg-white px-8 py-7 rounded-3xl border border-indigo-950/[0.08] shadow-[0_12px_36px_-10px_rgba(19,27,58,0.14)]">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#131B3A] via-[#1C2C62] to-[#0F4C5C] flex items-center justify-center shadow-md">
            <div className="w-5 h-5 border-2 border-teal-300 border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-0.5">
            <p className="text-sm font-extrabold text-[#131B3A]">AivraSol Executive Portal</p>
            <p className="text-xs text-slate-500">Connecting your live pharmacy insights…</p>
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
            ? "bg-gradient-to-r from-teal-500/20 via-cyan-500/10 to-transparent text-white ring-1 ring-teal-400/35 shadow-xs"
            : "text-indigo-200/80 hover:text-white hover:bg-white/[0.06]"
        } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
      >
        <Icon
          className={`w-[18px] h-[18px] shrink-0 transition-colors ${
            active ? "text-teal-300" : "text-indigo-300/65 group-hover:text-teal-300"
          }`}
        />
        {!sidebarCollapsed && <span className="truncate flex-1">{item.label}</span>}
        {showWebBadge && !sidebarCollapsed && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold shadow-2xs">
            {onlineOrderBadgeCount}
          </span>
        )}
        {showWebBadge && sidebarCollapsed && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold">
            {onlineOrderBadgeCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[#F3F5FA] text-[#131B3A] flex flex-col">
      {/* Executive Top Header Bar — Royal Midnight Indigo & Electric Teal */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 bg-gradient-to-r from-[#111834] via-[#17234E] to-[#112A48] border-b border-white/10 px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 text-white shadow-[0_4px_20px_-6px_rgba(17,24,52,0.45)]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link
            href="/portal/profile"
            className="flex items-center gap-2.5 min-w-0 flex-1 group hover:opacity-95 transition-opacity"
            title="View Pharmacy Profile & Owner Card"
          >
            {me?.pharmacy_logo && !logoError ? (
              <img
                src={me.pharmacy_logo}
                alt={me.client_name}
                className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border border-white/20 shrink-0"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div
                className="w-8 h-8 rounded-xl bg-teal-400/15 border border-teal-400/35 flex items-center justify-center text-teal-300 font-black text-sm shrink-0"
              >
                {me?.client_name ? me.client_name.charAt(0).toUpperCase() : <Building2 className="w-4 h-4" />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-[13px] sm:text-sm font-extrabold text-white truncate leading-tight group-hover:text-teal-200 transition-colors">
                  {me?.client_name || "My Pharmacy"}
                </p>
                {currentNav && (
                  <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-indigo-100 shrink-0">
                    {currentNav.shortLabel}
                  </span>
                )}
              </div>
              <p className="text-[10.5px] sm:text-[11px] truncate leading-tight mt-0.5">
                <span className="text-teal-300 font-bold tracking-wide uppercase text-[9.5px]">
                  Owner Portal
                </span>
                <span className="text-indigo-200/70 ml-1.5 hidden sm:inline">
                  • {me?.email || "Executive View"}
                </span>
              </p>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {onlineOrderBadgeCount > 0 && (
            <button
              type="button"
              onClick={openOnlineOrdersView}
              className="inline-flex items-center gap-1.5 h-8 sm:h-9 px-2.5 sm:px-3 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white shadow-xs transition-all active:scale-95"
              title="New Online Orders Pending Action"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Orders</span>
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-rose-700 text-[10.5px] font-extrabold">
                {onlineOrderBadgeCount}
              </span>
            </button>
          )}

          <Link
            href="/portal/profile"
            className={`inline-flex items-center gap-1.5 h-8 sm:h-9 px-2.5 sm:px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/profile")
                ? "bg-teal-400/20 text-teal-200 border-teal-400/40"
                : "bg-white/[0.08] text-indigo-100 border-white/15 hover:bg-white/15 hover:text-white"
            }`}
            title="Owner Profile & Card"
          >
            <ShieldCheck className="w-4 h-4 text-teal-300" />
            <span className="hidden md:inline">Profile</span>
          </Link>

          <Link
            href="/portal/alerts"
            className={`inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2.5 sm:px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/alerts")
                ? "bg-teal-400/20 text-teal-200 border-teal-400/40"
                : "bg-white/[0.08] text-indigo-100 border-white/15 hover:bg-white/15 hover:text-white"
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
                ? "bg-teal-400/20 text-teal-200 border-teal-400/40"
                : "bg-white/[0.08] text-indigo-100 border-white/15 hover:bg-white/15 hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span className="hidden md:inline">Plan</span>
          </Link>

          <button
            onClick={handleLogout}
            className="inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-3 rounded-xl text-xs font-semibold text-indigo-200 hover:text-rose-200 hover:bg-rose-500/20 border border-transparent hover:border-rose-400/30 transition-colors"
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
        {/* Desktop Executive Sidebar — Royal Midnight Indigo */}
        <aside
          className={`hidden lg:flex flex-col bg-[#111834] border-r border-white/10 shrink-0 transition-all duration-200 sticky top-16 h-[calc(100vh-4rem)] text-indigo-100 ${
            sidebarCollapsed ? "w-[78px]" : "w-[260px]"
          }`}
        >
          <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto portal-scroll">
            {sidebarSections.map((group) => (
              <div key={group.title} className="space-y-1">
                {!sidebarCollapsed && (
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-indigo-300/50">
                    {group.title}
                  </p>
                )}
                {group.items.map(renderNavLink)}
              </div>
            ))}

            <div className="space-y-1 pt-3 border-t border-white/10">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-indigo-300/50">
                  Backups &amp; Plan
                </p>
              )}
              {SECONDARY_NAV.map(renderNavLink)}
            </div>
          </div>

          {/* Owner Status + Collapse Control */}
          <div className="p-3 border-t border-white/10 space-y-2">
            {!sidebarCollapsed && me && (
              <div className="px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 flex items-center gap-2.5 text-[11px]">
                <ShieldCheck className="w-4 h-4 text-teal-300 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{me.client_name}</p>
                  <p className="text-[10px] text-teal-300 font-semibold">Live POS Cloud Sync</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-indigo-200/75 hover:text-white hover:bg-white/[0.08] transition-colors"
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

        {/* Main Workspace — generous bottom clearance for the floating mobile dock */}
        <main className="flex-1 min-w-0 pb-[calc(6.75rem+env(safe-area-inset-bottom,0px))] lg:pb-12">
          <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 animate-portal-in">
            {children}
          </div>
        </main>
      </div>

      {/* App-Grade Floating Executive Mobile Bottom Dock */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom,0px))] pt-1 pointer-events-none">
        <nav
          aria-label="Mobile Primary Navigation"
          className="pointer-events-auto mx-auto max-w-md bg-[#111834]/95 backdrop-blur-lg border border-white/15 rounded-2xl px-1.5 py-1.5 flex items-center justify-around shadow-[0_12px_32px_-4px_rgba(11,16,38,0.48)]"
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
                className="flex-1 max-w-[78px] min-h-[50px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
              >
                <div
                  className={`relative w-11 h-7 rounded-xl flex items-center justify-center transition-all ${
                    active
                      ? "bg-gradient-to-br from-teal-400 to-cyan-500 text-[#0E1630] shadow-[0_4px_12px_rgba(45,212,191,0.4)]"
                      : "text-indigo-200/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2.4 : 1.9} />
                  {showWebBadge && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold shadow-xs">
                      {onlineOrderBadgeCount}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10.5px] tracking-tight leading-none ${
                    active
                      ? "text-teal-300 font-extrabold"
                      : "text-indigo-200/70 font-medium"
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
            className="flex-1 max-w-[78px] min-h-[50px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
          >
            <div
              className={`w-11 h-7 rounded-xl flex items-center justify-center transition-all ${
                isMoreActive || mobileMoreOpen
                  ? "bg-gradient-to-br from-teal-400 to-cyan-500 text-[#0E1630] shadow-[0_4px_12px_rgba(45,212,191,0.4)]"
                  : "text-indigo-200/75 hover:bg-white/10 hover:text-white"
              }`}
            >
              {mobileMoreOpen ? (
                <X className="w-[18px] h-[18px]" strokeWidth={2.4} />
              ) : (
                <MoreHorizontal className="w-[18px] h-[18px]" strokeWidth={2.1} />
              )}
            </div>
            <span
              className={`text-[10.5px] tracking-tight leading-none ${
                isMoreActive || mobileMoreOpen
                  ? "text-teal-300 font-extrabold"
                  : "text-indigo-200/70 font-medium"
              }`}
            >
              More
            </span>
          </button>
        </nav>
      </div>

      {/* Mobile "More" App-Grade Launcher Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex flex-col justify-end bg-[#0B1026]/65 backdrop-blur-[3px]">
          <div className="flex-1" onClick={() => setMobileMoreOpen(false)} />
          <div className="bg-[#F3F5FA] rounded-t-3xl border-t border-white/20 overflow-hidden pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] shadow-2xl max-h-[84dvh] overflow-y-auto animate-portal-drawer">
            <div className="bg-gradient-to-r from-[#111834] via-[#17234E] to-[#112A48] px-4 pt-2.5 pb-4 text-white border-b border-white/10 space-y-2.5">
              <div className="w-11 h-1 rounded-full bg-indigo-300/35 mx-auto" />
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <span className="text-sm font-extrabold text-white block truncate">
                    {me?.client_name || "Owner Portal Modules"}
                  </span>
                  <span className="text-xs text-teal-300/90 truncate block">
                    {me?.email || "Choose a section to explore"}
                  </span>
                </div>
                <button
                  onClick={() => setMobileMoreOpen(false)}
                  className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-indigo-100 hover:text-white shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3.5 grid grid-cols-2 gap-2.5">
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
                        ? "bg-gradient-to-br from-[#131B3A] to-[#1A355B] border-indigo-800 text-white shadow-md"
                        : "bg-white border-indigo-950/[0.08] text-[#131B3A] hover:border-indigo-300 shadow-2xs"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          active
                            ? "bg-teal-400/20 text-teal-300"
                            : "bg-indigo-50 border border-indigo-100 text-indigo-700"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 ${
                          active ? "text-teal-300" : "text-slate-400"
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold truncate">{item.shortLabel}</p>
                      <p
                        className={`text-[11px] truncate mt-0.5 ${
                          active ? "text-indigo-200/80" : "text-slate-500"
                        }`}
                      >
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
