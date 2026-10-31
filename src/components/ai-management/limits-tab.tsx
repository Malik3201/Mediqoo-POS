"use client";

import { useState } from "react";
import { ChevronDown, Gift, Loader2, RotateCcw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  aiApi,
  errMsg,
  useAiLimits,
  useAiModels,
  useAiMutation,
  type Entitlement,
  type LimitRow,
  type ModelPolicy,
} from "./api";
import { EmptyState, ErrorState, Field, TableSkeletonRows } from "./shared";
import { LicenseStatusBadge, fmtCompact, fmtDateTime, fmtNum } from "./status-badge";

const POLICY_LABEL: Record<ModelPolicy, string> = {
  auto: "Automatic",
  fast_only: "Fast models only",
  full_featured: "Full-featured",
};

const ROLES: { value: string; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "senior-cashier", label: "Senior cashier" },
  { value: "cashier", label: "Cashier" },
];

/* ------------------------------------------------------------------ */
/* Adjust dialog (reset / promo) — reason is mandatory                  */
/* ------------------------------------------------------------------ */

type AdjustAction = "reset_daily" | "reset_monthly" | "add_promo";

function AdjustDialog({
  row,
  action,
  onClose,
}: {
  row: LimitRow;
  action: AdjustAction;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [promoReq, setPromoReq] = useState("");
  const [promoTok, setPromoTok] = useState("");
  const [promoExp, setPromoExp] = useState("");
  const m = useAiMutation((b: Parameters<typeof aiApi.adjustLimits>[1]) => aiApi.adjustLimits(row.license_id, b));

  const title =
    action === "reset_daily" ? "Reset today's usage" : action === "reset_monthly" ? "Reset this month's usage" : "Add promo quota";
  const reasonOk = reason.trim().length >= 5;
  const promoOk = action !== "add_promo" || Number(promoReq) > 0 || Number(promoTok) > 0;

  const submit = async () => {
    if (!reasonOk || !promoOk) return;
    try {
      await m.mutateAsync({
        action,
        reason: reason.trim(),
        ...(action === "add_promo"
          ? {
              promo_requests: Number(promoReq) || 0,
              promo_tokens: Number(promoTok) || 0,
              promo_expires_at: promoExp ? new Date(`${promoExp}T23:59:59`).toISOString() : undefined,
            }
          : {}),
      });
      toast.success("Quota updated");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            For <strong>{row.client_name}</strong>. This action is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {action === "add_promo" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Extra requests" htmlFor="pr-req">
                <Input id="pr-req" type="number" min={0} value={promoReq} onChange={(e) => setPromoReq(e.target.value)} />
              </Field>
              <Field label="Extra tokens" htmlFor="pr-tok">
                <Input id="pr-tok" type="number" min={0} value={promoTok} onChange={(e) => setPromoTok(e.target.value)} />
              </Field>
              <Field label="Expires on" htmlFor="pr-exp" help="Leave empty for no expiry." className="sm:col-span-2">
                <Input id="pr-exp" type="date" value={promoExp} onChange={(e) => setPromoExp(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Reason (required)" htmlFor="adj-reason" help="At least 5 characters.">
            <Textarea
              id="adj-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested a fresh quota after an outage"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!reasonOk || !promoOk || m.isPending}>
            {m.isPending && <Loader2 className="animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit sheet                                                           */
/* ------------------------------------------------------------------ */

type FormState = {
  ai_enabled: boolean;
  model_policy: ModelPolicy;
  daily_request_limit: string;
  monthly_request_limit: string;
  daily_token_limit: string;
  monthly_token_limit: string;
  max_output_tokens: string;
  concurrent_request_limit: string;
  advanced_copilot_enabled: boolean;
  purchase_preparation_enabled: boolean;
  allowed_models: string[];
  allowed_roles: string[];
  timezone: string;
};

const toForm = (e: Entitlement): FormState => ({
  ai_enabled: e.ai_enabled,
  model_policy: e.model_policy,
  daily_request_limit: String(e.daily_request_limit),
  monthly_request_limit: String(e.monthly_request_limit),
  daily_token_limit: String(e.daily_token_limit),
  monthly_token_limit: String(e.monthly_token_limit),
  max_output_tokens: String(e.max_output_tokens),
  concurrent_request_limit: String(e.concurrent_request_limit),
  advanced_copilot_enabled: e.advanced_copilot_enabled,
  purchase_preparation_enabled: e.purchase_preparation_enabled,
  allowed_models: e.allowed_models,
  allowed_roles: e.allowed_roles,
  timezone: e.timezone,
});

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function UsageLine({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {fmtNum(used)} / {fmtNum(limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={pct >= 90 ? "h-full bg-red-500" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EditForm({ row, onClose }: { row: LimitRow; onClose: () => void }) {
  const e = row.entitlement;
  const [f, setF] = useState<FormState>(() => toForm(e));
  const [advOpen, setAdvOpen] = useState(false);
  const [adjust, setAdjust] = useState<AdjustAction | null>(null);
  const { data: modelsData } = useAiModels();
  const save = useAiMutation((b: Partial<Entitlement>) => aiApi.putLimits(row.license_id, b));
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));
  const toggleIn = (key: "allowed_models" | "allowed_roles", v: string, on: boolean) =>
    set({ [key]: on ? [...f[key], v] : f[key].filter((x) => x !== v) } as Partial<FormState>);

  const nums = [
    f.daily_request_limit,
    f.monthly_request_limit,
    f.daily_token_limit,
    f.monthly_token_limit,
    f.max_output_tokens,
    f.concurrent_request_limit,
  ].map(Number);
  const numsOk = nums.every((n) => Number.isFinite(n) && n >= 0);
  const tzOk = validTimezone(f.timezone.trim());
  const canSave = numsOk && tzOk && f.concurrent_request_limit !== "" && Number(f.concurrent_request_limit) >= 1;

  const submit = async () => {
    if (!canSave) {
      toast.error("Please fix the highlighted values (numbers must be 0 or more, timezone must be valid).");
      return;
    }
    try {
      await save.mutateAsync({
        ai_enabled: f.ai_enabled,
        model_policy: f.model_policy,
        daily_request_limit: Number(f.daily_request_limit),
        monthly_request_limit: Number(f.monthly_request_limit),
        daily_token_limit: Number(f.daily_token_limit),
        monthly_token_limit: Number(f.monthly_token_limit),
        max_output_tokens: Number(f.max_output_tokens),
        concurrent_request_limit: Number(f.concurrent_request_limit),
        advanced_copilot_enabled: f.advanced_copilot_enabled,
        purchase_preparation_enabled: f.purchase_preparation_enabled,
        allowed_models: f.allowed_models,
        allowed_roles: f.allowed_roles,
        timezone: f.timezone.trim(),
      });
      toast.success("Limits saved");
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const numField = (label: string, key: keyof FormState, id: string, help?: string) => (
    <Field label={label} htmlFor={id} help={help}>
      <Input
        id={id}
        type="number"
        min={0}
        value={f[key] as string}
        onChange={(ev) => set({ [key]: ev.target.value } as Partial<FormState>)}
        aria-invalid={Number(f[key]) < 0 || f[key] === ""}
      />
    </Field>
  );

  return (
    <>
      <SheetHeader>
        <SheetTitle>{row.client_name}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{row.license_key_masked}</span>
            <LicenseStatusBadge status={row.license_status} />
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto py-4 pr-1">
        <div className="space-y-3 rounded-lg border p-4">
          <UsageLine label="Requests today" used={e.daily_requests_used} limit={e.daily_request_limit} />
          <UsageLine label="Requests this month" used={e.monthly_requests_used} limit={e.monthly_request_limit} />
          <UsageLine label="Tokens today" used={e.daily_tokens_used} limit={e.daily_token_limit} />
          <UsageLine label="Tokens this month" used={e.monthly_tokens_used} limit={e.monthly_token_limit} />
          {(e.promo_extra_requests > 0 || e.promo_extra_tokens > 0) && (
            <p className="text-xs text-muted-foreground">
              Promo: +{fmtNum(e.promo_extra_requests)} requests, +{fmtNum(e.promo_extra_tokens)} tokens
              {e.promo_expires_at ? ` until ${fmtDateTime(e.promo_expires_at)}` : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setAdjust("reset_daily")}>
              <RotateCcw /> Reset today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdjust("reset_monthly")}>
              <RotateCcw /> Reset month
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdjust("add_promo")}>
              <Gift /> Add promo quota
            </Button>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">AI enabled for this pharmacy</p>
            <p className="text-xs text-muted-foreground">Turn off to block all AI requests from this license.</p>
          </div>
          <Switch checked={f.ai_enabled} onCheckedChange={(v) => set({ ai_enabled: v })} aria-label="AI enabled" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          {numField("Daily request limit", "daily_request_limit", "l-drl")}
          {numField("Monthly request limit", "monthly_request_limit", "l-mrl")}
          {numField("Daily token budget", "daily_token_limit", "l-dtl")}
          {numField("Monthly token budget", "monthly_token_limit", "l-mtl")}
          <Field label="Model policy" className="sm:col-span-2">
            <Select value={f.model_policy} onValueChange={(v) => set({ model_policy: v as ModelPolicy })}>
              <SelectTrigger aria-label="Model policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POLICY_LABEL) as ModelPolicy[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {POLICY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Collapsible open={advOpen} onOpenChange={setAdvOpen} className="rounded-lg border">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" aria-hidden /> Advanced
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${advOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 border-t p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {numField("Max output tokens", "max_output_tokens", "l-mot", "Cap on each AI reply.")}
              {numField("Concurrent requests", "concurrent_request_limit", "l-crl", "At least 1.")}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Allowed models</legend>
              <p className="text-xs text-muted-foreground">Leave all unchecked to allow every enabled model.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(modelsData?.models ?? []).map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={f.allowed_models.includes(m.provider_model_id)}
                      onCheckedChange={(v) => toggleIn("allowed_models", m.provider_model_id, v === true)}
                    />
                    <span className="truncate">{m.model_name}</span>
                  </label>
                ))}
                {(modelsData?.models ?? []).length === 0 && <p className="text-xs text-muted-foreground">No models configured.</p>}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Allowed roles</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLES.map((r) => (
                  <label key={r.value} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={f.allowed_roles.includes(r.value)}
                      onCheckedChange={(v) => toggleIn("allowed_roles", r.value, v === true)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                Advanced Copilot
                <Switch
                  checked={f.advanced_copilot_enabled}
                  onCheckedChange={(v) => set({ advanced_copilot_enabled: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                Purchase preparation
                <Switch
                  checked={f.purchase_preparation_enabled}
                  onCheckedChange={(v) => set({ purchase_preparation_enabled: v })}
                />
              </label>
            </div>

            <Field
              label="Timezone"
              htmlFor="l-tz"
              help={tzOk ? "Used for the daily and monthly quota reset (e.g. Asia/Karachi)." : undefined}
            >
              <Input id="l-tz" value={f.timezone} onChange={(ev) => set({ timezone: ev.target.value })} aria-invalid={!tzOk} />
              {!tzOk && <p className="text-xs text-red-700">Enter a valid IANA timezone such as Asia/Karachi.</p>}
            </Field>

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Promo quota</p>
              <p>
                {e.promo_extra_requests > 0 || e.promo_extra_tokens > 0
                  ? `+${fmtNum(e.promo_extra_requests)} requests, +${fmtNum(e.promo_extra_tokens)} tokens${
                      e.promo_expires_at ? `, expires ${fmtDateTime(e.promo_expires_at)}` : ""
                    }`
                  : "No promo quota active."}{" "}
                Use “Add promo quota” above to grant more.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <SheetFooter className="gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </SheetFooter>

      {adjust && <AdjustDialog row={row} action={adjust} onClose={() => setAdjust(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main tab                                                             */
/* ------------------------------------------------------------------ */

export function LimitsTab() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useAiLimits(search);
  const toggle = useAiMutation((v: { id: string; ai_enabled: boolean }) =>
    aiApi.putLimits(v.id, { ai_enabled: v.ai_enabled }),
  );

  const rows = data?.rows ?? [];
  const selected = rows.find((r) => r.license_id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input.trim());
        }}
      >
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search pharmacy or license…"
            aria-label="Search pharmacies"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value === "") setSearch("");
            }}
          />
        </div>
        <Button type="submit" variant="outline" disabled={isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </form>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pharmacy limits</CardTitle>
            <CardDescription>Control AI access and quotas per pharmacy. Select a row to edit.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pharmacy</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>AI</TableHead>
                    <TableHead>Daily</TableHead>
                    <TableHead>Monthly</TableHead>
                    <TableHead>Token budget (day)</TableHead>
                    <TableHead>Model policy</TableHead>
                    <TableHead className="text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeletonRows cols={8} />
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <EmptyState
                          title={search ? "No pharmacies match your search" : "No pharmacies found"}
                          description={search ? "Try a different name or license key." : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => {
                      const en = r.entitlement;
                      return (
                        <TableRow
                          key={r.license_id}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(r.license_id)}
                        >
                          <TableCell>
                            <div className="font-medium">{r.client_name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{r.license_key_masked}</div>
                          </TableCell>
                          <TableCell>
                            <LicenseStatusBadge status={r.license_status} />
                          </TableCell>
                          <TableCell onClick={(ev) => ev.stopPropagation()}>
                            <Switch
                              checked={en.ai_enabled}
                              disabled={toggle.isPending}
                              aria-label={`AI for ${r.client_name}`}
                              onCheckedChange={(v) =>
                                toggle.mutate(
                                  { id: r.license_id, ai_enabled: v },
                                  {
                                    onSuccess: () => toast.success(`AI ${v ? "enabled" : "disabled"} for ${r.client_name}`),
                                    onError: (e) => toast.error(errMsg(e)),
                                  },
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {fmtNum(en.daily_requests_used)} / {fmtNum(en.daily_request_limit)}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {fmtNum(en.monthly_requests_used)} / {fmtNum(en.monthly_request_limit)}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {fmtCompact(en.daily_tokens_used)} / {fmtCompact(en.daily_token_limit)}
                          </TableCell>
                          <TableCell className="text-sm">{POLICY_LABEL[en.model_policy] ?? en.model_policy}</TableCell>
                          <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                            <Button variant="outline" size="sm" onClick={() => setSelectedId(r.license_id)}>
                              <Settings2 /> Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          {selected && <EditForm key={selected.license_id} row={selected} onClose={() => setSelectedId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
