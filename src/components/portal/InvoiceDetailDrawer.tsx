"use client";

import React, { useEffect, useState } from "react";
import {
  X,
  Printer,
  FileText,
  User,
  Calendar,
  CreditCard,
  RotateCcw,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Receipt,
} from "lucide-react";

interface InvoiceDetailDrawerProps {
  invoiceId: string | null;
  onClose: () => void;
}

function formatPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
}

function formatDateTime(iso: string, timezone = "Asia/Karachi"): string {
  try {
    return new Date(iso).toLocaleString("en-PK", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function InvoiceDetailDrawer({ invoiceId, onClose }: InvoiceDetailDrawerProps) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/portal/sales/${encodeURIComponent(invoiceId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || "Failed to load invoice details");
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Error loading invoice");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (!invoiceId) return null;

  const inv = data?.invoice;
  const pharmacy = data?.pharmacy;

  const handlePrintInvoice = () => {
    if (!inv) return;
    const printWin = window.open("", "_blank", "width=850,height=900");
    if (!printWin) {
      window.print();
      return;
    }

    const itemsRowsHtml = (inv.items || [])
      .map(
        (item: any) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${
            item.index
          }</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600;color:#0f172a;">
            ${item.product_name}
            ${item.code ? `<div style="font-size:10px;color:#64748b;font-weight:400;">SKU: ${item.code}</div>` : ""}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;color:#334155;">${
            item.unit || "unit"
          }</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;color:#0f172a;font-weight:600;">${
            item.qty
          }</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;color:#334155;">${formatPKR(
            item.unit_price
          )}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;color:#64748b;">${
            item.discount_amt > 0 ? formatPKR(item.discount_amt) : "—"
          }</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-weight:700;color:#0f172a;">${formatPKR(
            item.line_total
          )}</td>
        </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${inv.invoice_number} - ${pharmacy?.name || "AivraSol Pharmacy"}</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { margin: 0; padding: 32px; color: #0f172a; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #009A4D; padding-bottom: 16px; margin-bottom: 20px; }
    .brand { font-size: 22px; font-weight: 800; color: #009A4D; margin: 0 0 4px 0; }
    .sub { font-size: 12px; color: #475569; margin: 2px 0; }
    .inv-badge { text-align: right; }
    .inv-title { font-size: 18px; font-weight: 800; color: #0f172a; margin: 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
    .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
    .meta-val { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f1f5f9; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; padding: 10px; text-align: left; border-bottom: 2px solid #cbd5e1; }
    .totals { margin-left: auto; width: 280px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; background: #f8fafc; }
    .tot-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #334155; }
    .tot-grand { border-top: 2px solid #cbd5e1; margin-top: 6px; padding-top: 8px; font-size: 15px; font-weight: 800; color: #009A4D; }
    .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 12px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand">${pharmacy?.name || "Pharmacy"}</h1>
      ${pharmacy?.address ? `<p class="sub">${pharmacy.address}</p>` : ""}
      ${pharmacy?.phone ? `<p class="sub">Phone: ${pharmacy.phone}</p>` : ""}
    </div>
    <div class="inv-badge">
      <p class="inv-title">SALES INVOICE</p>
      <p class="sub" style="font-weight:700;color:#0f172a;">#${inv.invoice_number}</p>
      <p class="sub">${formatDateTime(inv.occurred_at, pharmacy?.timezone)}</p>
    </div>
  </div>
  <div class="meta-grid">
    <div>
      <div class="meta-label">Customer</div>
      <div class="meta-val">${inv.customer_name || "Walk-in Customer"}</div>
      ${inv.customer_phone ? `<div class="sub">${inv.customer_phone}</div>` : ""}
    </div>
    <div>
      <div class="meta-label">Payment Method</div>
      <div class="meta-val" style="text-transform:uppercase;">${inv.payment_method}</div>
    </div>
    <div>
      <div class="meta-label">Cashier / Terminal</div>
      <div class="meta-val">${inv.cashier || "Cashier"} (T${inv.terminal_number || 1})</div>
    </div>
    <div>
      <div class="meta-label">Status</div>
      <div class="meta-val" style="text-transform:uppercase;color:#009A4D;">${inv.status.replace("_", " ")}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>Item Description</th>
        <th style="text-align:center;">Unit</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:right;">Rate</th>
        <th style="text-align:right;">Disc</th>
        <th style="text-align:right;">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${
        itemsRowsHtml ||
        `<tr><td colspan="7" style="padding:16px;text-align:center;color:#64748b;">Summary invoice record (detailed lines stored in POS archive)</td></tr>`
      }
    </tbody>
  </table>
  <div class="totals">
    <div class="tot-row"><span>Gross Subtotal</span><span>${formatPKR(inv.subtotal)}</span></div>
    ${inv.discount > 0 ? `<div class="tot-row"><span>Discount</span><span>- ${formatPKR(inv.discount)}</span></div>` : ""}
    ${inv.tax > 0 ? `<div class="tot-row"><span>Tax</span><span>+ ${formatPKR(inv.tax)}</span></div>` : ""}
    <div class="tot-row tot-grand"><span>Grand Total</span><span>${formatPKR(inv.grand_total)}</span></div>
    ${
      inv.returned_total > 0
        ? `<div class="tot-row" style="color:#dc2626;"><span>Returned Amount</span><span>- ${formatPKR(
            inv.returned_total
          )}</span></div>
           <div class="tot-row" style="font-weight:700;"><span>Net After Returns</span><span>${formatPKR(
             inv.net_effective_total
           )}</span></div>`
        : ""
    }
  </div>
  <div class="footer">
    <span>Generated from AivraSol Owner Portal</span>
    <span>Printed on ${new Date().toLocaleString("en-PK")}</span>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-[2px] animate-fadeIn">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-label="Close invoice detail drawer"
      />
      <div className="relative z-10 w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        {/* Top Drawer Bar */}
        <div className="px-5 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {inv ? `Invoice #${inv.invoice_number}` : "Invoice Details"}
                </h2>
                {inv && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
                      inv.status === "refunded"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : inv.status === "partially_returned"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    }`}
                  >
                    {inv.status.replace("_", " ")}
                  </span>
                )}
              </div>
              {inv && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDateTime(inv.occurred_at, pharmacy?.timezone)} · {pharmacy?.name}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {inv && (
              <button
                onClick={handlePrintInvoice}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                title="Print or Save Invoice as PDF"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print / PDF</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="space-y-4 py-8">
              <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
              <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
              <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
            </div>
          )}

          {error && !loading && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {inv && !loading && (
            <>
              {/* Metadata Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Customer</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1 truncate">
                    {inv.customer_name || "Walk-in Customer"}
                  </p>
                  {inv.customer_phone && (
                    <p className="text-xs text-slate-500 mt-0.5">{inv.customer_phone}</p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                    <span>Payment Method</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1 uppercase">
                    {inv.payment_method}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {inv.payment_method === "credit" ? "Khata Receivable" : "Settled at Counter"}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <Terminal className="w-3.5 h-3.5 text-slate-400" />
                    <span>Cashier & Counter</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1 truncate">
                    {inv.cashier || "Cashier"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Terminal #{inv.terminal_number || 1}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Net Bill Total</span>
                  </div>
                  <p className="text-base font-bold text-emerald-800 mt-1 tabular-nums">
                    {formatPKR(inv.grand_total)}
                  </p>
                  {inv.has_reliable_cogs && (
                    <p className="text-[11px] text-emerald-700 mt-0.5 tabular-nums">
                      Profit: {formatPKR(inv.gross_profit)}
                    </p>
                  )}
                </div>
              </div>

              {/* Line Items Section */}
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Sold Items ({inv.items?.length || 0})
                  </h3>
                  {inv.items_archived && (
                    <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Archived Line Details in Local POS
                    </span>
                  )}
                </div>

                {inv.items && inv.items.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {inv.items.map((item: any) => (
                      <div
                        key={`${item.product_id}-${item.index}`}
                        className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-400 w-5">
                              #{item.index}
                            </span>
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {item.product_name}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 mt-1 pl-7 text-xs text-slate-500 flex-wrap">
                            <span>
                              {item.qty} {item.unit || "unit"} × {formatPKR(item.unit_price)}
                            </span>
                            {item.discount_amt > 0 && (
                              <span className="text-amber-700 font-medium">
                                Disc: -{formatPKR(item.discount_amt)}
                              </span>
                            )}
                            {item.tax_amt > 0 && (
                              <span>Tax: +{formatPKR(item.tax_amt)}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatPKR(item.line_total)}
                          </p>
                          {inv.has_reliable_cogs && item.cogs > 0 && (
                            <p className="text-[11px] text-emerald-600 tabular-nums">
                              GP: {formatPKR(item.gross_profit)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500">
                    <FileText className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    {inv.items_archived
                      ? "This invoice is older than the 30-day cloud line-item retention window. Header financial totals are preserved above; full item lines remain stored in your local POS and .aivrabak backup."
                      : "No individual line items recorded for this invoice."}
                  </div>
                )}
              </div>

              {/* Financial Breakdown */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Gross Subtotal</span>
                  <span className="font-medium text-slate-900 tabular-nums">
                    {formatPKR(inv.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Total Discount</span>
                  <span className="font-medium text-amber-700 tabular-nums">
                    {inv.discount > 0 ? `- ${formatPKR(inv.discount)}` : "Rs 0"}
                  </span>
                </div>
                {inv.tax > 0 && (
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Tax</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      + {formatPKR(inv.tax)}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-900">Grand Total</span>
                  <span className="text-base font-extrabold text-emerald-700 tabular-nums">
                    {formatPKR(inv.grand_total)}
                  </span>
                </div>
                {inv.paid_amount > 0 && inv.payment_method !== "credit" && (
                  <div className="flex justify-between text-xs text-slate-500 pt-1">
                    <span>Tendered / Change</span>
                    <span className="tabular-nums">
                      Paid {formatPKR(inv.paid_amount)} · Change {formatPKR(inv.change_amount)}
                    </span>
                  </div>
                )}
                {inv.returned_total > 0 && (
                  <div className="pt-2 border-t border-red-200 space-y-1">
                    <div className="flex justify-between text-xs font-semibold text-red-600">
                      <span>Less: Linked Sales Returns</span>
                      <span className="tabular-nums">- {formatPKR(inv.returned_total)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-slate-900">
                      <span>Net Effective Sale</span>
                      <span className="tabular-nums">{formatPKR(inv.net_effective_total)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Linked Returns */}
              {inv.related_returns && inv.related_returns.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50/40 overflow-hidden">
                  <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-red-600" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-800">
                      Linked Sales Returns ({inv.related_returns.length})
                    </h4>
                  </div>
                  <div className="divide-y divide-red-100">
                    {inv.related_returns.map((ret: any) => (
                      <div key={ret.id} className="p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-red-900">
                              Return #{ret.return_number}
                            </span>
                            <span className="text-xs text-red-600 ml-2">
                              {formatDateTime(ret.occurred_at, pharmacy?.timezone)}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-red-700 tabular-nums">
                            - {formatPKR(ret.return_amount)} ({ret.refund_method.toUpperCase()})
                          </span>
                        </div>
                        {ret.reason && (
                          <p className="text-xs text-red-700">Reason: {ret.reason}</p>
                        )}
                        {ret.items && ret.items.length > 0 && (
                          <div className="text-xs text-slate-600 space-y-1 pl-2 border-l-2 border-red-200">
                            {ret.items.map((ri: any, idx: number) => (
                              <div key={idx} className="flex justify-between">
                                <span>
                                  {ri.product_name} × {ri.qty}
                                </span>
                                <span className="tabular-nums">{formatPKR(ri.line_total)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

