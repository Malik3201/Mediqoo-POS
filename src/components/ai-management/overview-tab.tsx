"use client";

import { Activity, CheckCircle2, KeyRound, Percent, Sparkles, Store, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAiOverview } from "./api";
import { EmptyState, ErrorState, StatCard } from "./shared";
import { SeverityBadge, fmtAgo, fmtCompact, fmtNum, fmtUsd } from "./status-badge";

const trendConfig = {
  requests: { label: "Requests", color: "var(--primary)" },
  failures: { label: "Failures", color: "var(--destructive)" },
} satisfies ChartConfig;

const STATUS_STYLE = {
  Running: "text-emerald-600",
  Limited: "text-amber-600",
  Unavailable: "text-red-600",
} as const;

export function TrendChart({
  data,
  className,
}: {
  data: { date: string; requests: number; failures: number }[];
  className?: string;
}) {
  return (
    <ChartContainer config={trendConfig} className={cn("aspect-auto h-64 w-full", className)}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: string) => {
            try {
              return format(parseISO(v), "dd MMM");
            } catch {
              return v;
            }
          }}
        />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(v: number) => fmtCompact(v)} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent payload={[]} />} />
        <Area dataKey="requests" type="monotone" stroke="var(--color-requests)" strokeWidth={2} fill="url(#fillRequests)" isAnimationActive={false} />
        <Area dataKey="failures" type="monotone" stroke="var(--color-failures)" strokeWidth={2} fill="transparent" isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, isLoading, error, refetch } = useAiOverview();

  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const alerts = (data?.alerts ?? [])
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity];
    })
    .slice(0, 4);

  const healthyRatio = data && data.totalKeys > 0 ? data.healthyKeys / data.totalKeys : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="AI Status"
          loading={isLoading}
          icon={<Sparkles className="h-4 w-4" />}
          value={data ? <span className={STATUS_STYLE[data.status]}>{data.status}</span> : null}
          hint={data?.statusReason}
        />
        <StatCard
          label="Requests Today"
          loading={isLoading}
          icon={<Activity className="h-4 w-4" />}
          value={fmtNum(data?.requestsToday)}
          hint="AI replies served since midnight"
        />
        <StatCard
          label="Tokens Used Today"
          loading={isLoading}
          icon={<Zap className="h-4 w-4" />}
          value={fmtCompact(data?.tokensToday)}
          hint={data?.estimatedCostUsd != null ? `Estimated cost ${fmtUsd(data.estimatedCostUsd)}` : "Input + output tokens"}
        />
        <StatCard
          label="Active Pharmacies"
          loading={isLoading}
          icon={<Store className="h-4 w-4" />}
          value={fmtNum(data?.activePharmacies)}
          hint="Pharmacies that used AI today"
        />
        <StatCard
          label="Healthy API Capacity"
          loading={isLoading}
          icon={<KeyRound className="h-4 w-4" />}
          value={data ? `${data.healthyKeys} of ${data.totalKeys}` : null}
          tone={data && data.totalKeys > 0 ? (healthyRatio >= 0.5 ? undefined : "text-amber-600") : "text-red-600"}
          hint={data ? (data.totalKeys === 0 ? "No API keys added yet" : "keys healthy") : undefined}
        />
        <StatCard
          label="Request Success Rate"
          loading={isLoading}
          icon={<Percent className="h-4 w-4" />}
          value={data?.successRate != null ? `${data.successRate.toFixed(1)}%` : "—"}
          hint={data?.successRate == null ? "Not enough data yet" : "Successful AI replies today"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last 7 days</CardTitle>
          <CardDescription>Requests and failures per day</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : data && data.trend.length > 0 ? (
            <TrendChart data={data.trend} />
          ) : (
            <EmptyState title="No usage yet" description="Requests will appear here once pharmacies start using AI." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>Most important active alerts</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("alerts")}>
            All alerts
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Everything looks good. No active alerts.
            </div>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <span className="text-sm font-medium">{a.title}</span>
                    {a.occurrence_count > 1 && (
                      <Badge variant="secondary" className="font-normal">
                        ×{a.occurrence_count}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{a.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.affected_entity_name} · {fmtAgo(a.last_detected_at)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => onNavigate("alerts")}>
                  View Details
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
