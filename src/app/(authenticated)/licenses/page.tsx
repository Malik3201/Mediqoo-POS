"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { KeyRound, Plus, Copy, Ban, Trash2, RefreshCw, Monitor, CreditCard, AlertTriangle, CheckCircle2, Clock, XCircle, ShieldCheck, Eye, EyeOff, Cloud, Download, HardDrive, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { deriveOperationalStatus, deriveBillingStatus } from "@/lib/status";
import { format } from "date-fns";
import { RenewalVoucherModal } from "@/components/billing/RenewalVoucherModal";

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
    recurring_enabled?: boolean;
    setup_type?: "none" | "installation" | "lifetime";
    installation_charges?: number;
    lifetime_amount?: number;
    setup_paid_amount?: number;
    setup_payment_status?: "paid" | "partially_paid" | "unpaid";
    setup_payment_method?: string;
    setup_payment_reference?: string;
    setup_paid_at?: string | null;
    setup_voucher_id?: string | null;
    setup_notes?: string;
    model?: "fixed" | "per_invoice";
    amount: number;
    rate_per_invoice?: number;
    currency: string;
    cycle: string;
    grace_days: number;
    reminder_days?: number[];
    pending_changes?: {
      model?: "fixed" | "per_invoice";
      amount?: number;
      rate_per_invoice?: number;
      effective_from?: string;
    } | null;
  };
  go_live?: {
    status: "not_enabled" | "enabled" | "completed" | "revoked";
    enabled_at?: string | null;
    enabled_by?: string | null;
    completed_at?: string | null;
    completed_by?: string | null;
    revoked_at?: string | null;
    revoked_by?: string | null;
    notes?: string | null;
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
  const { data: vouchers = [] } = useDataQuery("license_renewal_invoices");
  const { mutateAsync: mutateLicense } = useDataMutation("licenses");

  const latestVoucherByLicense = useMemo(() => {
    const map = new Map<string, any>();
    for (const v of vouchers as any[]) {
      const existing = map.get(v.license_id);
      if (!existing) {
        map.set(v.license_id, v);
      } else {
        const vTime = new Date(v.issued_at || v.created_at || 0).getTime();
        const eTime = new Date(existing.issued_at || existing.created_at || 0).getTime();
        if (vTime > eTime) map.set(v.license_id, v);
      }
    }
    return map;
  }, [vouchers]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [revokeTarget, setRevokeTarget] = useState<License | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [terminalLicense, setTerminalLicense] = useState<License | null>(null);
  const [billingTarget, setBillingTarget] = useState<License | null>(null);
  const [billingForm, setBillingForm] = useState({
    enabled: false,
    setup_type: "none" as "none" | "installation" | "lifetime",
    installation_charges: 0,
    lifetime_amount: 0,
    setup_paid_amount: 0,
    setup_payment_method: "Cash",
    setup_payment_reference: "",
    setup_notes: "",
    recurring_enabled: true,
    set_lifetime_expiry: false,
    expires_at: "",
    model: "fixed" as "fixed" | "per_invoice",
    amount: 1500,
    rate_per_invoice: 1,
    currency: "PKR",
    cycle: "monthly",
    grace_days: 3,
    reminder_days: [1] as number[],
    generate_voucher: true,
    auto_email: true,
  });
  const [billingSaving, setBillingSaving] = useState(false);
  const [eligibility, setEligibility] = useState<any>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [voucherModalState, setVoucherModalState] = useState<{
    open: boolean;
    voucherId?: string | null;
    initialVoucher?: any | null;
  }>({ open: false });
  const [generatingVoucherFor, setGeneratingVoucherFor] = useState<string | null>(null);

  // License-specific Go-Live Authorization Modal State
  const [goLiveTarget, setGoLiveTarget] = useState<License | null>(null);
  const [isUpdatingGoLive, setIsUpdatingGoLive] = useState(false);

  async function updateLicenseGoLive(licenseId: string, nextStatus: "enabled" | "revoked" | "not_enabled") {
    setIsUpdatingGoLive(true);
    try {
      const res = await fetch(`/api/admin/licenses/${licenseId}/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update Go-Live status");

      await queryClient.invalidateQueries({ queryKey: ["licenses"] });
      toast.success(
        nextStatus === "enabled"
          ? "Go-Live Setup Enabled for this License"
          : "Go-Live Setup Revoked for this License"
      );
      setGoLiveTarget((prev) => (prev && prev.id === licenseId ? { ...prev, go_live: data.go_live } : null));
    } catch (err: any) {
      toast.error(err.message || "Failed to update Go-Live status");
    } finally {
      setIsUpdatingGoLive(false);
    }
  }

  // Cloud Backup & Recovery Secret Modal State
  const [backupSecurityTarget, setBackupSecurityTarget] = useState<any | null>(null);
  const [backupSecurityData, setBackupSecurityData] = useState<{
    loading: boolean;
    has_secret: boolean;
    recovery_secret: string | null;
    revealed: boolean;
    backups: any[];
  }>({
    loading: false,
    has_secret: false,
    recovery_secret: null,
    revealed: false,
    backups: [],
  });

  async function openBackupSecurity(lic: any) {
    setBackupSecurityTarget(lic);
    setBackupSecurityData({
      loading: true,
      has_secret: false,
      recovery_secret: null,
      revealed: false,
      backups: [],
    });
    try {
      const res = await fetch(`/api/admin/licenses/${lic.id}/backup-secret`);
      const data = await res.json();
      if (res.ok && data.ok) {
        setBackupSecurityData({
          loading: false,
          has_secret: data.has_secret,
          recovery_secret: data.recovery_secret,
          revealed: false,
          backups: data.backups || [],
        });
      } else {
        setBackupSecurityData(prev => ({ ...prev, loading: false }));
      }
    } catch {
      setBackupSecurityData(prev => ({ ...prev, loading: false }));
    }
  }

  async function revealSecretForTarget() {
    if (!backupSecurityTarget) return;
    try {
      const res = await fetch(`/api/admin/licenses/${backupSecurityTarget.id}/backup-secret`);
      const data = await res.json();
      if (res.ok && data.ok && data.recovery_secret) {
        setBackupSecurityData(prev => ({
          ...prev,
          revealed: true,
          recovery_secret: data.recovery_secret,
        }));
        toast.success("Recovery Secret revealed (Audit logged)");
      } else {
        toast.error("Could not reveal secret", data.message || data.error);
      }
    } catch (err: any) {
      toast.error("Error revealing secret", err.message);
    }
  }

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

  async function toggleOnlineOrders(lic: License) {
    const currentVal =
      lic.features?.online_orders === true ||
      (lic.features?.online_orders === undefined && lic.features?.storefront_enabled === true);
    try {
      const res = await fetch(`/api/admin/licenses/${lic.id}/online-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentVal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle POS Online Orders");

      await queryClient.invalidateQueries({ queryKey: ["licenses"] });

      toast.success(
        data.changed
          ? `POS Online Orders ${!currentVal ? "enabled" : "disabled"}`
          : "POS Online Orders state already matches"
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

  const fetchEligibility = useCallback(async (licenseId: string) => {
    setEligibilityLoading(true);
    try {
      const res = await fetch(`/api/admin/licenses/${licenseId}/billing-eligibility`);
      if (res.ok) setEligibility(await res.json());
    } catch { /* ignore */ }
    finally { setEligibilityLoading(false); }
  }, []);

  function openBilling(lic: License, forceEnable = false) {
    setBillingTarget(lic);
    setEligibility(null);
    const setupType = (lic.billing?.setup_type ?? "none") as "none" | "installation" | "lifetime";
    const isLifetimeLic = !lic.expires_at;
    setBillingForm({
      enabled: forceEnable ? true : (lic.billing?.enabled ?? true),
      setup_type: setupType,
      installation_charges: lic.billing?.installation_charges ?? 0,
      lifetime_amount: lic.billing?.lifetime_amount ?? 0,
      setup_paid_amount: lic.billing?.setup_paid_amount ?? 0,
      setup_payment_method: lic.billing?.setup_payment_method ?? "Cash",
      setup_payment_reference: lic.billing?.setup_payment_reference ?? "",
      setup_notes: lic.billing?.setup_notes ?? "",
      recurring_enabled:
        lic.billing?.recurring_enabled !== undefined
          ? Boolean(lic.billing.recurring_enabled)
          : setupType !== "lifetime",
      set_lifetime_expiry: isLifetimeLic,
      expires_at: lic.expires_at ? new Date(lic.expires_at).toISOString().slice(0, 10) : "",
      model: (lic.billing?.model ?? "fixed") as "fixed" | "per_invoice",
      amount: lic.billing?.amount ?? 1500,
      rate_per_invoice: lic.billing?.rate_per_invoice ?? 1,
      currency: lic.billing?.currency ?? "PKR",
      cycle: (lic.billing?.cycle ?? "monthly") as "monthly" | "yearly",
      grace_days: lic.billing?.grace_days ?? 3,
      reminder_days: lic.billing?.reminder_days ?? [1],
      generate_voucher: true,
      auto_email: true,
    });
    fetchEligibility(lic.id);
  }

  async function saveBilling() {
    if (!billingTarget) return;
    if (
      billingForm.enabled &&
      billingForm.recurring_enabled &&
      billingForm.model === "per_invoice"
    ) {
      const rate = Number(billingForm.rate_per_invoice);
      if (!rate || rate <= 0 || !isFinite(rate)) {
        toast.error("Rate per invoice must be a positive number.");
        return;
      }
    }
    setBillingSaving(true);
    try {
      const idemKey = crypto.randomUUID();
      const res = await fetch(`/api/admin/licenses/${billingTarget.id}/billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: idemKey,
          generate_voucher: billingForm.enabled && billingForm.generate_voucher,
          auto_email: billingForm.enabled && billingForm.auto_email,
          billing: {
            enabled: billingForm.enabled,
            setup_type: billingForm.setup_type,
            installation_charges:
              billingForm.setup_type === "installation"
                ? Math.max(0, Number(billingForm.installation_charges) || 0)
                : 0,
            lifetime_amount:
              billingForm.setup_type === "lifetime"
                ? Math.max(0, Number(billingForm.lifetime_amount) || 0)
                : 0,
            setup_paid_amount: Math.max(0, Number(billingForm.setup_paid_amount) || 0),
            setup_payment_method: billingForm.setup_payment_method,
            setup_payment_reference: billingForm.setup_payment_reference.trim() || undefined,
            setup_notes: billingForm.setup_notes.trim() || undefined,
            recurring_enabled: billingForm.recurring_enabled,
            set_lifetime_expiry: billingForm.set_lifetime_expiry,
            expires_at:
              !billingForm.set_lifetime_expiry && billingForm.expires_at
                ? new Date(`${billingForm.expires_at}T23:59:59.999Z`).toISOString()
                : undefined,
            model: billingForm.model,
            amount:
              billingForm.recurring_enabled && billingForm.model === "fixed"
                ? Number(billingForm.amount) || 0
                : 0,
            rate_per_invoice:
              billingForm.recurring_enabled && billingForm.model === "per_invoice"
                ? Number(billingForm.rate_per_invoice)
                : undefined,
            currency: billingForm.currency,
            cycle: billingForm.cycle,
            grace_days: Number(billingForm.grace_days) || 3,
            reminder_days: billingForm.reminder_days,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Failed to save billing configuration");
      }
      if (data.applied === "pending") {
        toast.success("Change scheduled for next renewal", { description: data.message });
      } else if (data.voucher) {
        const emailNote = data.email_result?.sent
          ? `PDF voucher emailed to ${data.email_result.email || "client"}.`
          : data.email_result?.reason === "no_client_email"
          ? "Voucher created (client email missing)."
          : data.email_result?.error
          ? `Voucher created (email issue: ${data.email_result.error}).`
          : "Official voucher generated.";
        toast.success("Billing & Voucher saved", { description: emailNote });
      } else {
        toast.success("Billing configuration saved");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["licenses"] }),
        queryClient.invalidateQueries({ queryKey: ["license_billing_periods"] }),
        queryClient.invalidateQueries({ queryKey: ["license_payments"] }),
        queryClient.invalidateQueries({ queryKey: ["license_renewal_invoices"] }),
      ]);
      setBillingTarget(null);
      if (data.voucher) {
        setVoucherModalState({ open: true, initialVoucher: data.voucher });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBillingSaving(false);
    }
  }

  async function openOrGenerateLicenseVoucher(lic: License) {
    const existing =
      lic.billing?.setup_voucher_id
        ? (vouchers as any[]).find((v) => v.id === lic.billing?.setup_voucher_id)
        : latestVoucherByLicense.get(lic.id);

    if (existing) {
      setVoucherModalState({ open: true, voucherId: existing.id, initialVoucher: existing });
      return;
    }

    setGeneratingVoucherFor(lic.id);
    try {
      const res = await fetch(`/api/admin/licenses/${lic.id}/voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send_email: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.voucher) {
        throw new Error(data.error || "Failed to generate voucher");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["licenses"] }),
        queryClient.invalidateQueries({ queryKey: ["license_renewal_invoices"] }),
      ]);
      toast.success("Official voucher ready");
      setVoucherModalState({ open: true, initialVoucher: data.voucher });
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate voucher");
    } finally {
      setGeneratingVoucherFor(null);
    }
  }

  async function cancelPending() {
    if (!billingTarget) return;
    setBillingSaving(true);
    try {
      const res = await fetch(`/api/admin/licenses/${billingTarget.id}/billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_pending: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel");
      toast.success("Scheduled change cancelled");
      await queryClient.invalidateQueries({ queryKey: ["licenses"] });
      setBillingTarget(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBillingSaving(false);
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
    if (s === "Paid" || s === "Settled (Lifetime)" || s === "Installation Paid") return "default";
    if (s === "Current") return "outline";
    if (
      s === "Due Tomorrow" ||
      s === "Due Soon" ||
      s === "Partially Paid" ||
      s === "Installation Partial"
    )
      return "secondary";
    if (s === "Overdue" || s === "Unpaid" || s === "Installation Due" || s === "Lifetime Due")
      return "destructive";
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
              <TableHead>Online Orders</TableHead>
              <TableHead>Go-Live</TableHead>
              <TableHead className="w-[180px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
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

                const totalOutstanding = periodsForLicense.reduce((sum: number, bp: any) => {
                  if (bp.status === "paid" || bp.status === "waived") return sum;
                  const bal = bp.outstanding ?? Math.max(0, (bp.amount_due || 0) - (bp.amount_paid || 0));
                  return sum + bal;
                }, 0);

                const billingStatus = deriveBillingStatus(r, currentPeriod, previousPeriodsExist, totalOutstanding);

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
                      {r.expires_at ? format(new Date(r.expires_at), "dd/MM/yyyy") : "Never"}
                    </TableCell>
                    <TableCell>
                      {r.billing?.enabled ? (
                        <div className="flex flex-col gap-1 text-xs">
                          {r.billing.setup_type === "installation" && (
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">
                              Install • {r.billing.currency || "PKR"}{" "}
                              {Number(r.billing.installation_charges || 0).toLocaleString()}
                              {r.billing.setup_payment_status === "paid"
                                ? " (Paid)"
                                : r.billing.setup_payment_status === "partially_paid"
                                ? " (Partial)"
                                : " (Due)"}
                            </span>
                          )}
                          {r.billing.setup_type === "lifetime" && (
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">
                              Lifetime • {r.billing.currency || "PKR"}{" "}
                              {Number(r.billing.lifetime_amount || 0).toLocaleString()}
                              {r.billing.setup_payment_status === "paid"
                                ? " (Settled)"
                                : r.billing.setup_payment_status === "partially_paid"
                                ? " (Partial)"
                                : " (Due)"}
                            </span>
                          )}
                          {r.billing.recurring_enabled !== false ? (
                            r.billing.model === "per_invoice" ? (
                              <span className="font-semibold text-primary">
                                Per Invoice • {r.billing.currency} {r.billing.rate_per_invoice ?? 1}/inv
                              </span>
                            ) : (
                              <span className="font-semibold text-primary">
                                Fixed • {r.billing.currency} {r.billing.amount?.toLocaleString()}/
                                {r.billing.cycle?.charAt(0) === "y" ? "yr" : "mo"}
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              No Recurring Schedule
                            </span>
                          )}
                          {r.billing.pending_changes && (
                            <span className="text-amber-600 flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Scheduled change
                            </span>
                          )}
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
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-7 text-xs px-2"
                          onClick={() => toggleCloudBackup(r)}
                        >
                          {r.features?.cloud_backup ? "Enabled" : "Disabled"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-primary"
                          title="Cloud Backup & Recovery Secret"
                          onClick={() => openBackupSecurity(r)}
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => toggleOnlineOrders(r)}
                      >
                        {r.features?.online_orders === true ||
                        (r.features?.online_orders === undefined && r.features?.storefront_enabled === true)
                          ? "Allowed"
                          : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 text-xs px-2 font-medium ${
                          r.go_live?.status === "enabled"
                            ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600"
                            : r.go_live?.status === "completed"
                              ? "border-emerald-500 text-emerald-600 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                              : r.go_live?.status === "revoked"
                                ? "border-rose-400 text-rose-600 hover:bg-rose-50"
                                : "text-muted-foreground"
                        }`}
                        onClick={() => setGoLiveTarget(r)}
                        title="Manage Go-Live Setup for this specific license"
                      >
                        {r.go_live?.status === "enabled"
                          ? "Enabled"
                          : r.go_live?.status === "completed"
                            ? "Completed"
                            : r.go_live?.status === "revoked"
                              ? "Revoked"
                              : "Not Enabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Cloud Backup & Recovery Secret"
                          onClick={() => openBackupSecurity(r)}
                        >
                          <ShieldCheck className="h-4 w-4 text-primary" />
                        </Button>
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
                        <Button
                          size="sm"
                          variant="outline"
                          title="Open or 1-Click Generate Official Payment Voucher"
                          className="h-8 gap-1 px-2 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
                          disabled={generatingVoucherFor === r.id}
                          onClick={() => openOrGenerateLicenseVoucher(r)}
                        >
                          {generatingVoucherFor === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                          Voucher
                        </Button>
                        {r.billing?.enabled ? (
                          r.billing.recurring_enabled !== false && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Record Payment & Renew"
                              className="h-8 ml-1"
                              onClick={() => (window.location.href = "/billing")}
                            >
                              Renew
                            </Button>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Enable Billing"
                            className="h-8 ml-1"
                            onClick={() => openBilling(r, true)}
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
        <DialogContent className="max-w-xl max-h-[88vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>Billing Configuration — {billingTarget?.projects?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            {/* Enable Billing Master Toggle */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={billingForm.enabled}
                  onChange={(e) => setBillingForm({ ...billingForm, enabled: e.target.checked })}
                  id="billingEnabled"
                  className="h-4 w-4 accent-primary"
                />
                <Label htmlFor="billingEnabled" className="cursor-pointer font-semibold">
                  Enable License Billing &amp; Setup Charges
                </Label>
              </div>
              {billingTarget?.expires_at && !billingForm.set_lifetime_expiry && (
                <span className="text-[11px] text-muted-foreground">
                  Expiry: {format(new Date(billingTarget.expires_at), "dd/MM/yyyy")}
                </span>
              )}
            </div>

            {billingForm.enabled && (
              <>
                {/* ── 1. Setup / Installation / Lifetime Settlement ── */}
                <div className="rounded-lg border p-3.5 space-y-3 bg-card">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    1. Setup / One-Time Commercial Arrangement
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setBillingForm((prev) => ({
                          ...prev,
                          setup_type: "none",
                          recurring_enabled: true,
                        }))
                      }
                      className={`rounded-lg border p-2.5 text-left transition ${
                        billingForm.setup_type === "none"
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-muted hover:border-primary/40"
                      }`}
                    >
                      <div className="text-xs font-semibold">No Setup Fee</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Recurring only
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBillingForm((prev) => ({
                          ...prev,
                          setup_type: "installation",
                        }))
                      }
                      className={`rounded-lg border p-2.5 text-left transition ${
                        billingForm.setup_type === "installation"
                          ? "border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/20 ring-2 ring-emerald-500/20"
                          : "border-muted hover:border-emerald-500/40"
                      }`}
                    >
                      <div className="text-xs font-semibold">Installation Charges</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Setup / onboarding fee
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBillingForm((prev) => ({
                          ...prev,
                          setup_type: "lifetime",
                          recurring_enabled: false,
                          set_lifetime_expiry: true,
                        }))
                      }
                      className={`rounded-lg border p-2.5 text-left transition ${
                        billingForm.setup_type === "lifetime"
                          ? "border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/20 ring-2 ring-emerald-500/20"
                          : "border-muted hover:border-emerald-500/40"
                      }`}
                    >
                      <div className="text-xs font-semibold">Lifetime Sold</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        One-time full sale
                      </div>
                    </button>
                  </div>

                  {billingForm.setup_type !== "none" && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">
                            {billingForm.setup_type === "lifetime"
                              ? `Lifetime Sale Price (${billingForm.currency})`
                              : `Installation Charges (${billingForm.currency})`}
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            value={
                              billingForm.setup_type === "lifetime"
                                ? billingForm.lifetime_amount
                                : billingForm.installation_charges
                            }
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setBillingForm((prev) => ({
                                ...prev,
                                ...(prev.setup_type === "lifetime"
                                  ? { lifetime_amount: val }
                                  : { installation_charges: val }),
                              }));
                            }}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">
                              Paid Now ({billingForm.currency})
                            </Label>
                            <button
                              type="button"
                              className="text-[11px] font-medium text-emerald-600 hover:underline"
                              onClick={() =>
                                setBillingForm((prev) => ({
                                  ...prev,
                                  setup_paid_amount:
                                    prev.setup_type === "lifetime"
                                      ? Number(prev.lifetime_amount) || 0
                                      : Number(prev.installation_charges) || 0,
                                }))
                              }
                            >
                              Mark Full Paid
                            </button>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            value={billingForm.setup_paid_amount}
                            onChange={(e) =>
                              setBillingForm({
                                ...billingForm,
                                setup_paid_amount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Payment Method</Label>
                          <Select
                            value={billingForm.setup_payment_method}
                            onValueChange={(v) =>
                              setBillingForm({ ...billingForm, setup_payment_method: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Cash">Cash</SelectItem>
                              <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                              <SelectItem value="JazzCash">JazzCash</SelectItem>
                              <SelectItem value="EasyPaisa">EasyPaisa</SelectItem>
                              <SelectItem value="Cheque">Cheque</SelectItem>
                              <SelectItem value="Online">Online</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Reference / Slip #</Label>
                          <Input
                            placeholder="Optional txn / bank ref"
                            value={billingForm.setup_payment_reference}
                            onChange={(e) =>
                              setBillingForm({
                                ...billingForm,
                                setup_payment_reference: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <Label className="text-xs">Setup / Commercial Notes</Label>
                        <Input
                          placeholder="e.g. Installed & demo approved on counter #1"
                          value={billingForm.setup_notes}
                          onChange={(e) =>
                            setBillingForm({ ...billingForm, setup_notes: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* License Expiry / Lifetime Expiry control */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t">
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="setLifetimeExpiry"
                        checked={billingForm.set_lifetime_expiry}
                        onChange={(e) =>
                          setBillingForm({
                            ...billingForm,
                            set_lifetime_expiry: e.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-emerald-600"
                      />
                      <Label htmlFor="setLifetimeExpiry" className="text-xs cursor-pointer">
                        Lifetime Expiry (Never Expires)
                      </Label>
                    </div>
                    {!billingForm.set_lifetime_expiry && (
                      <div className="grid gap-1">
                        <Label className="text-[11px] text-muted-foreground">
                          License Expiry Date (sets Next Payment Date)
                        </Label>
                        <Input
                          type="date"
                          value={billingForm.expires_at}
                          onChange={(e) =>
                            setBillingForm({ ...billingForm, expires_at: e.target.value })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* ── 2. Optional Recurring Schedule ── */}
                <div className="rounded-lg border p-3.5 space-y-3 bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={billingForm.recurring_enabled}
                        onChange={(e) =>
                          setBillingForm({
                            ...billingForm,
                            recurring_enabled: e.target.checked,
                            ...(e.target.checked ? { set_lifetime_expiry: false } : {}),
                          })
                        }
                        id="recurringEnabledToggle"
                        className="h-4 w-4 accent-primary"
                      />
                      <Label
                        htmlFor="recurringEnabledToggle"
                        className="text-xs font-semibold uppercase tracking-wider cursor-pointer"
                      >
                        2. Enable Recurring Subscription (Optional)
                      </Label>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {billingForm.recurring_enabled ? "Recurring Active" : "One-Time Only"}
                    </Badge>
                  </div>

                  {!billingForm.recurring_enabled && (
                    <p className="text-xs text-muted-foreground">
                      No monthly or yearly invoices will be billed after installation / settlement. Only the one-time setup charge above applies.
                    </p>
                  )}

                  {billingForm.recurring_enabled && (
                    <div className="space-y-3">
                      {/* ── Pending Changes Banner ── */}
                      {billingTarget?.billing?.pending_changes && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
                          <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400 mb-2">
                            <Clock className="h-4 w-4" /> Scheduled Change (Next Renewal)
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-xs">
                            <span className="text-muted-foreground">New Model:</span>
                            <span className="font-medium capitalize">
                              {billingTarget.billing.pending_changes.model === "per_invoice"
                                ? "Per Invoice"
                                : "Fixed Subscription"}
                            </span>
                            {billingTarget.billing.pending_changes.model === "per_invoice" && (
                              <>
                                <span className="text-muted-foreground">New Rate:</span>
                                <span className="font-medium">
                                  {billingTarget.billing.currency}{" "}
                                  {billingTarget.billing.pending_changes.rate_per_invoice}/invoice
                                </span>
                              </>
                            )}
                            {billingTarget.billing.pending_changes.model === "fixed" &&
                              billingTarget.billing.pending_changes.amount !== undefined && (
                                <>
                                  <span className="text-muted-foreground">New Amount:</span>
                                  <span className="font-medium">
                                    {billingTarget.billing.currency}{" "}
                                    {billingTarget.billing.pending_changes.amount}
                                  </span>
                                </>
                              )}
                            {billingTarget.billing.pending_changes.effective_from && (
                              <>
                                <span className="text-muted-foreground">Effective:</span>
                                <span className="font-medium">
                                  {new Date(
                                    billingTarget.billing.pending_changes.effective_from
                                  ).toLocaleDateString()}
                                </span>
                              </>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 text-amber-700 border-amber-300"
                            onClick={cancelPending}
                            disabled={billingSaving}
                          >
                            <XCircle className="h-3 w-3 mr-1" /> Cancel Scheduled Change
                          </Button>
                        </div>
                      )}

                      {/* ── Billing Model Selector ── */}
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Recurring Billing Model</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setBillingForm({ ...billingForm, model: "fixed" })}
                            className={`rounded-lg border p-2.5 text-sm text-left transition ${
                              billingForm.model === "fixed"
                                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                : "border-muted hover:border-primary/40"
                            }`}
                          >
                            <div className="font-semibold text-xs">Fixed Subscription</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              Fixed monthly or yearly fee
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setBillingForm({ ...billingForm, model: "per_invoice" })
                            }
                            className={`rounded-lg border p-2.5 text-sm text-left transition ${
                              billingForm.model === "per_invoice"
                                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                : "border-muted hover:border-primary/40"
                            }`}
                          >
                            <div className="font-semibold text-xs">Pay Per Invoice</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              Rate per finalized POS invoice
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* ── Fixed Plan Fields ── */}
                      {billingForm.model === "fixed" && (
                        <div className="grid gap-1.5">
                          <Label className="text-xs">
                            Recurring Amount ({billingForm.currency})
                          </Label>
                          <Input
                            type="number"
                            value={billingForm.amount}
                            onChange={(e) =>
                              setBillingForm({
                                ...billingForm,
                                amount: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      )}

                      {/* ── Per Invoice Fields ── */}
                      {billingForm.model === "per_invoice" && (
                        <>
                          <div className="grid gap-1.5">
                            <Label className="text-xs">Rate Per Invoice</Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-muted-foreground">
                                {billingForm.currency}
                              </span>
                              <Input
                                type="number"
                                step="0.5"
                                min="0.01"
                                value={billingForm.rate_per_invoice}
                                onChange={(e) =>
                                  setBillingForm({
                                    ...billingForm,
                                    rate_per_invoice: Number(e.target.value),
                                  })
                                }
                                className="max-w-[120px]"
                              />
                              <span className="text-xs text-muted-foreground">/ invoice</span>
                            </div>
                          </div>

                          {/* ── Seat Compatibility ── */}
                          <div className="rounded-lg border p-3">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              Metering Compatibility
                            </div>
                            {eligibilityLoading ? (
                              <p className="text-xs text-muted-foreground">
                                Checking seat versions…
                              </p>
                            ) : eligibility ? (
                              <>
                                <div className="flex items-center gap-2 mb-2">
                                  {eligibility.eligible ? (
                                    <Badge variant="default" className="bg-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" /> All Seats Compatible
                                    </Badge>
                                  ) : (
                                    <Badge variant="destructive">
                                      <AlertTriangle className="h-3 w-3 mr-1" /> Incompatible Seats
                                    </Badge>
                                  )}
                                  <span className="text-xs text-muted-foreground">
                                    Min: v{eligibility.minVersion}
                                  </span>
                                </div>
                                {eligibility.seats.length > 0 && (
                                  <div className="space-y-1">
                                    {eligibility.seats.map((s: any) => (
                                      <div
                                        key={s.seatId}
                                        className={`flex items-center justify-between text-xs rounded px-2 py-1 ${
                                          s.eligible
                                            ? "bg-green-50 dark:bg-green-950/20"
                                            : "bg-red-50 dark:bg-red-950/20"
                                        }`}
                                      >
                                        <span className="font-medium">{s.displayName}</span>
                                        <span
                                          className={
                                            s.eligible ? "text-green-600" : "text-red-600"
                                          }
                                        >
                                          {s.version ? `v${s.version}` : "No version"} —{" "}
                                          {s.eligible ? "Compatible" : "Update Required"}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {eligibility.seats.length === 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    No active terminals. Compatibility will be verified when terminals connect.
                                  </p>
                                )}
                                {!eligibility.eligible && (
                                  <p className="text-xs text-red-600 mt-2 font-medium">
                                    Update all active POS terminals to v{eligibility.minVersion}+ before enabling Pay Per Invoice.
                                  </p>
                                )}
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => billingTarget && fetchEligibility(billingTarget.id)}
                              >
                                Check Compatibility
                              </Button>
                            )}
                          </div>
                        </>
                      )}

                      {/* ── Shared Fields ── */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Currency</Label>
                          <Select
                            value={billingForm.currency}
                            onValueChange={(v) =>
                              setBillingForm({ ...billingForm, currency: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PKR">PKR</SelectItem>
                              <SelectItem value="USD">USD</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Cycle</Label>
                          <Select
                            value={billingForm.cycle}
                            onValueChange={(v) =>
                              setBillingForm({ ...billingForm, cycle: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="yearly">Yearly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Grace Days</Label>
                          <Input
                            type="number"
                            value={billingForm.grace_days}
                            onChange={(e) =>
                              setBillingForm({
                                ...billingForm,
                                grace_days: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Reminder Days Before</Label>
                          <Input
                            type="number"
                            value={billingForm.reminder_days[0] ?? 1}
                            onChange={(e) =>
                              setBillingForm({
                                ...billingForm,
                                reminder_days: [Number(e.target.value) || 1],
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* Next Payment Date preview */}
                      <div className="rounded-md bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs flex items-center justify-between">
                        <span className="text-emerald-800 dark:text-emerald-300 font-medium">
                          Voucher Next Payment Date (from License Expiry):
                        </span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                          {billingForm.set_lifetime_expiry
                            ? "None (Lifetime)"
                            : billingForm.expires_at
                            ? format(new Date(billingForm.expires_at), "dd MMM yyyy")
                            : billingTarget?.expires_at
                            ? format(new Date(billingTarget.expires_at), "dd MMM yyyy")
                            : billingForm.cycle === "yearly"
                            ? "1 Year from Activation"
                            : "1 Month from Activation"}
                        </span>
                      </div>

                      {/* ── Immediate vs Pending indicator ── */}
                      {eligibility && !eligibility.canApplyImmediately && (
                        <div className="rounded border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 text-xs text-blue-700 dark:text-blue-400">
                          <Clock className="h-3 w-3 inline mr-1" />
                          An active billing cycle exists. Recurring model or rate changes will be{" "}
                          <strong>scheduled for next renewal</strong>. Setup charges apply immediately.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── 3. Official Payment Voucher & Client Email ── */}
                <div className="rounded-lg border p-3.5 space-y-2 bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900">
                  <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    3. Official Voucher &amp; Client Delivery
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={billingForm.generate_voucher}
                        onChange={(e) =>
                          setBillingForm({
                            ...billingForm,
                            generate_voucher: e.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-emerald-600"
                      />
                      Generate Official Payment Voucher (with Terms &amp; PDF)
                    </label>
                    {billingForm.generate_voucher && (
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={billingForm.auto_email}
                          onChange={(e) =>
                            setBillingForm({ ...billingForm, auto_email: e.target.checked })
                          }
                          className="h-4 w-4 accent-emerald-600"
                        />
                        Auto-Email PDF to Client
                      </label>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="px-6 py-3.5 border-t bg-muted/20 shrink-0">
            <Button variant="outline" onClick={() => setBillingTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveBilling}
              disabled={
                billingSaving ||
                (billingForm.enabled &&
                  billingForm.recurring_enabled &&
                  billingForm.model === "per_invoice" &&
                  eligibility &&
                  !eligibility.eligible)
              }
            >
              {billingSaving
                ? "Saving…"
                : billingForm.enabled && billingForm.generate_voucher
                ? "Save & Generate Voucher"
                : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {terminalLicense && (
        <TerminalsModal
          license={terminalLicense}
          onClose={() => setTerminalLicense(null)}
        />
      )}

      {backupSecurityTarget && (
        <BackupSecurityDialog
          license={backupSecurityTarget}
          data={backupSecurityData}
          onClose={() => setBackupSecurityTarget(null)}
          onReveal={revealSecretForTarget}
        />
      )}

      <RenewalVoucherModal
        open={voucherModalState.open}
        voucherId={voucherModalState.voucherId}
        initialVoucher={voucherModalState.initialVoucher}
        onClose={() => setVoucherModalState({ open: false })}
      />

      {/* License-Specific Go-Live Authorization Modal */}
      <Dialog open={!!goLiveTarget} onOpenChange={(o) => { if (!o) setGoLiveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-500" />
              <span>License Go-Live Authorization</span>
            </DialogTitle>
          </DialogHeader>
          {goLiveTarget && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <span className="text-xs text-muted-foreground block">Pharmacy / Project:</span>
                <strong className="text-base text-foreground">
                  {goLiveTarget.projects?.name || "Active Deployment"}
                </strong>
                {goLiveTarget.clients?.name && (
                  <span className="text-xs text-muted-foreground block">Client: {goLiveTarget.clients.name}</span>
                )}
                <span className="text-xs text-muted-foreground block font-mono">
                  License: {goLiveTarget.license_key.substring(0, 16)}…
                </span>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold block text-muted-foreground uppercase tracking-wider">
                  Current License Authorization:
                </span>
                <div className="flex items-center gap-2">
                  <Badge
                    className={
                      goLiveTarget.go_live?.status === "enabled"
                        ? "bg-amber-500 text-white"
                        : goLiveTarget.go_live?.status === "completed"
                          ? "bg-emerald-600 text-white font-bold"
                          : goLiveTarget.go_live?.status === "revoked"
                            ? "bg-rose-500 text-white"
                            : "bg-secondary text-secondary-foreground"
                    }
                  >
                    {goLiveTarget.go_live?.status === "enabled"
                      ? "Enabled (Awaiting POS Execution)"
                      : goLiveTarget.go_live?.status === "completed"
                        ? "Completed (Locked)"
                        : goLiveTarget.go_live?.status === "revoked"
                          ? "Revoked"
                          : "Not Enabled (Default)"}
                  </Badge>
                </div>
                {goLiveTarget.go_live?.enabled_at && (
                  <p className="text-xs text-muted-foreground">
                    Authorized on: {new Date(goLiveTarget.go_live.enabled_at).toLocaleString()} by {goLiveTarget.go_live.enabled_by || "Super Admin"}
                  </p>
                )}
                {goLiveTarget.go_live?.completed_at && (
                  <p className="text-xs text-emerald-600 font-medium">
                    Clean Start completed on: {new Date(goLiveTarget.go_live.completed_at).toLocaleString()} by {goLiveTarget.go_live.completed_by || "POS Operator"}
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200 dark:border-amber-900/30">
                Authorizing Go-Live applies strictly to THIS license. Other licenses under the same client remain untouched. Once authorized, the POS running this license will show the Clean Start Wizard upon next license refresh.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t">
                {goLiveTarget.go_live?.status === "enabled" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isUpdatingGoLive}
                    onClick={() => updateLicenseGoLive(goLiveTarget.id, "revoked")}
                  >
                    Revoke Permission
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                    disabled={isUpdatingGoLive}
                    onClick={() => updateLicenseGoLive(goLiveTarget.id, "enabled")}
                  >
                    {goLiveTarget.go_live?.status === "completed" ? "Re-Authorize Clean Start" : "Enable Go-Live Setup"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setGoLiveTarget(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Backup & Recovery Secret Modal (Super Admin / Admin access)
// ─────────────────────────────────────────────────────────────────────────────
function BackupSecurityDialog({
  license,
  data,
  onClose,
  onReveal,
}: {
  license: any | null;
  data: {
    loading: boolean;
    has_secret: boolean;
    recovery_secret: string | null;
    revealed: boolean;
    backups: any[];
  };
  onClose: () => void;
  onReveal: () => void;
}) {
  if (!license) return null;

  const latestBackup = data.backups[0] || null;
  const previousBackup = data.backups[1] || null;

  const copySecret = () => {
    if (!data.recovery_secret) return;
    navigator.clipboard.writeText(data.recovery_secret);
    toast.success("Backup Recovery Secret copied to clipboard");
  };

  return (
    <Dialog open={!!license} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Cloud Backup &amp; Recovery Secret
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Pharmacy identity */}
          <div className="rounded border bg-muted/40 p-3 text-xs space-y-1">
            <div className="font-semibold text-foreground text-sm">
              {license.projects?.name || "Pharmacy POS"}
            </div>
            <div className="text-muted-foreground flex justify-between">
              <span>Client: {license.clients?.name ?? "—"}</span>
              <span className="font-mono">{license.license_key?.slice(0, 16)}…</span>
            </div>
            <div className="text-muted-foreground flex justify-between pt-1 border-t">
              <span>Cloud Backup Entitlement:</span>
              <Badge variant={license.features?.cloud_backup ? "default" : "secondary"} className="text-[10px]">
                {license.features?.cloud_backup ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>

          {/* Stored Backups */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Cloud Backups (Retention: Max 2)</span>
              <span className="text-primary">{data.backups.length} / 2 Slots Active</span>
            </div>

            {data.loading ? (
              <div className="text-xs text-muted-foreground py-3 text-center animate-pulse">
                Loading cloud backup status…
              </div>
            ) : data.backups.length === 0 ? (
              <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                No cloud backups uploaded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {latestBackup && (
                  <div className="rounded border p-2.5 text-xs flex justify-between items-center bg-card">
                    <div>
                      <div className="font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Latest Backup
                      </div>
                      <div className="text-muted-foreground text-[11px] mt-0.5">
                        {latestBackup.uploaded_at ? new Date(latestBackup.uploaded_at).toLocaleString() : new Date(latestBackup.created_at).toLocaleString()}
                        {latestBackup.size_bytes ? ` • ${Math.round(latestBackup.size_bytes / 1024)} KB` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-50 border-emerald-300">
                      Verified
                    </Badge>
                  </div>
                )}
                {previousBackup && (
                  <div className="rounded border p-2.5 text-xs flex justify-between items-center bg-card">
                    <div>
                      <div className="font-medium flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        Previous Backup
                      </div>
                      <div className="text-muted-foreground text-[11px] mt-0.5">
                        {previousBackup.uploaded_at ? new Date(previousBackup.uploaded_at).toLocaleString() : new Date(previousBackup.created_at).toLocaleString()}
                        {previousBackup.size_bytes ? ` • ${Math.round(previousBackup.size_bytes / 1024)} KB` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Prior
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Backup Recovery Secret (Admin Privileged Reveal) */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                Permanent Recovery Secret
              </Label>
              <span className="text-[10px] text-muted-foreground">Super Admin Access</span>
            </div>
            
            <p className="text-[11px] text-muted-foreground">
              Every cloud backup for this pharmacy is encrypted with this permanent secret.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <div className="flex-1 font-mono text-xs px-3 py-2 bg-background border rounded font-semibold tracking-wider select-all overflow-x-auto">
                {data.revealed 
                  ? data.recovery_secret 
                  : (data.has_secret ? "••••••••••••••••••••" : "Not yet generated / synced from POS")}
              </div>
              
              {data.has_secret && (
                <>
                  {!data.revealed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onReveal}
                      className="text-xs shrink-0"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Reveal
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={copySecret}
                      className="text-xs shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copy
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

