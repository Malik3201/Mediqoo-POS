"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users,
  Search,
  ChevronRight,
  X,
  Printer,
  Phone,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Bookmark,
  Receipt,
  Calendar,
  ArrowUpDown,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
  PortalSectionCard,
  PortalStatusBadge,
  PortalSlideOver,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

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

const FOLLOW_UP_LABELS: Record<string, { label: string; tone: "slate" | "sky" | "amber" | "rose" | "emerald" }> = {
  none: { label: "No Follow-Up Tag", tone: "slate" },
  promised_to_pay: { label: "Promised to Pay", tone: "sky" },
  follow_up_needed: { label: "Follow-Up Needed", tone: "amber" },
  disputed: { label: "Disputed / Review", tone: "rose" },
  vip: { label: "VIP Credit Account", tone: "emerald" },
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    searchParams.get("customer") || null
  );
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

  const renderCreditBadge = (status: string) => {
    const tone =
      status === "overdue"
        ? "rose"
        : status === "due"
        ? "amber"
        : status === "advance"
        ? "sky"
        : "emerald";
    return (
      <PortalStatusBadge tone={tone} dot>
        {status?.toUpperCase() || "CLEAR"}
      </PortalStatusBadge>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<Users className="w-5 h-5" />}
        title="Customer Khata & Credit"
        subtitle="Track verified customer receivables, running ledgers, printable statements, and owner follow-up notes."
        actions={
          <PortalRefreshButton loading={loading} onClick={() => void fetchCustomers()} />
        }
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PortalKpiCard
          label="Total Receivable"
          value={formatPKR(summary.total_receivable ?? 0)}
          subtext="Verified net customer balances"
          icon={<Users className="w-4 h-4" />}
          tone="amber"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <PortalKpiCard
          label="Customers Owing"
          value={String(summary.due_count ?? 0)}
          subtext={`of ${summary.total_customers ?? customers.length} total accounts`}
          icon={<Clock className="w-4 h-4" />}
          tone="default"
          active={statusFilter === "due"}
          onClick={() => setStatusFilter(statusFilter === "due" ? "all" : "due")}
        />
        <PortalKpiCard
          label="Overdue 30d+"
          value={String(summary.overdue_count ?? 0)}
          subtext="Accounts needing urgent call"
          icon={<AlertTriangle className="w-4 h-4" />}
          tone={(summary.overdue_count ?? 0) > 0 ? "rose" : "default"}
          active={statusFilter === "overdue"}
          onClick={() => setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")}
        />
        <PortalKpiCard
          label="Follow-Up Tagged"
          value={String(summary.follow_up_count ?? 0)}
          subtext="Promised, disputed, or VIP"
          icon={<Bookmark className="w-4 h-4" />}
          tone="sky"
          active={statusFilter === "follow_up"}
          onClick={() => setStatusFilter(statusFilter === "follow_up" ? "all" : "follow_up")}
        />
      </div>

      {/* Filters & Search */}
      <PortalSectionCard className="p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search customer name or phone number…"
              className="w-full min-h-[42px] pl-10 pr-9 py-2 rounded-xl border border-slate-200/90 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-[#009A4D] transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] pl-8 pr-4 py-2 rounded-xl border border-slate-200/90 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:border-[#009A4D]"
            >
              <option value="balance_desc">Highest Balance First</option>
              <option value="name_asc">Name A–Z</option>
              <option value="recent">Most Recent Activity</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id: "all", label: "All Accounts" },
            { id: "due", label: "With Balance Due" },
            { id: "overdue", label: "Overdue (30d+)" },
            { id: "follow_up", label: "Follow-Up Tagged" },
            { id: "clear", label: "Clear / Advance" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === f.id
                  ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </PortalSectionCard>

      {/* Customer List */}
      <PortalSectionCard
        title="Customer Accounts"
        subtitle="Tap any customer to view itemized running ledger, print statement, or add recovery notes"
        icon={<Users className="w-4 h-4" />}
        headerRight={
          <span className="text-[11px] font-bold text-slate-400">
            {customers.length} {customers.length === 1 ? "account" : "accounts"}
          </span>
        }
      >
        {loading ? (
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <PortalEmptyState
            icon={<Users className="w-6 h-6" />}
            title="No Matching Customer Accounts"
            description='Try changing the credit filter to "All Accounts" or clearing your search.'
            action={
              (statusFilter !== "all" || searchInput) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setSearchInput("");
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                >
                  Show All Accounts
                </button>
              )
            }
          />
        ) : (
          <>
            {/* Mobile Structured Customer Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {customers.map((cust) => {
                const followTag =
                  FOLLOW_UP_LABELS[cust.owner_meta?.follow_up_status || "none"] ||
                  FOLLOW_UP_LABELS.none;
                return (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className="w-full text-left p-4 active:bg-emerald-50/50 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 truncate">{cust.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {renderCreditBadge(cust.credit_status)}
                          {cust.owner_meta?.follow_up_status &&
                            cust.owner_meta.follow_up_status !== "none" && (
                              <PortalStatusBadge tone={followTag.tone}>
                                {followTag.label}
                              </PortalStatusBadge>
                            )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Balance
                        </span>
                        <p
                          className={`text-sm font-extrabold tabular-nums ${
                            cust.credit_balance > 0
                              ? "text-amber-700"
                              : cust.credit_balance < 0
                              ? "text-sky-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {formatPKR(cust.credit_balance)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-0.5">
                      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                        {cust.phone && (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {cust.phone}
                          </span>
                        )}
                        {cust.last_purchase_at && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            Sale: {formatDateTime(cust.last_purchase_at)}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>

                    {cust.owner_meta?.owner_note && (
                      <p className="text-[11px] text-sky-800 bg-sky-50/90 border border-sky-200/70 px-2.5 py-1 rounded-lg truncate">
                        Note: {cust.owner_meta.owner_note}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Desktop Customer Table */}
            <div className="hidden md:block overflow-x-auto portal-scroll">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 pl-5 pr-3">Customer &amp; Tags</th>
                    <th className="py-3 px-3">Phone &amp; Last Activity</th>
                    <th className="py-3 px-3">Credit Status</th>
                    <th className="py-3 pl-3 pr-5 text-right">Verified Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {customers.map((cust) => {
                    const followTag =
                      FOLLOW_UP_LABELS[cust.owner_meta?.follow_up_status || "none"] ||
                      FOLLOW_UP_LABELS.none;
                    return (
                      <tr
                        key={cust.id}
                        onClick={() => setSelectedCustomerId(cust.id)}
                        className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900 group-hover:text-[#009A4D]">
                              {cust.name}
                            </span>
                            {cust.owner_meta?.follow_up_status &&
                              cust.owner_meta.follow_up_status !== "none" && (
                                <PortalStatusBadge tone={followTag.tone}>
                                  {followTag.label}
                                </PortalStatusBadge>
                              )}
                          </div>
                          {cust.owner_meta?.owner_note && (
                            <p className="text-[11px] text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md inline-block mt-1 max-w-md truncate">
                              Note: {cust.owner_meta.owner_note}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-slate-500">
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {cust.phone && <span className="text-slate-700 font-medium">Tel: {cust.phone}</span>}
                            {cust.last_purchase_at && (
                              <span>Sale: {formatDateTime(cust.last_purchase_at)}</span>
                            )}
                            {cust.last_payment_at && (
                              <span>Paid: {formatDateTime(cust.last_payment_at)}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {renderCreditBadge(cust.credit_status)}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span
                              className={`text-sm sm:text-base font-extrabold tabular-nums ${
                                cust.credit_balance > 0
                                  ? "text-amber-700"
                                  : cust.credit_balance < 0
                                  ? "text-sky-700"
                                  : "text-emerald-700"
                              }`}
                            >
                              {formatPKR(cust.credit_balance)}
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#009A4D]" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </PortalSectionCard>

      {/* Customer Khata & Statement Slide-Over Drawer */}
      <PortalSlideOver
        open={Boolean(selectedCustomerId)}
        onClose={() => setSelectedCustomerId(null)}
        maxWidthClass="max-w-2xl"
        eyebrow="Customer Khata & Recovery"
        title={customerDetail?.customer?.name || "Customer Khata Ledger"}
        subtitle={
          customerDetail?.customer?.phone
            ? `Phone: ${customerDetail.customer.phone}`
            : "Verified running khata statement"
        }
        headerActions={
          customerDetail?.customer ? (
            <button
              type="button"
              onClick={handlePrintStatement}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-50 text-[#009A4D] border border-emerald-200 hover:bg-emerald-100 text-xs font-bold transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Print Statement</span>
              <span className="sm:hidden">Print</span>
            </button>
          ) : undefined
        }
      >
        {loadingDetail && (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        )}

        {customerDetail?.customer && !loadingDetail && (
          <div className="space-y-4">
            {/* Balance Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Opening Bal
                </span>
                <p className="text-sm font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(customerDetail.customer.opening_balance)}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  Credit Sales
                </span>
                <p className="text-sm font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(customerDetail.customer.total_credit_sales)}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase text-emerald-700">
                  Paid / Returned
                </span>
                <p className="text-sm font-extrabold text-emerald-700 mt-1 tabular-nums">
                  {formatPKR(
                    (customerDetail.customer.total_payments || 0) +
                      (customerDetail.customer.total_returns_deducted || 0)
                  )}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/90">
                <span className="text-[10px] font-bold uppercase text-amber-800">
                  Balance Due
                </span>
                <p className="text-sm sm:text-base font-extrabold text-amber-800 mt-1 tabular-nums">
                  {formatPKR(customerDetail.customer.credit_balance)}
                </p>
              </div>
            </div>

            {/* Owner Follow-up & Note Panel */}
            <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200/90 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-[#009A4D]" />
                  Owner Follow-Up &amp; Reminder
                </h3>
                {metaSavedMsg && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    {metaSavedMsg}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Follow-Up Status
                  </label>
                  <select
                    value={followUpStatus}
                    onChange={(e) => setFollowUpStatus(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900 focus:outline-none focus:border-[#009A4D]"
                  >
                    <option value="none">No Follow-Up Tag</option>
                    <option value="promised_to_pay">Promised to Pay</option>
                    <option value="follow_up_needed">Follow-Up Needed</option>
                    <option value="disputed">Disputed / Review</option>
                    <option value="vip">VIP Credit Account</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Promised Payment Date
                  </label>
                  <input
                    type="date"
                    value={promisedDate}
                    onChange={(e) => setPromisedDate(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#009A4D]"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={ownerNote}
                  onChange={(e) => setOwnerNote(e.target.value)}
                  placeholder="Private owner follow-up note (never modifies POS accounting)…"
                  className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#009A4D]"
                />
                <button
                  type="button"
                  onClick={handleSaveOwnerMeta}
                  disabled={savingMeta}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 shrink-0 transition-colors"
                >
                  {savingMeta ? "Saving…" : "Save Note"}
                </button>
              </div>
            </div>

            {/* Running Ledger Statement */}
            <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-white">
              <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Running Khata Ledger ({customerDetail.ledger?.length || 0})
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={stmtFrom}
                    onChange={(e) => setStmtFrom(e.target.value)}
                    className="flex-1 sm:flex-initial min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-medium"
                  />
                  <span className="text-slate-400 font-semibold">to</span>
                  <input
                    type="date"
                    value={stmtTo}
                    onChange={(e) => setStmtTo(e.target.value)}
                    className="flex-1 sm:flex-initial min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-medium"
                  />
                </div>
              </div>

              {(customerDetail.ledger || []).length === 0 ? (
                <p className="p-6 text-xs text-slate-400 text-center">
                  No ledger entries matched this date range.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(customerDetail.ledger || []).map((entry: any) => (
                    <div
                      key={entry.id}
                      onClick={() => {
                        if (entry.invoice_id) setSelectedInvoiceId(entry.invoice_id);
                      }}
                      className={`px-4 py-3 flex items-start justify-between gap-3 text-xs transition-colors ${
                        entry.invoice_id ? "hover:bg-emerald-50/50 cursor-pointer" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-900 font-mono">
                            {entry.reference}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {formatDateTime(entry.date)}
                          </span>
                          {entry.invoice_id && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#009A4D] bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200/70">
                              <Receipt className="w-2.5 h-2.5" />
                              View Receipt
                            </span>
                          )}
                        </div>
                        <p className="text-slate-600 mt-1">{entry.description}</p>
                      </div>

                      <div className="text-right shrink-0 space-y-0.5">
                        {entry.debit > 0 && (
                          <p className="font-extrabold text-amber-700 tabular-nums">
                            + {formatPKR(entry.debit)}
                          </p>
                        )}
                        {entry.credit > 0 && (
                          <p className="font-extrabold text-emerald-700 tabular-nums">
                            - {formatPKR(entry.credit)}
                          </p>
                        )}
                        <p className="text-[11px] font-semibold text-slate-500 tabular-nums">
                          Bal: {formatPKR(entry.running_balance)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </PortalSlideOver>

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
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading Customer Khata…</div>}>
      <KhataContent />
    </Suspense>
  );
}
