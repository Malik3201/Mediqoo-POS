import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import OwnerPortalState from "@/models/OwnerPortalState";
import Client from "@/models/Client";
import { isCloudDashboardEnabled } from "@/lib/status";
import { meterFinalizedInvoiceUsage } from "@/lib/metering";
import { extractRequestGeo } from "@/lib/geo-location";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-license-key, x-terminal-id, x-machine-id",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const VALID_TYPES = new Set([
  "sale.completed",
  "sale.returned",
  "purchase.received",
  "purchase.returned",
  "khata.payment",
  "supplier.payment",
  "drawer.session",
  "daily.closing",
  "expense.created",
  "expense.updated",
  "expense.deleted",
]);

const MAX_EVENTS_PER_BATCH = 50;

function normalizeAnalyticsPayload(type: string, raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const p = { ...raw };

  const num = (v: any, fallback = 0) => {
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };

  if (type === "sale.completed") {
    const invNo = p.invoiceNumber || p.invoice_number || "";
    const invId = p.invoiceId || p.invoice_id || "";
    const custName = p.customerName || p.customer_name || "Walk-in Customer";
    const custPhone = p.customerPhone || p.customer_phone || "";
    const custId = p.customerId || p.customer_id || null;
    const pm = (p.paymentMethod || p.payment_method || "cash").toLowerCase();
    const gross = num(p.grossSales ?? p.gross_sales ?? p.subtotal ?? p.total);
    const disc = num(p.discount ?? 0);
    const tax = num(p.tax ?? 0);
    const net = num(p.netSales ?? p.net_sales ?? p.total ?? (gross - disc + tax));
    const paid = num(p.paidAmount ?? p.paid_amount ?? p.paid ?? net);
    const change = num(p.changeAmount ?? p.change_amount ?? p.change ?? 0);
    const cogs = num(p.cogs ?? 0);
    const gp = num(p.grossProfit ?? p.gross_profit ?? (net - cogs));
    const cashier = p.cashier || "Cashier";
    const term = p.terminalNumber ?? p.terminal_number ?? 1;

    p.invoiceNumber = invNo;
    p.invoice_number = invNo;
    p.invoiceId = invId;
    p.invoice_id = invId;
    p.customerName = custName;
    p.customer_name = custName;
    p.customerPhone = custPhone;
    p.customer_phone = custPhone;
    p.customerId = custId;
    p.customer_id = custId;
    p.paymentMethod = pm;
    p.payment_method = pm;
    p.grossSales = gross;
    p.gross_sales = gross;
    p.subtotal = gross;
    p.discount = disc;
    p.tax = tax;
    p.netSales = net;
    p.net_sales = net;
    p.total = net;
    p.paidAmount = paid;
    p.paid_amount = paid;
    p.changeAmount = change;
    p.change_amount = change;
    p.cogs = cogs;
    p.grossProfit = gp;
    p.gross_profit = gp;
    p.cashier = cashier;
    p.terminalNumber = term;
    p.terminal_number = term;

    if (Array.isArray(p.items)) {
      p.items = p.items.map((it: any) => {
        const pId = it.productId || it.product_id || "";
        const pName = it.productName || it.product_name || it.name || pId;
        const qty = num(it.qty ?? 0);
        const uPrice = num(it.unitPrice ?? it.unit_price ?? it.price ?? 0);
        const lTotal = num(it.lineTotal ?? it.line_total ?? it.revenue ?? (qty * uPrice));
        const rev = num(it.revenue ?? lTotal);
        const iCogs = num(it.cogs ?? 0);
        const iGp = num(it.grossProfit ?? it.gross_profit ?? (rev - iCogs));
        const dAmt = num(it.discountAmt ?? it.discount_amt ?? 0);
        const dPct = num(it.discountPct ?? it.discount_pct ?? 0);
        const tAmt = num(it.taxAmt ?? it.tax_amt ?? 0);
        const tPct = num(it.taxPct ?? it.tax_pct ?? 0);

        return {
          ...it,
          productId: pId,
          product_id: pId,
          productName: pName,
          product_name: pName,
          name: pName,
          code: it.code || "",
          unit: it.unit || "unit",
          multiplier: num(it.multiplier ?? 1),
          qty,
          unitPrice: uPrice,
          unit_price: uPrice,
          price: uPrice,
          discountAmt: dAmt,
          discount_amt: dAmt,
          discountPct: dPct,
          discount_pct: dPct,
          taxAmt: tAmt,
          tax_amt: tAmt,
          taxPct: tPct,
          tax_pct: tPct,
          lineTotal: lTotal,
          line_total: lTotal,
          revenue: rev,
          cogs: iCogs,
          grossProfit: iGp,
          gross_profit: iGp,
        };
      });
    }
  } else if (type === "sale.returned") {
    const retId = p.returnId || p.return_id || "";
    const retNo = p.returnNumber || p.return_number || "";
    const invId = p.invoiceId || p.invoice_id || null;
    const invNo = p.invoiceNumber || p.invoice_number || null;
    const custName = p.customerName || p.customer_name || "Walk-in Customer";
    const refMethod = (p.refundMethod || p.refund_method || p.refund || "cash").toLowerCase();
    const retAmt = num(p.returnAmount ?? p.return_amount ?? p.total ?? 0);
    const cogsRev = num(p.cogsReversed ?? p.cogs_reversed ?? 0);

    p.returnId = retId;
    p.return_id = retId;
    p.returnNumber = retNo;
    p.return_number = retNo;
    p.invoiceId = invId;
    p.invoice_id = invId;
    p.invoiceNumber = invNo;
    p.invoice_number = invNo;
    p.customerName = custName;
    p.customer_name = custName;
    p.refundMethod = refMethod;
    p.refund_method = refMethod;
    p.returnAmount = retAmt;
    p.return_amount = retAmt;
    p.total = retAmt;
    p.cogsReversed = cogsRev;
    p.cogs_reversed = cogsRev;

    if (Array.isArray(p.items)) {
      p.items = p.items.map((it: any) => {
        const pId = it.productId || it.product_id || "";
        const pName = it.productName || it.product_name || it.name || pId;
        const qty = num(it.qty ?? 0);
        const revRev = num(it.revenueReversed ?? it.revenue_reversed ?? it.lineTotal ?? it.line_total ?? 0);
        const cogsR = num(it.cogsReversed ?? it.cogs_reversed ?? 0);
        const gpRev = num(it.grossProfitReversed ?? it.gross_profit_reversed ?? (revRev - cogsR));
        return {
          ...it,
          productId: pId,
          product_id: pId,
          productName: pName,
          product_name: pName,
          name: pName,
          qty,
          lineTotal: revRev,
          line_total: revRev,
          revenueReversed: revRev,
          revenue_reversed: revRev,
          cogsReversed: cogsR,
          cogs_reversed: cogsR,
          grossProfitReversed: gpRev,
          gross_profit_reversed: gpRev,
        };
      });
    }
  } else if (type === "purchase.received") {
    const purId = p.purchaseId || p.purchase_id || "";
    const purNo = p.purchaseNumber || p.purchase_number || p.grn || "";
    const supId = p.supplierId || p.supplier_id || "";
    const supName = p.supplierName || p.supplier_name || p.supplier || "";
    const purTot = num(p.purchaseTotal ?? p.purchase_total ?? p.total ?? 0);
    const paid = num(p.paidAmount ?? p.paid_amount ?? p.paid ?? 0);

    p.purchaseId = purId;
    p.purchase_id = purId;
    p.purchaseNumber = purNo;
    p.purchase_number = purNo;
    p.grn = purNo;
    p.supplierId = supId;
    p.supplier_id = supId;
    p.supplierName = supName;
    p.supplier_name = supName;
    p.supplier = supName;
    p.purchaseTotal = purTot;
    p.purchase_total = purTot;
    p.total = purTot;
    p.paidAmount = paid;
    p.paid_amount = paid;

    if (Array.isArray(p.lines)) {
      p.lines = p.lines.map((l: any) => ({
        ...l,
        productId: l.productId || l.product_id || "",
        product_id: l.productId || l.product_id || "",
        name: l.name || l.productName || l.product_name || "",
        productName: l.productName || l.product_name || l.name || "",
        product_name: l.productName || l.product_name || l.name || "",
        cost: num(l.cost ?? 0),
        cost_price: num(l.cost ?? l.cost_price ?? 0),
        qty: num(l.qty ?? 0),
        freeQty: num(l.freeQty ?? l.free_qty ?? 0),
        free_qty: num(l.freeQty ?? l.free_qty ?? 0),
        lineTotal: num(l.lineTotal ?? l.line_total ?? 0),
        line_total: num(l.lineTotal ?? l.line_total ?? 0),
      }));
    }
  } else if (type === "purchase.returned") {
    const pretId = p.returnId || p.return_id || "";
    const pretNo = p.returnNumber || p.return_number || "";
    const supId = p.supplierId || p.supplier_id || "";
    const supName = p.supplierName || p.supplier_name || "Supplier";
    const purId = p.purchaseId || p.purchase_id || null;
    const purNo = p.purchaseNumber || p.purchase_number || null;
    const tot = num(p.returnTotal ?? p.return_total ?? p.total ?? 0);

    p.returnId = pretId;
    p.return_id = pretId;
    p.returnNumber = pretNo;
    p.return_number = pretNo;
    p.supplierId = supId;
    p.supplier_id = supId;
    p.supplierName = supName;
    p.supplier_name = supName;
    p.purchaseId = purId;
    p.purchase_id = purId;
    p.purchaseNumber = purNo;
    p.purchase_number = purNo;
    p.returnTotal = tot;
    p.return_total = tot;
    p.total = tot;

    if (Array.isArray(p.items)) {
      p.items = p.items.map((it: any) => ({
        ...it,
        productId: it.productId || it.product_id || "",
        product_id: it.productId || it.product_id || "",
        name: it.name || it.productName || it.product_name || "",
        productName: it.productName || it.product_name || it.name || "",
        product_name: it.productName || it.product_name || it.name || "",
        qty: num(it.qty ?? 0),
        cost: num(it.cost ?? 0),
        lineTotal: num(it.lineTotal ?? it.line_total ?? 0),
        line_total: num(it.lineTotal ?? it.line_total ?? 0),
      }));
    }
  } else if (type === "khata.payment") {
    const payId = p.paymentId || p.payment_id || "";
    const custId = p.customerId || p.customer_id || "";
    const custName = p.customerName || p.customer_name || "Customer";
    const amt = num(p.amount ?? 0);
    const m = (p.method || "cash").toLowerCase();

    p.paymentId = payId;
    p.payment_id = payId;
    p.customerId = custId;
    p.customer_id = custId;
    p.customerName = custName;
    p.customer_name = custName;
    p.amount = amt;
    p.method = m;
  } else if (type === "supplier.payment") {
    const payId = p.paymentId || p.payment_id || "";
    const supId = p.supplierId || p.supplier_id || "";
    const supName = p.supplierName || p.supplier_name || "Supplier";
    const amt = num(p.amount ?? 0);
    const m = (p.method || "cash").toLowerCase();

    p.paymentId = payId;
    p.payment_id = payId;
    p.supplierId = supId;
    p.supplier_id = supId;
    p.supplierName = supName;
    p.supplier_name = supName;
    p.amount = amt;
    p.method = m;
  }
  return p;
}

/**
 * POST /api/public/analytics/events
 *
 * POS analytics event ingestion endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const license_key = (
      body?.license_key ||
      req.headers.get("x-license-key") ||
      ""
    ).trim();

    const machine_id = (
      body?.machine_id ||
      req.headers.get("x-terminal-id") ||
      req.headers.get("x-machine-id") ||
      ""
    ).trim();

    const events = body?.events;

    if (!license_key || !machine_id) {
      return NextResponse.json(
        { error: "missing_fields", message: "license_key and machine_id are required." },
        { status: 400, headers: CORS }
      );
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "invalid_events", message: "events must be a non-empty array." },
        { status: 400, headers: CORS }
      );
    }

    if (events.length > MAX_EVENTS_PER_BATCH) {
      return NextResponse.json(
        { error: "too_many_events", message: `Maximum ${MAX_EVENTS_PER_BATCH} events per batch.` },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // ── Step 1: Resolve License ───────────────────────────────────────────
    const license = await License.findOne({ license_key }).lean<{
      id: string; client_id: string; project_id: string;
      status: string; features: any;
    }>();

    if (!license) {
      return NextResponse.json(
        { error: "invalid_license", message: "License not found." },
        { status: 401, headers: CORS }
      );
    }

    if (license.status !== "active") {
      return NextResponse.json(
        { error: "license_not_active", status: license.status },
        { status: 403, headers: CORS }
      );
    }

    // ── Step 2: Feature flag check ────────────────────────────────────────
    if (!isCloudDashboardEnabled(license)) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Cloud dashboard is not enabled for this license." },
        { status: 403, headers: CORS }
      );
    }

    // ── Step 3: Verify registered seat (per correction #7) + silent geo ───
    const seatUpdate: Record<string, any> = { last_seen_at: new Date() };
    try {
      const client = license.client_id
        ? await Client.findOne({ id: license.client_id }).lean()
        : null;
      const geo = extractRequestGeo(
        req,
        body?.location,
        client?.address || client?.name
      );
      if (geo) {
        seatUpdate.location = geo;
        if (client && client.location?.source !== "admin_manual") {
          await Client.updateOne({ id: client.id }, { $set: { location: geo } });
        }
      }
    } catch {
      // Never block event ingestion on geolocation
    }

    const seat = await LicenseSeat.findOneAndUpdate(
      {
        license_id: license.id,
        machine_id: String(machine_id),
      },
      { $set: seatUpdate },
      { new: true }
    ).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json(
        { error: "machine_not_registered", message: "This machine is not registered for this license." },
        { status: 401, headers: CORS }
      );
    }

    // ── Step 4: Process each event ────────────────────────────────────────
    const portalResetState = await OwnerPortalState.findOne({
      client_id: license.client_id,
    })
      .select("last_data_reset_at")
      .lean<{ last_data_reset_at?: Date }>();
    const lastResetMs = portalResetState?.last_data_reset_at
      ? new Date(portalResetState.last_data_reset_at).getTime()
      : 0;

    const results: Array<{ event_id: string; duplicate: boolean; error?: string }> = [];

    for (const ev of events) {
      const { event_id, type, source_record_id, occurred_at, payload: rawPayload } = ev ?? {};

      if (!event_id || !type || !source_record_id || !occurred_at || !rawPayload) {
        results.push({ event_id: event_id ?? "unknown", duplicate: false, error: "missing_fields" });
        continue;
      }

      if (!VALID_TYPES.has(type)) {
        results.push({ event_id, duplicate: false, error: "invalid_type" });
        continue;
      }

      let occurredAtDate = new Date(occurred_at);
      if (isNaN(occurredAtDate.getTime()) && typeof occurred_at === "string") {
        // Robust fallback for localized date strings e.g. "18/11/2026, 1:04:46 pm" or "18/11/2026"
        const dmyMatch = occurred_at.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
        if (dmyMatch) {
          const day = parseInt(dmyMatch[1], 10);
          const month = parseInt(dmyMatch[2], 10) - 1;
          const year = parseInt(dmyMatch[3], 10);
          let hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 12;
          const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
          const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
          const ampm = dmyMatch[7]?.toLowerCase();
          if (ampm === "pm" && hours < 12) hours += 12;
          if (ampm === "am" && hours === 12) hours = 0;
          const parsed = new Date(year, month, day, hours, minutes, seconds);
          if (!isNaN(parsed.getTime())) occurredAtDate = parsed;
        }
      }

      if (isNaN(occurredAtDate.getTime())) {
        results.push({ event_id, duplicate: false, error: "invalid_occurred_at" });
        continue;
      }

      // Ignore any stale pre-reset events that occurred before the latest POS factory data reset
      if (lastResetMs > 0 && occurredAtDate.getTime() <= lastResetMs + 2000) {
        results.push({ event_id, duplicate: true });
        continue;
      }

      // ── Strict Multi-Seat & Historical Deduplication ──
      // Check if this source record has already been ingested under this license (e.g. from Desktop or Mobile)
      const existingRecord = await AnalyticsEvent.findOne({
        license_id: license.id,
        type,
        source_record_id: String(source_record_id),
      }).select("event_id").lean();

      if (existingRecord) {
        results.push({ event_id, duplicate: true });
        continue;
      }

      const payload = normalizeAnalyticsPayload(type, rawPayload);

      // Idempotent insert — catch duplicate-key error
      try {
        await AnalyticsEvent.create({
          event_id,
          client_id: license.client_id,        // server-resolved
          project_id: license.project_id,       // server-resolved
          license_id: license.id,               // server-resolved
          seat_id: seat.id,                     // server-resolved
          terminal_number: seat.terminal_number, // server-resolved
          type,
          source_record_id: String(source_record_id),
          occurred_at: occurredAtDate,
          received_at: new Date(),
          payload,
        });

        // Side effect: update CloudExpense projection for expense events
        if (type.startsWith("expense.")) {
          await upsertExpenseProjection(
            license.client_id,
            license.id,
            String(source_record_id),
            type,
            payload,
            occurredAtDate
          );
        }

        results.push({ event_id, duplicate: false });
      } catch (e: any) {
        if (e.code === 11000) {
          // Duplicate event_id — idempotent: return success with duplicate flag
          results.push({ event_id, duplicate: true });
        } else {
          console.error(`Error storing event ${event_id}:`, e);
          results.push({ event_id, duplicate: false, error: "storage_error" });
          continue; // skip metering on failure
        }
      }

      // ── Step 5: Auto-Meter Finalized Sales ────────────────────────────
      if (type === "sale.completed") {
        try {
          const meterRes = await meterFinalizedInvoiceUsage({
            license,
            seat,
            invoiceUuid: String(source_record_id),
            invoiceNumber: typeof payload?.invoice_number === "string" ? payload.invoice_number : undefined,
            occurredAt: occurredAtDate,
            terminalId: String(machine_id),
            terminalNumber: seat.terminal_number,
          });
          
          if (meterRes.status === "rejected") {
            console.error(`Analytics Auto-Meter rejected for ${source_record_id}:`, meterRes.reason);
          }
        } catch (meterErr) {
          console.error(`Analytics Auto-Meter exception for ${source_record_id}:`, meterErr);
        }
      }
    }

    return NextResponse.json({ ok: true, results }, { headers: CORS });
  } catch (e: any) {
    console.error("Analytics events error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}

async function upsertExpenseProjection(
  clientId: string,
  licenseId: string,
  sourceRecordId: string,
  type: string,
  payload: any,
  occurredAt: Date
) {
  const filter = { client_id: clientId, license_id: licenseId, source_record_id: sourceRecordId };

  if (type === "expense.deleted") {
    await CloudExpense.findOneAndUpdate(
      filter,
      {
        $set: {
          is_deleted: true,
          amount: 0,
          source_updated_at: occurredAt,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (type === "expense.created" || type === "expense.updated") {
    const amount = Number(payload?.amount ?? 0);
    const category = payload?.category ?? undefined;
    const occurredAtDate = payload?.occurred_at ? new Date(payload.occurred_at) : occurredAt;

    await CloudExpense.findOneAndUpdate(
      {
        ...filter,
        $or: [
          { source_updated_at: { $exists: false } },
          { source_updated_at: { $lt: occurredAt } },
        ],
      },
      {
        $set: {
          amount,
          category,
          occurred_at: occurredAtDate,
          is_deleted: false,
          source_updated_at: occurredAt,
        },
        $setOnInsert: { client_id: clientId, license_id: licenseId, source_record_id: sourceRecordId },
      },
      { upsert: true }
    );
  }
}
