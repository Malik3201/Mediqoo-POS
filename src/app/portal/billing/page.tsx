"use client";

import { useEffect, useState } from "react";
import { CreditCard, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function PortalBillingPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/portal/billing")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setData(res.items);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Billing & Subscriptions</h1>
        <p className="text-muted-foreground mt-1">
          Manage your software licenses, view billing cycles, and track usage.
        </p>
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Billing Model</TableHead>
              <TableHead>Expiry / Status</TableHead>
              <TableHead>Current Ledger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading billing data...</TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No active subscriptions found.</TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.license.id}>
                  <TableCell className="font-medium">
                    {item.project?.name || "Unknown"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="capitalize">{item.license.billing?.model === "per_invoice" ? "Per Invoice" : item.license.billing?.cycle}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.license.billing?.currency} {item.license.billing?.amount}
                        {item.license.billing?.model === "per_invoice" ? " / invoice" : " / period"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <span className="text-sm">
                        {item.license.expires_at ? new Date(item.license.expires_at).toLocaleDateString() : "Never"}
                      </span>
                      <Badge variant={
                        item.operationalStatus === "Active" ? "default" :
                        item.operationalStatus === "Grace Period" ? "secondary" : "destructive"
                      }>
                        {item.operationalStatus}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.license.billing?.model === "per_invoice" ? (
                      <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
                        <span className="text-muted-foreground">Metered Usage:</span>
                        <span className="text-right">{item.invoice_count || 0} invoices</span>
                        <span className="text-muted-foreground">Total Charges:</span>
                        <span className="text-right">{item.license.billing?.currency} {item.usage_amount || 0}</span>
                        {item.payment_amount > 0 && (
                          <>
                            <span className="text-muted-foreground">Payments (Partial):</span>
                            <span className="text-right text-green-600">-{item.license.billing?.currency} {item.payment_amount || 0}</span>
                          </>
                        )}
                        <span className="font-medium pt-1 border-t mt-1">Outstanding:</span>
                        <span className={`font-medium text-right pt-1 border-t mt-1 ${item.totalOutstanding > 0 ? "text-destructive" : ""}`}>
                          {item.license.billing?.currency} {item.totalOutstanding}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm flex flex-col gap-1">
                        <span className="text-muted-foreground">Unpaid Periods: {item.unpaidPeriods?.length || 0}</span>
                        <span className={`font-medium ${item.totalOutstanding > 0 ? "text-destructive" : ""}`}>
                          Outstanding: {item.license.billing?.currency} {item.totalOutstanding}
                        </span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {!loading && data.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4 text-slate-800">Payment History</h3>
          <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.flatMap(d => (d.paymentHistory || []).map((p: any) => ({ ...p, projectName: d.project?.name }))).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payment history found.</TableCell>
                  </TableRow>
                ) : (
                  data.flatMap(d => (d.paymentHistory || []).map((p: any) => ({ ...p, projectName: d.project?.name }))).sort((a: any, b: any) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.projectName || "Unknown"}</TableCell>
                      <TableCell>{new Date(p.paid_at).toLocaleDateString()}</TableCell>
                      <TableCell>{p.receipt_number || "N/A"}</TableCell>
                      <TableCell>{p.payment_method}</TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {p.currency} {p.amount_paid}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 mt-6">
        <h4 className="font-semibold flex items-center gap-2 mb-1"><CreditCard className="w-4 h-4" /> Payments</h4>
        <p>To make a payment or renew your subscription, please contact your account manager or refer to your latest invoice instructions.</p>
      </div>
    </div>
  );
}
