"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users,
  Search,
  RefreshCw,
  ChevronRight,
  X,
  Printer,
  Phone,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Bookmark,
  FileText,
  Receipt,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

function formatPKR(n: number): string {
  return `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const FOLLOW_UP_LABELS: Record<string, { label: string; style: string }> = {
  none: { label: "No Follow-Up Tag", style: "bg-slate-100 text-slate-600 border-slate-200" },
  promised_to_pay: {
    label: "Promised to Pay",
    style: "bg-blue-50 text-blue-700 border-blue-200",
  },
  follow_up_needed: {
    label: "Follow-Up Needed",
    style: "bg-amber-50 text-amber-800 border-amber-200",
  },
  disputed: { label: "Disputed / Review", style: "bg-red-50 text-red-700 border-red-200" },
  vip: { label: "VIP Credit Account", style: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

function KhataContent() {
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "balance_desc");

  const [customers, setCustomers] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // Selected customer drawer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");

  // Owner note & follow-up form
  const [followUpStatus, setFollowUpStatus] = useState("none");
  const [promisedDate, setPromisedDate] = useState("");
  const [ownerNote, setOwnerNote] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSavedMsg, setMetaSavedMsg] = useState("");

  // Linked invoice detail drawer
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sortBy) params.set("sort", sortBy);

      const res = await fetch(`/api/portal/customers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load customers");
      const json = await res.json();
      setCustomers(json.customers || []);
      setSummary(json.summary || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, statusFilter, sortBy]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const loadCustomerDetail = useCallback(
    async (custId: string, from = stmtFrom, to = stmtTo) => {
      setLoadingDetail(true);
      try {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(
          `/api/portal/customers/${encodeURIComponent(custId)}?${params.toString()}`
        );
        if (!res.ok) throw new Error("Failed to load customer ledger");
        const json = await res.json();
        setCustomerDetail(json);
        const meta = json.customer?.owner_meta || {};
        setFollowUpStatus(meta.follow_up_status || "none");
        setPromisedDate(meta.promised_date || "");
        setOwnerNote(meta.owner_note || "");
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingDetail(false);
      }
    },
    [stmtFrom, stmtTo]
  );

  useEffect(() => {
    if (selectedCustomerId) {
      void loadCustomerDetail(selectedCustomerId, stmtFrom, stmtTo);
    } else {
      setCustomerDetail(null);
    }
  }, [selectedCustomerId, stmtFrom, stmtTo, loadCustomerDetail]);

  const handleSaveOwnerMeta = async () => {
    if (!selectedCustomerId) return;
    setSavingMeta(true);
    setMetaSavedMsg("");
    try {
      const res = await fetch(`/api/portal/customers/${encodeURIComponent(selectedCustomerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          follow_up_status: followUpStatus,
          promised_date: promisedDate,
          owner_note: ownerNote,
        }),
      });
      if (res.ok) {
        setMetaSavedMsg("Saved owner note");
        void fetchCustomers();
        setTimeout(() => setMetaSavedMsg(""), 2500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingMeta(false);
    }
  };

  const handlePrintStatement = () => {
    if (!customerDetail?.customer) return;
    const cust = customerDetail.customer;
    const pharmacy = customerDetail.pharmacy;
    const ledger: any[] = customerDetail.ledger_chronological || [];

    const printWin = window.open("", "_blank", "width=850,height=900");
    if (!printWin) {
      window.print();
      return;
    }

    const rowsHtml = ledger
      .map(
        (l) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;">${formatDateTime(
          l.date
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#0f172a;">${
          l.reference
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${
          l.description
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;color:#b45309;">${
          l.debit > 0 ? formatPKR(l.debit) : "—"
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;color:#009A4D;">${
          l.credit > 0 ? formatPKR(l.credit) : "—"
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-weight:700;color:#0f172a;">${formatPKR(
          l.running_balance
        )}</td>
      </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Khata Statement - ${cust.name}</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { margin: 0; padding: 32px; color: #0f172a; background: #fff; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #009A4D; padding-bottom: 16px; margin-bottom: 20px; }
    .brand { font-size: 22px; font-weight: 800; color: #009A4D; margin: 0; }
    .sub { font-size: 12px; color: #475569; margin: 2px 0; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 20px; }
    .lbl { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .val { font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; color: #475569; font-size: 11px; text-transform: uppercase; padding: 10px; text-align: left; border-bottom: 2px solid #cbd5e1; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand">${pharmacy?.name || "AivraSol Pharmacy"}</h1>
      ${pharmacy?.address ? `<p class="sub">${pharmacy.address}</p>` : ""}
      ${pharmacy?.phone ? `<p class="sub">Phone: ${pharmacy.phone}</p>` : ""}
    </div>
    <div style="text-align:right;">
      <p style="font-size:18px;font-weight:800;margin:0;">CUSTOMER KHATA STATEMENT</p>
      <p class="sub">Customer: <strong>${cust.name}</strong> ${cust.phone ? `(${cust.phone})` : ""}</p>
      <p class="sub">Generated: ${new Date().toLocaleDateString("en-PK")}</p>
    </div>
  </div>
  <div class="summary">
    <div><div class="lbl">Opening Balance</div><div class="val">${formatPKR(cust.opening_balance)}</div></div>
    <div><div class="lbl">Credit Sales</div><div class="val">${formatPKR(cust.total_credit_sales)}</div></div>
    <div><div class="lbl">Payments & Returns</div><div class="val">${formatPKR(
      (cust.total_payments || 0) + (cust.total_returns_deducted || 0)
    )}</div></div>
    <div><div class="lbl">Current Balance Due</div><div class="val" style="color:#b45309;">${formatPKR(
      cust.credit_balance
    )}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Reference</th>
        <th>Description</th>
        <th style="text-align:right;">Debit (+)</th>
        <th style="text-align:right;">Credit (-)</th>
        <th style="text-align:right;">Balance</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Customers & Khata Credit Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track verified customer receivables, running ledgers, printable statements, and owner follow-up notes
          </p>
        </div>

        <button
          onClick={() => void fetchCustomers()}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Total Khata Receivable</span>
          <p className="text-base sm:text-lg font-extrabold text-amber-700 mt-1 tabular-nums">
            {formatPKR(summary.total_receivable ?? 0)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Verified due from customers</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Accounts with Due</span>
          <p className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
            {summary.due_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Out of {summary.total_customers ?? 0} customers
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Overdue / High Balance</span>
          <p className="text-base sm:text-lg font-extrabold text-red-600 mt-1 tabular-nums">
            {summary.overdue_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">&gt;30d inactive or ≥Rs 5,000</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5">
          <span className="text-[11px] font-semibold text-slate-500">Owner Follow-Up Tagged</span>
          <p className="text-base sm:text-lg font-extrabold text-blue-700 mt-1 tabular-nums">
            {summary.follow_up_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Promised / follow-up notes</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search customer by name, phone number, or owner note…"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#009A4D]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {[
              { id: "all", label: "All Accounts" },
              { id: "due", label: "Balance Due" },
              { id: "overdue", label: "Overdue / High" },
              { id: "follow_up", label: "Follow-Up Tagged" },
              { id: "clear", label: "Cleared" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
                  statusFilter === f.id
                    ? "bg-[#009A4D] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-800">No Matching Customer Accounts</p>
            <p className="text-xs text-slate-500">
              Try changing the credit filter to &ldquo;All Accounts&rdquo; or clearing your search.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {customers.map((cust) => {
              const followTag =
                FOLLOW_UP_LABELS[cust.owner_meta?.follow_up_status || "none"] ||
                FOLLOW_UP_LABELS.none;
              return (
                <button
                  key={cust.id}
                  onClick={() => setSelectedCustomerId(cust.id)}
                  className="w-full text-left px-4 sm:px-5 py-4 hover:bg-emerald-50/40 transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 group-hover:text-[#009A4D]">
                        {cust.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          cust.credit_status === "overdue"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : cust.credit_status === "due"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : cust.credit_status === "advance"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {cust.credit_status}
                      </span>
                      {cust.owner_meta?.follow_up_status &&
                        cust.owner_meta.follow_up_status !== "none" && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${followTag.style}`}
                          >
                            {followTag.label}
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      {cust.phone && <span>Tel: {cust.phone}</span>}
                      {cust.last_purchase_at && (
                        <span>Last Purchase: {formatDateTime(cust.last_purchase_at)}</span>
                      )}
                      {cust.last_payment_at && (
                        <span>Last Payment: {formatDateTime(cust.last_payment_at)}</span>
                      )}
                    </div>
                    {cust.owner_meta?.owner_note && (
                      <p className="text-xs text-blue-700 bg-blue-50/70 px-2 py-0.5 rounded inline-block truncate max-w-md">
                        Note: {cust.owner_meta.owner_note}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">
                        Verified Balance
                      </span>
                      <p
                        className={`text-sm sm:text-base font-extrabold tabular-nums ${
                          cust.credit_balance > 0
                            ? "text-amber-700"
                            : cust.credit_balance < 0
                            ? "text-blue-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {formatPKR(cust.credit_balance)}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer Khata Detail & Statement Drawer */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/50 backdrop-blur-[2px]">
          <div className="fixed inset-0" onClick={() => setSelectedCustomerId(null)} />
          <div className="relative z-10 w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {customerDetail?.customer?.name || "Customer Khata Statement"}
                </h2>
                {customerDetail?.customer?.phone && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Phone: {customerDetail.customer.phone}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {customerDetail?.customer && (
                  <button
                    onClick={handlePrintStatement}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / PDF Statement</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingDetail && (
                <div className="space-y-3">
                  <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
                  <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
                </div>
              )}

              {customerDetail?.customer && !loadingDetail && (
                <>
                  {/* Balance Breakdown */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-400">
                        Opening
                      </span>
                      <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                        {formatPKR(customerDetail.customer.opening_balance)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-400">
                        Credit Sales
                      </span>
                      <p className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                        {formatPKR(customerDetail.customer.total_credit_sales)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-400">
                        Payments & Returns
                      </span>
                      <p className="text-sm font-bold text-emerald-700 mt-0.5 tabular-nums">
                        {formatPKR(
                          (customerDetail.customer.total_payments || 0) +
                            (customerDetail.customer.total_returns_deducted || 0)
                        )}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                      <span className="text-[10px] font-bold uppercase text-amber-800">
                        Net Balance Due
                      </span>
                      <p className="text-base font-extrabold text-amber-800 mt-0.5 tabular-nums">
                        {formatPKR(customerDetail.customer.credit_balance)}
                      </p>
                    </div>
                  </div>

                  {/* Owner-Only Follow-Up & Notes Panel */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Bookmark className="w-3.5 h-3.5 text-[#009A4D]" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Owner Follow-Up & Credit Notes (Cloud-Only)
                        </h3>
                      </div>
                      {metaSavedMsg && (
                        <span className="text-xs font-semibold text-emerald-600">
                          {metaSavedMsg}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Follow-Up Status
                        </label>
                        <select
                          value={followUpStatus}
                          onChange={(e) => setFollowUpStatus(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                        >
                          <option value="none">No Follow-Up Tag</option>
                          <option value="promised_to_pay">Promised to Pay</option>
                          <option value="follow_up_needed">Follow-Up Needed</option>
                          <option value="disputed">Disputed / Review</option>
                          <option value="vip">VIP Credit Account</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Promised Payment Date
                        </label>
                        <input
                          type="date"
                          value={promisedDate}
                          onChange={(e) => setPromisedDate(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ownerNote}
                        onChange={(e) => setOwnerNote(e.target.value)}
                        placeholder="Add owner follow-up note (does not alter POS accounting balance)…"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800"
                      />
                      <button
                        onClick={handleSaveOwnerMeta}
                        disabled={savingMeta}
                        className="px-4 py-1.5 rounded-lg bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {savingMeta ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>

                  {/* Running Ledger Statement */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Running Khata Ledger ({customerDetail.ledger?.length || 0})
                      </h3>
                      <div className="flex items-center gap-2 text-xs">
                        <input
                          type="date"
                          value={stmtFrom}
                          onChange={(e) => setStmtFrom(e.target.value)}
                          className="px-2 py-1 rounded border border-slate-200 bg-white text-[11px]"
                        />
                        <span className="text-slate-400">to</span>
                        <input
                          type="date"
                          value={stmtTo}
                          onChange={(e) => setStmtTo(e.target.value)}
                          className="px-2 py-1 rounded border border-slate-200 bg-white text-[11px]"
                        />
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(customerDetail.ledger || []).map((entry: any) => (
                        <div
                          key={entry.id}
                          onClick={() => {
                            if (entry.invoice_id) setSelectedInvoiceId(entry.invoice_id);
                          }}
                          className={`px-4 py-3 flex items-center justify-between gap-3 text-xs ${
                            entry.invoice_id ? "hover:bg-emerald-50/40 cursor-pointer" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 font-mono">
                                {entry.reference}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatDateTime(entry.date)}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-0.5">{entry.description}</p>
                          </div>

                          <div className="text-right shrink-0 space-y-0.5">
                            {entry.debit > 0 && (
                              <p className="font-bold text-amber-700 tabular-nums">
                                + {formatPKR(entry.debit)}
                              </p>
                            )}
                            {entry.credit > 0 && (
                              <p className="font-bold text-emerald-700 tabular-nums">
                                - {formatPKR(entry.credit)}
                              </p>
                            )}
                            <p className="text-[11px] text-slate-500 tabular-nums">
                              Bal: {formatPKR(entry.running_balance)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Linked Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

export default function PortalKhataPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-xs text-slate-500">Loading Khata…</div>}
    >
      <KhataContent />
    </Suspense>
  );
}

