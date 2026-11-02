import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerCustomerMeta from "@/models/OwnerCustomerMeta";

/**
 * GET /api/portal/customers/[id]
 *
 * Customer Khata Detail, Chronological Running Ledger Statement, and Owner Notes (Part F).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    const clientId = session.client_id;

    const [client, portalState, ownerMeta] = await Promise.all([
      Client.findOne({ id: clientId }).select("name phone address city email timezone").lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerCustomerMeta.findOne({ client_id: clientId, customer_id: decodedId }).lean<any>(),
    ]);

    const stateCustomers: any[] = portalState?.customers || [];
    const matchedCustomer = stateCustomers.find(
      (c) =>
        c.id === decodedId ||
        (c.name && c.name.trim().toLowerCase() === decodedId.trim().toLowerCase())
    );

    const customerId = matchedCustomer?.id || decodedId;
    const customerName = matchedCustomer?.name || decodedId;

    // Fetch credit sales, returns, and khata payments for this customer
    const escapedName = customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRegex = new RegExp(`^${escapedName}$`, "i");

    const [saleDocs, returnDocs, eventPayments] = await Promise.all([
      AnalyticsEvent.find({
        client_id: clientId,
        type: "sale.completed",
        $or: [
          { "payload.customer_id": customerId },
          { "payload.customer_name": nameRegex },
        ],
      })
        .sort({ occurred_at: 1 })
        .limit(300)
        .lean<any[]>(),
      AnalyticsEvent.find({
        client_id: clientId,
        type: "sale.returned",
        $or: [
          { "payload.customer_id": customerId },
          { "payload.customer_name": nameRegex },
        ],
      })
        .sort({ occurred_at: 1 })
        .limit(200)
        .lean<any[]>(),
      AnalyticsEvent.find({
        client_id: clientId,
        type: "khata.payment",
        $or: [
          { "payload.customer_id": customerId },
          { "payload.customer_name": nameRegex },
        ],
      })
        .sort({ occurred_at: 1 })
        .limit(200)
        .lean<any[]>(),
    ]);

    // Merge Khata payments from OwnerPortalState + khata.payment events
    const statePayments: any[] = (portalState?.khata_payments || []).filter(
      (p: any) =>
        p.customer_id === customerId ||
        (p.customer_name && p.customer_name.trim().toLowerCase() === customerName.trim().toLowerCase())
    );

    const paymentsMap = new Map<string, any>();
    for (const p of statePayments) {
      paymentsMap.set(p.id, {
        id: p.id,
        date: p.date,
        amount: Math.round(Number(p.amount ?? 0) * 100) / 100,
        method: p.method || "cash",
        reference: p.reference || null,
        note: p.note || null,
        operator_name: p.operator_name || null,
      });
    }
    for (const ev of eventPayments) {
      const pid = ev.payload?.payment_id || ev.source_record_id;
      if (!paymentsMap.has(pid)) {
        paymentsMap.set(pid, {
          id: pid,
          date: new Date(ev.occurred_at).toISOString(),
          amount: Math.round(Number(ev.payload?.amount ?? 0) * 100) / 100,
          method: ev.payload?.method || "cash",
          reference: ev.payload?.reference || null,
          note: ev.payload?.note || null,
          operator_name: ev.payload?.operator_name || null,
        });
      }
    }

    // Build chronological running ledger
    const openingBalance = Math.round(Number(matchedCustomer?.opening_balance ?? 0) * 100) / 100;

    type LedgerRawEntry = {
      id: string;
      date: string;
      type: "opening" | "credit_sale" | "payment_received" | "credit_return";
      reference: string;
      description: string;
      debit: number;  // increases customer debt
      credit: number; // reduces customer debt
      invoice_id?: string;
      method?: string;
    };

    const rawEntries: LedgerRawEntry[] = [];

    for (const s of saleDocs) {
      const p = s.payload || {};
      if (p.payment_method !== "credit") continue;
      const amt = Math.round(Number(p.net_sales ?? p.gross_sales ?? 0) * 100) / 100;
      const invNo = p.invoice_number || s.source_record_id;
      rawEntries.push({
        id: `sale-${s.source_record_id}`,
        date: new Date(s.occurred_at).toISOString(),
        type: "credit_sale",
        reference: invNo,
        description: `Credit Invoice ${invNo} (${Array.isArray(p.items) ? p.items.length : 0} items)`,
        debit: amt,
        credit: 0,
        invoice_id: p.invoice_id || s.source_record_id,
        method: "credit",
      });
    }

    for (const r of returnDocs) {
      const p = r.payload || {};
      if (p.refund_method && p.refund_method !== "credit") continue;
      const amt = Math.round(Number(p.return_amount ?? 0) * 100) / 100;
      const rNo = p.return_number || r.source_record_id;
      rawEntries.push({
        id: `ret-${r.source_record_id}`,
        date: new Date(r.occurred_at).toISOString(),
        type: "credit_return",
        reference: rNo,
        description: p.invoice_number
          ? `Credit Return ${rNo} (against ${p.invoice_number})`
          : `Credit Return ${rNo}`,
        debit: 0,
        credit: amt,
        invoice_id: p.invoice_id || undefined,
        method: "credit",
      });
    }

    for (const pay of paymentsMap.values()) {
      rawEntries.push({
        id: `pay-${pay.id}`,
        date: pay.date,
        type: "payment_received",
        reference: pay.reference || `PAY-${String(pay.id).slice(0, 6).toUpperCase()}`,
        description: pay.note
          ? `Payment Received (${pay.method.toUpperCase()}) — ${pay.note}`
          : `Payment Received (${pay.method.toUpperCase()})`,
        debit: 0,
        credit: pay.amount,
        method: pay.method,
      });
    }

    rawEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = openingBalance;
    const fullLedger: Array<LedgerRawEntry & { running_balance: number }> = [];

    if (openingBalance !== 0 || rawEntries.length === 0) {
      fullLedger.push({
        id: "opening-balance",
        date: rawEntries[0]?.date || new Date().toISOString(),
        type: "opening",
        reference: "OPENING",
        description: "Opening / Brought-Forward Khata Balance",
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
        running_balance: openingBalance,
      });
    }

    for (const entry of rawEntries) {
      runningBalance = Math.round((runningBalance + entry.debit - entry.credit) * 100) / 100;
      fullLedger.push({
        ...entry,
        running_balance: runningBalance,
      });
    }

    // Apply optional statement date filter
    let filteredLedger = fullLedger;
    if (fromDate || toDate) {
      const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
      const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER;
      filteredLedger = fullLedger.filter((l) => {
        if (l.type === "opening") return true;
        const t = new Date(l.date).getTime();
        return t >= fromMs && t <= toMs;
      });
    }

    const authoritativeBalance =
      matchedCustomer?.credit_balance !== undefined
        ? Math.round(Number(matchedCustomer.credit_balance) * 100) / 100
        : runningBalance;

    return NextResponse.json({
      pharmacy: {
        name: portalState?.pharmacy_name || client?.name || session.client_name,
        phone: portalState?.pharmacy_phone || client?.phone || null,
        address: portalState?.pharmacy_address || client?.address || client?.city || null,
      },
      customer: {
        id: customerId,
        name: customerName,
        phone: matchedCustomer?.phone || null,
        address: matchedCustomer?.address || null,
        notes: matchedCustomer?.notes || null,
        opening_balance: openingBalance,
        credit_balance: authoritativeBalance,
        total_credit_sales:
          matchedCustomer?.total_credit_sales ??
          Math.round(rawEntries.filter((e) => e.type === "credit_sale").reduce((s, e) => s + e.debit, 0) * 100) / 100,
        total_returns_deducted:
          matchedCustomer?.total_returns_deducted ??
          Math.round(rawEntries.filter((e) => e.type === "credit_return").reduce((s, e) => s + e.credit, 0) * 100) / 100,
        total_payments:
          matchedCustomer?.total_payments ??
          Math.round(rawEntries.filter((e) => e.type === "payment_received").reduce((s, e) => s + e.credit, 0) * 100) / 100,
        last_purchase_at: matchedCustomer?.last_purchase_at || null,
        last_payment_at: matchedCustomer?.last_payment_at || null,
        credit_status:
          matchedCustomer?.credit_status ||
          (authoritativeBalance > 0.01 ? "due" : authoritativeBalance < -0.01 ? "advance" : "clear"),
        is_migrated: Boolean(matchedCustomer?.is_migrated),
        owner_meta: {
          follow_up_status: ownerMeta?.follow_up_status || "none",
          promised_date: ownerMeta?.promised_date || null,
          owner_note: ownerMeta?.owner_note || null,
          updated_at: ownerMeta?.updated_at ? new Date(ownerMeta.updated_at).toISOString() : null,
        },
      },
      ledger: filteredLedger.slice().reverse(), // newest first for UI display, chronological available for statement
      ledger_chronological: filteredLedger,
    });
  } catch (e: any) {
    console.error("Portal customer detail error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/portal/customers/[id]
 *
 * Updates lightweight owner-only follow-up status and notes for a credit account
 * without mutating POS accounting balances (Part F).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const { id } = await params;
    const customerId = decodeURIComponent(id);
    const body = await req.json();

    const validStatuses = ["none", "promised_to_pay", "follow_up_needed", "disputed", "vip"];
    const followUpStatus = validStatuses.includes(body.follow_up_status)
      ? body.follow_up_status
      : "none";
    const promisedDate =
      typeof body.promised_date === "string" && body.promised_date.trim()
        ? body.promised_date.trim()
        : undefined;
    const ownerNote =
      typeof body.owner_note === "string" ? body.owner_note.trim().slice(0, 1000) : "";

    const updated = await OwnerCustomerMeta.findOneAndUpdate(
      { client_id: session.client_id, customer_id: customerId },
      {
        $set: {
          follow_up_status: followUpStatus,
          promised_date: promisedDate,
          owner_note: ownerNote,
          updated_by: session.email,
        },
      },
      { upsert: true, new: true }
    ).lean<any>();

    return NextResponse.json({
      ok: true,
      owner_meta: {
        follow_up_status: updated.follow_up_status,
        promised_date: updated.promised_date || null,
        owner_note: updated.owner_note || null,
        updated_at: updated.updated_at ? new Date(updated.updated_at).toISOString() : null,
      },
    });
  } catch (e: any) {
    console.error("Portal customer meta update error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

