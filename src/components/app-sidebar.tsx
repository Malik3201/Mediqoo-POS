"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Boxes,
  FolderKanban,
  KeyRound,
  Package,
  Palette,
  ScrollText,
  Activity,
  Settings,
  Bell,
  ShieldCheck,
  Rocket,
  MessageSquare,
  CreditCard,
  Sparkles,
  Database,
  HardDrive,
  MapPin,
  Cloud,
  Globe,
  Images,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const primary = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Pharmacy Websites", url: "/pharmacy-websites", icon: Globe },
  { title: "Central Medicine Images", url: "/central-images", icon: Images },
  { title: "POS Live Map", url: "/pos-map", icon: MapPin },
  { title: "Clients", url: "/clients", icon: Building2 },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Licenses", url: "/licenses", icon: KeyRound },
  { title: "Data Migration", url: "/migration", icon: Database },
  { title: "Billing & Renewals", url: "/billing", icon: CreditCard },
  { title: "Packages", url: "/packages", icon: Package },
  { title: "Releases", url: "/releases", icon: Rocket },
  { title: "Business Templates", url: "/templates", icon: Boxes },
  { title: "AI Management", url: "/ai-management", icon: Sparkles },
];

const infrastructure = [
  { title: "Cloud Resource Monitor", url: "/infrastructure/cloud-monitor", icon: Cloud },
  { title: "Storage Management", url: "/storage", icon: HardDrive },
];

const admin = [
  { title: "Users", url: "/users", icon: Users },
  { title: "Roles", url: "/roles", icon: ShieldCheck },
  { title: "Branding", url: "/branding", icon: Palette },
  { title: "Audit Logs", url: "/audit", icon: ScrollText },
  { title: "Activity", url: "/activity", icon: Activity },
  { title: "Notifications", url: "/notifications", icon: Bell },
  { title: "Feedbacks", url: "/feedbacks", icon: MessageSquare },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const currentPath = usePathname();
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(`${path}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
            A
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">AivraSol</span>
            <span className="text-xs text-muted-foreground">Builder</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Infrastructure</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {infrastructure.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {admin.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t text-xs text-muted-foreground px-3 py-2 group-data-[collapsible=icon]:hidden">
        v0.1 · Milestone 1
      </SidebarFooter>
    </Sidebar>
  );
}
