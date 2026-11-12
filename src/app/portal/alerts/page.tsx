"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  MessageSquarePlus,
  Plus,
  Check,
  ShieldAlert,
  Clock,
} from "lucide-react";
import InvoiceDetailDrawer from "@/components/portal/InvoiceDetailDrawer";
import {
  PortalPageHeader,
  PortalRefreshButton,
  PortalKpiCard,
  PortalSectionCard,
  PortalStatusBadge,
  PortalEmptyState,
} from "@/components/portal/PortalUI";

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

function severityMeta(sev: string): {
  label: string;
  tone: "rose" | "amber" | "sky";
  cardBorder: string;
} {
  switch (sev) {
    case "critical":
      return {
        label: "Critical",
        tone: "rose",
        cardBorder: "border-l-4 border-l-rose-600",
      };
    case "warning":
      return {
        label: "Warning",
        tone: "amber",
        cardBorder: "border-l-4 border-l-amber-500",
      };
    default:
      return {
        label: "Review",
        tone: "sky",
        cardBorder: "border-l-4 border-l-sky-500",
      };
  }
}

function AlertsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [category, setCategory] = useState(searchParams.get("category") || "all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [activeNoteBoxId, setActiveNoteBoxId] = useState<string | null>(null);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

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

  const selectCategory = (catId: string) => {
    setCategory(catId);
    router.replace(catId === "all" ? "/portal/alerts" : `/portal/alerts?category=${catId}`, {
      scroll: false,
    });
  };

  const countsByCategory = data?.counts_by_category || {};
  const countsBySeverity = data?.counts_by_severity || {};
  const countsByStatus = data?.counts_by_status || {};
  const alerts: any[] = data?.alerts || [];
  const tasks: any[] = data?.review_tasks || [];

  return (
    <div className="space-y-4 sm:space-y-5 animate-portal-in">
      <PortalPageHeader
        icon={<BellRing className="w-5 h-5" />}
        title="Exception Alerts & Supervision"
        subtitle="Audit discounts, cash variance, expiry exposure, supplier cost spikes, and sync health."
        actions={<PortalRefreshButton loading={loading} onClick={() => void loadAlerts()} />}
      />

      {/* Executive Alert KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <PortalKpiCard
          label="Open Alerts"
          value={String(countsByStatus.open || 0)}
          subtext="Needs owner supervision"
          icon={<BellRing className="w-4 h-4" />}
          tone={(countsByStatus.open || 0) > 0 ? "rose" : "default"}
          active={statusFilter === "open"}
          onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")}
        />
        <PortalKpiCard
          label="Critical Severity"
          value={String(countsBySeverity.critical || 0)}
          subtext="High-priority anomalies"
          icon={<ShieldAlert className="w-4 h-4" />}
          tone={(countsBySeverity.critical || 0) > 0 ? "amber" : "default"}
          active={severityFilter === "critical"}
          onClick={() =>
            setSeverityFilter(severityFilter === "critical" ? "all" : "critical")
          }
        />
        <PortalKpiCard
          label="Acknowledged"
          value={String(countsByStatus.acknowledged || 0)}
          subtext="Under counter review"
          icon={<Clock className="w-4 h-4" />}
          tone="sky"
          active={statusFilter === "acknowledged"}
          onClick={() =>
            setStatusFilter(statusFilter === "acknowledged" ? "all" : "acknowledged")
          }
        />
        <PortalKpiCard
          label="Resolved"
          value={String(countsByStatus.resolved || 0)}
          subtext="Closed audit exceptions"
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="emerald"
          active={statusFilter === "resolved"}
          onClick={() => setStatusFilter(statusFilter === "resolved" ? "all" : "resolved")}
        />
      </div>

      {/* Category & Filter Bar */}
      <PortalSectionCard className="p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {CATEGORY_TABS.map((t) => {
            const count =
              t.id === "all"
                ? countsByCategory.all ?? alerts.length
                : countsByCategory[t.id] || 0;
            const active = category === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectCategory(t.id)}
                className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? "bg-[#009A4D] text-white shadow-xs shadow-emerald-600/20"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                <span>{t.label}</span>
                {count > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold tabular-nums ${
                      active ? "bg-white/20 text-white" : "bg-white text-slate-700"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:border-[#009A4D]"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open Only</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:border-[#009A4D]"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical Only</option>
            <option value="warning">Warning Only</option>
            <option value="info">Review / Info</option>
          </select>

          {(category !== "all" || statusFilter !== "all" || severityFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                selectCategory("all");
                setStatusFilter("all");
                setSeverityFilter("all");
              }}
              className="text-xs font-bold text-[#009A4D] hover:underline px-2 py-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </PortalSectionCard>

      {/* Exception Alerts Feed */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <PortalSectionCard>
            <PortalEmptyState
              icon={<CheckCircle2 className="w-7 h-7 text-[#009A4D]" />}
              title="All Clear — No Matching Alerts"
              description="No operational exceptions match your selected filters right now."
            />
          </PortalSectionCard>
        ) : (
          alerts.map((alert) => {
            const sev = severityMeta(alert.severity);
            const isResolved = alert.resolution_status === "resolved";

            return (
              <div
                key={alert.id}
                className={`bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs transition-all space-y-3 ${
                  sev.cardBorder
                } ${isResolved ? "opacity-75" : ""}`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PortalStatusBadge tone={sev.tone} dot>
                        {sev.label}
                      </PortalStatusBadge>
                      <PortalStatusBadge tone="slate">{alert.category_label}</PortalStatusBadge>
                      {alert.resolution_status !== "open" && (
                        <PortalStatusBadge tone={isResolved ? "emerald" : "amber"}>
                          {alert.resolution_status}
                        </PortalStatusBadge>
                      )}
                      <span className="text-[11px] text-slate-400 font-medium">
                        {alert.pharmacy_name} • {formatDateTime(alert.occurred_at)}
                      </span>
                    </div>

                    <h3 className="text-sm sm:text-[15px] font-extrabold text-slate-900 leading-snug">
                      {alert.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{alert.description}</p>

                    <div className="flex items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500 flex-wrap">
                      <span>
                        Impact:{" "}
                        <strong className="text-slate-800">{alert.subject_label}</strong>
                      </span>
                      <span className="text-slate-300">•</span>
                      <span>
                        Ref:{" "}
                        <strong className="font-mono text-slate-800">
                          {alert.source_ref_label}
                        </strong>
                      </span>
                      {alert.resolution_note && (
                        <span className="w-full sm:w-auto text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200/60">
                          Note: &ldquo;{alert.resolution_note}&rdquo;
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Mobile-Friendly Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {alert.source_ref_type === "invoice" ? (
                      <button
                        type="button"
                        onClick={() => setSelectedInvoiceId(alert.source_ref_id)}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                      >
                        <span>View Invoice</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    ) : (
                      <Link
                        href={alert.href}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                      >
                        <span>Inspect</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}

                    {alert.resolution_status === "open" && (
                      <button
                        type="button"
                        disabled={updatingId === alert.id}
                        onClick={() => void updateAlertStatus(alert.id, "acknowledged")}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}

                    {alert.resolution_status !== "resolved" ? (
                      <button
                        type="button"
                        disabled={updatingId === alert.id}
                        onClick={() => void updateAlertStatus(alert.id, "resolved")}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-[#009A4D] text-xs font-bold hover:bg-emerald-100 disabled:opacity-50"
                      >
                        Resolve
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={updatingId === alert.id}
                        onClick={() => void updateAlertStatus(alert.id, "open")}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setActiveNoteBoxId(activeNoteBoxId === alert.id ? null : alert.id)
                      }
                      className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      Note
                    </button>
                  </div>
                </div>

                {/* Inline Note Box */}
                {activeNoteBoxId === alert.id && (
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={noteDrafts[alert.id] ?? alert.resolution_note ?? ""}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [alert.id]: e.target.value,
                        }))
                      }
                      placeholder="Add owner review note (e.g. Verified with counter pharmacist)…"
                      className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#009A4D]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void updateAlertStatus(
                          alert.id,
                          alert.resolution_status === "open"
                            ? "acknowledged"
                            : alert.resolution_status
                        )
                      }
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 shrink-0"
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

      {/* Owner Review Tasks Checklist */}
      <PortalSectionCard
        title="Owner Follow-Up & Review Tasks"
        subtitle="Personal pharmacy audit checklist saved privately in your owner cloud"
        icon={<CheckCircle2 className="w-4 h-4" />}
      >
        <div className="p-4 sm:p-5 space-y-4">
          <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add a store review task (e.g. Audit Friday evening shift discount invoices)…"
              className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#009A4D]"
            />
            <select
              value={newTaskCategory}
              onChange={(e) => setNewTaskCategory(e.target.value)}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white"
            >
              <option value="audit">Cash / Discount Audit</option>
              <option value="purchasing">Supplier / Stock</option>
              <option value="khata">Customer Collection</option>
            </select>
            <button
              type="submit"
              disabled={addingTask || !newTaskTitle.trim()}
              className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-[#009A4D] text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 shrink-0 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Task
            </button>
          </form>

          {tasks.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {tasks.map((t: any) => (
                <div
                  key={t.task_id}
                  className="py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => void toggleTaskStatus(t)}
                    className="flex items-center gap-3 text-left min-w-0 flex-1"
                  >
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        t.status === "completed"
                          ? "bg-[#009A4D] border-[#009A4D] text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {t.status === "completed" && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span
                      className={`leading-snug ${
                        t.status === "completed"
                          ? "line-through text-slate-400"
                          : "font-bold text-slate-800"
                      }`}
                    >
                      {t.title}
                    </span>
                  </button>
                  <PortalStatusBadge tone="slate">{t.category}</PortalStatusBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      </PortalSectionCard>

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
