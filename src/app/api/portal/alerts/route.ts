import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";

export type AlertCategory =
  | "discount_watch"
  | "cash_variance_watch"
  | "low_stock_watch"
  | "expiry_watch"
  | "supplier_price_watch"
  | "margin_watch"
  | "returns_watch"
  | "credit_watch"
  | "sync_health_watch";

export interface PortalAlertItem {
  id: string;
  category: AlertCategory;
  category_label: string;
  title: string;
  description: string;
  pharmacy_name: string;
  occurred_at: string;
  subject_label: string;
  amount_or_metric: number;
  severity: "critical" | "warning" | "info";
  source_ref_type:
    | "invoice"
    | "purchase"
    | "product"
    | "customer"
    | "drawer_session"
    | "return"
    | "sync";
  source_ref_id: string;
  source_ref_label: string;
  href: string;
  resolution_status: "open" | "acknowledged" | "resolved";
  resolution_note?: string;
  resolved_by?: string;
  resolved_at?: string;
}

/**
 * GET /api/portal/alerts
 * Evaluates all 9 deterministic Alert Categories in a single batched query.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const { searchParams } = new URL(req.url);
    const categoryFilter = searchParams.get("category") || "all";
    const statusFilter = searchParams.get("status") || "all"; // all | open | acknowledged | resolved
    const severityFilter = searchParams.get("severity") || "all";

    const cutoff14d = new Date(Date.now() - 14 * 86400_000);

    const [client, licenses, portalState, actionState, recentEvents] =
      await Promise.all([
        Client.findOne({ id: clientId }).select("name timezone").lean<any>(),
        License.find({ client_id: clientId, status: "active" })
          .select("id license_key")
          .lean<any[]>(),
        OwnerPortalState.findOne({ client_id: clientId })
          .sort({ captured_at: -1 })
          .lean<any>(),
        OwnerActionState.findOne({ client_id: clientId }).lean<any>(),
        AnalyticsEvent.find({
          client_id: clientId,
          occurred_at: { $gte: cutoff14d },
          type: { $in: ["sale.completed", "sale.returned", "purchase.received"] },
        })
          .sort({ occurred_at: -1 })
          .limit(200)
          .lean<any[]>(),
      ]);

    const licenseIds = licenses.map((l) => l.id);
    const seats =
      licenseIds.length > 0
        ? await LicenseSeat.find({ license_id: { $in: licenseIds } })
            .select("id terminal_number hostname last_seen_at")
            .lean<any[]>()
        : [];

    const pharmacyName =
      portalState?.pharmacy_name || client?.name || "AivraSol Pharmacy";

    const alertResolutionMap = new Map<string, any>();
    for (const r of actionState?.alert_states || []) {
      if (r?.alert_id) alertResolutionMap.set(r.alert_id, r);
    }

    const alerts: PortalAlertItem[] = [];

    const attachResolution = (
      item: Omit<
        PortalAlertItem,
        "resolution_status" | "resolution_note" | "resolved_by" | "resolved_at"
      >
    ): PortalAlertItem => {
      const res = alertResolutionMap.get(item.id);
      return {
        ...item,
        resolution_status: res?.status || "open",
        resolution_note: res?.note,
        resolved_by: res?.updated_by,
        resolved_at: res?.updated_at,
      };
    };

    // 1. Sync Health Watch
    const latestSyncCandidates: number[] = [];
    if (portalState?.captured_at) {
      latestSyncCandidates.push(new Date(portalState.captured_at).getTime());
    }
    if (recentEvents[0]?.occurred_at) {
      latestSyncCandidates.push(new Date(recentEvents[0].occurred_at).getTime());
    }
    for (const s of seats) {
      if (s.last_seen_at) {
        latestSyncCandidates.push(new Date(s.last_seen_at).getTime());
      }
    }
    const lastSyncMs =
      latestSyncCandidates.length > 0 ? Math.max(...latestSyncCandidates) : 0;
    const syncAgeMins = lastSyncMs
      ? Math.round((Date.now() - lastSyncMs) / 60_000)
      : null;

    if (syncAgeMins === null || syncAgeMins > 120) {
      const hours = syncAgeMins ? Math.round(syncAgeMins / 60) : null;
      alerts.push(
        attachResolution({
          id: `sync_health_${clientId}`,
          category: "sync_health_watch",
          category_label: "Sync Health Watch",
          title:
            syncAgeMins === null
              ? "POS Terminal Has Not Synced Yet"
              : `POS Sync Delayed (${hours}h since last sync)`,
          description:
            syncAgeMins === null
              ? "No POS synchronization payload has been received yet. Verify internet connectivity on the main POS counter."
              : `Last POS activity was received ${
                  hours && hours >= 24
                    ? `${Math.round(hours / 24)} day(s)`
                    : `${hours} hour(s)`
                } ago. Figures reflect the last synced state.`,
          pharmacy_name: pharmacyName,
          occurred_at: lastSyncMs
            ? new Date(lastSyncMs).toISOString()
            : new Date().toISOString(),
          subject_label:
            syncAgeMins === null ? "No sync received" : `${syncAgeMins} mins ago`,
          amount_or_metric: syncAgeMins || 9999,
          severity:
            syncAgeMins === null || syncAgeMins > 1440 ? "critical" : "warning",
          source_ref_type: "sync",
          source_ref_id: clientId,
          source_ref_label: "POS Cloud Sync",
          href: "/portal/dashboard",
        })
      );
    }

    // 2. Discount Watch & Margin Watch & Returns Watch from recent events
    for (const ev of recentEvents) {
      const p = ev.payload || {};
      const evType = ev.type || ev.event_type;
      const occurredIso = new Date(ev.occurred_at).toISOString();

      if (evType === "sale.completed") {
        const invId = p.invoice_id || ev.source_record_id || ev.event_id;
        const invNo = p.invoice_number || ev.source_record_id || invId;
        const total = Number(p.net_sales ?? p.total_amount ?? p.net_total ?? p.gross_sales ?? 0);
        const disc = Number(p.discount ?? p.discount_amount ?? 0);
        const subtotal = Number(p.gross_sales ?? p.subtotal ?? total + disc);
        const discPct =
          subtotal > 0 ? Number(((disc / subtotal) * 100).toFixed(1)) : 0;
        const cashierName = p.cashier || p.cashier_name || "POS Cashier";

        if (disc >= 300 || (disc >= 100 && discPct >= 10)) {
          alerts.push(
            attachResolution({
              id: `disc_${invId}`,
              category: "discount_watch",
              category_label: "Discount Watch",
              title: `High Discount on Invoice ${invNo} (${discPct}%)`,
              description: `Discount of Rs ${disc.toLocaleString()} (${discPct}% of Rs ${subtotal.toLocaleString()}) granted by ${cashierName}.`,
              pharmacy_name: pharmacyName,
              occurred_at: occurredIso,
              subject_label: `Rs ${disc.toLocaleString()} (${discPct}%)`,
              amount_or_metric: disc,
              severity: disc >= 1000 || discPct >= 20 ? "critical" : "warning",
              source_ref_type: "invoice",
              source_ref_id: invId,
              source_ref_label: invNo,
              href: `/portal/sales?invoice=${encodeURIComponent(invId)}`,
            })
          );
        }

        // Check negative/low margin on invoice when reliable cogs/cost_total exists
        const costTotal = Number(p.cogs ?? p.cost_total ?? 0);
        if (costTotal > 0 && total > 0 && total < costTotal) {
          const lossAmt = Number((costTotal - total).toFixed(2));
          alerts.push(
            attachResolution({
              id: `margin_inv_${invId}`,
              category: "margin_watch",
              category_label: "Margin Watch",
              title: `Negative-Margin Sale on Invoice ${invNo}`,
              description: `Invoice billed at Rs ${total.toLocaleString()} against verified WAC cost of Rs ${costTotal.toLocaleString()} (Net loss: Rs ${lossAmt.toLocaleString()}).`,
              pharmacy_name: pharmacyName,
              occurred_at: occurredIso,
              subject_label: `-Rs ${lossAmt.toLocaleString()}`,
              amount_or_metric: lossAmt,
              severity: "critical",
              source_ref_type: "invoice",
              source_ref_id: invId,
              source_ref_label: invNo,
              href: `/portal/sales?invoice=${encodeURIComponent(invId)}`,
            })
          );
        }
      } else if (evType === "sale.returned") {
        const retId = p.return_id || p.return_number || ev.source_record_id || ev.event_id;
        const invNo = p.invoice_number || p.invoice_id || ev.source_record_id || "POS Return";
        const retAmt = Math.abs(
          Number(p.return_amount ?? p.total_refund ?? p.total ?? 0)
        );
        const cashierName = p.cashier || p.cashier_name || p.operator_name || "POS Cashier";
        if (retAmt >= 500) {
          alerts.push(
            attachResolution({
              id: `ret_${retId}`,
              category: "returns_watch",
              category_label: "Returns Watch",
              title: `Sales Return of Rs ${retAmt.toLocaleString()} (${invNo})`,
              description: `Processed by ${cashierName} via ${p.refund_method || "cash"}${
                p.reason ? ` — Reason: "${p.reason}"` : ""
              }.`,
              pharmacy_name: pharmacyName,
              occurred_at: occurredIso,
              subject_label: `Rs ${retAmt.toLocaleString()}`,
              amount_or_metric: retAmt,
              severity: retAmt >= 2500 ? "critical" : "warning",
              source_ref_type: "return",
              source_ref_id: retId,
              source_ref_label: invNo,
              href: `/portal/returns?id=${encodeURIComponent(retId)}`,
            })
          );
        }
      }
    }

    // 3. Product-level Margin Watch from products_intelligence
    for (const prod of (portalState?.products_intelligence || []).slice(0, 150)) {
      if (prod.is_negative_margin && prod.sale_price > 0 && prod.cost_wac > prod.sale_price) {
        const lossPerUnit = Number((prod.cost_wac - prod.sale_price).toFixed(2));
        alerts.push(
          attachResolution({
            id: `margin_prod_${prod.product_id}`,
            category: "margin_watch",
            category_label: "Margin Watch",
            title: `Negative Margin Catalog Price: ${prod.name}`,
            description: `Selling price (Rs ${prod.sale_price.toLocaleString()}) is below verified WAC cost (Rs ${prod.cost_wac.toLocaleString()}), losing Rs ${lossPerUnit.toLocaleString()} per unit.`,
            pharmacy_name: pharmacyName,
            occurred_at: portalState?.captured_at
              ? new Date(portalState.captured_at).toISOString()
              : new Date().toISOString(),
            subject_label: `${prod.name} (-Rs ${lossPerUnit}/unit)`,
            amount_or_metric: lossPerUnit,
            severity: "critical",
            source_ref_type: "product",
            source_ref_id: prod.product_id,
            source_ref_label: prod.code || prod.name,
            href: `/portal/inventory?product=${encodeURIComponent(prod.product_id)}`,
          })
        );
      }
    }

    // 4. Cash Variance Watch (current drawer + recent drawer sessions + daily closings)
    const curDrawer = portalState?.current_drawer;
    if (curDrawer && typeof curDrawer.variance === "number" && Math.abs(curDrawer.variance) >= 50) {
      const v = curDrawer.variance;
      alerts.push(
        attachResolution({
          id: `cash_var_${curDrawer.session_id || "current"}`,
          category: "cash_variance_watch",
          category_label: "Cash Variance Watch",
          title: `Cash Drawer ${v < 0 ? "Shortage" : "Overage"} of Rs ${Math.abs(v).toLocaleString()}`,
          description: `Expected Rs ${Number(curDrawer.expected_cash || 0).toLocaleString()} vs Counted Rs ${Number(
            curDrawer.counted_cash || 0
          ).toLocaleString()} (${curDrawer.opened_by || "Cashier"}).`,
          pharmacy_name: pharmacyName,
          occurred_at:
            curDrawer.closed_at ||
            curDrawer.last_reconciled_at ||
            new Date().toISOString(),
          subject_label: `${v < 0 ? "-" : "+"}Rs ${Math.abs(v).toLocaleString()}`,
          amount_or_metric: Math.abs(v),
          severity: Math.abs(v) >= 500 ? "critical" : "warning",
          source_ref_type: "drawer_session",
          source_ref_id: curDrawer.session_id || "current",
          source_ref_label: curDrawer.drawer_name || "Counter Drawer",
          href: `/portal/cash?session=${encodeURIComponent(curDrawer.session_id || "current")}`,
        })
      );
    }

    for (const sess of (portalState?.drawer_sessions || []).slice(0, 15)) {
      if (sess.id === curDrawer?.session_id) continue;
      const v = Number(sess.variance || 0);
      if (Math.abs(v) >= 50) {
        alerts.push(
          attachResolution({
            id: `cash_var_${sess.id}`,
            category: "cash_variance_watch",
            category_label: "Cash Variance Watch",
            title: `Shift Closing ${v < 0 ? "Shortage" : "Overage"}: Rs ${Math.abs(v).toLocaleString()}`,
            description: `Business date ${sess.business_date} (${sess.opened_by || "Cashier"}): Expected Rs ${Number(
              sess.expected_cash || 0
            ).toLocaleString()}, Counted Rs ${Number(sess.counted_cash || 0).toLocaleString()}.`,
            pharmacy_name: pharmacyName,
            occurred_at: sess.closed_at || sess.opened_at || new Date().toISOString(),
            subject_label: `${v < 0 ? "-" : "+"}Rs ${Math.abs(v).toLocaleString()}`,
            amount_or_metric: Math.abs(v),
            severity: Math.abs(v) >= 500 ? "critical" : "warning",
            source_ref_type: "drawer_session",
            source_ref_id: sess.id,
            source_ref_label: `${sess.business_date} Shift`,
            href: `/portal/cash?session=${encodeURIComponent(sess.id)}`,
          })
        );
      }
    }

    // 5. Low Stock Watch
    for (const item of (portalState?.inventory_alerts?.low_stock_items || []).slice(0, 25)) {
      const stock = Number(item.current_stock ?? 0);
      const reorder = Number(item.reorder_level ?? 0);
      alerts.push(
        attachResolution({
          id: `low_stock_${item.product_id}`,
          category: "low_stock_watch",
          category_label: "Low Stock Watch",
          title:
            stock <= 0
              ? `Out of Stock: ${item.name}`
              : `Low Stock: ${item.name} (${stock} left)`,
          description:
            stock <= 0
              ? `${item.name} has 0 units remaining in stock (Reorder threshold: ${reorder || "Set threshold"}).`
              : `Current stock (${stock}) is at or below verified reorder level (${reorder}).`,
          pharmacy_name: pharmacyName,
          occurred_at: portalState?.captured_at
            ? new Date(portalState.captured_at).toISOString()
            : new Date().toISOString(),
          subject_label: `${stock} / ${reorder} units`,
          amount_or_metric: stock,
          severity: stock <= 0 ? "critical" : "warning",
          source_ref_type: "product",
          source_ref_id: item.product_id,
          source_ref_label: item.code || item.name,
          href: `/portal/inventory?product=${encodeURIComponent(item.product_id)}`,
        })
      );
    }

    // 6. Expiry Watch (Verified Expiring Batches + Unverified Migrated Expiry Review)
    for (const exp of (portalState?.inventory_alerts?.expiring_items || []).slice(0, 25)) {
      const days = Number(exp.days_left ?? 0);
      const val = Number(exp.value ?? 0);
      alerts.push(
        attachResolution({
          id: `exp_${exp.product_id}_${exp.batch_no || "batch"}`,
          category: "expiry_watch",
          category_label: "Expiry Watch",
          title:
            days <= 0
              ? `Expired Batch: ${exp.name} (Batch ${exp.batch_no || "N/A"})`
              : `Expiring in ${days}d: ${exp.name}`,
          description: `${exp.qty} units in batch ${
            exp.batch_no || "N/A"
          } expire on ${exp.expiry} (Stock at risk: Rs ${val.toLocaleString()}).`,
          pharmacy_name: pharmacyName,
          occurred_at: portalState?.captured_at
            ? new Date(portalState.captured_at).toISOString()
            : new Date().toISOString(),
          subject_label: `${exp.qty} units • Rs ${val.toLocaleString()}`,
          amount_or_metric: val,
          severity: days <= 15 ? "critical" : "warning",
          source_ref_type: "product",
          source_ref_id: exp.product_id,
          source_ref_label: `${exp.name} (${exp.batch_no || "Batch"})`,
          href: `/portal/inventory?product=${encodeURIComponent(exp.product_id)}`,
        })
      );
    }

    // Unverified legacy expiry items -> Flagged as "Expiry needs review" (NEVER "Expired")
    for (const unv of (portalState?.inventory_alerts?.unverified_expiry_items || []).slice(0, 15)) {
      alerts.push(
        attachResolution({
          id: `exp_review_${unv.product_id}_${unv.batch_no || "legacy"}`,
          category: "expiry_watch",
          category_label: "Expiry Watch",
          title: `Expiry Needs Review: ${unv.name}`,
          description: `Migrated batch (${unv.batch_no || "Legacy"}) with ${
            unv.qty
          } units has an unverified source expiry date. Please verify physical pack expiry in POS.`,
          pharmacy_name: pharmacyName,
          occurred_at: portalState?.captured_at
            ? new Date(portalState.captured_at).toISOString()
            : new Date().toISOString(),
          subject_label: `${unv.qty} units (Unverified Expiry)`,
          amount_or_metric: Number(unv.value || 0),
          severity: "info",
          source_ref_type: "product",
          source_ref_id: unv.product_id,
          source_ref_label: unv.code || unv.name,
          href: `/portal/inventory?filter=unverified_expiry&product=${encodeURIComponent(
            unv.product_id
          )}`,
        })
      );
    }

    // 7. Supplier Price Watch
    for (const spc of (portalState?.supplier_price_changes || []).slice(0, 20)) {
      alerts.push(
        attachResolution({
          id: `sup_price_${spc.id || `${spc.product_id}_${spc.grn_number}`}`,
          category: "supplier_price_watch",
          category_label: "Supplier Price Watch",
          title: `Purchase Cost +${spc.change_pct}%: ${spc.product_name}`,
          description: `Unit cost increased from Rs ${Number(
            spc.old_cost
          ).toLocaleString()} to Rs ${Number(spc.new_cost).toLocaleString()} (+Rs ${Number(
            spc.change_amount
          ).toLocaleString()}) from ${spc.supplier_name} on ${spc.grn_number}.`,
          pharmacy_name: pharmacyName,
          occurred_at: spc.date || new Date().toISOString(),
          subject_label: `Rs ${spc.old_cost} → Rs ${spc.new_cost} (+${spc.change_pct}%)`,
          amount_or_metric: Number(spc.change_pct || 0),
          severity: spc.change_pct >= 15 ? "critical" : "warning",
          source_ref_type: "purchase",
          source_ref_id: spc.purchase_id || spc.grn_number,
          source_ref_label: spc.grn_number,
          href: `/portal/purchases?grn=${encodeURIComponent(
            spc.purchase_id || spc.grn_number
          )}`,
        })
      );
    }

    // 8. Credit Watch (Overdue / high verified customer Khata balances)
    for (const cust of (portalState?.customers || []).slice(0, 40)) {
      const bal = Number(cust.credit_balance ?? cust.outstanding_balance ?? 0);
      const isOverdue =
        cust.credit_status === "overdue" || cust.is_overdue === true || bal >= 5000;
      if (bal > 0 && isOverdue) {
        alerts.push(
          attachResolution({
            id: `credit_due_${cust.id}`,
            category: "credit_watch",
            category_label: "Credit Watch",
            title: `Customer Khata Receivable: ${cust.name} (Rs ${bal.toLocaleString()})`,
            description: `Verified outstanding balance of Rs ${bal.toLocaleString()}${
              cust.last_payment_at
                ? ` • Last payment on ${new Date(cust.last_payment_at).toLocaleDateString()}`
                : " • No recent payment recorded"
            }.`,
            pharmacy_name: pharmacyName,
            occurred_at:
              cust.last_purchase_at ||
              (portalState?.captured_at
                ? new Date(portalState.captured_at).toISOString()
                : new Date().toISOString()),
            subject_label: `Rs ${bal.toLocaleString()}`,
            amount_or_metric: bal,
            severity: bal >= 10000 || cust.credit_status === "overdue" ? "critical" : "warning",
            source_ref_type: "customer",
            source_ref_id: cust.id,
            source_ref_label: cust.name,
            href: `/portal/khata?customer=${encodeURIComponent(cust.id)}`,
          })
        );
      }
    }

    // Sort alerts: open first, then critical > warning > info, then most recent
    const sevWeight = { critical: 3, warning: 2, info: 1 };
    const statusWeight = { open: 3, acknowledged: 2, resolved: 1 };
    alerts.sort((a, b) => {
      const sw = statusWeight[b.resolution_status] - statusWeight[a.resolution_status];
      if (sw !== 0) return sw;
      const sv = sevWeight[b.severity] - sevWeight[a.severity];
      if (sv !== 0) return sv;
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    });

    // Compute category counts before filtering
    const countsByCategory: Record<string, number> = {
      all: alerts.length,
      discount_watch: 0,
      cash_variance_watch: 0,
      low_stock_watch: 0,
      expiry_watch: 0,
      supplier_price_watch: 0,
      margin_watch: 0,
      returns_watch: 0,
      credit_watch: 0,
      sync_health_watch: 0,
    };
    const countsBySeverity = { critical: 0, warning: 0, info: 0 };
    const countsByStatus = { open: 0, acknowledged: 0, resolved: 0 };

    for (const a of alerts) {
      countsByCategory[a.category] = (countsByCategory[a.category] || 0) + 1;
      countsBySeverity[a.severity] += 1;
      countsByStatus[a.resolution_status] += 1;
    }

    const filtered = alerts.filter((a) => {
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (statusFilter !== "all" && a.resolution_status !== statusFilter) return false;
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      return true;
    });

    return NextResponse.json({
      ok: true,
      pharmacy_name: pharmacyName,
      counts_by_category: countsByCategory,
      counts_by_severity: countsBySeverity,
      counts_by_status: countsByStatus,
      alerts: filtered,
      review_tasks: actionState?.review_tasks || [],
    });
  } catch (err: any) {
    console.error("[api/portal/alerts] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load alerts", detail: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/portal/alerts
 * Lightweight cloud-side owner actions:
 * - Acknowledge / resolve / reopen an alert
 * - Mark a cash discrepancy reviewed
 * - Add / complete an owner review task
 * Never mutates POS accounting records.
 */
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const body = await req.json();
    const { action } = body;

    let doc = await OwnerActionState.findOne({ client_id: clientId });
    if (!doc) {
      doc = new OwnerActionState({
        client_id: clientId,
        alert_states: [],
        reorder_watchlist: [],
        cash_reviews: [],
        review_tasks: [],
      });
    }

    const nowIso = new Date().toISOString();
    const actorName = session.name || session.email || "Owner";

    if (action === "update_alert_status") {
      const { alert_id, status, note } = body;
      if (!alert_id || !["open", "acknowledged", "resolved"].includes(status)) {
        return NextResponse.json({ error: "Invalid alert_id or status" }, { status: 400 });
      }
      const existingIdx = (doc.alert_states || []).findIndex(
        (x: any) => x.alert_id === alert_id
      );
      const entry = {
        alert_id,
        status,
        note: note ? String(note).slice(0, 300) : undefined,
        updated_by: actorName,
        updated_at: nowIso,
      };
      const nextArr = [...(doc.alert_states || [])];
      if (existingIdx >= 0) {
        nextArr[existingIdx] = entry;
      } else {
        nextArr.unshift(entry);
      }
      doc.alert_states = nextArr.slice(0, 200);
      doc.markModified("alert_states");
      await doc.save();

      return NextResponse.json({ ok: true, alert_state: entry });
    }

    if (action === "review_cash_discrepancy") {
      const { session_id, business_date, status, note } = body;
      if (!session_id || !["reviewed", "flagged_for_audit"].includes(status)) {
        return NextResponse.json(
          { error: "Invalid session_id or review status" },
          { status: 400 }
        );
      }
      const entry = {
        session_id: String(session_id),
        business_date: business_date ? String(business_date) : undefined,
        status,
        note: note ? String(note).slice(0, 300) : undefined,
        reviewed_by: actorName,
        reviewed_at: nowIso,
      };
      const nextReviews = [
        entry,
        ...(doc.cash_reviews || []).filter((r: any) => r.session_id !== session_id),
      ].slice(0, 100);
      doc.cash_reviews = nextReviews;
      doc.markModified("cash_reviews");

      // Also acknowledge corresponding cash variance alert
      const alertId = `cash_var_${session_id}`;
      const nextAlerts = [
        {
          alert_id: alertId,
          status: status === "reviewed" ? ("resolved" as const) : ("acknowledged" as const),
          note: entry.note,
          updated_by: actorName,
          updated_at: nowIso,
        },
        ...(doc.alert_states || []).filter((a: any) => a.alert_id !== alertId),
      ].slice(0, 200);
      doc.alert_states = nextAlerts;
      doc.markModified("alert_states");

      await doc.save();
      return NextResponse.json({ ok: true, cash_review: entry });
    }

    if (action === "upsert_review_task") {
      const { task_id, title, category, ref_id, ref_href, status, note } = body;
      if (!title) {
        return NextResponse.json({ error: "Task title is required" }, { status: 400 });
      }
      const id = task_id || `task_${Date.now()}`;
      const entry = {
        task_id: id,
        title: String(title).slice(0, 160),
        category: String(category || "general"),
        ref_id: ref_id ? String(ref_id) : undefined,
        ref_href: ref_href ? String(ref_href) : undefined,
        status: status === "completed" ? ("completed" as const) : ("open" as const),
        note: note ? String(note).slice(0, 300) : undefined,
        updated_by: actorName,
        updated_at: nowIso,
      };
      const nextTasks = [
        entry,
        ...(doc.review_tasks || []).filter((t: any) => t.task_id !== id),
      ].slice(0, 100);
      doc.review_tasks = nextTasks;
      doc.markModified("review_tasks");
      await doc.save();

      return NextResponse.json({ ok: true, task: entry, review_tasks: doc.review_tasks });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err: any) {
    console.error("[api/portal/alerts] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save owner action", detail: err.message },
      { status: 500 }
    );
  }
}
