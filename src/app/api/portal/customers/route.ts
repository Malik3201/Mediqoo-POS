import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerCustomerMeta from "@/models/OwnerCustomerMeta";

/**
 * GET /api/portal/customers
 *
 * Customers & Khata (Credit Management) Directory (Part F).
 * Merges OwnerPortalState.customers with live credit invoices / payments / returns
 * and OwnerCustomerMeta follow-up notes.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const statusFilter = (searchParams.get("status") ?? "all").toLowerCase();
    const sortBy = (searchParams.get("sort") ?? "balance_desc").toLowerCase();

    const clientId = session.client_id;

    const [portalState, ownerMetas, creditEvents] = await Promise.all([
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerCustomerMeta.find({ client_id: clientId }).lean<any[]>(),
      AnalyticsEvent.find({
        client_id: clientId,
        $or: [
          { type: "sale.completed", "payload.payment_method": "credit" },
          { type: "khata.payment" },
        ],
      })
        .sort({ occurred_at: -1 })
        .limit(500)
        .lean<any[]>(),
    ]);

    const metaMap = new Map<string, any>();
    for (const m of ownerMetas) {
      metaMap.set(m.customer_id, {
        follow_up_status: m.follow_up_status || "none",
        promised_date: m.promised_date || null,
        owner_note: m.owner_note || null,
        updated_at: m.updated_at ? new Date(m.updated_at).toISOString() : null,
      });
    }

    const customerMap = new Map<string, any>();
    const stateCustomers: any[] = portalState?.customers || [];

    for (const c of stateCustomers) {
      const id = c.id || c.name;
      const meta = metaMap.get(id) || {
        follow_up_status: "none",
        promised_date: null,
        owner_note: null,
      };
      customerMap.set(id, {
        id,
        name: c.name || "Customer",
        phone: c.phone || null,
        address: c.address || null,
        notes: c.notes || null,
        opening_balance: Math.round(Number(c.opening_balance ?? 0) * 100) / 100,
        credit_balance: Math.round(Number(c.credit_balance ?? 0) * 100) / 100,
        total_credit_sales: Math.round(Number(c.total_credit_sales ?? 0) * 100) / 100,
        total_returns_deducted: Math.round(Number(c.total_returns_deducted ?? 0) * 100) / 100,
        total_payments: Math.round(Number(c.total_payments ?? 0) * 100) / 100,
        last_purchase_at: c.last_purchase_at || null,
        last_payment_at: c.last_payment_at || null,
        credit_status: c.credit_status || (Number(c.credit_balance ?? 0) > 0 ? "due" : "clear"),
        is_migrated: Boolean(c.is_migrated),
        owner_meta: meta,
      });
    }

    // Also ensure any customer seen in live credit sales or khata.payment events is represented
    for (const ev of creditEvents) {
      const p = ev.payload || {};
      const custId = p.customer_id || p.customer_name;
      const custName = p.customer_name || "Customer";
      if (!custId || custName === "Walk-in Customer") continue;

      if (!customerMap.has(custId)) {
        const meta = metaMap.get(custId) || {
          follow_up_status: "none",
          promised_date: null,
          owner_note: null,
        };
        customerMap.set(custId, {
          id: custId,
          name: custName,
          phone: p.customer_phone || null,
          address: null,
          notes: null,
          opening_balance: 0,
          credit_balance: 0,
          total_credit_sales: 0,
          total_returns_deducted: 0,
          total_payments: 0,
          last_purchase_at: null,
          last_payment_at: null,
          credit_status: "clear",
          is_migrated: false,
          owner_meta: meta,
          _derived_from_events: true,
        });
      }

      const entry = customerMap.get(custId)!;
      if (entry._derived_from_events) {
        const iso = new Date(ev.occurred_at).toISOString();
        if (ev.type === "sale.completed") {
          const amt = Number(p.net_sales ?? p.gross_sales ?? 0);
          entry.total_credit_sales = Math.round((entry.total_credit_sales + amt) * 100) / 100;
          entry.credit_balance = Math.round((entry.credit_balance + amt) * 100) / 100;
          if (!entry.last_purchase_at || iso > entry.last_purchase_at) entry.last_purchase_at = iso;
        } else if (ev.type === "khata.payment") {
          const amt = Number(p.amount ?? 0);
          entry.total_payments = Math.round((entry.total_payments + amt) * 100) / 100;
          entry.credit_balance = Math.round((entry.credit_balance - amt) * 100) / 100;
          if (!entry.last_payment_at || iso > entry.last_payment_at) entry.last_payment_at = iso;
        }
        entry.credit_status = entry.credit_balance > 0.01 ? "due" : entry.credit_balance < -0.01 ? "advance" : "clear";
      }
    }

    let customers = Array.from(customerMap.values()).map((c) => {
      delete c._derived_from_events;
      return c;
    });

    // Compute global summary before filtering
    let totalReceivable = 0;
    let totalAdvance = 0;
    let dueCount = 0;
    let overdueCount = 0;
    let followUpCount = 0;

    for (const c of customers) {
      if (c.credit_balance > 0.01) {
        totalReceivable += c.credit_balance;
        dueCount++;
        if (c.credit_status === "overdue" || c.credit_balance >= 5000) overdueCount++;
      } else if (c.credit_balance < -0.01) {
        totalAdvance += Math.abs(c.credit_balance);
      }
      if (c.owner_meta?.follow_up_status && c.owner_meta.follow_up_status !== "none") {
        followUpCount++;
      }
    }

    // Apply search & filter
    if (q) {
      customers = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.toLowerCase().includes(q)) ||
          (c.owner_meta?.owner_note && c.owner_meta.owner_note.toLowerCase().includes(q))
      );
    }

    if (statusFilter === "due") {
      customers = customers.filter((c) => c.credit_balance > 0.01);
    } else if (statusFilter === "overdue") {
      customers = customers.filter((c) => c.credit_status === "overdue" || c.credit_balance >= 5000);
    } else if (statusFilter === "advance") {
      customers = customers.filter((c) => c.credit_balance < -0.01);
    } else if (statusFilter === "clear") {
      customers = customers.filter((c) => Math.abs(c.credit_balance) <= 0.01);
    } else if (statusFilter === "follow_up") {
      customers = customers.filter(
        (c) => c.owner_meta?.follow_up_status && c.owner_meta.follow_up_status !== "none"
      );
    }

    // Sort
    if (sortBy === "name") {
      customers.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "recent") {
      customers.sort((a, b) => {
        const aTime = Math.max(
          a.last_purchase_at ? new Date(a.last_purchase_at).getTime() : 0,
          a.last_payment_at ? new Date(a.last_payment_at).getTime() : 0
        );
        const bTime = Math.max(
          b.last_purchase_at ? new Date(b.last_purchase_at).getTime() : 0,
          b.last_payment_at ? new Date(b.last_payment_at).getTime() : 0
        );
        return bTime - aTime;
      });
    } else {
      customers.sort((a, b) => b.credit_balance - a.credit_balance);
    }

    return NextResponse.json({
      customers,
      summary: {
        total_customers: customerMap.size,
        total_receivable: Math.round(totalReceivable * 100) / 100,
        total_advance: Math.round(totalAdvance * 100) / 100,
        due_count: dueCount,
        overdue_count: overdueCount,
        follow_up_count: followUpCount,
      },
    });
  } catch (e: any) {
    console.error("Portal customers error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

