"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BellRing,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Percent,
  Wallet,
  Package,
  CalendarClock,
  TrendingUp,
  RotateCcw,
  Users,
  WifiOff,
  Plus,
  Check,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";

const CATEGORY_TABS = [
  { id: "all", label: "All Alerts" },
  { id: "discount_watch", label: "Discount Watch" },
  { id: "cash_variance_watch", label: "Cash Variance" },
  { id: "low_stock_watch", label: "Low Stock" },
  { id: "expiry_watch", label: "Expiry Watch" },
  { id: "supplier_price_watch", label: "Supplier Price" },
  { id: "margin_watch", label: "Margin Watch" },
  { id: "returns_watch", label: "Returns Watch" },
  { id: "credit_watch", label: "Credit Watch" },
  { id: "sync_health_watch", label: "Sync Health" },
];

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function severityBadge(sev: string) {
  switch (sev) {
    case "critical":
      return {
        label: "Critical",
        cls: "bg-red-100 text-red-800 border-red-300",
        cardBorder: "border-l-4 border-l-red-600",
      };
    case "warning":
      return {
        label: "Warning",
        cls: "bg-amber-100 text-amber-800 border-amber-300",
        cardBorder: "border-l-4 border-l-amber-500",
      };
    default:
      return {
        label: "Review",
        cls: "bg-blue-50 text-blue-700 border-blue-200",
        cardBorder: "border-l-4 border-l-blue-500",
      };
  }
}

function AlertsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [category, setCategory] = useState(
    searchParams.get("category") || "all"
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [activeNoteBoxId, setActiveNoteBoxId] = useState<string | null>(null);

  // Invoice detail drawer for invoice-sourced alerts
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Review Task form
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("audit");
  const [addingTask, setAddingTask] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category,
        status: statusFilter,
        severity: severityFilter,
      });
      const res = await fetch(`/api/portal/alerts?${params.toString()}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [category, statusFilter, severityFilter]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const updateAlertStatus = async (
    alertId: string,
    status: "open" | "acknowledged" | "resolved"
  ) => {
    setUpdatingId(alertId);
    try {
      const note = noteDrafts[alertId] || undefined;
      const res = await fetch("/api/portal/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_alert_status",
          alert_id: alertId,
          status,
          note,
        }),
      });
      if (res.ok) {
        setActiveNoteBoxId(null);
        await loadAlerts();
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setAddingTask(true);
    try {
      const res = await fetch("/api/portal/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_review_task",
          title: newTaskTitle.trim(),
          category: newTaskCategory,
          status: "open",
        }),
      });
      if (res.ok) {
        setNewTaskTitle("");
        await loadAlerts();
      }
    } finally {
      setAddingTask(false);
    }
  };

  const toggleTaskStatus = async (task: any) => {
    await fetch("/api/portal/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_review_task",
        task_id: task.task_id,
        title: task.title,
        category: task.category,
        status: task.status === "completed" ? "open" : "completed",
      }),
    });
    await loadAlerts();
  };

  const countsByCategory = data?.counts_by_category || {};
  const countsBySeverity = data?.counts_by_severity || {};
  const countsByStatus = data?.counts_by_status || {};
  const alerts: any[] = data?.alerts || [];
  const tasks: any[] = data?.review_tasks || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <BellRing className="w-5 h-5 text-[#009A4D]" />
            <span>Actionable Owner Alert Center</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Deterministic supervision rules across discounts, cash variances, stock, expiry, margins, supplier prices &amp; credit.
          </p>
        </div>
        <button
          onClick={() => void loadAlerts()}
          disabled={loading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#009A4D]" : ""}`}
          />
          Refresh Alerts
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={() => setStatusFilter("open")}
          className={`text-left p-3 rounded-2xl border transition-colors ${
            statusFilter === "open"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white border-slate-200 hover:border-slate-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Open Alerts
          </span>
          <span className="text-base font-extrabold mt-0.5 block">
            {countsByStatus.open || 0}
          </span>
        </button>

        <button
          onClick={() =>
            setSeverityFilter(severityFilter === "critical" ? "all" : "critical")
          }
          className={`text-left p-3 rounded-2xl border transition-colors ${
            severityFilter === "critical"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white border-slate-200 hover:border-red-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Critical Priority
          </span>
          <span className="text-base font-extrabold mt-0.5 block">
            {countsBySeverity.critical || 0}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter("acknowledged")}
          className={`text-left p-3 rounded-2xl border transition-colors ${
            statusFilter === "acknowledged"
              ? "bg-amber-600 text-white border-amber-600"
              : "bg-white border-slate-200 hover:border-amber-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Acknowledged
          </span>
          <span className="text-base font-extrabold mt-0.5 block">
            {countsByStatus.acknowledged || 0}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter("resolved")}
          className={`text-left p-3 rounded-2xl border transition-colors ${
            statusFilter === "resolved"
              ? "bg-[#009A4D] text-white border-[#009A4D]"
              : "bg-white border-slate-200 hover:border-emerald-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75 block">
            Resolved
          </span>
          <span className="text-base font-extrabold mt-0.5 block">
            {countsByStatus.resolved || 0}
          </span>
        </button>
      </div>

      {/* Category Filter Pills & Status Selector */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORY_TABS.map((t) => {
            const count = countsByCategory[t.id] || 0;
            return (
              <button
                key={t.id}
                onClick={() => setCategory(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  category === t.id
                    ? "bg-[#009A4D] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    category === t.id
                      ? "bg-white/20 text-white"
                      : "bg-white text-slate-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 text-xs">
          <span className="text-[11px] font-semibold text-slate-500">Status:</span>
          {["all", "open", "acknowledged", "resolved"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize ${
                statusFilter === st
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Alert Cards List */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-500 animate-pulse">
            Evaluating supervision rules across pharmacy records…
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-[#009A4D] mx-auto" />
            <p className="text-xs font-bold text-slate-800">
              No active alerts match the selected filter.
            </p>
            <p className="text-[11px] text-slate-500">
              All monitored thresholds for this category are currently clear.
            </p>
          </div>
        ) : (
          alerts.map((alert) => {
            const sev = severityBadge(alert.severity);
            const isResolved = alert.resolution_status === "resolved";
            const isAck = alert.resolution_status === "acknowledged";

            return (
              <div
                key={alert.id}
                className={`bg-white rounded-2xl border border-slate-200 p-4 shadow-xs transition-all ${
                  sev.cardBorder
                } ${isResolved ? "opacity-75" : ""}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${sev.cls}`}
                      >
                        {sev.label}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                        {alert.category_label}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {alert.pharmacy_name} • {formatDateTime(alert.occurred_at)}
                      </span>
                      {alert.resolution_status !== "open" && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isResolved
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {alert.resolution_status}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">
                      {alert.title}
                    </h3>
                    <p className="text-xs text-slate-600">{alert.description}</p>

                    <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-500 flex-wrap">
                      <span>
                        Impact:{" "}
                        <strong className="text-slate-800">
                          {alert.subject_label}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        Source Ref:{" "}
                        <strong className="font-mono text-slate-800">
                          {alert.source_ref_label}
                        </strong>
                      </span>
                      {alert.resolution_note && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-700 font-medium">
                            Owner Note: &ldquo;{alert.resolution_note}&rdquo;
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {alert.source_ref_type === "invoice" ? (
                      <button
                        onClick={() => setSelectedInvoiceId(alert.source_ref_id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                      >
                        <span>View Invoice</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    ) : (
                      <Link
                        href={alert.href}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                      >
                        <span>View Details</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}

                    {alert.resolution_status === "open" && (
                      <button
                        disabled={updatingId === alert.id}
                        onClick={() =>
                          void updateAlertStatus(alert.id, "acknowledged")
                        }
                        className="px-2.5 py-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100"
                      >
                        Acknowledge
                      </button>
                    )}

                    {alert.resolution_status !== "resolved" ? (
                      <button
                        disabled={updatingId === alert.id}
                        onClick={() =>
                          void updateAlertStatus(alert.id, "resolved")
                        }
                        className="px-2.5 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-[#009A4D] text-xs font-semibold hover:bg-emerald-100"
                      >
                        Resolve
                      </button>
                    ) : (
                      <button
                        disabled={updatingId === alert.id}
                        onClick={() => void updateAlertStatus(alert.id, "open")}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50"
                      >
                        Reopen
                      </button>
                    )}

                    <button
                      onClick={() =>
                        setActiveNoteBoxId(
                          activeNoteBoxId === alert.id ? null : alert.id
                        )
                      }
                      className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs hover:bg-slate-50"
                    >
                      + Note
                    </button>
                  </div>
                </div>

                {/* Inline Note Box */}
                {activeNoteBoxId === alert.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                    <input
                      type="text"
                      value={
                        noteDrafts[alert.id] ?? alert.resolution_note ?? ""
                      }
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [alert.id]: e.target.value,
                        }))
                      }
                      placeholder="Add owner review note (e.g. Verified with counter pharmacist)…"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                    />
                    <button
                      onClick={() =>
                        void updateAlertStatus(
                          alert.id,
                          alert.resolution_status === "open"
                            ? "acknowledged"
                            : alert.resolution_status
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[#009A4D] text-white text-xs font-semibold"
                    >
                      Save Note
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Owner Review Tasks Checklist (Section 6) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
          Owner Follow-Up &amp; Review Tasks
        </h2>
        <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Add a store review task (e.g. Audit Friday evening shift discount invoices)…"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs"
          />
          <select
            value={newTaskCategory}
            onChange={(e) => setNewTaskCategory(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
          >
            <option value="audit">Cash / Discount Audit</option>
            <option value="purchasing">Supplier / Stock</option>
            <option value="khata">Customer Collection</option>
          </select>
          <button
            type="submit"
            disabled={addingTask || !newTaskTitle.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Task
          </button>
        </form>

        {tasks.length > 0 && (
          <div className="divide-y divide-slate-100">
            {tasks.map((t: any) => (
              <div
                key={t.task_id}
                className="py-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <button
                  onClick={() => void toggleTaskStatus(t)}
                  className="flex items-center gap-2.5 text-left"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      t.status === "completed"
                        ? "bg-[#009A4D] border-[#009A4D] text-white"
                        : "border-slate-300"
                    }`}
                  >
                    {t.status === "completed" && <Check className="w-3 h-3" />}
                  </span>
                  <span
                    className={
                      t.status === "completed"
                        ? "line-through text-slate-400"
                        : "font-semibold text-slate-800"
                    }
                  >
                    {t.title}
                  </span>
                </button>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  {t.category}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoice Detail Drawer */}
      <InvoiceDetailDrawer
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </div>
  );
}

export default function AlertsCenterPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">
          Loading Alert Center…
        </div>
      }
    >
      <AlertsPageInner />
    </Suspense>
  );
}
