"use client";

import { useMemo, useState } from "react";
import { KeyRound, Plus, Copy, Ban, Trash2, RefreshCw, Monitor, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { deriveOperationalStatus, deriveBillingStatus } from "@/lib/status";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Project = {
  id: string;
  name: string;
  slug: string;
  client_id: string;
  version: string;
  modules_config: Record<string, boolean> | null;
  clients?: { id: string; name: string } | null;
};

type License = {
  id: string;
  license_key: string;
  project_id: string;
  client_id: string;
  status: "active" | "revoked" | "expired" | "suspended";
  seats: number;
  machine_fingerprint: string | null;
  features: Record<string, unknown>;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  notes: string | null;
  billing?: {
    enabled: boolean;
    amount: number;
    currency: string;
    cycle: string;
    grace_days: number;
  };
  projects?: { name: string; slug: string } | null;
  clients?: { name: string } | null;
};

type Form = {
  project_id: string;
  seats: number;
  expires_at: string;
  machine_fingerprint: string;
  notes: string;
};

const emptyForm: Form = {
  project_id: "",
  seats: 1,
  expires_at: "",
  machine_fingerprint: "",
  notes: "",
};

function generateLicenseKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `AIVRA-${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

export default function LicensesPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  
  const { data: rows = [], isLoading: loadingLicenses } = useDataQuery("licenses", { populate: "clients,projects" });
  const { data: projects = [], isLoading: loadingProjects } = useDataQuery("projects");
  const { data: billingPeriods = [], isLoading: loadingPeriods } = useDataQuery("license_billing_periods");
  const { mutateAsync: mutateLicense } = useDataMutation("licenses");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [revokeTarget, setRevokeTarget] = useState<License | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [terminalLicense, setTerminalLicense] = useState<License | null>(null);
  const [billingTarget, setBillingTarget] = useState<License | null>(null);
  const [billingForm, setBillingForm] = useState({
    enabled: false,
    amount: 1500,
    currency: "PKR",
    cycle: "monthly",
    grace_days: 3,
  });

  const selectedProject = useMemo(
    () => projects.find((p: Project) => p.id === form.project_id) ?? null,
    [projects, form.project_id]
  );

  function openNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  async function issue() {
    if (!form.project_id) {
      toast.error("Select a project");
      return;
    }
    const project = projects.find((p: Project) => p.id === form.project_id);
    if (!project) return;
    
    const payload = {
      license_key: generateLicenseKey(),
      project_id: project.id,
      client_id: project.client_id,
      seats: Math.max(1, Number(form.seats) || 1),
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      machine_fingerprint: form.machine_fingerprint.trim() || null,
      notes: form.notes.trim() || null,
      features: project.modules_config ?? {},
      issued_by: session?.user?.id ?? null,
      status: "active",
    };
    
    try {
      await mutateLicense({ method: "POST", data: payload });
      toast.success("License issued");
      setOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    try {
      await mutateLicense({
        method: "PATCH",
        id: revokeTarget.id,
        data: {
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_reason: revokeReason.trim() || "Revoked by admin",
        }
      });
      toast.success("License revoked");
      setRevokeTarget(null);
      setRevokeReason("");
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function reactivate(id: string) {
    try {
      await mutateLicense({
        method: "PATCH",
        id,
        data: { status: "active", revoked_at: null, revoked_reason: null }
      });
      toast.success("License reactivated");
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function toggleCloud(lic: License) {
    const currentVal = lic.features?.cloud_dashboard === true;
    try {
      const res = await fetch(`/api/admin/licenses/${lic.id}/cloud`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentVal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle cloud dashboard");
      
      await queryClient.invalidateQueries({ queryKey: ["licenses"] });
      
      toast.success(
        data.changed 
          ? `Cloud Dashboard ${!currentVal ? "enabled" : "disabled"}` 
          : "Cloud Dashboard state already matches"
      );
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function toggleCloudBackup(lic: License) {
    const currentVal = lic.features?.cloud_backup === true;
    try {
      const res = await fetch(`/api/admin/licenses/${lic.id}/cloud-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentVal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle cloud backup");
      
      await queryClient.invalidateQueries({ queryKey: ["licenses"] });
      
      toast.success(
        data.changed 
          ? `Cloud Backup ${!currentVal ? "enabled" : "disabled"}` 
          : "Cloud Backup state already matches"
      );
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this license permanently?")) return;
    try {
      await mutateLicense({ method: "DELETE", id });
      toast.success("License deleted");
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  function openBilling(lic: License) {
    setBillingTarget(lic);
    setBillingForm({
      enabled: lic.billing?.enabled ?? false,
      amount: lic.billing?.amount ?? 1500,
      currency: lic.billing?.currency ?? "PKR",
      cycle: (lic.billing?.cycle ?? "monthly") as "monthly" | "yearly",
      grace_days: lic.billing?.grace_days ?? 3,
    });
  }

  async function saveBilling() {
    if (!billingTarget) return;
    try {
      const res = await fetch(`/api/admin/licenses/${billingTarget.id}/billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billing: {
            enabled: billingForm.enabled,
            amount: Number(billingForm.amount) || 0,
            currency: billingForm.currency,
            cycle: billingForm.cycle,
            grace_days: Number(billingForm.grace_days) || 3,
            reminder_days: [1],
          }
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save billing configuration");
      }
      toast.success("Billing configuration saved");
      setBillingTarget(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function copyKey(k: string) {
    navigator.clipboard.writeText(k);
    toast.success("License key copied");
  }

  function statusVariant(s: string) {
    if (s === "Active") return "default";
    if (s === "Grace Period") return "secondary";
    if (s === "Renewal Required" || s === "Revoked" || s === "Suspended") return "destructive";
    return "outline";
  }

  function billingVariant(s: string) {
    if (s === "Paid") return "default";
    if (s === "Due Tomorrow" || s === "Due Soon" || s === "Partially Paid") return "secondary";
    if (s === "Overdue" || s === "Unpaid") return "destructive";
    return "outline";
  }
  
  const loading = loadingLicenses || loadingProjects || loadingPeriods;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-primary" />
            Licenses
          </h1>
          <p className="text-sm text-muted-foreground">
            Issue, review and revoke commercial licenses bound to project deployments.
          </p>
        </div>
        <Button onClick={openNew} disabled={projects.length === 0}>
          <Plus className="h-4 w-4" />
          Issue license
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cloud</TableHead>
              <TableHead>Backup</TableHead>
              <TableHead className="w-[180px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No licenses found. Issue one to get started.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r: any) => {
                const operationalStatus = deriveOperationalStatus(r);
                
                // Find the relevant current billing period for this license
                const periodsForLicense = billingPeriods.filter((bp: any) => bp.license_id === r.id);
                periodsForLicense.sort((a: any, b: any) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
                
                const unpaidPeriods = periodsForLicense.filter((bp: any) => bp.status !== "paid" && bp.status !== "waived");
                const currentPeriod = unpaidPeriods[0] || periodsForLicense[periodsForLicense.length - 1] || null;

                const previousPeriodsExist = periodsForLicense.length > 1 || (periodsForLicense[0] && (periodsForLicense[0].status === "paid" || periodsForLicense[0].status === "waived"));

                const billingStatus = deriveBillingStatus(r, currentPeriod, previousPeriodsExist);

                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.license_key.substring(0, 16)}…
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-2 h-6 w-6"
                        onClick={() => copyKey(r.license_key)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      {r.projects?.name}
                    </TableCell>
                    <TableCell>{r.clients?.name ?? "—"}</TableCell>
                    <TableCell>{r.seats}</TableCell>
                    <TableCell>
                      {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell>
                      {r.billing?.enabled ? (
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="font-semibold text-primary">{r.billing.currency} {r.billing.amount} / {r.billing.cycle}</span>
                          <span className="text-muted-foreground">Grace: {r.billing.grace_days}d</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={statusVariant(operationalStatus)}>{operationalStatus}</Badge>
                        {r.billing?.enabled && (
                          <Badge variant={billingVariant(billingStatus)} className="text-[10px] uppercase opacity-90 tracking-wider">
                            {billingStatus}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 text-xs px-2"
                        onClick={() => toggleCloud(r)}
                      >
                        {r.features?.cloud_dashboard ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 text-xs px-2"
                        onClick={() => toggleCloudBackup(r)}
                      >
                        {r.features?.cloud_backup ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="View terminals"
                          onClick={() => setTerminalLicense(r)}
                        >
                          <Monitor className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Billing Settings"
                          onClick={() => openBilling(r)}
                        >
                          <CreditCard className="h-4 w-4" />
                        </Button>
                        {r.billing?.enabled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Record Payment & Renew"
                            className="h-8 ml-2"
                            onClick={() => window.location.href = "/billing"}
                          >
                            Renew
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Enable Billing"
                            className="h-8 ml-2"
                            onClick={() => openBilling(r)}
                          >
                            Enable Billing
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end gap-1">
                        {r.status === "active" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Revoke license"
                            onClick={() => setRevokeTarget(r)}
                          >
                            <Ban className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Reactivate license"
                            onClick={() => reactivate(r.id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue New License</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={form.project_id}
                onValueChange={(v) => setForm({ ...form, project_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: Project) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.clients?.name ? `(${p.clients.name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedProject && (
              <div className="rounded border p-3 text-xs text-muted-foreground bg-muted/50">
                <p>
                  <strong>Features bound:</strong>{" "}
                  {Object.keys(selectedProject.modules_config ?? {}).filter(
                    (k) => selectedProject.modules_config![k]
                  ).join(", ") || "Base"}
                </p>
                <p className="mt-1">
                  <strong>Client:</strong> {selectedProject.clients?.name ?? "—"}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Seats</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.seats}
                  onChange={(e) => setForm({ ...form, seats: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Expires At (Optional)</Label>
                <Input
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Machine Fingerprint (Optional HWID lock)</Label>
              <Input
                placeholder="Leave empty to bind on first use"
                value={form.machine_fingerprint}
                onChange={(e) => setForm({ ...form, machine_fingerprint: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Internal notes about this issuance"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={issue} disabled={!form.project_id}>
              Issue License
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke License</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Revoking a license will immediately invalidate all running deployments.
            </p>
            <div className="grid gap-2">
              <Label>Reason for revocation</Label>
              <Input
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Non-payment, compromised key"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={revoke}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!billingTarget} onOpenChange={(v) => !v && setBillingTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Billing Configuration</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={billingForm.enabled}
                onChange={(e) => setBillingForm({ ...billingForm, enabled: e.target.checked })}
                id="billingEnabled" 
                className="h-4 w-4"
              />
              <Label htmlFor="billingEnabled">Enable Recurring Billing</Label>
            </div>
            {billingForm.enabled && (
              <>
                <div className="grid gap-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    value={billingForm.amount}
                    onChange={(e) => setBillingForm({ ...billingForm, amount: Number(e.target.value) })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Currency</Label>
                    <Select
                      value={billingForm.currency}
                      onValueChange={(v) => setBillingForm({ ...billingForm, currency: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PKR">PKR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Cycle</Label>
                    <Select
                      value={billingForm.cycle}
                      onValueChange={(v) => setBillingForm({ ...billingForm, cycle: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Grace Days</Label>
                  <Input
                    type="number"
                    value={billingForm.grace_days}
                    onChange={(e) => setBillingForm({ ...billingForm, grace_days: Number(e.target.value) })}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingTarget(null)}>Cancel</Button>
            <Button onClick={saveBilling}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {terminalLicense && (
        <TerminalsModal
          license={terminalLicense}
          onClose={() => setTerminalLicense(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminals Modal — shows all seats (terminals) for a given license.
// Read-only. Admin can delete individual seats to free them.
// ─────────────────────────────────────────────────────────────────────────────
type Seat = {
  id: string;
  license_id: string;
  machine_id: string;
  hostname?: string;
  role: string;
  terminal_number?: number;
  first_seen_at: string;
  last_seen_at: string;
};

function TerminalsModal({ license, onClose }: { license: License; onClose: () => void }) {
  const { data: seats = [], isLoading, refetch } = useDataQuery("license_seats", {
    license_id: license.id,
  });
  const { mutateAsync: mutateSeat } = useDataMutation("license_seats");

  async function releaseTerminal(seat: Seat) {
    if (
      !confirm(
        `Release Terminal ${seat.terminal_number ?? "(no number)"} (${seat.hostname ?? seat.machine_id})?\n\nReleasing a terminal will:\n- Free this slot for a new PC.\n- Keep the license, billing history, and analytics intact.\n- Not affect other terminals.\n\nAre you sure you want to release this terminal?`
      )
    )
      return;
    try {
      await mutateSeat({ method: "DELETE", id: seat.id });
      toast.success("Terminal released successfully");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const sortedSeats = useMemo(
    () => [...seats].sort((a: Seat, b: Seat) => (a.terminal_number ?? 9999) - (b.terminal_number ?? 9999)),
    [seats]
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Terminals — {license.projects?.name ?? license.id}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Seat capacity: <strong>{sortedSeats.length}</strong> / {license.seats} used.
          Deleting a terminal does <strong>not</strong> reuse its number — the next terminal receives a higher number.
        </p>
        <div className="rounded-lg border overflow-auto max-h-[50vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>Hostname / Machine</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>First Seen</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="w-[100px]">seat_id</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : sortedSeats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                    No terminals registered yet.
                  </TableCell>
                </TableRow>
              ) : (
                sortedSeats.map((seat: Seat) => (
                  <TableRow key={seat.id}>
                    <TableCell>
                      <span className="font-mono font-bold text-primary">
                        {seat.terminal_number ?? <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{seat.hostname ?? "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{seat.machine_id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={seat.role === "main" ? "default" : "secondary"}>
                        {seat.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(seat.first_seen_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(seat.last_seen_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {seat.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        title="Release terminal"
                        onClick={() => releaseTerminal(seat)}
                        className="text-destructive hover:bg-destructive hover:text-white"
                      >
                        Release
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
