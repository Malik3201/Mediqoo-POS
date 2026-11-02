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
import { isBefore, isAfter, addDays, startOfMonth, endOfMonth, differenceInDays, startOfDay, format } from "date-fns";
import { RenewalVoucherModal } from "@/components/billing/RenewalVoucherModal";

export default function BillingPage() {
  const { data: licenses = [], isLoading: loadingLicenses, refetch: refetchLicenses } = useDataQuery("licenses", { populate: "clients,projects" });
  const { data: billingPeriods = [], isLoading: loadingPeriods, refetch: refetchPeriods } = useDataQuery("license_billing_periods");
  const { data: payments = [], isLoading: loadingPayments, refetch: refetchPayments } = useDataQuery("license_payments");

  const [paymentTarget, setPaymentTarget] = useState<any | null>(null);
  const [renewalPreview, setRenewalPreview] = useState<any | null>(null);
  const [renewalSuccess, setRenewalSuccess] = useState<any | null>(null);
  const [activeVoucherId, setActiveVoucherId] = useState<string | null>(null);
  const [activeVoucherDoc, setActiveVoucherDoc] = useState<any | null>(null);
  
  const [historyTarget, setHistoryTarget] = useState<any | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Renewal / Expiry extension state
  const [extensionMode, setExtensionMode] = useState<"quick" | "custom" | "lifetime">("quick");
  const [extensionMonths, setExtensionMonths] = useState<number>(1);
  const [customExpiryDate, setCustomExpiryDate] = useState<string>("");
  const [isLifetime, setIsLifetime] = useState<boolean>(false);

  const [paymentForm, setPaymentForm] = useState({
    amount_paid: 0,
    payment_method: "Bank Transfer",
    payment_reference: "",
    notes: "",
    override_renewal: false,
    override_reason: "",
    action: "payment_and_renew"
  });
  const [submitting, setSubmitting] = useState(false);

  // ── Usage Detail Dialog ──
  const [usageTarget, setUsageTarget] = useState<any | null>(null);
  const [usageData, setUsageData] = useState<any | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // ── Adjustments ──
  const [adjustmentForm, setAdjustmentForm] = useState({ type: "credit", amount: 0, reason: "" });
  const [adjustmentSubmitting, setAdjustmentSubmitting] = useState(false);
  const [defaultTab, setDefaultTab] = useState("usage");

  // Master Table Data: Combine License with its active Billing Period & Authoritative Expiry
  const activeBillingData = useMemo(() => {
    const now = Date.now();
    const today = startOfDay(new Date());

    return licenses.filter((l: any) => l.billing?.enabled).map((l: any) => {
      const periodsForLicense = billingPeriods.filter((bp: any) => bp.license_id === l.id);
      
      // Sort ASCENDING (oldest first)
      periodsForLicense.sort((a: any, b: any) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
      
      // Current period by TIME (period_start <= now < period_end)
      const currentPeriod = periodsForLicense.find((bp: any) => {
        const start = new Date(bp.period_start).getTime();
        const end = new Date(bp.period_end).getTime();
        return now >= start && now < end;
      }) || periodsForLicense.filter((bp: any) => new Date(bp.period_start).getTime() <= now).pop() || null;

      // Past+current periods (by TIME, not by status)
      const accruedPeriods = periodsForLicense.filter((bp: any) =>
        new Date(bp.period_start).getTime() <= now
      );
      
      // Use effective_status (derived from actual ledger) instead of stored status
      const unpaidPeriods = accruedPeriods.filter((bp: any) => {
        const es = bp.effective_status || bp.status;
        return es !== "paid" && es !== "waived" && es !== "no_activity";
      });

      const previousPeriodsExist = periodsForLicense.length > 1 || (periodsForLicense[0] && (periodsForLicense[0].status === "paid" || periodsForLicense[0].status === "waived"));

      const operationalStatus = deriveOperationalStatus(l);

      // Aggregate ALL accrued periods for accurate account-level display
      let totalUnpaidAmountDue = 0;
      let totalUnpaidUsageCharges = 0;
      let totalUnpaidInvoiceCount = 0;
      
      accruedPeriods.forEach((bp: any) => {
        totalUnpaidAmountDue += (bp.outstanding ?? Math.max(0, (bp.amount_due || 0) - (bp.amount_paid || 0)));
        totalUnpaidUsageCharges += (bp.usage_charges || 0);
        totalUnpaidInvoiceCount += (bp.invoice_count || 0);
      });

      const billingStatus = deriveBillingStatus(l, currentPeriod, previousPeriodsExist, totalUnpaidAmountDue);

      // Calculate calendar days difference from authoritative license.expires_at
      let expiryDaysDiff: number | null = null;
      let expiryLabel = "Lifetime / Never";
      if (l.expires_at) {
        const expiryDate = startOfDay(new Date(l.expires_at));
        expiryDaysDiff = differenceInDays(expiryDate, today);
        expiryLabel = format(new Date(l.expires_at), "dd/MM/yyyy");
      }

      return {
        license: l,
        currentPeriod,
        unpaidPeriods,
        operationalStatus,
        billingStatus,
        totalUnpaidAmountDue,
        totalUnpaidUsageCharges,
        totalUnpaidInvoiceCount,
        expiryDaysDiff,
        expiryLabel,
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
    let expiringSoonCount = 0;
    let expiredLicenseCount = 0;

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
      // Payment status counts
      if (item.billingStatus === "Due Soon" || item.billingStatus === "Due Today" || item.billingStatus === "Due Tomorrow") {
        dueSoonCount++;
      }
      if (item.billingStatus === "Overdue") {
        overdueCount++;
      }

      // Authoritative license expiry counts
      if (item.expiryDaysDiff !== null) {
        if (item.expiryDaysDiff < 0) {
          expiredLicenseCount++;
        } else if (item.expiryDaysDiff <= 7) {
          expiringSoonCount++;
        }
      }
    });

    // Collected: payments made this month
    payments.forEach((p: any) => {
      const paidAt = new Date(p.paid_at);
      if (paidAt >= monthStart && paidAt <= monthEnd) {
        collected += p.amount_paid;
      }
    });

    return { expected, collected, outstanding, dueSoonCount, overdueCount, expiringSoonCount, expiredLicenseCount };
  }, [billingPeriods, payments, activeBillingData]);

  // Separated Action Center Alerts
  const expiryAlerts = useMemo(() => {
    return activeBillingData
      .filter((item: any) => item.expiryDaysDiff !== null && item.expiryDaysDiff <= 7)
      .map((item: any) => {
        const days = item.expiryDaysDiff;
        let title = "";
        let desc = "";
        let isExpired = false;

        if (days < 0) {
          title = `${item.license.projects?.name || item.license.clients?.name} — License Expired`;
          desc = `Expired on ${item.expiryLabel}. Software access requires renewal.`;
          isExpired = true;
        } else if (days === 0) {
          title = `${item.license.projects?.name || item.license.clients?.name} — License Expires Today`;
          desc = `License expires today (${item.expiryLabel}).`;
          isExpired = true;
        } else if (days === 1) {
          title = `${item.license.projects?.name || item.license.clients?.name} — License Expires Tomorrow`;
          desc = `License expires tomorrow (${item.expiryLabel}).`;
        } else {
          title = `${item.license.projects?.name || item.license.clients?.name} — License Expires in ${days} Days`;
          desc = `License will expire on ${item.expiryLabel}.`;
        }

        return {
          item,
          title,
          desc,
          isExpired,
        };
      });
  }, [activeBillingData]);

  const paymentAlerts = useMemo(() => {
    return activeBillingData
      .filter((item: any) => {
        const hasDebt = (item.totalUnpaidAmountDue || 0) > 0;
        return hasDebt && (item.billingStatus === "Overdue" || item.billingStatus === "Due Today" || item.billingStatus === "Due Tomorrow");
      })
      .map((item: any) => {
        const isOverdue = item.billingStatus === "Overdue";
        const amountStr = `${item.license.billing?.currency || "PKR"} ${(item.totalUnpaidAmountDue || 0).toLocaleString()}`;
        let title = "";
        let desc = "";

        if (isOverdue) {
          title = `${item.license.projects?.name || item.license.clients?.name} — Payment Overdue`;
          desc = `${amountStr} payment is overdue.`;
        } else if (item.billingStatus === "Due Today") {
          title = `${item.license.projects?.name || item.license.clients?.name} — Payment Due Today`;
          desc = `${amountStr} is due today.`;
        } else {
          title = `${item.license.projects?.name || item.license.clients?.name} — Payment Due Tomorrow`;
          desc = `${amountStr} is due tomorrow.`;
        }

        return {
          item,
          title,
          desc,
          isOverdue,
        };
      });
  }, [activeBillingData]);

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
      if (statusFilter === "Current" && item.billingStatus === "Current") return true;
      if (statusFilter === "Due Soon" && (item.billingStatus === "Due Soon" || item.billingStatus === "Due Today" || item.billingStatus === "Due Tomorrow")) return true;
      if (statusFilter === "Overdue" && item.billingStatus === "Overdue") return true;
      if (statusFilter === "Grace" && item.operationalStatus === "Grace Period") return true;
      if (statusFilter === "Renewal Required" && item.operationalStatus === "Renewal Required") return true;

      return false;
    }).sort((a: any, b: any) => {
       // Sorting priority: Overdue > Renewal Required > Grace > Due Today > Due Soon > Current > Paid
       const priority = (s: string) => {
         if (s === "Overdue") return 0;
         if (s === "Renewal Required") return 1;
         if (s === "Grace Period") return 2;
         if (s === "Due Today") return 3;
         if (s === "Due Tomorrow") return 4;
         if (s === "Due Soon") return 5;
         if (s === "Current") return 6;
         return 7;
       };
       return priority(a.billingStatus) - priority(b.billingStatus) || priority(a.operationalStatus) - priority(b.operationalStatus);
    });
  }, [activeBillingData, statusFilter, searchFilter]);

  const loading = loadingLicenses || loadingPeriods || loadingPayments;

  const fetchPreview = useCallback(async (licenseId: string, months?: number, customDate?: string, lifetime?: boolean) => {
    try {
      const params = new URLSearchParams();
      if (lifetime) {
        params.set("is_lifetime", "true");
      } else if (customDate) {
        params.set("custom_expiry", customDate);
      } else if (months) {
        params.set("extension_months", months.toString());
      }

      const res = await fetch(`/api/admin/licenses/${licenseId}/renew/preview?${params.toString()}`);
      if (res.ok) {
        const preview = await res.json();
        setRenewalPreview(preview);
      }
    } catch (e) {
      console.error("Failed to load renewal preview", e);
    }
  }, []);

  async function openPayment(item: any, preferredAction?: string) {
    if (!item.currentPeriod) {
      toast.error("No active billing period found. Please ensure billing is fully configured.");
      return;
    }
    
    setPaymentTarget(item);
    setRenewalSuccess(null);
    setRenewalPreview(null);
    setExtensionMode("quick");
    const initialMonths = item.license.billing?.cycle === "yearly" ? 12 : 1;
    setExtensionMonths(initialMonths);
    setCustomExpiryDate("");
    setIsLifetime(false);

    const outstanding = item.totalUnpaidAmountDue || 0;
    const initialAction = preferredAction || (outstanding > 0 ? "payment_and_renew" : "extend_only");

    setPaymentForm({
      amount_paid: initialAction === "extend_only" ? 0 : outstanding,
      payment_method: "Bank Transfer",
      payment_reference: "",
      notes: "",
      override_renewal: false,
      override_reason: "",
      action: initialAction,
    });

    fetchPreview(item.license.id, initialMonths, "", false);
  }

  async function openHistory(item: any) {
    setUsageTarget(item);
    setHistoryTarget(item);
    setHistoryLoading(true);
    setUsageData(null);
    setUsageLoading(true);
    setDefaultTab("history");
    try {
      const res = await fetch(`/api/admin/licenses/${item.license.id}/payments`);
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data.items || []);
      }
      // Also fetch usage data in case user switches tabs
      const usageRes = await fetch(`/api/admin/licenses/${item.license.id}/usage`);
      if (usageRes.ok) {
        setUsageData(await usageRes.json());
      }
    } catch (e) {
      toast.error("Failed to load payment history");
    } finally {
      setHistoryLoading(false);
      setUsageLoading(false);
    }
  }

  async function recordPayment() {
    if (!paymentTarget || !paymentTarget.currentPeriod) return;
    setSubmitting(true);
    
    // Generate idempotency key for this payment/renewal attempt
    const idempotencyKey = `renew_${paymentTarget.license.id}_${Date.now()}`;
    
    try {
      const isExtendOnly = paymentForm.action === "extend_only";
      const isPaymentOnly = paymentForm.action === "payment_only";

      const url = isPaymentOnly 
        ? `/api/admin/licenses/${paymentTarget.license.id}/payments` 
        : `/api/admin/licenses/${paymentTarget.license.id}/renew`;

      const payload: any = {
        amount_paid: isExtendOnly ? 0 : paymentForm.amount_paid,
        payment_method: paymentForm.payment_method,
        payment_reference: paymentForm.payment_reference,
        idempotency_key: idempotencyKey,
        notes: paymentForm.notes,
        override_renewal: paymentForm.override_renewal,
        override_reason: paymentForm.override_reason,
        action: paymentForm.action
      };

      if (!isPaymentOnly) {
        payload.extension_months = extensionMode === "quick" ? extensionMonths : undefined;
        payload.custom_expiry = extensionMode === "custom" ? customExpiryDate : undefined;
        payload.is_lifetime = isLifetime;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to process request");
      }

      const data = await res.json();

      toast.success(
        isExtendOnly 
          ? "License expiry updated successfully!" 
          : "Payment recorded and license updated successfully!"
      );
      
      const [latestData] = await Promise.all([
        refetchLicenses(),
        refetchPeriods(),
        refetchPayments()
      ]);

      const updatedLicense = (latestData as any)?.find?.((l: any) => l.id === paymentTarget.license.id);
      const voucher = data.voucher || null;
      const payment = data.payment || null;

      setRenewalSuccess({
        ...paymentForm,
        previous_expiry: paymentTarget.license.expires_at,
        new_expiry: voucher?.new_expiry || updatedLicense?.expires_at || renewalPreview?.new_expiry,
        grace_until: updatedLicense?.grace_until || renewalPreview?.new_grace_until,
        invoice_number: voucher?.voucher_number || voucher?.invoice_number || payment?.receipt_number || "Generated",
        invoice_id: voucher?.id || payment?.id,
        voucher,
        status: voucher?.status || (isExtendOnly ? "unpaid" : "paid"),
        email_status: payment?.email_status || voucher?.email_status || "skipped"
      });
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
    setDefaultTab("usage");
    try {
      const res = await fetch(`/api/admin/licenses/${item.license.id}/usage`);
      if (res.ok) {
        setUsageData(await res.json());
      }
      // Also fetch payment history for the same license
      setHistoryLoading(true);
      const historyRes = await fetch(`/api/admin/licenses/${item.license.id}/payments`);
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistoryData(data.items || []);
      }
    } catch (e) {
      toast.error("Failed to load usage data");
    } finally {
      setUsageLoading(false);
      setHistoryLoading(false);
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
      {(expiryAlerts.length > 0 || paymentAlerts.length > 0) && (
        <div className="flex flex-col gap-2">
          {/* License Expiry Alerts */}
          {expiryAlerts.map(({ item, title, desc, isExpired }: any) => (
            <div key={`exp-${item.license.id}`} className={`flex items-center justify-between p-4 rounded-xl border shadow-sm ${
              isExpired ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
            }`}>
              <div className="flex items-center gap-3">
                <AlertCircle className={`h-5 w-5 ${isExpired ? "text-red-500" : "text-amber-500"}`} />
                <div>
                  <h4 className={`font-semibold ${isExpired ? "text-red-800" : "text-amber-800"}`}>
                    {title}
                  </h4>
                  <p className={`text-sm ${isExpired ? "text-red-600" : "text-amber-700"}`}>
                    {desc}
                  </p>
                </div>
              </div>
              <Button 
                size="sm" 
                onClick={() => openPayment(item, "extend_only")} 
                variant={isExpired ? "destructive" : "default"}
              >
                Manage License / Renew
              </Button>
            </div>
          ))}

          {/* Payment Due Alerts */}
          {paymentAlerts.map(({ item, title, desc, isOverdue }: any) => (
            <div key={`pay-${item.license.id}`} className={`flex items-center justify-between p-4 rounded-xl border shadow-sm ${
              isOverdue ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
            }`}>
              <div className="flex items-center gap-3">
                <CreditCard className={`h-5 w-5 ${isOverdue ? "text-red-500" : "text-amber-500"}`} />
                <div>
                  <h4 className={`font-semibold ${isOverdue ? "text-red-800" : "text-amber-800"}`}>
                    {title}
                  </h4>
                  <p className={`text-sm ${isOverdue ? "text-red-600" : "text-amber-700"}`}>
                    {desc}
                  </p>
                </div>
              </div>
              <Button 
                size="sm" 
                onClick={() => openPayment(item, "payment_and_renew")} 
                variant={isOverdue ? "destructive" : "default"}
              >
                Record Payment
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
            <SelectItem value="Current">Current / Accruing</SelectItem>
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
              <TableHead>License Expiry</TableHead>
              <TableHead>License Status</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  Loading billing data...
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
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
                    <span className="text-xs font-medium">
                      {item.expiryLabel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      item.operationalStatus === "Active" ? "default" :
                      item.operationalStatus === "Grace Period" ? "secondary" : "destructive"
                    } className={
                      item.operationalStatus === "Active" ? "bg-emerald-600 hover:bg-emerald-700 text-white text-xs" :
                      item.operationalStatus === "Grace Period" ? "bg-amber-500 hover:bg-amber-600 text-white text-xs" :
                      "bg-red-600 hover:bg-red-700 text-white text-xs"
                    }>
                      {item.operationalStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.license.billing?.enabled ? (
                      <Badge variant="outline" className={
                        item.billingStatus === "Paid" ? "border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px]" :
                        item.billingStatus === "Overdue" ? "border-red-300 text-red-700 bg-red-50 text-[10px]" :
                        item.billingStatus === "Due Tomorrow" || item.billingStatus === "Due Today" || item.billingStatus === "Due Soon" ? "border-amber-300 text-amber-700 bg-amber-50 text-[10px]" :
                        item.billingStatus === "Current" ? "border-blue-300 text-blue-700 bg-blue-50 text-[10px]" :
                        "text-[10px]"
                      }>
                        {item.billingStatus}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
                        variant={item.operationalStatus === "Renewal Required" || item.billingStatus === "Overdue" ? "destructive" : "default"}
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
            <DialogTitle className="text-lg font-semibold flex items-center justify-between">
              <span>Manage License — {paymentTarget?.license.clients?.name}</span>
              <Badge variant="outline" className="text-xs font-normal">
                {paymentTarget?.license.billing?.model === "per_invoice" ? "Per Invoice Model" : "Fixed Subscription"}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {renewalSuccess ? (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border p-5 bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      {renewalSuccess.action === "extend_only"
                        ? "License Expiry Extended — Official Voucher Generated"
                        : "Payment Recorded & License Renewal Voucher Generated"}
                    </h4>
                    <Badge variant="outline" className="uppercase text-[10px]">
                      {renewalSuccess.status === "paid"
                        ? "Paid"
                        : renewalSuccess.status === "partially_paid"
                        ? "Partially Paid"
                        : renewalSuccess.status === "payment_pending"
                        ? "Payment Pending"
                        : "Unpaid (Extension Only)"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 mt-3 text-xs">
                    <div className="text-muted-foreground">Voucher Number:</div>
                    <div className="font-mono font-bold text-primary">{renewalSuccess.invoice_number}</div>
                    
                    <div className="text-muted-foreground">Email Receipt:</div>
                    <div className="font-medium capitalize">
                      {renewalSuccess.email_status === "sent"
                        ? "Sent to Client"
                        : renewalSuccess.email_status === "skipped"
                        ? "No Payment Recorded (Voucher Ready)"
                        : "Pending / Queued"}
                    </div>
                    
                    <div className="text-muted-foreground">Previous Expiry:</div>
                    <div className="font-medium">{renewalSuccess.previous_expiry ? format(new Date(renewalSuccess.previous_expiry), "dd/MM/yyyy") : "Never"}</div>
                    
                    <div className="text-muted-foreground">New Expiry:</div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">{renewalSuccess.new_expiry ? format(new Date(renewalSuccess.new_expiry), "dd/MM/yyyy") : "Lifetime / Never"}</div>
                    
                    <div className="text-muted-foreground">Amount Paid:</div>
                    <div className="font-semibold">{paymentTarget?.license.billing?.currency || "PKR"} {Number(renewalSuccess.amount_paid || 0).toLocaleString()}</div>
                  </div>

                  {renewalSuccess.invoice_id && (
                    <div className="flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-emerald-200/70 dark:border-emerald-800/60">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                        onClick={() => {
                          setActiveVoucherDoc(renewalSuccess.voucher || null);
                          setActiveVoucherId(renewalSuccess.invoice_id);
                        }}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        View Official Voucher
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() =>
                          window.open(
                            `/api/admin/vouchers/${encodeURIComponent(renewalSuccess.invoice_id)}?format=pdf`,
                            "_blank"
                          )
                        }
                      >
                        ⬇ Download PDF
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* 1. Account Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded border bg-muted/20 p-4 text-sm">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">License Information</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span className="text-muted-foreground">Client:</span>
                      <span className="font-medium text-right">{paymentTarget?.license.clients?.name}</span>
                      <span className="text-muted-foreground">Project:</span>
                      <span className="font-medium text-right">{paymentTarget?.license.projects?.name}</span>
                      <span className="text-muted-foreground">Current Expiry:</span>
                      <span className="font-semibold text-right">
                        {paymentTarget?.license.expires_at ? format(new Date(paymentTarget.license.expires_at), "dd/MM/yyyy") : "Lifetime / Never"}
                      </span>
                      <span className="text-muted-foreground">License Status:</span>
                      <span className={`font-semibold text-right ${paymentTarget?.operationalStatus === "Active" ? "text-emerald-600" : "text-destructive"}`}>
                        {paymentTarget?.operationalStatus}
                      </span>
                    </div>
                  </div>

                  <div className="rounded border bg-muted/20 p-4 text-sm">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financial Status</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span className="text-muted-foreground">Billing Model:</span>
                      <span className="font-medium text-right">{paymentTarget?.license.billing?.model === "per_invoice" ? "Per Invoice" : "Fixed"}</span>
                      <span className="text-muted-foreground">Payment Status:</span>
                      <span className={`font-semibold text-right ${paymentTarget?.billingStatus === "Overdue" ? "text-red-600" : ""}`}>
                        {paymentTarget?.billingStatus}
                      </span>
                      <span className="text-muted-foreground font-semibold pt-1 border-t">Outstanding Balance:</span>
                      <span className={`font-bold text-right pt-1 border-t text-sm ${(paymentTarget?.totalUnpaidAmountDue || 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {paymentTarget?.license.billing?.currency || "PKR"} {(paymentTarget?.totalUnpaidAmountDue || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Action Selector */}
                <div className="grid gap-2">
                  <Label className="text-xs uppercase font-semibold text-muted-foreground tracking-wider">Select Operation</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant={paymentForm.action === "extend_only" ? "default" : "outline"}
                      className="justify-start text-xs h-auto py-2.5 px-3 flex flex-col items-start"
                      onClick={() => setPaymentForm(prev => ({ ...prev, action: "extend_only", amount_paid: 0 }))}
                    >
                      <span className="font-semibold">Extend License Only</span>
                      <span className="text-[10px] opacity-80">Update validity without payment</span>
                    </Button>
                    <Button
                      type="button"
                      variant={paymentForm.action === "payment_and_renew" ? "default" : "outline"}
                      className="justify-start text-xs h-auto py-2.5 px-3 flex flex-col items-start"
                      onClick={() => setPaymentForm(prev => ({ ...prev, action: "payment_and_renew", amount_paid: paymentTarget?.totalUnpaidAmountDue || 0 }))}
                    >
                      <span className="font-semibold">Record Payment &amp; Extend</span>
                      <span className="text-[10px] opacity-80">Settle balance &amp; extend expiry</span>
                    </Button>
                    <Button
                      type="button"
                      variant={paymentForm.action === "payment_only" ? "default" : "outline"}
                      disabled={(paymentTarget?.totalUnpaidAmountDue || 0) <= 0}
                      className="justify-start text-xs h-auto py-2.5 px-3 flex flex-col items-start"
                      onClick={() => setPaymentForm(prev => ({ ...prev, action: "payment_only", amount_paid: paymentTarget?.totalUnpaidAmountDue || 0 }))}
                    >
                      <span className="font-semibold">Record Payment Only</span>
                      <span className="text-[10px] opacity-80">Settle balance without date change</span>
                    </Button>
                  </div>
                </div>

                {/* 3. License Expiry Extension Section */}
                {paymentForm.action !== "payment_only" && (
                  <div className="rounded-xl border p-4 bg-muted/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="h-4 w-4" /> License Expiry Extension
                      </h4>
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={isLifetime}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setIsLifetime(val);
                            if (val) {
                              setExtensionMode("lifetime");
                              setCustomExpiryDate("");
                              fetchPreview(paymentTarget.license.id, undefined, "", true);
                            } else {
                              setExtensionMode("quick");
                              fetchPreview(paymentTarget.license.id, extensionMonths, "", false);
                            }
                          }}
                          className="rounded text-primary"
                        />
                        Lifetime / No Expiry
                      </label>
                    </div>

                    {!isLifetime && (
                      <div className="space-y-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Quick Extend</Label>
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: "+1 Month", months: 1 },
                              { label: "+3 Months", months: 3 },
                              { label: "+6 Months", months: 6 },
                              { label: "+1 Year", months: 12 },
                            ].map((opt) => (
                              <Button
                                key={opt.months}
                                type="button"
                                size="sm"
                                variant={extensionMode === "quick" && extensionMonths === opt.months ? "default" : "outline"}
                                className="text-xs"
                                onClick={() => {
                                  setExtensionMode("quick");
                                  setExtensionMonths(opt.months);
                                  setCustomExpiryDate("");
                                  fetchPreview(paymentTarget.license.id, opt.months, "", false);
                                }}
                              >
                                {opt.label}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Or Set Exact Custom Expiry Date</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="date"
                              value={customExpiryDate}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCustomExpiryDate(val);
                                if (val) {
                                  setExtensionMode("custom");
                                  fetchPreview(paymentTarget.license.id, undefined, val, false);
                                }
                              }}
                              className="text-xs h-9 max-w-xs"
                            />
                            {customExpiryDate && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-xs text-muted-foreground h-9"
                                onClick={() => {
                                  setCustomExpiryDate("");
                                  setExtensionMode("quick");
                                  fetchPreview(paymentTarget.license.id, extensionMonths, "", false);
                                }}
                              >
                                Reset to Quick Extend
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Preview box */}
                    <div className="rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 p-3 text-xs">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-muted-foreground">Extension Base Date:</div>
                          <div className="font-medium text-foreground">
                            {renewalPreview?.base_date ? format(new Date(renewalPreview.base_date), "dd/MM/yyyy") : "Today"}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {paymentTarget?.license.expires_at && isBefore(new Date(), new Date(paymentTarget.license.expires_at))
                              ? "(From current expiry)"
                              : "(From today)"}
                          </span>
                        </div>
                        <div>
                          <div className="text-muted-foreground font-semibold text-blue-800 dark:text-blue-300">New Authoritative Expiry:</div>
                          <div className="text-sm font-bold text-blue-700 dark:text-blue-400">
                            {isLifetime ? "Lifetime / Never" : renewalPreview?.new_expiry ? format(new Date(renewalPreview.new_expiry), "dd/MM/yyyy") : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Grace Until:</div>
                          <div className="font-medium text-foreground">
                            {isLifetime ? "N/A" : renewalPreview?.new_grace_until ? format(new Date(renewalPreview.new_grace_until), "dd/MM/yyyy") : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Payment Details Section */}
                {paymentForm.action !== "extend_only" && (
                  <div className="border-t border-border pt-4 space-y-4">
                    <h4 className="text-sm font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4" /> Payment Details
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>Amount Paid ({paymentTarget?.license.billing?.currency || "PKR"})</Label>
                        <Input
                          type="number"
                          value={paymentForm.amount_paid}
                          onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: Number(e.target.value) })}
                          min={0}
                          max={paymentTarget?.totalUnpaidAmountDue || undefined}
                        />
                        {paymentForm.amount_paid > (paymentTarget?.totalUnpaidAmountDue || 0) && (
                          <p className="text-xs text-destructive">Amount exceeds current outstanding.</p>
                        )}
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

                    {paymentForm.action === "payment_and_renew" && paymentForm.amount_paid < (paymentTarget?.totalUnpaidAmountDue || 0) && (
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
                )}
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
                    (paymentForm.action === "payment_only" && (paymentForm.amount_paid <= 0 || paymentForm.amount_paid > (paymentTarget?.totalUnpaidAmountDue || 0))) ||
                    (paymentForm.action === "payment_and_renew" && (paymentTarget?.totalUnpaidAmountDue || 0) > 0 && paymentForm.amount_paid < (paymentTarget?.totalUnpaidAmountDue || 0) && !paymentForm.override_renewal)
                  }
                >
                  {submitting 
                    ? "Processing..." 
                    : paymentForm.action === "extend_only" 
                    ? "Save License Changes" 
                    : paymentForm.action === "payment_and_renew" 
                    ? "Record Payment & Extend" 
                    : "Record Payment"}
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
            <Tabs defaultValue={defaultTab} key={defaultTab} className="w-full">
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
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setActiveVoucherDoc(null);
                                    setActiveVoucherId(h.voucher_id || h.id);
                                  }}
                                >
                                  View Voucher
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    window.open(
                                      `/api/admin/vouchers/${encodeURIComponent(h.voucher_id || h.id)}?format=pdf`,
                                      "_blank"
                                    )
                                  }
                                >
                                  PDF
                                </Button>
                                {h.amount_paid > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      fetch(`/api/admin/payments/${h.id}/resend`, { method: "POST" })
                                        .then(() => toast.success("Receipt queued for resend"))
                                        .catch(() => toast.error("Failed to resend receipt"));
                                    }}
                                  >
                                    Resend
                                  </Button>
                                )}
                              </div>
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

      <RenewalVoucherModal
        open={Boolean(activeVoucherId || activeVoucherDoc)}
        onClose={() => {
          setActiveVoucherId(null);
          setActiveVoucherDoc(null);
        }}
        voucherId={activeVoucherId}
        initialVoucher={activeVoucherDoc}
      />
    </div>
  );
}
