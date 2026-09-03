"use client";

import { useMemo, useState } from "react";
import { CreditCard, DollarSign, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery } from "@/hooks/use-data";
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
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);

  // Derived KPIs
  const kpis = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    let expected = 0;
    let collected = 0;
    let outstanding = 0;
    let dueSoonCount = 0;

    // Expected: periods due this month
    billingPeriods.forEach((bp: any) => {
      const due = new Date(bp.due_at);
      if (due >= monthStart && due <= monthEnd) {
        expected += bp.amount_due;
      }
      if (bp.status === "unpaid" || bp.status === "partially_paid") {
        outstanding += (bp.amount_due - (bp.amount_paid || 0));
        
        // Due soon if unpaid and due date is within 7 days
        if (due >= now && due <= addDays(now, 7)) {
          dueSoonCount++;
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

    return { expected, collected, outstanding, dueSoonCount };
  }, [billingPeriods, payments]);

  // Master Table Data: Combine License with its active Billing Period
  const activeBillingData = useMemo(() => {
    return licenses.filter((l: any) => l.billing?.enabled).map((l: any) => {
      // Find the most recent/relevant unpaid billing period, or the latest paid one
      const periodsForLicense = billingPeriods.filter((bp: any) => bp.license_id === l.id);
      periodsForLicense.sort((a: any, b: any) => new Date(b.due_at).getTime() - new Date(a.due_at).getTime());
      
      const currentPeriod = periodsForLicense.find((bp: any) => bp.status !== "paid" && bp.status !== "waived") 
        || periodsForLicense[0] || null;

      return {
        license: l,
        currentPeriod
      };
    });
  }, [licenses, billingPeriods]);

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
      amount_paid: item.currentPeriod.amount_due - (item.currentPeriod.amount_paid || 0),
      payment_method: "Bank Transfer",
      payment_reference: "",
      notes: ""
    });

    try {
      const res = await fetch(`/api/admin/licenses/${item.license.id}/renew/preview`);
      if (res.ok) {
        const preview = await res.json();
        setRenewalPreview(preview);
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
      const res = await fetch(`/api/admin/licenses/${paymentTarget.license.id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billing_period_id: paymentTarget.currentPeriod.id,
          amount_paid: paymentForm.amount_paid,
          payment_method: paymentForm.payment_method,
          payment_reference: paymentForm.payment_reference,
          idempotency_key: idempotencyKey,
          notes: paymentForm.notes
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to record payment");
      }

      toast.success("Payment recorded and license renewed successfully!");
      
      // Update local state without full reload
      refetchLicenses().then((latestData: any) => {
        const updatedLicense = latestData?.find((l: any) => l.id === paymentTarget.license.id);
        if (updatedLicense) {
          setRenewalSuccess({
            ...paymentForm,
            previous_expiry: paymentTarget.license.expires_at,
            new_expiry: updatedLicense.expires_at,
            grace_until: updatedLicense.grace_until,
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

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Cycle</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead className="w-[140px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Loading billing data...
                </TableCell>
              </TableRow>
            ) : activeBillingData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No licenses have billing enabled.
                </TableCell>
              </TableRow>
            ) : (
              activeBillingData.map((item: any) => (
                <TableRow key={item.license.id}>
                  <TableCell className="font-medium">{item.license.projects?.name}</TableCell>
                  <TableCell>{item.license.clients?.name}</TableCell>
                  <TableCell className="capitalize">{item.license.billing?.cycle}</TableCell>
                  <TableCell>{item.license.billing?.currency} {item.license.billing?.amount}</TableCell>
                  <TableCell>
                    {item.license.expires_at ? new Date(item.license.expires_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    {item.currentPeriod ? (
                      <Badge variant={
                        item.currentPeriod.status === "paid" ? "default" :
                        item.currentPeriod.status === "overdue" ? "destructive" :
                        item.currentPeriod.status === "partially_paid" ? "secondary" : "outline"
                      }>
                        {item.currentPeriod.status.replace("_", " ")}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No period generated</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
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
                        disabled={!item.currentPeriod || item.currentPeriod.status === "paid"}
                      >
                        Record Payment & Renew
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
                    <div className="text-muted-foreground">Previous Expiry:</div>
                    <div className="font-medium">{renewalSuccess.previous_expiry ? new Date(renewalSuccess.previous_expiry).toLocaleDateString() : "Never"}</div>
                    
                    <div className="text-muted-foreground">New Expiry:</div>
                    <div className="font-medium text-primary">{new Date(renewalSuccess.new_expiry).toLocaleDateString()}</div>
                    
                    <div className="text-muted-foreground">Grace Until:</div>
                    <div className="font-medium">{new Date(renewalSuccess.grace_until).toLocaleDateString()}</div>
                    
                    <div className="text-muted-foreground">Amount Paid:</div>
                    <div className="font-medium">{paymentTarget?.license.billing?.currency} {renewalSuccess.amount_paid}</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Recording this payment will settle the selected billing period and automatically extend the license expiry.
                </p>
                
                {renewalPreview && (
                  <div className="rounded border bg-muted/50 p-3 text-sm">
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
                <Button onClick={recordPayment} disabled={submitting}>
                  {submitting ? "Processing..." : "Confirm Payment"}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : historyData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No payments found.</TableCell>
                  </TableRow>
                ) : (
                  historyData.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.created_at).toLocaleString()}</TableCell>
                      <TableCell>{p.currency} {p.amount_paid}</TableCell>
                      <TableCell>{p.payment_method}</TableCell>
                      <TableCell>{p.payment_reference || "—"}</TableCell>
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
    </div>
  );
}
