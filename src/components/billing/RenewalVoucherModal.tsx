"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  Download,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Building2,
  KeyRound,
  CreditCard,
  X,
} from "lucide-react";

interface RenewalVoucherModalProps {
  open: boolean;
  onClose: () => void;
  voucherId?: string | null;
  initialVoucher?: any | null;
}

// Handwritten cursive fountain-pen vector paths representing the signature of Abdulrehman
export const ABDULREHMAN_SIGNATURE_PATHS = {
  mainStroke:
    "M 16 44 C 21 20, 31 6, 38 8 C 44 10, 39 34, 34 44 C 33 46, 42 26, 49 23 C 54 21, 52 36, 57 36 C 62 36, 67 11, 63 9 C 59 7, 56 35, 64 36 C 70 37, 75 23, 72 21 C 68 19, 67 35, 74 36 C 79 36, 82 26, 85 35 C 88 36, 94 11, 90 9 C 86 7, 84 35, 92 36 C 96 25, 102 24, 105 34 C 108 35, 114 24, 110 22 C 106 20, 105 35, 113 35 C 118 35, 124 10, 120 8 C 116 6, 115 35, 121 35 C 125 25, 129 25, 132 35 C 135 25, 140 25, 143 34 C 146 25, 151 25, 154 34 C 158 35, 164 24, 160 22 C 156 20, 155 35, 163 35 C 168 25, 173 25, 177 34 C 181 25, 187 26, 192 35 C 197 37, 206 31, 214 22",
  crossAndFlourish:
    "M 12 27 C 46 22, 92 19, 134 17 M 22 49 C 72 41, 146 38, 208 41 C 216 42, 188 49, 154 52",
  dots: "M 172 54 L 175 54 M 183 53 L 186 53",
};

function fmtDate(d: any): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtDateTime(d: any): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtMoney(currency: string, val: any): string {
  const n = Number(val || 0);
  return `${currency || "PKR"} ${n.toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function getStatusBadgeInfo(status?: string) {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        className:
          "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300",
        printBg: "#DCFCE7",
        printFg: "#15803D",
      };
    case "partially_paid":
      return {
        label: "Partially Paid",
        className:
          "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
        printBg: "#FEF3C7",
        printFg: "#B45309",
      };
    case "payment_pending":
      return {
        label: "Payment Pending",
        className:
          "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300",
        printBg: "#FEE2E2",
        printFg: "#B91C1C",
      };
    case "unpaid":
    default:
      return {
        label: "Unpaid (Extension Only)",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300",
        printBg: "#F1F5F9",
        printFg: "#475569",
      };
  }
}

export function RenewalVoucherModal({
  open,
  onClose,
  voucherId,
  initialVoucher,
}: RenewalVoucherModalProps) {
  const [voucher, setVoucher] = useState<any | null>(initialVoucher || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialVoucher) {
      setVoucher(initialVoucher);
      setError(null);
      return;
    }
    if (!voucherId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/vouchers/${encodeURIComponent(voucherId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load voucher");
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setVoucher(data.voucher);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Error loading voucher");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, voucherId, initialVoucher]);

  const handleDownloadPdf = () => {
    if (!voucher) return;
    const id = voucher.id || voucher.voucher_number || voucher.invoice_number;
    window.open(
      `/api/admin/vouchers/${encodeURIComponent(id)}?format=pdf`,
      "_blank"
    );
  };

  const handlePrint = () => {
    if (!voucher) return;
    const currency =
      voucher.financial_snapshot?.currency || voucher.currency || "PKR";
    const lic = voucher.license_snapshot || {};
    const per = voucher.period_snapshot || {};
    const fin = voucher.financial_snapshot || {};
    const pay = voucher.payment_snapshot || {};
    const st = getStatusBadgeInfo(voucher.status);
    const voucherNo =
      voucher.voucher_number || voucher.invoice_number || voucher.id;

    const printWindow = window.open("", "_blank", "width=900,height=950");
    if (!printWindow) return;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>AivraSol Voucher - ${voucherNo}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { margin: 0; padding: 0; color: #0f172a; background: #fff; font-size: 12px; line-height: 1.45; }
    .voucher-sheet { position: relative; overflow: hidden; max-width: 780px; margin: 0 auto; border: 1px solid #e2e8f0; border-top: 6px solid #009A4D; border-radius: 8px; padding: 24px 28px; background: #fff; }
    .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
    .watermark img { width: 660px; max-width: 96%; height: auto; opacity: 0.12; object-fit: contain; }
    .content-layer { position: relative; z-index: 1; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 16px; }
    .doc-title { font-size: 15px; font-weight: 700; color: #0f172a; text-align: right; }
    .doc-sub { font-size: 11px; color: #64748b; text-align: right; margin-top: 2px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; background: ${st.printBg}; color: ${st.printFg}; margin-top: 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
    .box { background: rgba(248, 250, 252, 0.25); border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
    .box-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #009A4D; margin-bottom: 6px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #0f172a; margin: 16px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; background: rgba(255, 255, 255, 0.2); }
    .kv-row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0; }
    .kv-key { color: #475569; }
    .kv-val { font-weight: 600; color: #0f172a; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    th { background: rgba(241, 245, 249, 0.45); color: #0f172a; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #009A4D; text-align: left; padding: 8px 12px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    th.right, td.right { text-align: right; }
    td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; background: transparent; }
    tr.total-row td { background: rgba(248, 250, 252, 0.35); font-weight: 700; }
    tr.paid-row td { background: rgba(236, 253, 245, 0.38); color: #009A4D; font-weight: 700; }
    tr.balance-row td { font-weight: 700; }
    .sig-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; padding-top: 10px; }
    .sig-box { text-align: center; min-width: 220px; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 4px; font-size: 10.5px; font-weight: 700; color: #0f172a; }
    .sig-sub { font-size: 9.5px; color: #009A4D; font-weight: 600; }
    .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #64748b; }
    .disclaimer { margin-top: 6px; font-size: 9.5px; color: #64748b; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 5px; padding: 6px 10px; }
  </style>
</head>
<body>
  <div class="voucher-sheet">
    <div class="watermark">
      <img src="/logo-aivrasol-voucher.png" alt="" />
    </div>
    <div class="content-layer">
      <div class="header">
        <div style="display: flex; align-items: center; background: #ffffff;">
          <img src="/logo-aivrasol-voucher.png" alt="AivraSol" style="height: 96px; width: auto; object-fit: contain; margin: -12px 0 -12px -14px; background: #ffffff;" />
        </div>
        <div style="text-align: right;">
          <div class="doc-title">AivraSol Subscription &amp; License Renewal Voucher</div>
          <div class="doc-sub">Official Payment &amp; License Extension Confirmation</div>
          <div style="margin-top: 6px; font-size: 12px;"><strong>Voucher #:</strong> ${voucherNo}</div>
          <div style="font-size: 11px; color: #64748b;">Issued: ${fmtDateTime(voucher.issued_at)}</div>
          <div class="badge">${st.label}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="box">
          <div class="box-label">Issued By (Provider)</div>
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${voucher.seller_snapshot?.name || "AivraSol Technologies (Mediqoo Cloud)"}</div>
          <div>Support: ${voucher.seller_snapshot?.email || "support@aivrasol.com"}</div>
          <div>Website: ${voucher.seller_snapshot?.website || "www.aivrasol.com"}</div>
          <div>Location: ${voucher.seller_snapshot?.address || "Pakistan"}</div>
        </div>
        <div class="box">
          <div class="box-label">Pharmacy / License Holder</div>
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${voucher.client_snapshot?.name || "Pharmacy Client"}</div>
          <div>Contact: ${voucher.client_snapshot?.contact_name || "—"}</div>
          <div>Phone / Email: ${[voucher.client_snapshot?.phone, voucher.client_snapshot?.email].filter(Boolean).join(" • ") || "—"}</div>
          <div>Address: ${voucher.client_snapshot?.address || "—"}</div>
          <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">Tenant Ref: ${voucher.client_snapshot?.id || voucher.client_id}</div>
        </div>
      </div>

      <div class="section-title">Subscription &amp; License Details</div>
      <div class="kv-grid">
        <div class="kv-row"><span class="kv-key">Product:</span><span class="kv-val">${lic.product_name || "AivraSol Pharmacy POS"}</span></div>
        <div class="kv-row"><span class="kv-key">Previous Expiry:</span><span class="kv-val">${per.previous_expiry ? fmtDate(per.previous_expiry) : "Initial / None"}</span></div>
        <div class="kv-row"><span class="kv-key">License Key:</span><span class="kv-val" style="font-family: monospace;">${lic.license_key_masked || lic.license_key || "—"}</span></div>
        <div class="kv-row"><span class="kv-key">New Authoritative Expiry:</span><span class="kv-val" style="color: #009A4D;">${per.is_lifetime ? "Lifetime / Never" : fmtDate(per.new_expiry || voucher.new_expiry)}</span></div>
        <div class="kv-row"><span class="kv-key">Plan / Billing Model:</span><span class="kv-val">${lic.plan_label || (lic.billing_model === "per_invoice" ? "Pay Per Invoice" : "Fixed Subscription")}</span></div>
        <div class="kv-row"><span class="kv-key">Renewal Period:</span><span class="kv-val">${fmtDate(per.renewal_start)} → ${per.is_lifetime ? "Lifetime" : fmtDate(per.renewal_end || per.new_expiry)}</span></div>
        <div class="kv-row"><span class="kv-key">Allowed Terminals:</span><span class="kv-val">${lic.allowed_seats || 1} POS Seat(s)</span></div>
        <div class="kv-row"><span class="kv-key">Extension Duration:</span><span class="kv-val">${per.extension_duration_label || "Standard Cycle"}</span></div>
        <div class="kv-row"><span class="kv-key">Deployment:</span><span class="kv-val">${lic.project_name || "AivraSol Pharmacy POS"}</span></div>
        <div class="kv-row"><span class="kv-key">Status After Renewal:</span><span class="kv-val" style="color: #009A4D;">${lic.status_after_renewal || "Active"}</span></div>
      </div>

      <div class="section-title">Financial Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${
            lic.billing_model === "per_invoice"
              ? `<tr><td>Metered POS Invoice Usage (${fin.usage_invoice_count || 0} invoices @ ${fmtMoney(currency, fin.usage_rate || 0)}/invoice)</td><td class="right">${fmtMoney(currency, fin.invoice_overage_charge ?? fin.subtotal ?? 0)}</td></tr>`
              : `<tr><td>Subscription / Plan Charge (${lic.plan_label || "Standard Cycle"})</td><td class="right">${fmtMoney(currency, fin.plan_charge ?? fin.subtotal ?? 0)}</td></tr>`
          }
          ${
            Number(fin.arrears_included || 0) > 0
              ? `<tr><td>Arrears / Previous Balance Included</td><td class="right">${fmtMoney(currency, fin.arrears_included)}</td></tr>`
              : ""
          }
          <tr><td>Subtotal</td><td class="right">${fmtMoney(currency, fin.subtotal ?? voucher.subtotal ?? 0)}</td></tr>
          ${
            Number(fin.discount || 0) > 0
              ? `<tr><td>Discount / Waiver</td><td class="right">- ${fmtMoney(currency, fin.discount)}</td></tr>`
              : ""
          }
          ${
            Number(fin.tax || 0) > 0
              ? `<tr><td>Tax</td><td class="right">${fmtMoney(currency, fin.tax)}</td></tr>`
              : ""
          }
          <tr class="total-row"><td>Total Payable</td><td class="right">${fmtMoney(currency, fin.total_payable ?? voucher.total_due ?? 0)}</td></tr>
          <tr class="paid-row"><td>Amount Paid</td><td class="right">${fmtMoney(currency, fin.amount_paid ?? voucher.amount_paid ?? 0)}</td></tr>
          <tr class="balance-row"><td>Remaining Balance</td><td class="right">${fmtMoney(currency, fin.remaining_balance ?? voucher.balance ?? 0)}</td></tr>
        </tbody>
      </table>

      <div class="section-title">Payment &amp; Settlement Details</div>
      <div class="kv-grid">
        <div class="kv-row"><span class="kv-key">Payment Method:</span><span class="kv-val">${pay.payment_method || voucher.payment_method || "—"}</span></div>
        <div class="kv-row"><span class="kv-key">Payment Date:</span><span class="kv-val">${pay.paid_at ? fmtDateTime(pay.paid_at) : "No Payment Recorded"}</span></div>
        <div class="kv-row"><span class="kv-key">Transaction / Reference ID:</span><span class="kv-val">${pay.transaction_reference || voucher.payment_reference || "—"}</span></div>
        <div class="kv-row"><span class="kv-key">Processed By:</span><span class="kv-val">${pay.processed_by || "Super Admin"}</span></div>
        <div class="kv-row" style="grid-column: span 2;"><span class="kv-key">Remarks / Notes:</span><span class="kv-val">${pay.notes || "—"}</span></div>
      </div>

      <div class="sig-row">
        <div style="font-size: 10.5px; color: #475569;">
          <div style="font-weight: 700; color: #009A4D; text-transform: uppercase; letter-spacing: 0.05em;">Digital Verification Record</div>
          <div style="font-family: monospace; margin-top: 2px;">Hash: ${voucher.verification_hash || voucherNo}</div>
          <div style="color: #64748b;">support@aivrasol.com • www.aivrasol.com</div>
        </div>
        <div class="sig-box">
          <svg viewBox="0 0 230 62" width="185" height="50" style="display: block; margin: 0 auto -4px;">
            <path d="${ABDULREHMAN_SIGNATURE_PATHS.mainStroke}" fill="none" stroke="#0f172a" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
            <path d="${ABDULREHMAN_SIGNATURE_PATHS.crossAndFlourish}" fill="none" stroke="#009A4D" stroke-width="1.6" stroke-linecap="round" />
            <path d="${ABDULREHMAN_SIGNATURE_PATHS.dots}" fill="none" stroke="#009A4D" stroke-width="2.4" stroke-linecap="round" />
          </svg>
          <div class="sig-line">Authorized &amp; Verified Signature</div>
          <div class="sig-sub">AivraSol Billing &amp; Licensing Authority</div>
        </div>
      </div>

      <div class="footer">
        <div class="disclaimer">
          <strong>Disclaimer:</strong> This payment voucher is a digital receipt issued by AivraSol for subscription and license verification only and is not valid for banking, tax, or official financial institution purposes.
        </div>
      </div>
    </div>
  </div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 250); };
  </script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const currency =
    voucher?.financial_snapshot?.currency || voucher?.currency || "PKR";
  const lic = voucher?.license_snapshot || {};
  const per = voucher?.period_snapshot || {};
  const fin = voucher?.financial_snapshot || {};
  const pay = voucher?.payment_snapshot || {};
  const st = getStatusBadgeInfo(voucher?.status);
  const voucherNo =
    voucher?.voucher_number || voucher?.invoice_number || voucher?.id;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 py-3.5 border-b bg-slate-900 text-white shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <span>AivraSol Subscription &amp; License Renewal Voucher</span>
            </DialogTitle>
            <div className="flex items-center gap-2">
              {voucher && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs gap-1.5"
                    onClick={handlePrint}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print Voucher
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleDownloadPdf}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </Button>
                </>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-800"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950">
          {loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">
              Loading official AivraSol voucher…
            </div>
          ) : error ? (
            <div className="py-16 text-center space-y-2">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
              <div className="text-sm font-medium text-destructive">{error}</div>
            </div>
          ) : !voucher ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No voucher selected.
            </div>
          ) : (
            <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
              {/* Top Emerald Brand Accent */}
              <div className="h-2 bg-[#009A4D] relative z-10" />

              {/* Full-Page AivraSol Watermark Behind Voucher Content */}
              <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center z-0">
                <img
                  src="/logo-aivrasol-voucher.png"
                  alt=""
                  aria-hidden="true"
                  className="w-[580px] sm:w-[720px] max-w-[96%] h-auto object-contain opacity-[0.12]"
                />
              </div>

              <div className="relative z-10 p-6 space-y-6">
                {/* 1. Brand Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center bg-white rounded-xl">
                    <img
                      src="/logo-aivrasol-voucher.png"
                      alt="AivraSol Logo"
                      className="h-24 sm:h-28 w-auto object-contain -my-3 -ml-3"
                    />
                  </div>

                  <div className="sm:text-right space-y-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      AivraSol Subscription &amp; License Renewal Voucher
                    </div>
                    <div className="text-xs text-slate-500">
                      Official Payment &amp; License Extension Confirmation
                    </div>
                    <div className="pt-1 flex sm:justify-end items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded">
                        {voucherNo}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold ${st.className}`}
                      >
                        {st.label}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Issued: {fmtDateTime(voucher.issued_at)}
                    </div>
                  </div>
                </div>

                {/* 2. Issuer & Pharmacy / License Holder */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/25 dark:bg-slate-950/30 p-4 text-xs space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#009A4D] flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      Issued By (Provider)
                    </div>
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {voucher.seller_snapshot?.name ||
                        "AivraSol Technologies (Mediqoo Cloud)"}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Support:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {voucher.seller_snapshot?.email || "support@aivrasol.com"}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Website:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {voucher.seller_snapshot?.website || "www.aivrasol.com"}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Address:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {voucher.seller_snapshot?.address || "Pakistan"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/25 dark:bg-slate-950/30 p-4 text-xs space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#009A4D] flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      Pharmacy / License Holder
                    </div>
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {voucher.client_snapshot?.name || "Pharmacy Client"}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Owner / Contact:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {voucher.client_snapshot?.contact_name || "—"}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Phone / Email:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {[
                          voucher.client_snapshot?.phone,
                          voucher.client_snapshot?.email,
                        ]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Address:{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {voucher.client_snapshot?.address || "—"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Tenant ID: {voucher.client_snapshot?.id || voucher.client_id}
                    </div>
                  </div>
                </div>

                {/* 3. Subscription & License Details */}
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-[#009A4D]" />
                    Subscription &amp; License Details
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-xs bg-transparent">
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">Product:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {lic.product_name || "AivraSol Pharmacy POS"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">Previous Expiry:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {per.previous_expiry
                          ? fmtDate(per.previous_expiry)
                          : "Initial / None"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">License Key:</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {lic.license_key_masked || lic.license_key || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">New Expiry Date:</span>
                      <span className="font-bold text-[#009A4D]">
                        {per.is_lifetime
                          ? "Lifetime / Never"
                          : fmtDate(per.new_expiry || voucher.new_expiry)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">Plan / Billing Model:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {lic.plan_label ||
                          (lic.billing_model === "per_invoice"
                            ? "Pay Per Invoice"
                            : "Fixed Subscription")}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-slate-500">Renewal Window:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {fmtDate(per.renewal_start)} →{" "}
                        {per.is_lifetime
                          ? "Lifetime"
                          : fmtDate(per.renewal_end || per.new_expiry)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Allowed Terminals:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {lic.allowed_seats || 1} POS Seat(s)
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Extension Duration:</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {per.extension_duration_label || "Standard Cycle"} (
                        <span className="text-emerald-600">
                          {lic.status_after_renewal || "Active"}
                        </span>
                        )
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Financial Breakdown */}
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-[#009A4D]" />
                    Financial Breakdown
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 border-b-2 border-[#009A4D]">
                          <th className="py-2.5 px-4 text-left font-bold uppercase tracking-wider text-[10px]">
                            Description
                          </th>
                          <th className="py-2.5 px-4 text-right font-bold uppercase tracking-wider text-[10px]">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {lic.billing_model === "per_invoice" ? (
                          <tr>
                            <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                              Metered POS Invoice Usage (
                              {fin.usage_invoice_count || 0} invoices @{" "}
                              {fmtMoney(currency, fin.usage_rate || 0)}/invoice)
                            </td>
                            <td className="py-2.5 px-4 text-right font-medium">
                              {fmtMoney(
                                currency,
                                fin.invoice_overage_charge ?? fin.subtotal ?? 0
                              )}
                            </td>
                          </tr>
                        ) : (
                          <tr>
                            <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                              Subscription / Plan Charge (
                              {lic.plan_label || "Standard Cycle"})
                            </td>
                            <td className="py-2.5 px-4 text-right font-medium">
                              {fmtMoney(
                                currency,
                                fin.plan_charge ?? fin.subtotal ?? 0
                              )}
                            </td>
                          </tr>
                        )}
                        {Number(fin.arrears_included || 0) > 0 && (
                          <tr>
                            <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                              Arrears / Previous Balance Included
                            </td>
                            <td className="py-2.5 px-4 text-right font-medium">
                              {fmtMoney(currency, fin.arrears_included)}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-2 px-4 text-slate-500">Subtotal</td>
                          <td className="py-2 px-4 text-right font-medium">
                            {fmtMoney(currency, fin.subtotal ?? voucher.subtotal ?? 0)}
                          </td>
                        </tr>
                        {Number(fin.discount || 0) > 0 && (
                          <tr>
                            <td className="py-2 px-4 text-slate-500">
                              Discount / Waiver
                            </td>
                            <td className="py-2 px-4 text-right font-medium text-emerald-600">
                              - {fmtMoney(currency, fin.discount)}
                            </td>
                          </tr>
                        )}
                        {Number(fin.tax || 0) > 0 && (
                          <tr>
                            <td className="py-2 px-4 text-slate-500">Tax</td>
                            <td className="py-2 px-4 text-right font-medium">
                              {fmtMoney(currency, fin.tax)}
                            </td>
                          </tr>
                        )}
                        <tr className="bg-slate-50/35 dark:bg-slate-800/30 font-bold">
                          <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">
                            Total Payable
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-900 dark:text-slate-100">
                            {fmtMoney(
                              currency,
                              fin.total_payable ?? voucher.total_due ?? 0
                            )}
                          </td>
                        </tr>
                        <tr className="bg-emerald-50/35 dark:bg-emerald-950/20 font-bold text-[#009A4D]">
                          <td className="py-2.5 px-4">Amount Paid</td>
                          <td className="py-2.5 px-4 text-right">
                            {fmtMoney(
                              currency,
                              fin.amount_paid ?? voucher.amount_paid ?? 0
                            )}
                          </td>
                        </tr>
                        <tr className="font-bold">
                          <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                            Remaining Balance
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right ${
                              Number(
                                fin.remaining_balance ?? voucher.balance ?? 0
                              ) > 0
                                ? "text-red-600"
                                : "text-slate-900 dark:text-slate-100"
                            }`}
                          >
                            {fmtMoney(
                              currency,
                              fin.remaining_balance ?? voucher.balance ?? 0
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 5. Payment Details */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/25 dark:bg-slate-950/30 p-4 text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Method:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {pay.payment_method || voucher.payment_method || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Date:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {pay.paid_at
                        ? fmtDateTime(pay.paid_at)
                        : "No Payment Recorded"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction / Ref ID:</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {pay.transaction_reference ||
                        voucher.payment_reference ||
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Processed By:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {pay.processed_by || "Super Admin"}
                    </span>
                  </div>
                  {(pay.notes || pay.override_reason) && (
                    <div className="sm:col-span-2 pt-1 border-t border-slate-200 dark:border-slate-800 flex justify-between">
                      <span className="text-slate-500">Remarks / Notes:</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {pay.notes || pay.override_reason}
                      </span>
                    </div>
                  )}
                </div>

                {/* 6. Digital Verification & Handwritten Signature Block */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="space-y-1 text-xs">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#009A4D]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Digital Verification Record
                    </div>
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      Verification ID: {voucher.verification_hash || voucherNo}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      support@aivrasol.com • www.aivrasol.com
                    </div>
                  </div>

                  <div className="flex flex-col items-center sm:items-end">
                    <div className="text-center min-w-[215px]">
                      <svg
                        viewBox="0 0 230 62"
                        className="w-44 h-12 mx-auto -mb-1 select-none"
                        aria-label="Verified Signature"
                      >
                        <path
                          d={ABDULREHMAN_SIGNATURE_PATHS.mainStroke}
                          fill="none"
                          stroke="#0f172a"
                          strokeWidth="2.1"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d={ABDULREHMAN_SIGNATURE_PATHS.crossAndFlourish}
                          fill="none"
                          stroke="#009A4D"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d={ABDULREHMAN_SIGNATURE_PATHS.dots}
                          fill="none"
                          stroke="#009A4D"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="border-t border-slate-700 pt-1 text-[11px] font-bold text-slate-900 dark:text-slate-100">
                        Authorized &amp; Verified Signature
                      </div>
                      <div className="text-[10px] font-semibold text-[#009A4D]">
                        AivraSol Billing &amp; Licensing Authority
                      </div>
                    </div>
                  </div>
                </div>

                {/* 7. Non-Banking Digital Receipt Disclaimer */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="rounded-lg bg-slate-50/90 dark:bg-slate-800/40 border border-dashed border-slate-300 dark:border-slate-700 px-3.5 py-2 text-center text-[10.5px] text-slate-600 dark:text-slate-400">
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      Disclaimer:
                    </span>{" "}
                    This payment voucher is a digital receipt issued by AivraSol
                    for subscription and license verification only and is not
                    valid for banking, tax, or official financial institution
                    purposes.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
