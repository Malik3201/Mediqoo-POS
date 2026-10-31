"use client";

import { useState } from "react";
import { Loader2, Power } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { aiApi, errMsg, useAiMutation, useAiSettings, type AiSettings } from "./api";
import { ErrorState, Field } from "./shared";

type NumKey = Exclude<keyof AiSettings, "ai_global_enabled" | "alert_email_enabled">;
type Draft = Record<NumKey, string> & { ai_global_enabled: boolean; alert_email_enabled: boolean };

const toDraft = (s: AiSettings): Draft => ({
  ...(Object.fromEntries(
    (Object.keys(s) as (keyof AiSettings)[])
      .filter((k) => typeof s[k] === "number")
      .map((k) => [k, String(s[k])]),
  ) as Record<NumKey, string>),
  ai_global_enabled: s.ai_global_enabled,
  alert_email_enabled: s.alert_email_enabled,
});

const DEFAULT_FIELDS: { key: NumKey; label: string; help?: string }[] = [
  { key: "default_daily_requests", label: "Daily requests" },
  { key: "default_monthly_requests", label: "Monthly requests" },
  { key: "default_daily_tokens", label: "Daily tokens" },
  { key: "default_monthly_tokens", label: "Monthly tokens" },
  { key: "default_max_output_tokens", label: "Max output tokens", help: "Cap on each AI reply." },
];

const SAFETY_FIELDS: { key: NumKey; label: string; help: string; min: number; step?: string }[] = [
  { key: "max_payload_kb", label: "Max request size (KB)", help: "Larger requests are rejected.", min: 1 },
  { key: "max_tool_steps", label: "Max tool steps", help: "How many data look-ups AI may chain for one question.", min: 0 },
  { key: "chat_retention_days", label: "Chat retention (days)", help: "How long request records are kept.", min: 1 },
  { key: "alert_cooldown_minutes", label: "Alert cooldown (minutes)", help: "Minimum gap before the same alert repeats.", min: 1 },
  {
    key: "unusual_token_multiplier",
    label: "Unusual token usage multiplier",
    help: "Alert when a pharmacy uses this many times its normal tokens.",
    min: 1,
    step: "0.1",
  },
];

function SettingsForm({ initial }: { initial: AiSettings }) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [confirmOff, setConfirmOff] = useState(false);
  const save = useAiMutation((s: AiSettings) => aiApi.putSettings(s));

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const numKeys = Object.keys(d).filter((k) => typeof d[k as keyof Draft] === "string") as NumKey[];
  const invalid = numKeys.filter((k) => d[k] === "" || !Number.isFinite(Number(d[k])) || Number(d[k]) < 0);
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(initial));

  const doSave = async () => {
    if (invalid.length) {
      toast.error("Please enter valid numbers (0 or more) in every field.");
      return;
    }
    const payload = {
      ...(Object.fromEntries(numKeys.map((k) => [k, Number(d[k])])) as Record<NumKey, number>),
      ai_global_enabled: d.ai_global_enabled,
      alert_email_enabled: d.alert_email_enabled,
    } as AiSettings;
    try {
      await save.mutateAsync(payload);
      toast.success("AI settings saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const onSave = () => {
    // Turning the kill switch off stops AI for every pharmacy, so confirm first.
    if (initial.ai_global_enabled && !d.ai_global_enabled) setConfirmOff(true);
    else void doSave();
  };

  const numInput = (key: NumKey, id: string, min = 0, step?: string) => (
    <Input
      id={id}
      type="number"
      min={min}
      step={step}
      value={d[key]}
      onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
      aria-invalid={invalid.includes(key)}
    />
  );

  return (
    <div className="space-y-6">
      <Card className={d.ai_global_enabled ? "" : "border-red-200"}>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className={`grid h-9 w-9 place-items-center rounded-md ${d.ai_global_enabled ? "bg-primary/10 text-primary" : "bg-red-100 text-red-700"}`}>
              <Power className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold">AI for all pharmacies</p>
              <p className="text-sm text-muted-foreground">
                {d.ai_global_enabled
                  ? "AI is on. Turn this off to instantly stop AI for every pharmacy (emergency kill switch)."
                  : "AI is OFF for every pharmacy. Pharmacies will see AI as unavailable."}
              </p>
            </div>
          </div>
          <Switch
            checked={d.ai_global_enabled}
            onCheckedChange={(v) => set({ ai_global_enabled: v })}
            aria-label="Global AI kill switch"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Defaults for new pharmacies</CardTitle>
          <CardDescription>Applied when a pharmacy gets AI for the first time. Existing pharmacies are not changed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEFAULT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`s-${f.key}`} help={f.help}>
              {numInput(f.key, `s-${f.key}`)}
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Safety & retention</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`s-${f.key}`} help={f.help}>
              {numInput(f.key, `s-${f.key}`, f.min, f.step)}
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Email me about critical alerts</p>
              <p className="text-xs text-muted-foreground">Uses the portal&apos;s existing SMTP configuration</p>
            </div>
            <Switch
              checked={d.alert_email_enabled}
              onCheckedChange={(v) => set({ alert_email_enabled: v })}
              aria-label="Alert emails"
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setD(toDraft(initial))}>
          Reset
        </Button>
        <Button onClick={onSave} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save settings
        </Button>
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn AI off for all pharmacies?</AlertDialogTitle>
            <AlertDialogDescription>
              Every pharmacy will lose access to AI right away. You can turn it back on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void doSave()}
            >
              Turn AI off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SettingsTab() {
  const { data, isLoading, error, refetch } = useAiSettings();
  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  // Re-mount only when the saved server values actually change (so background refetches never wipe edits).
  return <SettingsForm key={JSON.stringify(data.settings)} initial={data.settings} />;
}
