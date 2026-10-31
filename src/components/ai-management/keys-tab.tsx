"use client";

import { useState } from "react";
import {
  AlertTriangle,
  History,
  Info,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
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
import { aiApi, errMsg, useAiKeyHistory, useAiKeys, useAiMutation, type AiKey, type AiPool } from "./api";
import { EmptyState, ErrorState, Field, TableSkeletonRows } from "./shared";
import { KeyStatusBadge, fmtAgo, fmtDateTime, fmtNum, resetsIn } from "./status-badge";

const SHARED_QUOTA_NOTE =
  "Keys in the same Groq organization share one quota pool — adding keys to the same organization does not increase capacity.";

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
            <p className="truncate text-sm font-semibold">{pool.organization_name || pool.organization_id}</p>
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: AiKey[];
}) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, blankRow));
  const [submitting, setSubmitting] = useState(false);
  const create = useAiMutation((b: Parameters<typeof aiApi.createKey>[0]) => aiApi.createKey(b));

  const reset = () => {
    setRows(Array.from({ length: 5 }, blankRow));
    setSubmitting(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (submitting) return;
    if (!o) reset(); // always wipe secrets from memory on close
    onOpenChange(o);
  };

  const patch = (uid: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));

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

  const submit = async () => {
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add API keys</DialogTitle>
          <DialogDescription>
            Paste Groq keys below. Fill only the rows you need. For security, a key is shown once here and only a masked
            version is kept afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{SHARED_QUOTA_NOTE}</p>
        </div>

        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
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
                    {sharedInBatch ? "Another row uses" : "An existing key already uses"} the same organization — these
                    keys will share one quota pool, so total capacity will not increase.
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
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus /> Add Another Key
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={submitting} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={submitting || pending.length === 0} onClick={() => void submit()}>
              {submitting && <Loader2 className="animate-spin" />}
              {submitting
                ? "Saving…"
                : pending.length
                  ? `Save ${pending.length} key${pending.length === 1 ? "" : "s"}`
                  : "Save keys"}
            </Button>
          </div>
        </DialogFooter>
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
      <DialogContent>{keyItem && <EditKeyForm key={keyItem.id} keyItem={keyItem} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function EditKeyForm({ keyItem, onClose }: { keyItem: AiKey; onClose: () => void }) {
  const [name, setName] = useState(keyItem.name);
  const [orgId, setOrgId] = useState(keyItem.organization_id);
  const [orgName, setOrgName] = useState(keyItem.organization_name);
  const [weight, setWeight] = useState(String(keyItem.weight));
  const [restriction, setRestriction] = useState<AiKey["admin_restriction"]>(keyItem.admin_restriction);
  const m = useAiMutation((b: Record<string, unknown>) => aiApi.patchKey(keyItem.id, b));

  const save = async () => {
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

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit key</DialogTitle>
        <DialogDescription>
          The secret itself is never shown. Use Rotate / Replace to change it. Key: <span className="font-mono">{keyItem.masked_key}</span>
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ek-name">
          <Input id="ek-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Weight" htmlFor="ek-weight" help="Higher weight receives more traffic within the pool.">
          <Input id="ek-weight" type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Organization ID" htmlFor="ek-org">
          <Input id="ek-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Organization name" htmlFor="ek-orgname">
          <Input id="ek-orgname" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="off" />
        </Field>
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
          placeholder="gsk_…"
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
  const [editKey, setEditKey] = useState<AiKey | null>(null);
  const [rotateKey, setRotateKey] = useState<AiKey | null>(null);
  const [historyKey, setHistoryKey] = useState<AiKey | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

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
      if (r.ok) toast.success(`${k.name}: working${r.latency_ms != null ? ` (${r.latency_ms} ms)` : ""}`);
      else toast.error(`${k.name}: ${r.message}`);
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
        <Button onClick={() => setAddOpen(true)}>
          <Plus /> Add Key
        </Button>
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
                      <TableHead>Organization</TableHead>
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
                            description="Add a Groq API key to turn on AI for pharmacies."
                            action={
                              <Button size="sm" onClick={() => setAddOpen(true)}>
                                <Plus /> Add Key
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      keys.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell className="min-w-[150px]">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="whitespace-nowrap">{k.name}</span>
                              {k.admin_restriction !== "none" && (
                                <Badge variant="secondary" className="whitespace-nowrap font-normal">
                                  {k.admin_restriction === "fallback_only" ? "Fallback" : "Test only"}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">{k.masked_key}</div>
                          </TableCell>
                          <TableCell className="min-w-[130px]">
                            <div className="text-sm">{k.organization_name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{k.organization_id}</div>
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
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <AddKeysDialog open={addOpen} onOpenChange={setAddOpen} existing={keys} />
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
