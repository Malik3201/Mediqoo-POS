"use client";

import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertsTab } from "@/components/ai-management/alerts-tab";
import { KeysTab } from "@/components/ai-management/keys-tab";
import { LimitsTab } from "@/components/ai-management/limits-tab";
import { ModelsTab } from "@/components/ai-management/models-tab";
import { OverviewTab } from "@/components/ai-management/overview-tab";
import { SettingsTab } from "@/components/ai-management/settings-tab";
import { UsageTab } from "@/components/ai-management/usage-tab";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "keys", label: "API Keys" },
  { value: "models", label: "Models & Routing" },
  { value: "limits", label: "Pharmacy Limits" },
  { value: "usage", label: "Usage & Analytics" },
  { value: "alerts", label: "Alerts & Logs" },
  { value: "settings", label: "AI Settings" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function AiManagement() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const active: TabValue = TABS.some((t) => t.value === raw) ? (raw as TabValue) : "overview";

  const setTab = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("tab", value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Management</h1>
            <p className="text-sm text-muted-foreground">
              Control API keys, models, pharmacy limits and monitor AI health across Mediqoo.
            </p>
          </div>
        </div>

        <Tabs value={active} onValueChange={setTab} className="space-y-4">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="h-auto w-max justify-start">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="overview">
            <OverviewTab onNavigate={setTab} />
          </TabsContent>
          <TabsContent value="keys">
            <KeysTab />
          </TabsContent>
          <TabsContent value="models">
            <ModelsTab />
          </TabsContent>
          <TabsContent value="limits">
            <LimitsTab />
          </TabsContent>
          <TabsContent value="usage">
            <UsageTab />
          </TabsContent>
          <TabsContent value="alerts">
            <AlertsTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

export default function AiManagementPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AiManagement />
    </Suspense>
  );
}
