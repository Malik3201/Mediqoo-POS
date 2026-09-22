"use client";

import { useMemo, useState, useCallback } from "react";
import { CreditCard, DollarSign, AlertCircle, CheckCircle2, FileText, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery } from "@/hooks/use-data";
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
import { isBefore, isAfter, addDays, startOfMonth, endOfMonth } from "date-fns";

export default function BillingPage() {
  const { data: licenses = [], isLoading: loadingLicenses, refetch: refetchLicenses } = useDataQuery("licenses", { populate: "clients,projects" });
  const { data: billingPeriods = [], isLoading: loadingPeriods, refetch: refetchPeriods } = useDataQuery("license_billing_periods");
  const { data: payments = [], isLoading: loadingPayments, refetch: refetchPayments } = useDataQuery("license_payments");

  const [paymentTarget, setPaymentTarget] = useState<any | null>(null);
  const [renewalPreview, setRenewalPreview] = useState<any | null>(null);
  const [renewalSuccess, setRenewalSuccess] = useState<any | null>(null);
  
  const [historyTarget, setHistoryTarget] = useState<any | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [paymentForm, setPaymentForm] = useState({
    amount_paid: 0,
    payment_method: "Bank Transfer",
    payment_reference: "",
    notes: "",
    override_renewal: false,
    override_reason: "",
    action: "renew"
  });
  const [submitting, setSubmitting] = useState(false);

  // ── Usage Detail Dialog ──
  const [usageTarget, setUsageTarget] = useState<any | null>(null);
  const [usageData, setUsageData] = useState<any | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // ── Adjustments ──
  const [adjustmentForm, setAdjustmentForm] = useState({ type: "credit", amount: 0, reason: "" });
  const [adjustmentSubmitting, setAdjustmentSubmitting] = useState(false);
  // Master Table Data: Combine License with its active Billing Period
  const activeBillingData = useMemo(() => {
    return licenses.filter((l: any) => l.billing?.enabled).map((l: any) => {
      // Find the most recent/relevant unpaid billing period, or the latest paid one
      const periodsForLicense = billingPeriods.filter((bp: any) => bp.license_id === l.id);
      
      // Sort ASCENDING (oldest due date first) so we address oldest arrears first
      periodsForLicense.sort((a: any, b: any) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
      
      const unpaidPeriods = periodsForLicense.filter((bp: any) => bp.status !== "paid" && bp.status !== "waived");
      
      // The "current" obligation is the oldest unpaid period.
      // If fully paid up, it's the latest future pre-created period.
      const currentPeriod = unpaidPeriods[0] || periodsForLicense[periodsForLicense.length - 1] || null;

      const previousPeriodsExist = periodsForLicense.length > 1 || (periodsForLicense[0] && (periodsForLicense[0].status === "paid" || periodsForLicense[0].status === "waived"));

      const operationalStatus = deriveOperationalStatus(l);
      const billingStatus = deriveBillingStatus(l, currentPeriod, previousPeriodsExist);

      return {
        license: l,
        currentPeriod,
        unpaidPeriods,
        operationalStatus,
        billingStatus
      };
    });
  }, [licenses, billingPeriods]);
  // Derived KPIs
  const kpis = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    let expected = 0;
    let collected = 0;
    let outstanding = 0;

    let dueSoonCount = 0;
    let overdueCount = 0;
    let expiringTomorrowCount = 0;

    // Expected: periods due this month
    billingPeriods.forEach((bp: any) => {
      const due = new Date(bp.due_at);
      if (due >= monthStart && due <= monthEnd) {
        expected += bp.amount_due;
      }
      if (bp.status === "unpaid" || bp.status === "partially_paid") {
        outstanding += (bp.amount_due - (bp.amount_paid || 0));
      }
    });

    activeBillingData.forEach((item: any) => {
      if (item.billingStatus === "Due Soon" || item.billingStatus === "Due Today" || item.billingStatus === "Due Tomorrow") {
        dueSoonCount++;
      }
      if (item.billingStatus === "Due Tomorrow") {
        expiringTomorrowCount++;
      }
      if (item.billingStatus === "Overdue") {
        overdueCount++;
      }
    });

    // Collected: payments made this month
    payments.forEach((p: any) => {
      const paidAt = new Date(p.paid_at);
      if (paidAt >= monthStart && paidAt <= monthEnd) {
        collected += p.amount_paid;
      }
    });

    return { expected, collected, outstanding, dueSoonCount, overdueCount, expiringTomorrowCount };
  }, [billingPeriods, payments, activeBillingData]);

  // Filters
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchFilter, setSearchFilter] = useState("");

  const filteredData = useMemo(() => {
    return activeBillingData.filter((item: any) => {
      // Search match
      const s = searchFilter.toLowerCase();
      const matchesSearch = !s || 
        item.license.projects?.name?.toLowerCase().includes(s) ||
        item.license.clients?.name?.toLowerCase().includes(s) ||
        item.license.clients?.contact_name?.toLowerCase().includes(s) ||
        item.license.license_key?.toLowerCase().includes(s);

      if (!matchesSearch) return false;

      if (statusFilter === "Per Invoice" && item.license.billing?.model !== "per_invoice") return false;
      if (statusFilter === "Fixed" && item.license.billing?.model === "per_invoice") return false;

      if (statusFilter === "All" || statusFilter === "Per Invoice" || statusFilter === "Fixed") return true;
      if (statusFilter === "Paid" && item.billingStatus === "Paid") return true;
      if (statusFilter === "Due Soon" && (item.billingStatus === "Due Soon" || item.billingStatus === "Due Today" || item.billingStatus === "Due Tomorrow")) return true;
      if (statusFilter === "Overdue" && item.billingStatus === "Overdue") return true;
      if (statusFilter === "Grace" && item.operationalStatus === "Grace Period") return true;
      if (statusFilter === "Renewal Required" && item.operationalStatus === "Renewal Required") return true;

      return false;
    }).sort((a: any, b: any) => {
       // Sorting priority: Overdue > Grace > Due Today > Due Soon > Active/Paid
       const priority = (s: string) => {
         if (s === "Overdue") return 0;
         if (s === "Renewal Required") return 1;
         if (s === "Grace Period") return 2;
         if (s === "Due Today") return 3;
         if (s === "Due Tomorrow") return 4;
         if (s === "Due Soon") return 5;
         return 6;
       };
       return priority(a.billingStatus) - priority(b.billingStatus) || priority(a.operationalStatus) - priority(b.operationalStatus);
    });
  }, [activeBillingData, statusFilter, searchFilter]);

  const loading = loadingLicenses || loadingPeriods || loadingPayments;

  async function openPayment(item: any) {
    if (!item.currentPeriod) {
      toast.error("No active billing period found. Please ensure billing is fully configured.");
      return;
    }
    
    setPaymentTarget(item);
    setRenewalSuccess(null);
    setRenewalPreview(null);
    setPaymentForm({
      amount_paid: 0, // will be updated once preview loads
      payment_method: "Bank Transfer",
      payment_reference: "",
      notes: "",
      override_renewal: false,
      override_reason: "",
      action: "renew", // "renew" or "payment_only"
    });

    try {
      const ids = item.unpaidPeriods.map((p:any) => p.id).join(",");
      const res = await fetch(`/api/admin/licenses/${item.license.id}/renew/preview?billing_period_ids=${ids}`);
      if (res.ok) {
        const preview = await res.json();
        setRenewalPreview(preview);
        setPaymentForm(prev => ({ ...prev, amount_paid: preview.amount_due }));
      }
    } catch (e) {
      console.error("Failed to load renewal preview", e);
    }
  }

  async function openHistory(item: any) {
    setHistoryTarget(item);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/licenses/${item.license.id}/payments`);
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data.items || []);
      }
    } catch (e) {
      toast.error("Failed to load payment history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function recordPayment() {
    if (!paymentTarget || !paymentTarget.currentPeriod) return;
    setSubmitting(true);
    
    // Generate idempotency key for this payment attempt
    const idempotencyKey = `pay_${paymentTarget.currentPeriod.id}_${Date.now()}`;
    
    try {
      const url = paymentForm.action === "renew" 
        ? `/api/admin/licenses/${paymentTarget.license.id}/renew` 
        : `/api/admin/licenses/${paymentTarget.license.id}/payments`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billing_period_ids: paymentTarget.unpaidPeriods.map((p:any) => p.id),
          amount_paid: paymentForm.amount_paid,
          payment_method: paymentForm.payment_method,
          payment_reference: paymentForm.payment_reference,
          idempotency_key: idempotencyKey,
          notes: paymentForm.notes,
          override_renewal: paymentForm.override_renewal,
          override_reason: paymentForm.override_reason,
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to record payment");
      }

      toast.success("Payment recorded and license renewed successfully!");
      
      // Update local state without full reload
      const data = await res.json();
      refetchLicenses().then((latestData: any) => {
        const updatedLicense = latestData?.find((l: any) => l.id === paymentTarget.license.id);
        if (updatedLicense) {
          setRenewalSuccess({
            ...paymentForm,
            previous_expiry: paymentTarget.license.expires_at,
            new_expiry: updatedLicense.expires_at,
            grace_until: updatedLicense.grace_until,
            invoice_number: data.invoice.invoice_number,
            invoice_id: data.invoice._id,
            email_status: data.invoice.email_status
          });
        }
      });
      refetchPeriods();
      refetchPayments();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openUsageDetail(item: any) {
    setUsageTarget(item);
    setUsageData(null);
    setUsageLoading(true);
    setAdjustmentForm({ type: "credit", amount: 0, reason: "" });
    try {
      const res = await fetch(`/api/admin/licenses/${item.license.id}/usage`);
      if (res.ok) {
        setUsageData(await res.json());
      }
    } catch (e) {
      toast.error("Failed to load usage data");
    } finally {
      setUsageLoading(false);
    }
  }

  async function submitAdjustment() {
    if (!usageTarget || !usageData) return;
    if (!adjustmentForm.reason || adjustmentForm.reason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters");
      return;
    }
    if (!adjustmentForm.amount || adjustmentForm.amount <= 0) {
      toast.error("Amount must be positive");
      return;
    }
    setAdjustmentSubmitting(true);
    try {
      const currentPeriod = usageData.periods?.[0];
      const res = await fetch(`/api/admin/licenses/${usageTarget.license.id}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: adjustmentForm.type,
          amount: Number(adjustmentForm.amount),
          reason: adjustmentForm.reason.trim(),
          billing_period_id: currentPeriod?.period_id || null,
          currency: usageData.currency || "PKR",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || err.error || "Failed");
      }
      toast.success("Adjustment recorded");
      setAdjustmentForm({ type: "credit", amount: 0, reason: "" });
      // Refresh usage data
      openUsageDetail(usageTarget);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdjustmentSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          Billing & Renewals
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage recurring license payments, expected revenue, and overdue subscriptions.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-row items-center justify-between pb-2">
            <h3 className="tracking-tight text-sm font-medium text-muted-foreground">Expected This Month</h3>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">Rs {kpis.expected.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-row items-center justify-between pb-2">
            <h3 className="tracking-tight text-sm font-medium text-muted-foreground">Collected This Month</h3>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold">Rs {kpis.collected.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-row items-center justify-between pb-2">
            <h3 className="tracking-tight text-sm font-medium text-muted-foreground">Outstanding Balance</h3>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </div>
          <div className="text-2xl font-bold text-destructive">Rs {kpis.outstanding.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-row items-center justify-between pb-2">
            <h3 className="tracking-tight text-sm font-medium text-muted-foreground">Due Soon (7 Days)</h3>
            <CreditCard className="h-4 w-4 text-orange-500" />
          </div>
          <div className="text-2xl font-bold">{kpis.dueSoonCount}</div>
        </div>
      </div>

      {/* ACTION CENTER */}
      {(kpis.dueSoonCount > 0 || kpis.overdueCount > 0) && (
        <div className="flex flex-col gap-2">
          {activeBillingData.filter((item: any) => item.billingStatus === "Due Tomorrow" || item.billingStatus === "Due Today" || item.billingStatus === "Overdue").map((item: any) => (
            <div key={item.license.id} className={`flex items-center justify-between p-4 rounded-xl border shadow-sm ${
              item.billingStatus === "Overdue" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
            }`}>
              <div className="flex items-center gap-3">
                <AlertCircle className={`h-5 w-5 ${item.billingStatus === "Overdue" ? "text-red-500" : "text-amber-500"}`} />
                <div>
                  <h4 className={`font-semibold ${item.billingStatus === "Overdue" ? "text-red-800" : "text-amber-800"}`}>
                    {item.license.projects?.name} — {item.billingStatus === "Overdue" ? "Overdue" : "Expires Tomorrow"}
                  </h4>
                  <p className={`text-sm ${item.billingStatus === "Overdue" ? "text-red-600" : "text-amber-700"}`}>
                    {item.license.billing?.currency} {item.currentPeriod?.amount_due} due
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => openPayment(item)} variant={item.billingStatus === "Overdue" ? "destructive" : "default"}>
                Record Payment & Renew
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <Input 
          placeholder="Search projects, clients..." 
          className="max-w-xs"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Licenses</SelectItem>
            <SelectItem value="Fixed">Fixed</SelectItem>
            <SelectItem value="Per Invoice">Per Invoice</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
            <SelectItem value="Due Soon">Due Soon</SelectItem>
            <SelectItem value="Overdue">Overdue</SelectItem>
            <SelectItem value="Grace">Grace Period</SelectItem>
            <SelectItem value="Renewal Required">Renewal Required</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Client & Contact</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Rate / Fee</TableHead>
              <TableHead>Invoices</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Loading billing data...
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No billing-enabled licenses match filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((item: any) => {
                const isPerInvoice = item.license.billing?.model === "per_invoice";
                const periodOutstanding = item.currentPeriod ? (item.currentPeriod.amount_due - (item.currentPeriod.amount_paid || 0)) : 0;
                return (
                <TableRow key={item.license.id}>
                  <TableCell className="font-medium">{item.license.projects?.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{item.license.clients?.name}</span>
                      {item.license.clients?.contact_name && <span className="text-xs text-muted-foreground">{item.license.clients?.contact_name} ({item.license.clients?.contact_phone})</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isPerInvoice ? "secondary" : "outline"} className="text-xs">
                      {isPerInvoice ? "Per Invoice" : "Fixed"}
                    </Badge>
                    {item.license.billing?.pending_changes && (
                      <div className="flex items-center gap-1 text-amber-600 text-[10px] mt-0.5"><Clock className="h-2.5 w-2.5" /> Pending</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">
                      {isPerInvoice
                        ? `${item.license.billing?.currency} ${item.license.billing?.rate_per_invoice ?? 1}/inv`
                        : `${item.license.billing?.currency} ${item.license.billing?.amount?.toLocaleString()}`
                      }
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{isPerInvoice ? (item.currentPeriod?.invoice_count ?? "0") : "—"}</span>
                  </TableCell>
                  <TableCell>
                    {item.currentPeriod ? (
                      <span className={`text-xs font-semibold ${periodOutstanding > 0 ? "text-destructive" : "text-green-600"}`}>
                        {item.license.billing?.currency} {Math.max(0, periodOutstanding).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.license.expires_at ? new Date(item.license.expires_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={
                        item.operationalStatus === "Active" ? "default" :
                        item.operationalStatus === "Grace Period" ? "secondary" : "destructive"
                      }>
                        {item.operationalStatus}
                      </Badge>
                      {item.currentPeriod && (
                        <Badge variant={
                          item.billingStatus === "Paid" ? "default" :
                          item.billingStatus === "Overdue" ? "destructive" :
                          item.billingStatus === "Due Tomorrow" || item.billingStatus === "Due Today" || item.billingStatus === "Due Soon" ? "secondary" : "outline"
                        } className="text-[10px]">
                          {item.billingStatus}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {isPerInvoice && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openUsageDetail(item)}
                          title="Usage Detail"
                        >
                          <FileText className="h-3 w-3 mr-1" /> Detail
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openHistory(item)}
                      >
                        History
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openPayment(item)}
                        variant={item.billingStatus === "Overdue" ? "destructive" : "default"}
                      >
                        Action
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!paymentTarget} onOpenChange={(v) => !v && setPaymentTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment & Renew</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {renewalSuccess ? (
              <div className="space-y-4 text-sm">
                <div className="rounded border p-4 bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                  <h4 className="font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Payment Recorded
                  </h4>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <div className="text-muted-foreground">Invoice Number:</div>
                    <div className="font-medium text-primary">{renewalSuccess.invoice_number}</div>
                    
                    <div className="text-muted-foreground">Email Receipt:</div>
                    <div className="font-medium capitalize">{renewalSuccess.email_status === 'sent' ? 'Sent to Client' : 'Pending/Failed'}</div>
                    
                    <div className="text-muted-foreground">Previous Expiry:</div>
                    <div className="font-medium">{renewalSuccess.previous_expiry ? new Date(renewalSuccess.previous_expiry).toLocaleDateString() : "Never"}</div>
                    
                    <div className="text-muted-foreground">New Expiry:</div>
                    <div className="font-medium text-primary">{new Date(renewalSuccess.new_expiry).toLocaleDateString()}</div>
                    
                    <div className="text-muted-foreground">Amount Paid:</div>
                    <div className="font-medium">{paymentTarget?.license.billing?.currency} {renewalSuccess.amount_paid}</div>
                    
                    <div className="col-span-2 pt-2 text-center">
                      <a href={`/api/admin/invoices/${renewalSuccess.invoice_id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:underline">
                        ⬇ Download PDF Invoice
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Recording this payment will settle the selected billing period and automatically extend the license expiry.
                </p>
                
                {paymentTarget && (
                  <div className="rounded border bg-muted/50 p-4 text-sm mb-4">
                     <div className="grid grid-cols-2 gap-2 text-xs mb-3 pb-3 border-b border-muted-foreground/10">
                        <span className="text-muted-foreground">Operational Status:</span>
                        <span className="font-semibold text-right">{paymentTarget.operationalStatus}</span>
                        <span className="text-muted-foreground">Billing Status:</span>
                        <span className={`font-semibold text-right ${paymentTarget.billingStatus === "Overdue" ? "text-red-600" : ""}`}>{paymentTarget.billingStatus}</span>
                     </div>
                     <div className="flex justify-between font-semibold text-primary mb-2">
                        <span>Current Ledger</span>
                     </div>
                     <div className="grid grid-cols-2 gap-1 text-xs">
                        <span className="text-muted-foreground">Outstanding Periods:</span>
                        <span className="text-right">{paymentTarget.unpaidPeriods.length} period(s)</span>
                        {renewalPreview?.billing_model !== "per_invoice" && (
                          <>
                            <span className="text-muted-foreground">Amount Due:</span>
                            <span className="text-right">{paymentTarget.license.billing?.currency} {paymentTarget.unpaidPeriods.reduce((sum:any, p:any) => sum + p.amount_due, 0)}</span>
                          </>
                        )}
                     </div>
                  </div>
                )}
                
                {renewalPreview && renewalPreview.billing_model === "per_invoice" && (
                  <div className="rounded border bg-muted/50 p-4 text-sm mb-4">
                    <div className="flex justify-between font-semibold text-primary mb-2">
                      <span>Per-Invoice Cycle Summary</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <span className="text-muted-foreground">Invoices Metered:</span>
                      <span className="text-right">{renewalPreview.invoice_count}</span>
                      <span className="text-muted-foreground">Usage Charges:</span>
                      <span className="text-right">{renewalPreview.currency} {renewalPreview.usage_amount}</span>
                      <span className="text-muted-foreground">Adjustments:</span>
                      <span className="text-right">{renewalPreview.currency} {renewalPreview.adjustments_amount}</span>
                      <span className="text-muted-foreground">Payments Recorded:</span>
                      <span className="text-right">{renewalPreview.currency} {renewalPreview.payment_amount}</span>
                      <span className="font-semibold pt-1 border-t mt-1">Total Outstanding:</span>
                      <span className="font-semibold text-right pt-1 border-t mt-1 text-destructive">{renewalPreview.currency} {renewalPreview.amount_due}</span>
                    </div>
                  </div>
                )}
                
                {renewalPreview && (
                  <div className="rounded border bg-muted/50 p-4 text-sm mb-4">
                    <div className="flex justify-between font-semibold text-primary mb-2">
                      <span>Renewal Preview</span>
                      <span className="capitalize">{renewalPreview.renewal_type} Renewal</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <span className="text-muted-foreground">Current Expiry:</span>
                      <span className="text-right">{renewalPreview.current_expiry ? new Date(renewalPreview.current_expiry).toLocaleDateString() : "Never"}</span>
                      <span className="text-muted-foreground">New Expiry:</span>
                      <span className="text-right font-medium">{new Date(renewalPreview.new_expiry).toLocaleDateString()}</span>
                      <span className="text-muted-foreground">New Grace Until:</span>
                      <span className="text-right">{new Date(renewalPreview.new_grace_until).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
            <div className="grid gap-2">
              <Label>Action</Label>
              <Select
                value={paymentForm.action}
                onValueChange={(v) => setPaymentForm({ ...paymentForm, action: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="renew">Confirm Payment & Renew License</SelectItem>
                  <SelectItem value="payment_only">Record Payment Only (No Renewal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid gap-2">
              <Label>Amount Paid</Label>
              <Input
                type="number"
                value={paymentForm.amount_paid}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: Number(e.target.value) })}
              />
            </div>
            {paymentForm.action === "renew" && renewalPreview && paymentForm.amount_paid < renewalPreview.amount_due && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-600 text-xs rounded border border-red-200 dark:border-red-900 mt-2">
                <div className="flex items-center gap-2 mb-2 font-semibold">
                  <AlertCircle className="w-4 h-4" /> Full outstanding balance required to renew.
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={paymentForm.override_renewal} onChange={e => setPaymentForm({...paymentForm, override_renewal: e.target.checked})} className="rounded text-red-600" />
                  Super-Admin Override: Renew with remaining debt
                </label>
                {paymentForm.override_renewal && (
                  <Input 
                    className="mt-2 text-sm" 
                    placeholder="Mandatory override reason" 
                    value={paymentForm.override_reason} 
                    onChange={e => setPaymentForm({...paymentForm, override_reason: e.target.value})} 
                  />
                )}
              </div>
            )}
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select
                value={paymentForm.payment_method}
                onValueChange={(v) => setPaymentForm({ ...paymentForm, payment_method: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                  <SelectItem value="Online Gateway">Online Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Reference ID (Optional)</Label>
              <Input
                value={paymentForm.payment_reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })}
                placeholder="Transaction ID, Cheque No, etc."
              />
            </div>
            <div className="grid gap-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
              </>
            )}
          </div>
          <DialogFooter>
            {renewalSuccess ? (
              <Button onClick={() => setPaymentTarget(null)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPaymentTarget(null)}>Cancel</Button>
                <Button onClick={recordPayment} disabled={submitting || (paymentForm.action === "renew" && paymentForm.amount_paid < (renewalPreview?.amount_due || 0) && (!paymentForm.override_renewal || !paymentForm.override_reason))}>
                  {submitting ? "Processing..." : paymentForm.action === "renew" ? "Confirm Payment & Renew" : "Record Payment"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyTarget} onOpenChange={(v) => !v && setHistoryTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment History — {historyTarget?.license.projects?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : historyData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No payments found.</TableCell>
                  </TableRow>
                ) : (
                  historyData.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{p.currency} {p.amount_paid}</TableCell>
                      <TableCell>{p.payment_method}</TableCell>
                      <TableCell>{p.payment_reference || "—"}</TableCell>
                      <TableCell className="text-right">
                        {p.invoice_id ? (
                          <a href={`/api/admin/invoices/${p.invoice_id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Download PDF</a>
                        ) : (
                          <span className="text-muted-foreground text-xs">No Invoice</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Usage Detail Dialog (Per-Invoice) ── */}
      <Dialog open={!!usageTarget} onOpenChange={(v) => !v && setUsageTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Per-Invoice Usage Detail — {usageTarget?.license.projects?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {usageLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading usage data…</p>
            ) : usageData ? (
              <>
                {/* License-level Summary */}
                <div className="rounded-lg border p-4">
                  <h4 className="font-semibold text-sm mb-3">Billing Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">Billing Model:</span>
                    <span className="font-medium capitalize">{usageData.billing_model === "per_invoice" ? "Per Invoice" : "Fixed"}</span>
                    <span className="text-muted-foreground">Rate:</span>
                    <span className="font-medium">{usageData.currency} {usageData.rate}/invoice</span>
                    <span className="text-muted-foreground">Cycle:</span>
                    <span className="font-medium capitalize">{usageData.cycle}</span>
                    {usageData.pending_changes && (
                      <>
                        <span className="text-amber-600 font-semibold col-span-2 border-t pt-1 mt-1">Pending Change (Next Renewal)</span>
                        {usageData.pending_changes.model && (
                          <><span className="text-muted-foreground">New Model:</span>
                          <span className="font-medium">{usageData.pending_changes.model === "per_invoice" ? "Per Invoice" : "Fixed"}</span></>
                        )}
                        {usageData.pending_changes.rate_per_invoice != null && (
                          <><span className="text-muted-foreground">New Rate:</span>
                          <span className="font-medium">{usageData.currency} {usageData.pending_changes.rate_per_invoice}/invoice</span></>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border p-4">
                  <h4 className="font-semibold text-sm mb-3">All-Time Totals</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">Total Invoices Metered:</span>
                    <span className="font-medium">{usageData.totals.usage_count}</span>
                    <span className="text-muted-foreground">Total Usage Charges:</span>
                    <span className="font-medium">{usageData.currency} {usageData.totals.total_charges}</span>
                    <span className="text-muted-foreground">Total Payments:</span>
                    <span className="font-medium">{usageData.currency} {usageData.totals.total_paid}</span>
                    <span className="text-muted-foreground">Adjustments (Net):</span>
                    <span className="font-medium">{usageData.currency} {usageData.totals.adjustments_net}</span>
                    <span className="font-semibold border-t pt-1 mt-1">Outstanding:</span>
                    <span className={`font-semibold border-t pt-1 mt-1 ${usageData.totals.outstanding > 0 ? "text-destructive" : "text-green-600"}`}>
                      {usageData.currency} {usageData.totals.outstanding}
                    </span>
                  </div>
                </div>

                {/* Per-Period Breakdown */}
                {usageData.periods?.length > 0 && (
                  <div className="rounded-lg border">
                    <h4 className="font-semibold text-sm p-4 pb-2">Period Breakdown</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period</TableHead>
                          <TableHead>Invoices</TableHead>
                          <TableHead>Charges</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead>Outstanding</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usageData.periods.map((p: any) => (
                          <TableRow key={p.period_id}>
                            <TableCell className="text-xs">
                              {new Date(p.period_start).toLocaleDateString()} – {new Date(p.period_end).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-xs">{p.usage_count}</TableCell>
                            <TableCell className="text-xs">{usageData.currency} {p.usage_charges}</TableCell>
                            <TableCell className="text-xs">{usageData.currency} {p.total_paid}</TableCell>
                            <TableCell className={`text-xs font-semibold ${p.outstanding > 0 ? "text-destructive" : "text-green-600"}`}>
                              {usageData.currency} {p.outstanding}
                            </TableCell>
                            <TableCell><Badge variant={p.status === "paid" ? "default" : p.status === "partially_paid" ? "secondary" : "outline"} className="text-[10px] capitalize">{p.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Recent Adjustments */}
                {usageData.recent_adjustments?.length > 0 && (
                  <div className="rounded-lg border">
                    <h4 className="font-semibold text-sm p-4 pb-2">Adjustment History</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usageData.recent_adjustments.map((a: any) => (
                          <TableRow key={a.id || a._id}>
                            <TableCell className="text-xs">{new Date(a.created_at).toLocaleDateString()}</TableCell>
                            <TableCell><Badge variant={a.type === "debit" ? "destructive" : "default"} className="text-[10px] capitalize">{a.type}</Badge></TableCell>
                            <TableCell className="text-xs">{a.currency} {a.amount}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{a.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{a.recorded_by}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Add Adjustment */}
                <div className="rounded-lg border p-4">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Plus className="h-3 w-3" /> Add Adjustment</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select value={adjustmentForm.type} onValueChange={(v) => setAdjustmentForm({ ...adjustmentForm, type: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit">Credit</SelectItem>
                          <SelectItem value="debit">Debit</SelectItem>
                          <SelectItem value="waiver">Waiver</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Amount</Label>
                      <Input type="number" min="0.01" step="0.01" className="h-8 text-xs" value={adjustmentForm.amount} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: Number(e.target.value) })} />
                    </div>
                    <div className="flex items-end">
                      <Button size="sm" className="h-8" onClick={submitAdjustment} disabled={adjustmentSubmitting}>
                        {adjustmentSubmitting ? "Saving…" : "Record"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs">Reason</Label>
                    <Textarea className="text-xs min-h-[60px]" placeholder="Mandatory reason (min 3 chars)" value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-center py-8">No data available</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsageTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
