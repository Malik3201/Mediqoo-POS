"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  LineChart,
  Package,
  ShoppingCart,
  Receipt,
  FileText,
  Menu,
  X,
  LogOut,
  User,
  ChevronDown
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  client_id: string;
  client?: {
    name: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    address?: string;
    timezone?: string;
  } | null;
}

const NAV_ITEMS = [
  { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
  { label: "Sales", href: "/portal/dashboard#sales", icon: LineChart },
  { label: "Products & Inventory", href: "/portal/dashboard#inventory", icon: Package },
  { label: "Purchases", href: "/portal/dashboard#purchases", icon: ShoppingCart },
  { label: "Expenses", href: "/portal/dashboard#expenses", icon: Receipt },
  { label: "Reports", href: "/portal/dashboard#reports", icon: FileText },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (pathname === "/portal/login" || pathname.startsWith("/portal/accept-invite")) {
      setLoading(false);
      return;
    }

    fetch("/api/portal/auth/me")
      .then((r) => {
        if (!r.ok) {
          router.replace("/portal/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => router.replace("/portal/login"))
      .finally(() => setLoading(false));
  }, [router, pathname]);

  const logout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Render original for public pages
  if (pathname === "/portal/login" || pathname.startsWith("/portal/accept-invite")) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 font-sans">
      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside className="hidden lg:flex flex-col w-64 fixed inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-600/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-sm text-slate-900 leading-tight tracking-tight">AivraSol</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Owner Portal</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href.includes("#") && pathname === item.href.split("#")[0]);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-emerald-50 text-emerald-700" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-emerald-600" : "text-slate-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <button
            onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-500" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ─── MOBILE SIDEBAR OVERLAY ─── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-white shadow-xl flex flex-col z-50">
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h1 className="font-bold text-sm text-slate-900 leading-tight tracking-tight">AivraSol <br/><span className="text-[10px] text-slate-500 uppercase font-semibold">Owner Portal</span></h1>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <Icon className="w-5 h-5 text-slate-400" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-100">
              <button
                onClick={logout}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="w-5 h-5 text-slate-400" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ─── MAIN WRAPPER ─── */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        
        {/* ─── TOP HEADER ─── */}
        <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-4">
            <button 
              className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg -ml-2"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:block">
              <h2 className="text-lg font-semibold text-slate-900">{user?.client?.name ?? "Loading..."}</h2>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 hover:bg-slate-50 p-1.5 pr-2 rounded-full transition-colors outline-none focus:ring-2 focus:ring-emerald-500/20">
                  <Avatar className="h-8 w-8 bg-emerald-100 text-emerald-700 font-semibold text-xs border border-emerald-200">
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium text-slate-700 leading-none">{user.name}</p>
                    <p className="text-[11px] text-slate-500 mt-1 capitalize">{user.role}</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 ml-1 hidden md:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 mt-1 rounded-xl shadow-lg border-slate-100 p-1">
                  <DropdownMenuLabel className="font-normal px-3 py-2">
                    <div className="flex flex-col space-y-1.5">
                      <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-100 mx-1" />
                  <DropdownMenuItem className="cursor-pointer rounded-md text-sm text-slate-600 focus:bg-slate-50 focus:text-slate-900" disabled>
                    <User className="mr-2 h-4 w-4 text-slate-400" />
                    <span>Profile Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={logout} className="cursor-pointer rounded-md text-sm text-red-600 focus:bg-red-50 focus:text-red-700 mt-1">
                    <LogOut className="mr-2 h-4 w-4 text-red-400" />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* ─── MAIN CONTENT ─── */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
