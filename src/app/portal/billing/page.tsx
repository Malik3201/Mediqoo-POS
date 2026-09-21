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

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
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
                        <span className="text-muted-foreground">Payments:</span>
                        <span className="text-right text-green-600">-{item.license.billing?.currency} {item.payment_amount || 0}</span>
                        <span className="font-medium pt-1 border-t mt-1">Outstanding:</span>
                        <span className={`font-medium text-right pt-1 border-t mt-1 ${item.totalOutstanding > 0 ? "text-destructive" : ""}`}>
                          {item.license.billing?.currency} {item.totalOutstanding}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm flex flex-col gap-1">
                        <span className="text-muted-foreground">Unpaid Periods: {item.unpaidPeriods.length}</span>
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
      
      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
        <h4 className="font-semibold flex items-center gap-2 mb-1"><CreditCard className="w-4 h-4" /> Payments</h4>
        <p>To make a payment or renew your subscription, please contact your account manager or refer to your latest invoice instructions.</p>
      </div>
    </div>
  );
}
