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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

      // Aggregate all unpaid periods for accurate UI display
      let totalUnpaidAmountDue = 0;
      let totalUnpaidUsageCharges = 0;
      let totalUnpaidInvoiceCount = 0;
      
      unpaidPeriods.forEach((bp: any) => {
        totalUnpaidAmountDue += (bp.outstanding ?? Math.max(0, bp.amount_due - (bp.amount_paid || 0)));
        totalUnpaidUsageCharges += (bp.usage_charges || 0);
        totalUnpaidInvoiceCount += (bp.invoice_count || 0);
      });

      return {
        license: l,
        currentPeriod,
        unpaidPeriods,
        operationalStatus,
        billingStatus,
        totalUnpaidAmountDue,
        totalUnpaidUsageCharges,
        totalUnpaidInvoiceCount,
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
      const res = await fetch(`/api/admin/licenses/${item.license.id}/renew/preview`);
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
          amount_paid: paymentForm.amount_paid,
          payment_method: paymentForm.payment_method,
          payment_reference: paymentForm.payment_reference,
          idempotency_key: idempotencyKey,
          notes: paymentForm.notes,
          override_renewal: paymentForm.override_renewal,
          override_reason: paymentForm.override_reason,
          action: paymentForm.action
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
      // Also fetch payment history for the same license
      const historyRes = await fetch(`/api/admin/licenses/${item.license.id}/payments`);
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistoryData(data.items || []);
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
              <TableHead>Usage</TableHead>
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
                const periodOutstanding = item.totalUnpaidAmountDue || 0;
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
                    <span className="text-xs">{isPerInvoice ? (item.totalUnpaidInvoiceCount ?? "0") : "—"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{isPerInvoice ? `${item.license.billing?.currency} ${(item.totalUnpaidUsageCharges ?? 0).toLocaleString()}` : "—"}</span>
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
        <DialogContent className="max-w-[850px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b bg-muted/10 shrink-0">
            <DialogTitle>Record Payment & Renew</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-primary mb-3 uppercase tracking-wider">Account Summary</h3>
                    {paymentTarget && (
                      <div className="rounded border bg-muted/20 p-4 text-sm h-full">
                         <div className="grid grid-cols-2 gap-2 text-xs">
                            <span className="text-muted-foreground">Operational Status:</span>
                            <span className="font-semibold text-right">{paymentTarget.operationalStatus}</span>
                            <span className="text-muted-foreground">Billing Status:</span>
                            <span className={`font-semibold text-right ${paymentTarget.billingStatus === "Overdue" ? "text-red-600" : ""}`}>{paymentTarget.billingStatus}</span>
                            <span className="text-muted-foreground">Outstanding Periods:</span>
                            <span className="text-right">{paymentTarget.unpaidPeriods.length} period(s)</span>
                         </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-primary mb-3 uppercase tracking-wider">Current Billing</h3>
                    {renewalPreview && renewalPreview.billing_model === "per_invoice" ? (
                      <div className="rounded border bg-muted/20 p-4 text-sm h-full flex flex-col justify-center">
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <span className="text-muted-foreground">Invoices Metered:</span>
                          <span className="text-right">{renewalPreview.invoice_count || 0}</span>
                          <span className="text-muted-foreground">Usage Charges:</span>
                          <span className="text-right">{renewalPreview.currency} {renewalPreview.usage_amount || 0}</span>
                          <span className="text-muted-foreground">Adjustments:</span>
                          <span className="text-right">{renewalPreview.currency} {renewalPreview.adjustments_amount || 0}</span>
                          <span className="text-muted-foreground">Payments Recorded:</span>
                          <span className="text-right">{renewalPreview.currency} {renewalPreview.payment_amount || 0}</span>
                          <span className="font-semibold pt-1 border-t mt-1">Total Outstanding:</span>
                          <span className="font-semibold text-right pt-1 border-t mt-1 text-destructive">{renewalPreview.currency} {renewalPreview.amount_due || 0}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded border bg-muted/20 p-4 text-sm h-full flex flex-col justify-center">
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <span className="text-muted-foreground">Amount Due:</span>
                          <span className="text-right">{paymentTarget?.license.billing?.currency} {paymentTarget?.unpaidPeriods.reduce((sum:any, p:any) => sum + p.amount_due, 0)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                   <div className="grid gap-2">
                     <Label>Action</Label>
                     <Select
                       value={paymentForm.action}
                       onValueChange={(v) => setPaymentForm({ ...paymentForm, action: v })}
                     >
                       <SelectTrigger>
                         <SelectValue placeholder="Select Action" />
                       </SelectTrigger>
                       <SelectContent>
                         {(!renewalPreview || renewalPreview.amount_due > 0) && (
                           <SelectItem value="payment_only">Record Payment Only</SelectItem>
                         )}
                         <SelectItem value="renew">Confirm Payment &amp; Renew</SelectItem>
                         {(renewalPreview && renewalPreview.amount_due <= 0) && (
                           <SelectItem value="renew_only">Renew License (Fully Paid)</SelectItem>
                         )}
                       </SelectContent>
                     </Select>
                   </div>
                   
                   {paymentForm.action !== "renew_only" && (
                     <div className="grid gap-2">
                       <Label>Amount Paid ({(renewalPreview || paymentTarget?.currentPeriod)?.currency})</Label>
                       <Input 
                         type="number" 
                         value={paymentForm.amount_paid} 
                         onChange={e => setPaymentForm({...paymentForm, amount_paid: Number(e.target.value)})}
                         max={renewalPreview?.amount_due || undefined}
                         min={0}
                       />
                       {paymentForm.amount_paid > (renewalPreview?.amount_due || 0) && (
                         <p className="text-xs text-destructive">Amount exceeds current outstanding.</p>
                       )}
                     </div>
                   )}
                   {paymentForm.action === "renew" && renewalPreview && (
                      <div className="rounded border bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900 p-3 text-sm col-span-2">
                        <div className="flex justify-between font-semibold text-blue-700 dark:text-blue-400 mb-2 text-xs uppercase tracking-wider">
                          <span>Renewal Preview</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Current Expiry</div>
                            <div>{renewalPreview.current_expiry ? new Date(renewalPreview.current_expiry).toLocaleDateString() : "Never"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">New Expiry</div>
                            <div className="font-medium text-blue-700 dark:text-blue-400">{new Date(renewalPreview.new_expiry).toLocaleDateString()}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Grace Until</div>
                            <div>{new Date(renewalPreview.new_grace_until).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </div>
                   )}
                </div>

                <div className="border-t border-border pt-6 mt-2">
                  <h3 className="text-sm font-semibold text-primary mb-4 uppercase tracking-wider">Payment Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="grid gap-2">
                      <Label>Amount Paid</Label>
                      <Input
                        type="number"
                        value={paymentForm.amount_paid}
                        onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: Number(e.target.value) })}
                      />
                    </div>
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
                      <Input
                        value={paymentForm.notes}
                        onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                      />
                    </div>
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
                </div>
              </>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t bg-muted/10 shrink-0">
            {renewalSuccess ? (
              <Button onClick={() => setPaymentTarget(null)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPaymentTarget(null)}>Cancel</Button>
                <Button 
                  onClick={recordPayment} 
                  disabled={
                    submitting || 
                    (paymentForm.action !== "renew_only" && (paymentForm.amount_paid <= 0 || paymentForm.amount_paid > (renewalPreview?.amount_due || 0)))
                  }
                >
                  {submitting ? "Processing..." : (paymentForm.action === "renew" ? "Record & Renew" : paymentForm.action === "renew_only" ? "Renew License" : "Record Payment")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Usage Detail Dialog (Per-Invoice) ── */}
      <Dialog open={!!usageTarget} onOpenChange={(v) => !v && setUsageTarget(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b bg-muted/20 shrink-0">
            <DialogTitle>Details for {usageTarget?.license.clients?.name}</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="usage" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="usage">Billing Usage</TabsTrigger>
                <TabsTrigger value="history">Payment History</TabsTrigger>
                <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
              </TabsList>
              
              <TabsContent value="usage">
                {usageLoading ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Loading usage data...</div>
                ) : !usageData || usageData.usage?.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">No metered usage found for this period.</div>
                ) : (
                  <div className="border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Terminal</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usageData.usage.map((u: any) => (
                          <TableRow key={u.id}>
                            <TableCell>{new Date(u.occurred_at).toLocaleDateString()}</TableCell>
                            <TableCell>{u.invoice_number_snapshot || "N/A"}</TableCell>
                            <TableCell>Seat {u.terminal_number || "?"}</TableCell>
                            <TableCell className="text-right">{u.rate_snapshot}</TableCell>
                            <TableCell className="text-right">{u.amount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="history">
                {historyLoading ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Loading payment history...</div>
                ) : !historyData || historyData.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">No payment history found.</div>
                ) : (
                  <div className="border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Receipt #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Out. After</TableHead>
                          <TableHead>Email Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historyData.map((h: any) => (
                          <TableRow key={h.id}>
                            <TableCell>{new Date(h.paid_at).toLocaleDateString()}</TableCell>
                            <TableCell>{h.receipt_number || "N/A"}</TableCell>
                            <TableCell>{h.currency} {h.amount_paid}</TableCell>
                            <TableCell>{h.payment_method || "N/A"}</TableCell>
                            <TableCell>{h.currency} {h.outstanding_after || 0}</TableCell>
                            <TableCell>
                              <Badge variant={h.email_status === "sent" ? "outline" : h.email_status === "failed" ? "destructive" : "secondary"}>
                                {h.email_status || "pending"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => window.open(`/api/admin/payments/${h.id}/pdf`, "_blank")}>
                                PDF
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => {
                                fetch(`/api/admin/payments/${h.id}/resend`, { method: "POST" })
                                  .then(() => toast.success("Receipt queued for resend"))
                                  .catch(() => toast.error("Failed to resend receipt"));
                              }}>
                                Resend
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="adjustments">
                {usageLoading ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Loading...</div>
                ) : (
                  <div className="space-y-4">
                    {usageData?.recent_adjustments?.length > 0 ? (
                      <div className="rounded-lg border">
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
                    ) : (
                      <div className="py-12 text-center text-muted-foreground text-sm border rounded-lg">No adjustments found.</div>
                    )}
                    
                    <div className="rounded-lg border p-4 bg-muted/10">
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
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter className="px-6 py-4 border-t bg-muted/10 shrink-0">
            <Button variant="outline" onClick={() => setUsageTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
