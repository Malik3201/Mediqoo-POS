"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, ShieldCheck, Trash2, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { aiApi, errMsg, useAiMutation, useAiModels, type AiModel, type UsagePolicy } from "./api";
import { EmptyState, ErrorState, Field, TableSkeletonRows } from "./shared";
import { fmtAgo, fmtNum } from "./status-badge";

const POLICY_LABEL: Record<UsagePolicy, string> = {
  all_queries: "All queries",
  simple_only: "Simple questions only",
  complex_only: "Complex questions only",
  fallback_only: "Fallback only",
};

type RoleField = "is_default" | "is_complex_default" | "is_fallback";

const ROLE_META: { field: RoleField; label: string }[] = [
  { field: "is_default", label: "Default" },
  { field: "is_complex_default", label: "Complex" },
  { field: "is_fallback", label: "Fallback" },
];

function RoleBadge({
  model,
  field,
  label,
  onPick,
  busy,
}: {
  model: AiModel;
  field: RoleField;
  label: string;
  onPick: () => void;
  busy: boolean;
}) {
  const active = model[field];
  const blocked = !model.supports_tools;
  const btn = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={`${label} model: ${model.model_name}`}
      disabled={active || blocked || busy}
      onClick={onPick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-dashed text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
  if (!blocked || active) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{btn}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">This model cannot use tools, so it cannot be a routing target.</TooltipContent>
    </Tooltip>
  );
}

function TokensInput({ model, onSave }: { model: AiModel; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(model.max_output_tokens));
  const commit = () => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) {
      setV(String(model.max_output_tokens));
      return;
    }
    if (n !== model.max_output_tokens) onSave(n);
  };
  return (
    <Input
      type="number"
      min={1}
      className="h-8 w-24"
      aria-label={`Max output tokens for ${model.model_name}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), undefined)}
    />
  );
}

function AddModelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState({
    model_name: "",
    provider_model_id: "",
    context_window: "131072",
    max_output_tokens: "1024",
    supports_tools: true,
    supports_structured_json: false,
    usage_policy: "all_queries" as UsagePolicy,
    cost_in: "",
    cost_out: "",
  });
  const m = useAiMutation((b: Parameters<typeof aiApi.createModel>[0]) => aiApi.createModel(b));
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    if (!form.model_name.trim() || !form.provider_model_id.trim()) {
      toast.error("Display name and Groq model ID are required.");
      return;
    }
    try {
      await m.mutateAsync({
        model_name: form.model_name.trim(),
        provider_model_id: form.provider_model_id.trim(),
        context_window: Number(form.context_window) || 0,
        max_output_tokens: Number(form.max_output_tokens) || 1024,
        supports_tools: form.supports_tools,
        supports_structured_json: form.supports_structured_json,
        usage_policy: form.usage_policy,
        cost_per_million_input_usd: Number(form.cost_in) || 0,
        cost_per_million_output_usd: Number(form.cost_out) || 0,
        enabled: false,
      });
      toast.success("Model added (disabled). Verify it, then enable it.");
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add model</DialogTitle>
          <DialogDescription>New models start disabled. Use “Verify with Groq” to confirm it exists before enabling.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="am-name">
            <Input id="am-name" value={form.model_name} onChange={(e) => set({ model_name: e.target.value })} placeholder="Llama 3.3 70B" />
          </Field>
          <Field label="Groq model ID" htmlFor="am-id">
            <Input id="am-id" value={form.provider_model_id} onChange={(e) => set({ provider_model_id: e.target.value })} placeholder="llama-3.3-70b-versatile" autoComplete="off" />
          </Field>
          <Field label="Context window (tokens)" htmlFor="am-ctx">
            <Input id="am-ctx" type="number" min={0} value={form.context_window} onChange={(e) => set({ context_window: e.target.value })} />
          </Field>
          <Field label="Max output tokens" htmlFor="am-out">
            <Input id="am-out" type="number" min={1} value={form.max_output_tokens} onChange={(e) => set({ max_output_tokens: e.target.value })} />
          </Field>
          <Field label="Cost per 1M input tokens (USD)" htmlFor="am-cin" help="Optional, used for estimates only.">
            <Input id="am-cin" type="number" min={0} step="0.01" value={form.cost_in} onChange={(e) => set({ cost_in: e.target.value })} />
          </Field>
          <Field label="Cost per 1M output tokens (USD)" htmlFor="am-cout">
            <Input id="am-cout" type="number" min={0} step="0.01" value={form.cost_out} onChange={(e) => set({ cost_out: e.target.value })} />
          </Field>
          <Field label="Usage policy" className="sm:col-span-2">
            <Select value={form.usage_policy} onValueChange={(v) => set({ usage_policy: v as UsagePolicy })}>
              <SelectTrigger aria-label="Usage policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POLICY_LABEL) as UsagePolicy[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {POLICY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            Supports tools
            <Switch checked={form.supports_tools} onCheckedChange={(v) => set({ supports_tools: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            Structured JSON
            <Switch checked={form.supports_structured_json} onCheckedChange={(v) => set({ supports_structured_json: v })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={m.isPending}>
            {m.isPending && <Loader2 className="animate-spin" />} Add model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModelsTab() {
  const { data, isLoading, error, refetch } = useAiModels();
  const patch = useAiMutation((v: { id: string; body: Partial<AiModel> }) => aiApi.patchModel(v.id, v.body));
  const remove = useAiMutation((id: string) => aiApi.deleteModel(id));
  const sync = useAiMutation<void, Awaited<ReturnType<typeof aiApi.syncModels>>>(() => aiApi.syncModels());

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AiModel | null>(null);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string; available: string[] } | null>(null);

  const models = data?.models ?? [];

  const update = (m: AiModel, body: Partial<AiModel>, okMsg?: string) =>
    patch.mutate(
      { id: m.id, body },
      { onSuccess: () => okMsg && toast.success(okMsg), onError: (e) => toast.error(errMsg(e)) },
    );

  const runSync = async () => {
    try {
      const r = await sync.mutateAsync();
      setSyncResult({ ok: r.ok, message: r.message, available: r.available });
      if (r.ok) toast.success(r.message || "Models verified");
      else toast.error(r.message || "Verification failed");
    } catch (e) {
      setSyncResult({ ok: false, message: errMsg(e), available: [] });
      toast.error(errMsg(e));
    }
  };

  const unavailable = syncResult?.ok
    ? models.filter((m) => !syncResult.available.includes(m.provider_model_id))
    : models.filter((m) => m.last_error);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-900 sm:max-w-3xl">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Pharmacy AI relies on tools to read live data, so requests are never routed to a model without tool support.
            Models without tools cannot be set as Default, Complex or Fallback.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void runSync()} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify with Groq
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Add Model
          </Button>
        </div>
      </div>

      {syncResult && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            syncResult.ok ? "border-emerald-200 bg-emerald-50/70 text-emerald-900" : "border-red-200 bg-red-50/70 text-red-900",
          )}
        >
          {syncResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <p>{syncResult.message}</p>
        </div>
      )}

      {unavailable.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {syncResult?.ok ? "Not available on Groq right now" : "Models with recent errors"}
            </p>
            <p className="mt-0.5">
              {unavailable.map((m) => m.model_name).join(", ")}
              {syncResult?.ok ? " — these cannot be used until Groq lists them again." : "."}
            </p>
          </div>
        </div>
      )}

      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Models & routing</CardTitle>
            <CardDescription>Choose which models are enabled and how requests are routed between them.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Routing role</TableHead>
                    <TableHead>Max output</TableHead>
                    <TableHead>Usage policy</TableHead>
                    <TableHead className="text-right">Context</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Reliability</TableHead>
                    <TableHead className="text-right">Remove</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeletonRows cols={9} />
                  ) : models.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <EmptyState title="No models configured" description="Add a model, or verify with Groq once a key is available." />
                      </TableCell>
                    </TableRow>
                  ) : (
                    models.map((m) => {
                      const success = m.total_requests > 0 ? (m.successful_requests / m.total_requests) * 100 : null;
                      return (
                        <TableRow key={m.id}>
                          <TableCell>
                            <div className="font-medium">{m.model_name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{m.provider_model_id}</div>
                            {m.last_error && (
                              <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-red-700" title={m.last_error}>
                                {m.last_error}
                              </div>
                            )}
                            {m.last_verified_at && (
                              <div className="text-[11px] text-muted-foreground">Verified {fmtAgo(m.last_verified_at)}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={m.enabled}
                              onCheckedChange={(v) => update(m, { enabled: v }, v ? `${m.model_name} enabled` : `${m.model_name} disabled`)}
                              aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.model_name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div role="group" aria-label={`Routing roles for ${m.model_name}`} className="flex flex-wrap gap-1">
                              {ROLE_META.map((r) => (
                                <RoleBadge
                                  key={r.field}
                                  model={m}
                                  field={r.field}
                                  label={r.label}
                                  busy={patch.isPending}
                                  onPick={() => update(m, { [r.field]: true }, `${m.model_name} set as ${r.label.toLowerCase()} model`)}
                                />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <TokensInput
                              key={`${m.id}-${m.max_output_tokens}`}
                              model={m}
                              onSave={(n) => update(m, { max_output_tokens: n }, "Max output tokens saved")}
                            />
                          </TableCell>
                          <TableCell>
                            <Select value={m.usage_policy} onValueChange={(v) => update(m, { usage_policy: v as UsagePolicy }, "Usage policy saved")}>
                              <SelectTrigger className="h-8 w-48" aria-label={`Usage policy for ${m.model_name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(POLICY_LABEL) as UsagePolicy[]).map((p) => (
                                  <SelectItem key={p} value={p}>
                                    {POLICY_LABEL[p]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{fmtNum(m.context_window)}</TableCell>
                          <TableCell>
                            {m.supports_tools ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">
                                Tools
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="whitespace-nowrap border-red-200 bg-red-50 font-medium text-red-700">
                                No tools
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {success === null ? (
                              <span className="text-muted-foreground">No data yet</span>
                            ) : (
                              <>
                                <div className="font-medium">{success.toFixed(1)}% success</div>
                                <div className="whitespace-nowrap text-muted-foreground">
                                  {Math.round(m.avg_latency_ms)} ms avg · {fmtNum(m.total_requests)} req
                                </div>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${m.model_name}`}
                              onClick={() => setRemoveTarget(m)}
                            >
                              <Trash2 className="text-red-600" />
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

      <AddModelDialog key={addOpen ? "open" : "closed"} open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this model?</AlertDialogTitle>
            <AlertDialogDescription>
              “{removeTarget?.model_name}” will be removed from the registry. If it is a routing default, pick a new one afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!removeTarget) return;
                remove.mutate(removeTarget.id, {
                  onSuccess: () => toast.success("Model removed"),
                  onError: (e) => toast.error(errMsg(e)),
                });
              }}
            >
              Remove model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
