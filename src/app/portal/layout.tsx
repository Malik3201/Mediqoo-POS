"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  Users,
  Clock,
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
  Loader2,
} from "lucide-react";
import {
  clearPortalSessionCache,
  getCachedPortalMe,
  setCachedPortalMe,
  type CachedPortalMe,
} from "@/lib/portal-cache";
import { PortalConfirmModal } from "@/components/portal/PortalUI";

type PortalMe = CachedPortalMe;

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
    href: "/portal/cash",
    label: "Shifts & Cash",
    shortLabel: "Shifts",
    subtitle: "Daily shifts, drawer & Z-close",
    icon: Clock,
    group: "pulse",
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
    href: "/portal/website",
    label: "My Website",
    shortLabel: "Website",
    subtitle: "Online storefront & orders",
    icon: Globe,
    group: "growth",
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

// Mobile bottom bar pinned tabs: Overview, Sales, Shifts, Website + More
const MOBILE_PINNED_HREFS = [
  "/portal/dashboard",
  "/portal/sales",
  "/portal/cash",
  "/portal/website",
];

const MOBILE_BOTTOM_TABS = MOBILE_PINNED_HREFS.map(
  (href) => PRIMARY_NAV.find((item) => item.href === href)!
);

const MOBILE_MORE_ITEMS = [
  ...PRIMARY_NAV.filter((item) => !MOBILE_PINNED_HREFS.includes(item.href)),
  ...SECONDARY_NAV,
];

/**
 * Top slim progress indicator shown immediately when navigating between portal routes.
 */
function PortalTopProgressBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      className="fixed top-0 inset-x-0 z-[90] h-[3px] bg-teal-900/20 overflow-hidden pointer-events-none"
    >
      <div className="h-full w-2/3 bg-[#14B8A6] animate-portal-progress" />
    </div>
  );
}

/**
 * Global capture-phase tactile feedback & anti-double-click guard scoped to `.portal-shell`.
 * - Gives every clicked button/link an unmistakable 260ms ring highlight (`data-portal-clicked`).
 * - Blocks accidental rapid multi-clicks (< 450ms) on the same action button unless opted out
 *   via `data-allow-rapid-click="true"`.
 */
function usePortalInteractionGuard(
  shellRef: React.RefObject<HTMLDivElement | null>,
  onInternalLinkClick: (href: string) => void
) {
  const lastClickMapRef = useRef<WeakMap<Element, number>>(new WeakMap());

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const handleCaptureClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 1. Detect internal portal route navigation links for 0ms progress feedback
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (anchor && !anchor.target && anchor.origin === window.location.origin) {
        const href = anchor.getAttribute("href") || "";
        if (href.startsWith("/portal/")) {
          onInternalLinkClick(href.split("?")[0].split("#")[0]);
        }
        anchor.setAttribute("data-portal-clicked", "true");
        window.setTimeout(() => anchor.removeAttribute("data-portal-clicked"), 240);
        return;
      }

      // 2. Detect buttons for tactile click highlight + rapid double-click guard
      const btn = target.closest("button") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;

      const allowRapid =
        btn.dataset.allowRapidClick === "true" ||
        btn.dataset.rapid === "true" ||
        btn.getAttribute("role") === "tab" ||
        btn.getAttribute("aria-label")?.toLowerCase().includes("clear") ||
        btn.getAttribute("aria-label")?.toLowerCase().includes("close");

      const now = Date.now();
      const prevTs = lastClickMapRef.current.get(btn) ?? 0;

      if (!allowRapid && now - prevTs < 450) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      lastClickMapRef.current.set(btn, now);
      btn.setAttribute("data-portal-clicked", "true");
      window.setTimeout(() => {
        btn.removeAttribute("data-portal-clicked");
      }, 240);
    };

    shell.addEventListener("click", handleCaptureClick, true);
    return () => shell.removeEventListener("click", handleCaptureClick, true);
  }, [shellRef, onInternalLinkClick]);
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const shellRef = useRef<HTMLDivElement | null>(null);

  const isPublicPage =
    pathname === "/portal/login" ||
    pathname === "/portal/accept-invite" ||
    pathname?.startsWith("/portal/accept-invite") ||
    pathname === "/portal/forgot-password" ||
    pathname === "/portal/reset-password";

  // Hydrate immediately from sessionStorage so navigating never shows a blocking full-screen loader
  const [me, setMe] = useState<PortalMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [onlineOrderBadgeCount, setOnlineOrderBadgeCount] = useState(0);
  const [logoError, setLogoError] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [newOrderBanner, setNewOrderBanner] = useState<{
    id: string;
    order_number: string;
    customer_name: string;
    total_pkr: number;
    fulfillment_type?: string;
  } | null>(null);

  // Track whether /api/portal/auth/me has already been verified for this authenticated session
  const sessionVerifiedRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);

  const startRoutePending = (targetHref: string) => {
    if (!targetHref || targetHref === pathname) return;
    setPendingHref(targetHref);
    if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      setPendingHref(null);
    }, 4000);
  };

  usePortalInteractionGuard(shellRef, startRoutePending);

  // Clear pending route indicator & close mobile sheet on pathname completion
  useEffect(() => {
    setMobileMoreOpen(false);
    setPendingHref(null);
    if (pendingTimerRef.current) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    setLogoError(false);
  }, [me?.pharmacy_logo]);

  // Verify session ONCE per login session (never re-fetch /api/portal/auth/me on every route change!)
  useEffect(() => {
    if (isPublicPage) {
      sessionVerifiedRef.current = false;
      setChecking(false);
      return;
    }

    // Hydrate cached user instantly so UI paints in 0ms
    const cached = getCachedPortalMe();
    if (cached) {
      setMe((prev) => prev ?? cached);
      setChecking(false);
    }

    if (sessionVerifiedRef.current) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    fetch("/api/portal/auth/me", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          clearPortalSessionCache();
          sessionVerifiedRef.current = false;
          router.replace("/portal/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        sessionVerifiedRef.current = true;
        const u = data.user ?? data;
        const clientId = u?.client_id ?? data?.client_id ?? "";
        let cachedPharmacyName = "";
        try {
          if (clientId) {
            cachedPharmacyName =
              sessionStorage.getItem(`aivrasol_pharmacy_name:${clientId}`) || "";
          }
        } catch {
          // Ignore storage errors
        }
        const resolvedName =
          data.pharmacy_name ||
          cachedPharmacyName ||
          u?.client?.name ||
          u?.client_name ||
          data?.client_name ||
          u?.name ||
          "My Pharmacy";

        const resolvedLogo = data.pharmacy_logo || u?.pharmacy_logo || null;

        const nextMe: PortalMe = {
          user_id: u?.id || u?.user_id || "",
          client_id: clientId,
          client_name: resolvedName,
          pharmacy_logo: resolvedLogo,
          email: u?.email || data?.email || "",
          role: u?.role || data?.role || "owner",
        };
        setCachedPortalMe(nextMe);
        setMe(nextMe);
      })
      .catch(() => {
        if (!cancelled && !cached) {
          router.replace("/portal/login");
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPublicPage, router]);

  // Background online-orders poll: keyed on primitive client_id (NOT me object or pathname), 45s interval
  const activeClientId = me?.client_id || "";
  useEffect(() => {
    if (isPublicPage || !activeClientId) return;

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

        const sfId = String(json.storefront_id || activeClientId || "default");
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
    }, 45_000);

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
  }, [isPublicPage, activeClientId]);

  useEffect(() => {
    const onPharmacyMeta = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; logo?: string | null }>).detail;
      const nextName = detail?.name?.trim();
      const nextLogo = detail?.logo;
      setMe((prev) => {
        if (!prev) return prev;
        const nameChanged = Boolean(nextName && prev.client_name !== nextName);
        const logoChanged = nextLogo !== undefined && prev.pharmacy_logo !== nextLogo;
        if (!nameChanged && !logoChanged) return prev;
        try {
          if (nextName && prev.client_id) {
            sessionStorage.setItem(`aivrasol_pharmacy_name:${prev.client_id}`, nextName);
          }
        } catch {
          // Ignore storage errors
        }
        const updated: PortalMe = {
          ...prev,
          ...(nameChanged && nextName ? { client_name: nextName } : {}),
          ...(logoChanged ? { pharmacy_logo: nextLogo } : {}),
        };
        setCachedPortalMe(updated);
        return updated;
      });
    };
    window.addEventListener("aivrasol:pharmacy-meta", onPharmacyMeta);
    return () => window.removeEventListener("aivrasol:pharmacy-meta", onPharmacyMeta);
  }, []);

  const openOnlineOrdersView = () => {
    setNewOrderBanner(null);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mediqoo:open-website-orders"));
    }
    startRoutePending("/portal/website");
    router.push("/portal/website?tab=orders");
  };

  async function executeLogout() {
    setLoggingOut(true);
    try {
      clearPortalSessionCache();
      sessionVerifiedRef.current = false;
      await fetch("/api/portal/auth/logout", { method: "POST" });
      setLogoutConfirmOpen(false);
      setMe(null);
      router.replace("/portal/login");
    } finally {
      setLoggingOut(false);
    }
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (checking && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F5F8] px-4">
        <div className="flex flex-col items-center gap-3.5 bg-white px-8 py-7 rounded-2xl border border-[#D8E0EA] shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-[#0F172A] flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
          </div>
          <div className="text-center space-y-0.5">
            <p className="text-sm font-extrabold text-[#0F172A]">AivraSol Owner Portal</p>
            <p className="text-xs text-slate-500">Connecting your pharmacy dashboard…</p>
          </div>
        </div>
      </div>
    );
  }

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/portal/dashboard" && pathname?.startsWith(href));

  const allNavItems = [...PRIMARY_NAV, ...SECONDARY_NAV];
  const currentNav = allNavItems.find((item) => isRouteActive(item.href));

  const isMoreActive = MOBILE_MORE_ITEMS.some((item) => isRouteActive(item.href));

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
    const isPending = pendingHref === item.href && !active;
    const showWebBadge = item.href === "/portal/website" && onlineOrderBadgeCount > 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={true}
        onClick={() => startRoutePending(item.href)}
        title={sidebarCollapsed ? item.label : undefined}
        className={`relative group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
          active
            ? "bg-[#0F766E] text-white shadow-xs"
            : isPending
            ? "bg-slate-800 text-teal-300 ring-1 ring-teal-500/50"
            : "text-slate-300 hover:text-white hover:bg-slate-800/80"
        } ${sidebarCollapsed ? "justify-center px-2" : ""}`}
      >
        {isPending ? (
          <Loader2 className="w-[18px] h-[18px] shrink-0 text-teal-300 animate-spin" />
        ) : (
          <Icon
            className={`w-[18px] h-[18px] shrink-0 transition-colors ${
              active ? "text-white" : "text-slate-400 group-hover:text-teal-300"
            }`}
          />
        )}
        {!sidebarCollapsed && <span className="truncate flex-1">{item.label}</span>}
        {showWebBadge && !sidebarCollapsed && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold">
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
    <div ref={shellRef} className="portal-shell min-h-screen bg-[#F3F5F8] text-[#0F172A] flex flex-col">
      {/* 0ms Route Transition Top Progress Bar */}
      <PortalTopProgressBar active={Boolean(pendingHref)} />

      {/* Solid Clinical-Executive Top Header Bar */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 bg-[#0F172A] border-b border-slate-800 px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 text-white">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link
            href="/portal/profile"
            prefetch={true}
            onClick={() => startRoutePending("/portal/profile")}
            className="flex items-center gap-2.5 min-w-0 flex-1 group hover:opacity-95 transition-opacity"
            title="View Pharmacy Profile & Owner Card"
          >
            {me?.pharmacy_logo && !logoError ? (
              <img
                src={me.pharmacy_logo}
                alt={me.client_name}
                className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border border-slate-700 shrink-0"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-[#0F766E] border border-teal-500/50 flex items-center justify-center text-white font-black text-sm shrink-0">
                {me?.client_name ? (
                  me.client_name.charAt(0).toUpperCase()
                ) : (
                  <Building2 className="w-4 h-4" />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-[13px] sm:text-sm font-extrabold text-white truncate leading-tight group-hover:text-teal-300 transition-colors">
                  {me?.client_name || "My Pharmacy"}
                </p>
                {currentNav && (
                  <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-200 shrink-0">
                    {currentNav.shortLabel}
                  </span>
                )}
              </div>
              <p className="text-[10.5px] sm:text-[11px] truncate leading-tight mt-0.5 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-teal-400 font-bold tracking-wide uppercase text-[9.5px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  Live Portal
                </span>
                <span className="text-slate-400 hidden sm:inline truncate">
                  • {me?.email || "Owner View"}
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
              className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors"
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
            href="/portal/alerts"
            prefetch={true}
            onClick={() => startRoutePending("/portal/alerts")}
            className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/alerts")
                ? "bg-[#0F766E] text-white border-teal-500"
                : "bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white"
            }`}
            title="Owner Alerts"
            aria-label="Owner Alerts"
          >
            <BellRing className="w-4 h-4" />
            <span className="hidden md:inline">Alerts</span>
          </Link>

          <Link
            href="/portal/profile"
            prefetch={true}
            onClick={() => startRoutePending("/portal/profile")}
            className={`hidden sm:inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/profile")
                ? "bg-[#0F766E] text-white border-teal-500"
                : "bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white"
            }`}
            title="Owner Profile & Card"
          >
            <ShieldCheck className="w-4 h-4 text-teal-400" />
            <span className="hidden md:inline">Profile</span>
          </Link>

          <Link
            href="/portal/billing"
            prefetch={true}
            onClick={() => startRoutePending("/portal/billing")}
            className={`hidden md:inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
              isRouteActive("/portal/billing")
                ? "bg-[#0F766E] text-white border-teal-500"
                : "bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Plan</span>
          </Link>

          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 rounded-xl text-xs font-bold text-slate-200 hover:text-white hover:bg-rose-600/90 bg-slate-800/80 border border-slate-700 hover:border-rose-500 transition-colors cursor-pointer"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Non-Blocking New Online Order Toast Banner — Clears Mobile Bottom Bar */}
      {newOrderBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[82px] lg:bottom-auto lg:top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 sm:max-w-sm rounded-2xl border border-teal-500 bg-[#0F172A] text-white p-4 shadow-2xl space-y-3 animate-portal-in"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-600 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                New Online Order
              </div>
              <div className="text-sm font-extrabold font-mono truncate pt-0.5">
                #{newOrderBanner.order_number}
              </div>
              <div className="text-xs text-slate-300 truncate">
                {newOrderBanner.customer_name} •{" "}
                <span className="font-bold text-teal-400">
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
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#0F766E] hover:bg-[#115E59] text-white"
            >
              View Order
            </button>
          </div>
        </div>
      )}

      {/* Main Content + Desktop Collapsible Sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Solid Executive Sidebar */}
        <aside
          className={`hidden lg:flex flex-col bg-[#0F172A] border-r border-slate-800 shrink-0 transition-all duration-200 sticky top-16 h-[calc(100vh-4rem)] text-slate-200 ${
            sidebarCollapsed ? "w-[76px]" : "w-[254px]"
          }`}
        >
          <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto portal-scroll">
            {sidebarSections.map((group) => (
              <div key={group.title} className="space-y-1">
                {!sidebarCollapsed && (
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {group.title}
                  </p>
                )}
                {group.items.map(renderNavLink)}
              </div>
            ))}

            <div className="space-y-1 pt-3 border-t border-slate-800">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Account &amp; Backups
                </p>
              )}
              {SECONDARY_NAV.map(renderNavLink)}
            </div>
          </div>

          {/* Owner Status + Logout + Collapse Control */}
          <div className="p-3 border-t border-slate-800 space-y-2">
            {!sidebarCollapsed && me && (
              <div className="px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center gap-2.5 text-[11px]">
                <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{me.client_name}</p>
                  <p className="text-[10px] text-teal-400 font-semibold">Live POS Cloud Sync</p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-300 hover:text-white hover:bg-rose-600/80 transition-colors cursor-pointer ${
                sidebarCollapsed ? "justify-center px-2" : ""
              }`}
              title="Sign out of Owner Portal"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Sign Out</span>}
            </button>
            <button
              type="button"
              data-allow-rapid-click="true"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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

        {/* Main Workspace — generous bottom clearance for mobile bottom bar */}
        <main className="flex-1 min-w-0 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-10">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3.5 sm:py-6">
            {children}
          </div>
        </main>
      </div>

      {/* Crisp Solid Mobile Bottom Navigation Bar (Overview | Sales | Shifts | Website | More) */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#D8E0EA] pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)]"
      >
        <div className="mx-auto max-w-lg px-1.5 py-1.5 flex items-center justify-around">
          {MOBILE_BOTTOM_TABS.map((item) => {
            const Icon = item.icon;
            const active = isRouteActive(item.href);
            const isPending = pendingHref === item.href && !active;
            const showWebBadge =
              item.href === "/portal/website" && onlineOrderBadgeCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                onClick={() => startRoutePending(item.href)}
                className="flex-1 min-w-0 min-h-[56px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all"
              >
                <div
                  className={`relative w-12 h-7 rounded-full flex items-center justify-center transition-all ${
                    active
                      ? "bg-[#0F766E] text-white"
                      : isPending
                      ? "bg-teal-100 text-[#0F766E] ring-1 ring-teal-500"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {isPending ? (
                    <Loader2 className="w-[17px] h-[17px] animate-spin" />
                  ) : (
                    <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2.4 : 2} />
                  )}
                  {showWebBadge && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-extrabold">
                      {onlineOrderBadgeCount}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10.5px] tracking-tight leading-none truncate max-w-full ${
                    active || isPending
                      ? "text-[#0F766E] font-extrabold"
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
            data-allow-rapid-click="true"
            onClick={() => setMobileMoreOpen((v) => !v)}
            className="flex-1 min-w-0 min-h-[56px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all"
          >
            <div
              className={`w-12 h-7 rounded-full flex items-center justify-center transition-all ${
                isMoreActive || mobileMoreOpen
                  ? "bg-[#0F766E] text-white"
                  : "text-slate-600 hover:bg-slate-100"
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
                  ? "text-[#0F766E] font-extrabold"
                  : "text-slate-600 font-semibold"
              }`}
            >
              More
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" Clean Solid Launcher Sheet */}
      {mobileMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex flex-col justify-end bg-[#0F172A]/60">
          <div className="flex-1" onClick={() => setMobileMoreOpen(false)} />
          <div className="bg-[#F3F5F8] rounded-t-3xl border-t border-[#D8E0EA] overflow-hidden pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl max-h-[84dvh] overflow-y-auto animate-portal-drawer">
            <div className="bg-[#0F172A] px-4 pt-2.5 pb-4 text-white border-b border-slate-800 space-y-2.5">
              <div className="w-11 h-1 rounded-full bg-slate-600 mx-auto" />
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-extrabold text-white block truncate">
                    {me?.client_name || "Owner Portal Modules"}
                  </span>
                  <span className="text-xs text-teal-400 truncate block">
                    {me?.email || "Choose a section to open"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMoreOpen(false)}
                  className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 hover:text-white shrink-0"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3.5 grid grid-cols-2 gap-2.5">
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isRouteActive(item.href);
                const isPending = pendingHref === item.href && !active;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onClick={() => {
                      startRoutePending(item.href);
                      setMobileMoreOpen(false);
                    }}
                    className={`flex flex-col gap-2 p-3.5 rounded-2xl border transition-all ${
                      active
                        ? "bg-[#0F172A] border-[#0F172A] text-white"
                        : "bg-white border-[#D8E0EA] text-[#0F172A] hover:border-[#0F766E]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          active
                            ? "bg-[#0F766E] text-white"
                            : "bg-teal-50 border border-teal-200 text-[#0F766E]"
                        }`}
                      >
                        {isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Icon className="w-4 h-4" />
                        )}
                      </div>
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 ${
                          active ? "text-teal-400" : "text-slate-400"
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold truncate">{item.shortLabel}</p>
                      <p
                        className={`text-[11px] truncate mt-0.5 ${
                          active ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        {item.subtitle}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Mobile Sign Out Trigger with Confirmation Modal */}
            <div className="px-3.5 pb-4">
              <button
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  setLogoutConfirmOpen(true);
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-2xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-extrabold transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out of Owner Portal</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Logout Confirmation Modal */}
      <PortalConfirmModal
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={executeLogout}
        loading={loggingOut}
        tone="danger"
        title="Log out of Owner Portal?"
        description="You will be signed out of your pharmacy owner session on this device. You can sign back in anytime with your owner email and password."
        details={me ? `${me.client_name} (${me.email})` : undefined}
        confirmLabel="Yes, Log Out"
        cancelLabel="Stay Logged In"
      />
    </div>
  );
}
