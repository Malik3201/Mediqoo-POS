"use client";

import { useEffect, useState } from "react";
import { CreditCard, Receipt, ShieldCheck, Calendar, CheckCircle2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PortalPageHeader,
  PortalKpiCard,
  PortalSectionCard,
  PortalStatusBadge,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

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

  const allPayments = data
    .flatMap((d) =>
      (d.paymentHistory || []).map((p: any) => ({ ...p, projectName: d.project?.name }))
    )
    .sort((a: any, b: any) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  const totalOutstandingSum = data.reduce(
    (sum, item) => sum + Number(item.totalOutstanding || 0),
    0
  );
  const currencyLabel = data[0]?.license?.billing?.currency || "PKR";

  const statusTone = (status: string): "emerald" | "amber" | "rose" =>
    status === "Active" ? "emerald" : status === "Grace Period" ? "amber" : "rose";

  return (
    <div className="space-y-4 sm:space-y-5 max-w-6xl animate-portal-in">
      <PortalPageHeader
        icon={<CreditCard className="w-5 h-5" />}
        title="Billing & Subscriptions"
        subtitle="Manage your AivraSol software licenses, billing cycles, metered usage, and payment history."
      />

      {/* Executive Billing KPIs */}
      {!loading && data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <PortalKpiCard
            label="Active Subscriptions"
            value={String(data.length)}
            subtext="Licensed pharmacy terminals"
            icon={<ShieldCheck className="w-4 h-4" />}
            tone="emerald"
          />
          <PortalKpiCard
            label="Total Outstanding Due"
            value={`${currencyLabel} ${totalOutstandingSum.toLocaleString()}`}
            subtext={totalOutstandingSum > 0 ? "Pending settlement" : "All cycles settled"}
            icon={<CreditCard className="w-4 h-4" />}
            tone={totalOutstandingSum > 0 ? "rose" : "default"}
          />
          <PortalKpiCard
            label="Recorded Payments"
            value={String(allPayments.length)}
            subtext="Verified license receipts"
            icon={<Receipt className="w-4 h-4" />}
            tone="indigo"
          />
        </div>
      )}

      {/* Subscriptions & License Ledger */}
      <PortalSectionCard
        title="Software Licenses & Current Ledger"
        subtitle="Per-invoice metered billing and fixed renewal cycles"
        icon={<ShieldCheck className="w-4 h-4" />}
      >
        {loading ? (
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <PortalEmptyState
            icon={<CreditCard className="w-6 h-6" />}
            title="No Active Subscriptions Found"
            description="Your pharmacy software license details will appear here once provisioned."
          />
        ) : (
          <>
            {/* Mobile Subscription Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.map((item) => (
                <div key={item.license.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">
                        {item.project?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 capitalize">
                        {item.license.billing?.model === "per_invoice"
                          ? "Per Invoice"
                          : item.license.billing?.cycle}{" "}
                        · {item.license.billing?.currency} {item.license.billing?.amount}
                        {item.license.billing?.model === "per_invoice"
                          ? " / invoice"
                          : " / period"}
                      </p>
                    </div>
                    <PortalStatusBadge tone={statusTone(item.operationalStatus)} dot>
                      {item.operationalStatus}
                    </PortalStatusBadge>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Expires:{" "}
                      <strong className="text-slate-700">
                        {item.license.expires_at
                          ? new Date(item.license.expires_at).toLocaleDateString()
                          : "Never"}
                      </strong>
                    </span>
                  </div>

                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 p-3 text-xs space-y-1.5">
                    {item.license.billing?.model === "per_invoice" ? (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>Metered Usage:</span>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {item.invoice_count || 0} invoices
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Total Charges:</span>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {item.license.billing?.currency} {item.usage_amount || 0}
                          </span>
                        </div>
                        {item.payment_amount > 0 && (
                          <div className="flex justify-between text-emerald-700">
                            <span>Payments (Partial):</span>
                            <span className="font-bold tabular-nums">
                              -{item.license.billing?.currency} {item.payment_amount || 0}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between pt-1.5 border-t border-slate-200 font-extrabold text-slate-900">
                          <span>Outstanding:</span>
                          <span
                            className={`tabular-nums ${
                              item.totalOutstanding > 0 ? "text-rose-600" : "text-emerald-700"
                            }`}
                          >
                            {item.license.billing?.currency} {item.totalOutstanding}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>Unpaid Periods:</span>
                          <span className="font-bold text-slate-900">
                            {item.unpaidPeriods?.length || 0}
                          </span>
                        </div>
                        <div className="flex justify-between pt-1.5 border-t border-slate-200 font-extrabold text-slate-900">
                          <span>Outstanding:</span>
                          <span
                            className={`tabular-nums ${
                              item.totalOutstanding > 0 ? "text-rose-600" : "text-emerald-700"
                            }`}
                          >
                            {item.license.billing?.currency} {item.totalOutstanding}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop License Table */}
            <div className="hidden md:block overflow-x-auto portal-scroll">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/90">
                    <TableHead>Project</TableHead>
                    <TableHead>Billing Model</TableHead>
                    <TableHead>Expiry / Status</TableHead>
                    <TableHead>Current Ledger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item) => (
                    <TableRow key={item.license.id}>
                      <TableCell className="font-bold text-slate-900">
                        {item.project?.name || "Unknown"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="capitalize font-semibold text-slate-800">
                            {item.license.billing?.model === "per_invoice"
                              ? "Per Invoice"
                              : item.license.billing?.cycle}
                          </span>
                          <span className="text-xs text-slate-500">
                            {item.license.billing?.currency} {item.license.billing?.amount}
                            {item.license.billing?.model === "per_invoice"
                              ? " / invoice"
                              : " / period"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5 items-start">
                          <span className="text-xs font-medium text-slate-700">
                            {item.license.expires_at
                              ? new Date(item.license.expires_at).toLocaleDateString()
                              : "Never"}
                          </span>
                          <PortalStatusBadge tone={statusTone(item.operationalStatus)} dot>
                            {item.operationalStatus}
                          </PortalStatusBadge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.license.billing?.model === "per_invoice" ? (
                          <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1 max-w-xs">
                            <span className="text-slate-500">Metered Usage:</span>
                            <span className="text-right font-semibold tabular-nums">
                              {item.invoice_count || 0} invoices
                            </span>
                            <span className="text-slate-500">Total Charges:</span>
                            <span className="text-right font-semibold tabular-nums">
                              {item.license.billing?.currency} {item.usage_amount || 0}
                            </span>
                            {item.payment_amount > 0 && (
                              <>
                                <span className="text-slate-500">Payments (Partial):</span>
                                <span className="text-right font-semibold text-emerald-700 tabular-nums">
                                  -{item.license.billing?.currency} {item.payment_amount || 0}
                                </span>
                              </>
                            )}
                            <span className="font-bold pt-1 border-t mt-1">Outstanding:</span>
                            <span
                              className={`font-extrabold text-right pt-1 border-t mt-1 tabular-nums ${
                                item.totalOutstanding > 0 ? "text-rose-600" : "text-emerald-700"
                              }`}
                            >
                              {item.license.billing?.currency} {item.totalOutstanding}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs flex flex-col gap-1">
                            <span className="text-slate-500">
                              Unpaid Periods: {item.unpaidPeriods?.length || 0}
                            </span>
                            <span
                              className={`font-extrabold tabular-nums ${
                                item.totalOutstanding > 0 ? "text-rose-600" : "text-emerald-700"
                              }`}
                            >
                              Outstanding: {item.license.billing?.currency} {item.totalOutstanding}
                            </span>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </PortalSectionCard>

      {/* Payment History */}
      {!loading && data.length > 0 && (
        <PortalSectionCard
          title="Payment History"
          subtitle="Verified subscription and usage settlement receipts"
          icon={<Receipt className="w-4 h-4" />}
        >
          {allPayments.length === 0 ? (
            <PortalEmptyState
              icon={<Receipt className="w-6 h-6" />}
              title="No Payment History Found"
              description="Settled license invoices and payment receipts will appear here."
            />
          ) : (
            <>
              {/* Mobile Payment History Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {allPayments.map((p: any) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {p.projectName || "Unknown"}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
                        <span>{new Date(p.paid_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="font-mono">{p.receipt_number || "N/A"}</span>
                        <span>•</span>
                        <span className="capitalize">{p.payment_method}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-extrabold text-emerald-700 tabular-nums">
                        {p.currency} {p.amount_paid}
                      </span>
                      <span className="flex items-center justify-end gap-0.5 text-[10px] text-emerald-600 font-semibold mt-0.5">
                        <CheckCircle2 className="w-3 h-3" /> Paid
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Payment History Table */}
              <div className="hidden md:block overflow-x-auto portal-scroll">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/90">
                      <TableHead>Project</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allPayments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-bold text-slate-900">
                          {p.projectName || "Unknown"}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {new Date(p.paid_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">
                          {p.receipt_number || "N/A"}
                        </TableCell>
                        <TableCell className="capitalize text-slate-700">
                          {p.payment_method}
                        </TableCell>
                        <TableCell className="text-right font-extrabold text-emerald-700 tabular-nums">
                          {p.currency} {p.amount_paid}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </PortalSectionCard>
      )}

      <div className="bg-sky-50/80 border border-sky-200/80 rounded-2xl p-4 text-xs sm:text-sm text-sky-900 flex items-start gap-3">
        <CreditCard className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-extrabold text-sky-950 mb-0.5">Subscription &amp; Renewal Payments</h4>
          <p className="text-sky-800 leading-relaxed">
            To make a payment or renew your subscription, please contact your AivraSol account manager or refer to your latest invoice instructions.
          </p>
        </div>
      </div>
    </div>
  );
}
