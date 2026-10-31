"use client";

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAiLimits, useAiModels, useAiUsage, type UsageFilters } from "./api";
import { TrendChart } from "./overview-tab";
import { EmptyState, ErrorState, Field, StatCard, TableSkeletonRows } from "./shared";
import { RequestStatusBadge, fmtCompact, fmtDateTime, fmtNum, fmtUsd } from "./status-badge";

const ALL = "all";
const today = () => format(new Date(), "yyyy-MM-dd");
const weekAgo = () => format(subDays(new Date(), 6), "yyyy-MM-dd");

export function UsageTab() {
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [license, setLicense] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const filters: UsageFilters = {
    from,
    to,
    license_id: license === ALL ? "" : license,
    model: model === ALL ? "" : model,
    status: status === ALL ? "" : status,
  };
  const rangeInvalid = !!from && !!to && from > to;
  const { data, isLoading, error, refetch } = useAiUsage(
    rangeInvalid ? { ...filters, from: to, to: from } : filters,
  );
  const { data: limits } = useAiLimits("");
  const { data: modelsData } = useAiModels();

  // Options come from the registry plus anything seen in the results, so a filter never hides its own value.
  const pharmacyOptions = useMemo(() => {
    const map = new Map<string, string>();
    (limits?.rows ?? []).forEach((r) => map.set(r.license_id, r.client_name));
    (data?.byPharmacy ?? []).forEach((p) => map.set(p.license_id, p.pharmacy_name));
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [limits, data]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    (modelsData?.models ?? []).forEach((m) => set.add(m.provider_model_id));
    (data?.byModel ?? []).forEach((m) => set.add(m.model));
    return Array.from(set).sort();
  }, [modelsData, data]);

  const s = data?.summary;
  const failureRate = s && s.requests > 0 ? (s.failures / s.requests) * 100 : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From" htmlFor="u-from">
            <Input id="u-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="u-to">
            <Input id="u-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Pharmacy">
            <Select value={license} onValueChange={setLicense}>
              <SelectTrigger aria-label="Pharmacy filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All pharmacies</SelectItem>
                {pharmacyOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Model">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger aria-label="Model filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All models</SelectItem>
                {modelOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="success">Successful</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {rangeInvalid && (
            <p role="alert" className="text-xs text-amber-700 sm:col-span-2 lg:col-span-5">
              “From” is after “To” — showing the dates swapped.
            </p>
          )}
        </CardContent>
      </Card>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Requests" loading={isLoading} value={fmtNum(s?.requests)} />
            <StatCard
              label="Tokens"
              loading={isLoading}
              value={fmtCompact(s?.tokens)}
              hint={s ? `${fmtCompact(s.inputTokens)} in · ${fmtCompact(s.outputTokens)} out · ${fmtCompact(s.cachedTokens)} cached` : undefined}
            />
            <StatCard
              label="Failures"
              loading={isLoading}
              value={fmtNum(s?.failures)}
              tone={s && s.failures > 0 ? "text-red-600" : undefined}
              hint={failureRate != null ? `${failureRate.toFixed(1)}% of requests` : undefined}
            />
            <StatCard
              label="Avg response time"
              loading={isLoading}
              value={s ? `${Math.round(s.avgLatencyMs)} ms` : "—"}
              hint={s?.estimatedCostUsd != null ? `Estimated cost ${fmtUsd(s.estimatedCostUsd)}` : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily usage</CardTitle>
              <CardDescription>Requests and failures per day</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : data && data.byDay.length > 0 ? (
                <TrendChart data={data.byDay} />
              ) : (
                <EmptyState title="No usage in this period" description="Try widening the date range or clearing filters." />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By model</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableSkeletonRows cols={3} rows={3} />
                    ) : (data?.byModel ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          No data
                        </TableCell>
                      </TableRow>
                    ) : (
                      data!.byModel.map((m) => (
                        <TableRow key={m.model}>
                          <TableCell className="font-mono text-xs">{m.model}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(m.requests)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCompact(m.tokens)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By pharmacy</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pharmacy</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableSkeletonRows cols={3} rows={3} />
                    ) : (data?.byPharmacy ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          No data
                        </TableCell>
                      </TableRow>
                    ) : (
                      data!.byPharmacy.map((p) => (
                        <TableRow key={p.license_id}>
                          <TableCell className="font-medium">{p.pharmacy_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(p.requests)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCompact(p.tokens)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent requests</CardTitle>
              <CardDescription>Latest 200 requests matching your filters</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Pharmacy</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableSkeletonRows cols={9} />
                    ) : (data?.rows ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9}>
                          <EmptyState title="No requests found" description="Nothing matches the selected filters." />
                        </TableCell>
                      </TableRow>
                    ) : (
                      data!.rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</TableCell>
                          <TableCell className="text-sm">{r.pharmacy_name}</TableCell>
                          <TableCell className="text-xs capitalize">{r.operator_role}</TableCell>
                          <TableCell className="text-xs">{r.request_type}</TableCell>
                          <TableCell className="font-mono text-xs">{r.model_used}</TableCell>
                          <TableCell className="text-xs">{r.credential_name}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{fmtNum(r.total_tokens)}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.latency_ms} ms</TableCell>
                          <TableCell>
                            <RequestStatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
