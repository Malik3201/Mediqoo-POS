"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Globe,
  History,
  Info,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  Layers,
  X,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { aiApi, errMsg, useAiKeyHistory, useAiKeys, useAiMutation, type AiKey, type AiPool, type AiProvider } from "./api";
import { EmptyState, ErrorState, Field, TableSkeletonRows } from "./shared";
import { KeyStatusBadge, fmtAgo, fmtDateTime, fmtNum, resetsIn } from "./status-badge";

const SHARED_QUOTA_NOTE =
  "Groq keys in the same organization share one quota pool. Universal / Custom API keys connect to any OpenAI-compatible provider (OpenRouter, DeepSeek, OpenAI, Together, Mistral, Ollama, etc.) independently.";

const CUSTOM_API_PRESETS = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", exampleModel: "openai/gpt-4o-mini" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", exampleModel: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", exampleModel: "gpt-4o-mini" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", exampleModel: "mistral-small-latest" },
  { id: "fireworks", label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", exampleModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "xai", label: "xAI Grok", baseUrl: "https://api.x.ai/v1", exampleModel: "grok-2-latest" },
  { id: "ollama", label: "Ollama (Local)", baseUrl: "http://localhost:11434/v1", exampleModel: "llama3.2" },
] as const;

function previewCompletionsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const cleanPath = u.pathname.replace(/\/+$/, "");
    const finalPath = /\/chat\/completions$/i.test(cleanPath) ? cleanPath : `${cleanPath}/chat/completions`;
    return `${u.protocol}//${u.host}${finalPath}${u.search}`;
  } catch {
    return null;
  }
}

function displayHost(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

/* ------------------------------------------------------------------ */
/* Pool summary                                                         */
/* ------------------------------------------------------------------ */

function pct(used: number, limit: number) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function PoolCard({ pool }: { pool: AiPool }) {
  const reset = resetsIn(pool.rate_limited_until) ?? resetsIn(pool.circuit_open_until);
  const reqPct = pct(pool.daily_requests_used, pool.daily_request_limit);
  const healthy = pool.healthy_key_count > 0;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold">{pool.organization_name || pool.organization_id}</p>
              {pool.provider === "custom" && (
                <Badge variant="outline" className="shrink-0 border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[10px] font-medium text-indigo-700">
                  {pool.provider_label || "Universal API"}
                </Badge>
              )}
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{pool.organization_id}</p>
          </div>
          <Badge
            variant="outline"
            className={`whitespace-nowrap font-medium ${
              /limited|rate|degraded|partial/i.test(pool.status)
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : healthy && !/unavail|down|invalid/i.test(pool.status)
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {pool.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {pool.healthy_key_count} of {pool.key_count} key{pool.key_count === 1 ? "" : "s"} healthy
          {reset ? ` · ${reset}` : ""}
        </p>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Daily requests</span>
            <span>
              {fmtNum(pool.daily_requests_used)} / {pool.daily_request_limit ? fmtNum(pool.daily_request_limit) : "—"}
            </span>
          </div>
          <Progress value={reqPct} aria-label={`${pool.organization_name} daily request usage`} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>In flight now</span>
          <span>{pool.in_flight_requests}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Add key dialog                                                       */
/* ------------------------------------------------------------------ */

type Row = {
  uid: number;
  name: string;
  organization_id: string;
  organization_name: string;
  weight: string;
  api_key: string;
  result?: { ok: boolean; message: string };
};

let uidCounter = 0;
const blankRow = (): Row => ({
  uid: ++uidCounter,
  name: "",
  organization_id: "",
  organization_name: "",
  weight: "1",
  api_key: "",
});

function AddKeysDialog({
  open,
  onOpenChange,
  existing,
  initialProvider = "groq",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: AiKey[];
  initialProvider?: AiProvider;
}) {
  const [providerTab, setProviderTab] = useState<AiProvider>(initialProvider);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, blankRow));
  const [submitting, setSubmitting] = useState(false);

  // Universal / Custom API form state
  const [customForm, setCustomForm] = useState({
    name: "",
    provider_label: "",
    base_url: "",
    default_model: "",
    api_key: "",
    weight: "100",
    set_as_primary: true,
    exampleModel: "deepseek-chat or openai/gpt-4o-mini",
  });
  const [customError, setCustomError] = useState<string | null>(null);

  const create = useAiMutation((b: Parameters<typeof aiApi.createKey>[0]) => aiApi.createKey(b));

  const reset = () => {
    setRows(Array.from({ length: 5 }, blankRow));
    setCustomForm({
      name: "",
      provider_label: "",
      base_url: "",
      default_model: "",
      api_key: "",
      weight: "100",
      set_as_primary: true,
      exampleModel: "deepseek-chat or openai/gpt-4o-mini",
    });
    setCustomError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (submitting) return;
    if (!o) reset(); // always wipe secrets from memory on close
    onOpenChange(o);
  };

  const patch = (uid: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const patchCustom = (p: Partial<typeof customForm>) => {
    setCustomError(null);
    setCustomForm((f) => ({ ...f, ...p }));
  };

  const applyPreset = (preset: (typeof CUSTOM_API_PRESETS)[number]) => {
    setCustomError(null);
    setCustomForm((f) => ({
      ...f,
      base_url: preset.baseUrl,
      provider_label: preset.label,
      exampleModel: preset.exampleModel,
      name: !f.name.trim() || CUSTOM_API_PRESETS.some((p) => f.name.trim() === `${p.label} API`) ? `${preset.label} API` : f.name,
    }));
  };

  const isFilled = (r: Row) => r.api_key.trim().length > 0 && !r.result?.ok;
  const isTouched = (r: Row) => !r.result?.ok && (r.api_key || r.name || r.organization_id || r.organization_name);
  const pending = rows.filter(isFilled);

  const orgCounts = new Map<string, number>();
  rows.forEach((r) => {
    const k = r.organization_id.trim();
    if (k && !r.result?.ok) orgCounts.set(k, (orgCounts.get(k) ?? 0) + 1);
  });
  const existingOrgs = new Set(existing.map((k) => k.organization_id));

  const rowInvalid = (r: Row) =>
    !r.name.trim() || !r.organization_id.trim() || !r.organization_name.trim() || !(Number(r.weight) > 0);

  const submitGroq = async () => {
    const touched = rows.filter(isTouched);
    if (touched.some((r) => !r.api_key.trim() || rowInvalid(r))) {
      toast.error("Complete every row you started: key, name, organization ID, organization name and weight.");
      return;
    }
    setSubmitting(true);
    let okCount = 0;
    for (const r of touched) {
      try {
        await create.mutateAsync({
          provider: "groq",
          name: r.name.trim(),
          organization_id: r.organization_id.trim(),
          organization_name: r.organization_name.trim(),
          api_key: r.api_key.trim(),
          weight: Number(r.weight) || 1,
        });
        okCount++;
        // Secret is dropped from state immediately after a successful save.
        patch(r.uid, { api_key: "", result: { ok: true, message: "Added" } });
      } catch (e) {
        patch(r.uid, { result: { ok: false, message: errMsg(e) } });
      }
    }
    setSubmitting(false);
    if (okCount > 0) toast.success(`${okCount} key${okCount === 1 ? "" : "s"} added`);
    if (okCount === touched.length) {
      reset();
      onOpenChange(false);
    }
  };

  const customCanSubmit =
    customForm.base_url.trim().length > 0 &&
    customForm.default_model.trim().length > 0 &&
    customForm.api_key.trim().length > 0 &&
    Number(customForm.weight) > 0;

  const submitCustom = async () => {
    if (!customForm.base_url.trim() || !customForm.default_model.trim() || !customForm.api_key.trim()) {
      setCustomError("Base URL, Model Name, and API Key are required.");
      return;
    }
    setSubmitting(true);
    setCustomError(null);
    try {
      await create.mutateAsync({
        provider: "custom",
        name: customForm.name.trim() || undefined,
        provider_label: customForm.provider_label.trim() || undefined,
        base_url: customForm.base_url.trim(),
        default_model: customForm.default_model.trim(),
        api_key: customForm.api_key.trim(),
        weight: Number(customForm.weight) || 100,
        set_as_primary: customForm.set_as_primary,
      });
      toast.success(
        customForm.set_as_primary
          ? `Universal API saved and "${customForm.default_model.trim()}" set as the active primary model.`
          : "Universal API key added. Click Test to verify connectivity.",
      );
      reset();
      onOpenChange(false);
    } catch (e) {
      setCustomError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const normalizedPreview = previewCompletionsUrl(customForm.base_url);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add AI API key</DialogTitle>
          <DialogDescription>
            Connect Groq or any OpenAI-compatible AI provider. Keys are encrypted at rest (AES-256-GCM) and only shown
            masked after saving.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={providerTab}
          onValueChange={(v) => setProviderTab(v as AiProvider)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="groq" disabled={submitting} className="gap-1.5">
              <Zap className="h-3.5 w-3.5" aria-hidden /> Groq
            </TabsTrigger>
            <TabsTrigger value="custom" disabled={submitting} className="gap-1.5">
              <Globe className="h-3.5 w-3.5" aria-hidden /> Universal / Custom API (Any OpenAI-Compatible)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="groq" className="mt-0 flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Keys in the same Groq organization share one quota pool — adding keys to the same organization does not
                increase capacity.
              </p>
            </div>

            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void submitGroq();
              }}
              className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6"
            >
              {rows.map((r, i) => {
                const sharedInBatch = r.organization_id.trim() && (orgCounts.get(r.organization_id.trim()) ?? 0) > 1;
                const sharedWithExisting = r.organization_id.trim() && existingOrgs.has(r.organization_id.trim());
                const done = r.result?.ok;
                return (
                  <div
                    key={r.uid}
                    className={`rounded-lg border p-3 ${done ? "border-emerald-200 bg-emerald-50/50" : ""}`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Key {i + 1}</span>
                      {done ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Added
                        </span>
                      ) : (
                        rows.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove row ${i + 1}`}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                            disabled={submitting}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <Input
                        className="sm:col-span-6"
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder="API key (gsk_…)"
                        aria-label={`API key ${i + 1}`}
                        value={r.api_key}
                        disabled={submitting || done}
                        onChange={(e) => patch(r.uid, { api_key: e.target.value, result: undefined })}
                      />
                      <Input
                        className="sm:col-span-4"
                        autoComplete="off"
                        placeholder="Name (e.g. Primary)"
                        aria-label={`Key name ${i + 1}`}
                        value={r.name}
                        disabled={submitting || done}
                        onChange={(e) => patch(r.uid, { name: e.target.value })}
                      />
                      <Input
                        className="sm:col-span-3"
                        autoComplete="off"
                        placeholder="Organization ID (e.g. org_…)"
                        aria-label={`Organization ID ${i + 1}`}
                        value={r.organization_id}
                        disabled={submitting || done}
                        onChange={(e) => {
                          const v = e.target.value;
                          const match = existing.find((k) => k.organization_id === v.trim());
                          patch(r.uid, {
                            organization_id: v,
                            ...(match && !r.organization_name ? { organization_name: match.organization_name } : {}),
                          });
                        }}
                      />
                      <Input
                        className="sm:col-span-3"
                        autoComplete="off"
                        placeholder="Organization name"
                        aria-label={`Organization name ${i + 1}`}
                        value={r.organization_name}
                        disabled={submitting || done}
                        onChange={(e) => patch(r.uid, { organization_name: e.target.value })}
                      />
                      <Input
                        className="sm:col-span-2"
                        type="number"
                        min={1}
                        step={1}
                        placeholder="Weight"
                        aria-label={`Weight ${i + 1}`}
                        value={r.weight}
                        disabled={submitting || done}
                        onChange={(e) => patch(r.uid, { weight: e.target.value })}
                      />
                    </div>
                    {(sharedInBatch || sharedWithExisting) && !done && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        {sharedInBatch ? "Another row uses" : "An existing key already uses"} the same organization —
                        these keys will share one quota pool, so total capacity will not increase.
                      </p>
                    )}
                    {r.result && !r.result.ok && (
                      <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-700">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {r.result.message}
                      </p>
                    )}
                  </div>
                );
              })}
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>

            <DialogFooter className="items-center gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => setRows((rs) => [...rs, blankRow()])}
              >
                <Plus /> Add Another Key
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" disabled={submitting} onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={submitting || pending.length === 0} onClick={() => void submitGroq()}>
                  {submitting && <Loader2 className="animate-spin" />}
                  {submitting
                    ? "Saving…"
                    : pending.length
                      ? `Save ${pending.length} key${pending.length === 1 ? "" : "s"}`
                      : "Save keys"}
                </Button>
              </div>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="custom" className="mt-0 flex min-h-0 flex-1 flex-col gap-3">
            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCustom();
              }}
              className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6"
            >
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Quick-fill a popular provider (or type any custom Base URL &amp; Model below):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CUSTOM_API_PRESETS.map((preset) => {
                    const active =
                      customForm.base_url.trim().replace(/\/+$/, "").toLowerCase() ===
                      preset.baseUrl.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={submitting}
                        onClick={() => applyPreset(preset)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/60 hover:bg-muted"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Base URL *"
                  htmlFor="cu-url"
                  className="sm:col-span-2"
                  help={
                    normalizedPreview
                      ? `Endpoint: ${normalizedPreview}`
                      : "Enter a base URL (e.g. https://openrouter.ai/api/v1) or full …/chat/completions URL."
                  }
                >
                  <Input
                    id="cu-url"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://openrouter.ai/api/v1"
                    value={customForm.base_url}
                    disabled={submitting}
                    onChange={(e) => patchCustom({ base_url: e.target.value })}
                  />
                </Field>

                <Field
                  label="Model Name *"
                  htmlFor="cu-model"
                  className="sm:col-span-2"
                  help="Exact model identifier accepted by your API provider (100% freely editable)."
                >
                  <Input
                    id="cu-model"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={customForm.exampleModel}
                    value={customForm.default_model}
                    disabled={submitting}
                    onChange={(e) => patchCustom({ default_model: e.target.value })}
                  />
                </Field>

                <Field
                  label="API Key *"
                  htmlFor="cu-secret"
                  className="sm:col-span-2"
                  help="Encrypted with AES-256-GCM at rest. Never exposed in API responses."
                >
                  <Input
                    id="cu-secret"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="sk-… or provider API key"
                    value={customForm.api_key}
                    disabled={submitting}
                    onChange={(e) => patchCustom({ api_key: e.target.value })}
                  />
                </Field>

                <Field label="Display Name" htmlFor="cu-name" help="Optional friendly label for this key.">
                  <Input
                    id="cu-name"
                    autoComplete="off"
                    placeholder="e.g. DeepSeek Primary"
                    value={customForm.name}
                    disabled={submitting}
                    onChange={(e) => patchCustom({ name: e.target.value })}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Provider Badge" htmlFor="cu-label" help="Auto-detected if blank.">
                    <Input
                      id="cu-label"
                      autoComplete="off"
                      placeholder="e.g. OpenRouter"
                      value={customForm.provider_label}
                      disabled={submitting}
                      onChange={(e) => patchCustom({ provider_label: e.target.value })}
                    />
                  </Field>
                  <Field label="Weight" htmlFor="cu-weight" help="Routing weight (1–1000).">
                    <Input
                      id="cu-weight"
                      type="number"
                      min={1}
                      max={1000}
                      value={customForm.weight}
                      disabled={submitting}
                      onChange={(e) => patchCustom({ weight: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3.5">
                <Checkbox
                  checked={customForm.set_as_primary}
                  onCheckedChange={(v) => patchCustom({ set_as_primary: v === true })}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden />
                    Make this the active primary model immediately
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Automatically registers this model in Models &amp; Routing and sets it as the active default for
                    live POS Aiva AI Chat with zero extra steps.
                  </p>
                </div>
              </label>

              {customError && (
                <p role="alert" className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {customError}
                </p>
              )}
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" disabled={submitting} onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={submitting || !customCanSubmit} onClick={() => void submitCustom()}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "Saving…" : "Save Universal API Key"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit / Rotate / History dialogs                                      */
/* ------------------------------------------------------------------ */

function EditKeyDialog({ keyItem, onClose }: { keyItem: AiKey | null; onClose: () => void }) {
  return (
    <Dialog open={!!keyItem} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={keyItem?.provider === "custom" ? "max-w-xl" : undefined}>
        {keyItem && <EditKeyForm key={keyItem.id} keyItem={keyItem} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditKeyForm({ keyItem, onClose }: { keyItem: AiKey; onClose: () => void }) {
  const isCustom = keyItem.provider === "custom";
  const [name, setName] = useState(keyItem.name);
  const [orgId, setOrgId] = useState(keyItem.organization_id);
  const [orgName, setOrgName] = useState(keyItem.organization_name);
  const [baseUrl, setBaseUrl] = useState(keyItem.base_url || "");
  const [defaultModel, setDefaultModel] = useState(keyItem.default_model || "");
  const [providerLabel, setProviderLabel] = useState(keyItem.provider_label || "");
  const [extraModels, setExtraModels] = useState(
    (keyItem.allowed_models || []).filter((m) => m !== keyItem.default_model).join(", "),
  );
  const [setAsPrimary, setSetAsPrimary] = useState(false);
  const [weight, setWeight] = useState(String(keyItem.weight));
  const [restriction, setRestriction] = useState<AiKey["admin_restriction"]>(keyItem.admin_restriction);
  const m = useAiMutation((b: Record<string, unknown>) => aiApi.patchKey(keyItem.id, b));

  const save = async () => {
    if (isCustom) {
      if (!name.trim() || !baseUrl.trim() || !defaultModel.trim() || !(Number(weight) > 0)) {
        toast.error("Name, Base URL, Model Name, and a positive weight are required.");
        return;
      }
      const parsedExtras = extraModels
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        await m.mutateAsync({
          name: name.trim(),
          base_url: baseUrl.trim(),
          default_model: defaultModel.trim(),
          provider_label: providerLabel.trim(),
          allowed_models: Array.from(new Set([defaultModel.trim(), ...parsedExtras])),
          weight: Number(weight),
          admin_restriction: restriction,
          ...(setAsPrimary ? { set_as_primary: true } : {}),
        });
        toast.success(setAsPrimary ? "Universal API updated & set as primary model" : "Universal API key updated");
        onClose();
      } catch (e) {
        toast.error(errMsg(e));
      }
      return;
    }

    if (!name.trim() || !orgId.trim() || !orgName.trim() || !(Number(weight) > 0)) {
      toast.error("Name, organization and a positive weight are required.");
      return;
    }
    try {
      await m.mutateAsync({
        name: name.trim(),
        organization_id: orgId.trim(),
        organization_name: orgName.trim(),
        weight: Number(weight),
        admin_restriction: restriction,
      });
      toast.success("Key updated");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const normalizedPreview = isCustom ? previewCompletionsUrl(baseUrl) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isCustom ? "Edit Universal / Custom API key" : "Edit key"}</DialogTitle>
        <DialogDescription>
          The secret itself is never shown. Use Rotate / Replace to change it. Key:{" "}
          <span className="font-mono">{keyItem.masked_key}</span>
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ek-name">
          <Input id="ek-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Weight" htmlFor="ek-weight" help="Higher weight receives more traffic within the pool.">
          <Input id="ek-weight" type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>

        {isCustom ? (
          <>
            <Field label="Provider Badge" htmlFor="ek-label">
              <Input
                id="ek-label"
                value={providerLabel}
                onChange={(e) => setProviderLabel(e.target.value)}
                placeholder="OpenRouter, DeepSeek, Custom API…"
                autoComplete="off"
              />
            </Field>
            <Field label="Primary Model Name" htmlFor="ek-model">
              <Input
                id="ek-model"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="deepseek-chat or openai/gpt-4o-mini"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Base URL"
              htmlFor="ek-url"
              className="sm:col-span-2"
              help={normalizedPreview ? `Endpoint: ${normalizedPreview}` : "HTTPS base URL or …/chat/completions"}
            >
              <Input
                id="ek-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Additional allowed models (optional)"
              htmlFor="ek-extras"
              className="sm:col-span-2"
              help="Comma-separated extra model IDs served by this same API key & Base URL."
            >
              <Input
                id="ek-extras"
                value={extraModels}
                onChange={(e) => setExtraModels(e.target.value)}
                placeholder="e.g. deepseek-reasoner, openai/gpt-4.1-mini"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Organization ID" htmlFor="ek-org">
              <Input id="ek-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Organization name" htmlFor="ek-orgname">
              <Input id="ek-orgname" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="off" />
            </Field>
          </>
        )}

        <Field label="Usage restriction" className="sm:col-span-2">
          <Select value={restriction} onValueChange={(v) => setRestriction(v as AiKey["admin_restriction"])}>
            <SelectTrigger aria-label="Usage restriction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Normal — use for all requests</SelectItem>
              <SelectItem value="fallback_only">Fallback only — use when others are unavailable</SelectItem>
              <SelectItem value="test_only">Test only — never used for pharmacies</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {isCustom && (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm sm:col-span-2">
            <Checkbox checked={setAsPrimary} onCheckedChange={(v) => setSetAsPrimary(v === true)} />
            <span>Promote &ldquo;{defaultModel.trim() || "this model"}&rdquo; to active primary default model</span>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={m.isPending}>
          {m.isPending && <Loader2 className="animate-spin" />} Save changes
        </Button>
      </DialogFooter>
    </>
  );
}

function RotateKeyDialog({ keyItem, onClose }: { keyItem: AiKey | null; onClose: () => void }) {
  return (
    <Dialog open={!!keyItem} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{keyItem && <RotateForm key={keyItem.id} keyItem={keyItem} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function RotateForm({ keyItem, onClose }: { keyItem: AiKey; onClose: () => void }) {
  const [secret, setSecret] = useState("");
  const m = useAiMutation((b: Record<string, unknown>) => aiApi.patchKey(keyItem.id, b));
  const save = async () => {
    if (!secret.trim()) return;
    try {
      await m.mutateAsync({ api_key: secret.trim() });
      setSecret("");
      toast.success("Key replaced");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Rotate / Replace key</DialogTitle>
        <DialogDescription>
          Paste the new key for <strong>{keyItem.name}</strong> (currently <span className="font-mono">{keyItem.masked_key}</span>). The
          old key stops working in the gateway immediately.
        </DialogDescription>
      </DialogHeader>
      <Field label="New API key" htmlFor="rk-secret">
        <Input
          id="rk-secret"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={keyItem.provider === "custom" ? "sk-… / API key" : "gsk_…"}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={m.isPending || !secret.trim()}>
          {m.isPending && <Loader2 className="animate-spin" />} Replace key
        </Button>
      </DialogFooter>
    </form>
  );
}

function HistoryDialog({ keyItem, onClose }: { keyItem: AiKey | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useAiKeyHistory(keyItem?.id ?? null);
  return (
    <Dialog open={!!keyItem} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Health history — {keyItem?.name}</DialogTitle>
          <DialogDescription>Recent health events for this key, newest first.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeletonRows cols={5} rows={4} />
                ) : (data?.history ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState title="No events yet" description="Health events appear after the key is used or tested." />
                    </TableCell>
                  </TableRow>
                ) : (
                  data!.history.map((h, i) => (
                    <TableRow key={`${h.timestamp}-${i}`}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(h.timestamp)}</TableCell>
                      <TableCell className="text-xs">{h.status}</TableCell>
                      <TableCell className="text-xs">{h.http_status ?? "—"}</TableCell>
                      <TableCell className="text-xs">{h.latency_ms != null ? `${h.latency_ms} ms` : "—"}</TableCell>
                      <TableCell className="max-w-[240px] text-xs text-muted-foreground">{h.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Main tab                                                             */
/* ------------------------------------------------------------------ */

type Confirm = { type: "disable" | "remove"; key: AiKey } | null;

export function KeysTab() {
  const { data, isLoading, error, refetch } = useAiKeys();
  const patchKey = useAiMutation((v: { id: string; body: Record<string, unknown> }) => aiApi.patchKey(v.id, v.body));
  const removeKey = useAiMutation((id: string) => aiApi.deleteKey(id));
  const testKey = useAiMutation((id: string) => aiApi.testKey(id));

  const [addOpen, setAddOpen] = useState(false);
  const [addInitialProvider, setAddInitialProvider] = useState<AiProvider>("groq");
  const [editKey, setEditKey] = useState<AiKey | null>(null);
  const [rotateKey, setRotateKey] = useState<AiKey | null>(null);
  const [historyKey, setHistoryKey] = useState<AiKey | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const openAddDialog = (provider: AiProvider) => {
    setAddInitialProvider(provider);
    setAddOpen(true);
  };

  const keys = data?.keys ?? [];
  const pools = data?.pools ?? [];

  const toggle = (k: AiKey, enabled: boolean) => {
    if (!enabled) {
      setConfirm({ type: "disable", key: k });
      return;
    }
    patchKey.mutate(
      { id: k.id, body: { enabled: true } },
      { onSuccess: () => toast.success(`${k.name} enabled`), onError: (e) => toast.error(errMsg(e)) },
    );
  };

  const runTest = async (k: AiKey) => {
    setTestingId(k.id);
    try {
      const r = await testKey.mutateAsync(k.id);
      if (r.ok) {
        toast.success(`${k.name}: ${r.message || "working"}${r.latency_ms != null ? ` (${r.latency_ms} ms)` : ""}`);
      } else {
        toast.error(`${k.name}: ${r.message}`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setTestingId(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { type, key } = confirm;
    try {
      if (type === "disable") {
        await patchKey.mutateAsync({ id: key.id, body: { enabled: false } });
        toast.success(`${key.name} disabled`);
      } else {
        await removeKey.mutateAsync(key.id);
        toast.success(`${key.name} removed`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-900 sm:max-w-3xl">
          <Layers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{SHARED_QUOTA_NOTE}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openAddDialog("groq")}>
            <Plus /> Add Groq Key
          </Button>
          <Button onClick={() => openAddDialog("custom")}>
            <Globe /> Add Universal / Custom API
          </Button>
        </div>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <section aria-labelledby="pools-h" className="space-y-3">
            <h2 id="pools-h" className="text-sm font-semibold">
              Organization pools
            </h2>
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Skeleton className="h-36" />
                <Skeleton className="h-36" />
              </div>
            ) : pools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations yet. Add your first key to create one.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pools.map((p) => (
                  <PoolCard key={p.organization_id} pool={p} />
                ))}
              </div>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">API keys</CardTitle>
              <CardDescription>Secrets are encrypted and never displayed after saving.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name &amp; key</TableHead>
                      <TableHead>Endpoint / Organization</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Last success / failure</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableSkeletonRows cols={7} />
                    ) : keys.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <EmptyState
                            icon={<KeyRound className="h-5 w-5" />}
                            title="No API keys yet"
                            description="Add a Groq key or connect any OpenAI-compatible Universal / Custom API (OpenRouter, DeepSeek, OpenAI, Together, Mistral, Ollama, etc.)."
                            action={
                              <div className="flex flex-wrap justify-center gap-2 pt-1">
                                <Button size="sm" onClick={() => openAddDialog("custom")}>
                                  <Globe /> Add Universal / Custom API
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openAddDialog("groq")}>
                                  <Plus /> Add Groq Key
                                </Button>
                              </div>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      keys.map((k) => {
                        const isCustom = k.provider === "custom";
                        const extraModelCount = Math.max(0, (k.allowed_models?.length || 0) - 1);
                        return (
                        <TableRow key={k.id}>
                          <TableCell className="min-w-[180px]">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              <span className="whitespace-nowrap">{k.name}</span>
                              {isCustom ? (
                                <Badge
                                  variant="outline"
                                  className="gap-1 whitespace-nowrap border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[10px] font-medium text-indigo-700"
                                >
                                  <Globe className="h-2.5 w-2.5" aria-hidden />
                                  {k.provider_label || "Universal API"}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="whitespace-nowrap border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] font-medium text-slate-600"
                                >
                                  Groq
                                </Badge>
                              )}
                              {k.admin_restriction !== "none" && (
                                <Badge variant="secondary" className="whitespace-nowrap font-normal">
                                  {k.admin_restriction === "fallback_only" ? "Fallback" : "Test only"}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">{k.masked_key}</div>
                          </TableCell>
                          <TableCell className="min-w-[170px] max-w-[260px]">
                            {isCustom ? (
                              <div className="space-y-1">
                                <div className="truncate text-sm font-medium" title={k.base_url || undefined}>
                                  {displayHost(k.base_url)}
                                </div>
                                {k.default_model && (
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span
                                      className="max-w-[210px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                                      title={k.default_model}
                                    >
                                      {k.default_model}
                                    </span>
                                    {extraModelCount > 0 && (
                                      <span className="text-[11px] text-muted-foreground">+{extraModelCount} more</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <div className="text-sm">{k.organization_name}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">{k.organization_id}</div>
                              </>
                            )}
                          </TableCell>
                          <TableCell>
                            <KeyStatusBadge status={k.status} cooldownUntil={k.cooldown_until} />
                          </TableCell>
                          <TableCell className="min-w-[200px] max-w-[260px] space-y-1 text-xs">
                            <div className="flex items-start gap-1.5 text-muted-foreground" title={fmtDateTime(k.last_success_at)}>
                              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                              <span>
                                <span className="sr-only">Last success: </span>
                                {k.last_success_at ? fmtAgo(k.last_success_at) : "No success yet"}
                              </span>
                            </div>
                            {k.last_failure_at ? (
                              <div className="flex items-start gap-1.5" title={fmtDateTime(k.last_failure_at)}>
                                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" aria-hidden />
                                <span>
                                  <span className="sr-only">Last failure: </span>
                                  <span className="text-muted-foreground">{fmtAgo(k.last_failure_at)}</span>
                                  {k.last_failure_reason && (
                                    <span className="line-clamp-2 break-words text-red-700" title={k.last_failure_reason}>
                                      {k.last_failure_reason}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-start gap-1.5 text-muted-foreground">
                                <XCircle className="mt-0.5 h-3 w-3 shrink-0 opacity-40" aria-hidden />
                                <span>No failures</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(k.total_requests)}</TableCell>
                          <TableCell>
                            <Switch
                              checked={k.enabled}
                              onCheckedChange={(v) => toggle(k, v)}
                              aria-label={`${k.enabled ? "Disable" : "Enable"} ${k.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={testingId === k.id}
                                onClick={() => void runTest(k)}
                              >
                                {testingId === k.id ? <Loader2 className="animate-spin" /> : <Zap />} Test
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" aria-label={`More actions for ${k.name}`}>
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => setRotateKey(k)}>
                                    <RefreshCcw className="mr-2 h-4 w-4" /> Rotate / Replace
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setEditKey(k)}>
                                    <Pencil className="mr-2 h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setHistoryKey(k)}>
                                    <History className="mr-2 h-4 w-4" /> History
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-600"
                                    onSelect={() => setConfirm({ type: "remove", key: k })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" /> Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
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
        </>
      )}

      <AddKeysDialog
        key={`${addOpen ? "open" : "closed"}-${addInitialProvider}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        existing={keys}
        initialProvider={addInitialProvider}
      />
      <EditKeyDialog keyItem={editKey} onClose={() => setEditKey(null)} />
      <RotateKeyDialog keyItem={rotateKey} onClose={() => setRotateKey(null)} />
      <HistoryDialog keyItem={historyKey} onClose={() => setHistoryKey(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.type === "remove" ? "Remove this key?" : "Disable this key?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "remove"
                ? `“${confirm.key.name}” will be permanently deleted and can no longer serve AI requests. This cannot be undone.`
                : `“${confirm?.key.name}” will stop serving AI requests until you enable it again. Pharmacy capacity may drop.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.type === "remove" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={(e) => {
                e.preventDefault();
                void runConfirm();
              }}
            >
              {confirm?.type === "remove" ? "Remove key" : "Disable key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
