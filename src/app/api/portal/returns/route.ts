import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import { getClientDateRange, startOfDayInTz, endOfDayInTz } from "@/lib/analytics";

/**
 * GET /api/portal/returns
 *
 * Sales Returns & Purchase Returns Explorer with Bidirectional Links (Part H).
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") ?? "30d";
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const refundFilter = (searchParams.get("refund") ?? "all").toLowerCase();

    const clientId = session.client_id;

    const [client, portalState] = await Promise.all([
      Client.findOne({ id: clientId }).select("timezone name").lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
    ]);
    const timezone = client?.timezone ?? "Asia/Karachi";

    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    if (period === "today" || period === "7d" || period === "30d") {
      const r = getClientDateRange(timezone, period);
      rangeStart = r.start;
      rangeEnd = r.end;
    } else if (period === "custom" && (fromParam || toParam)) {
      if (fromParam) {
        const d = new Date(`${fromParam}T00:00:00Z`);
        if (!isNaN(d.getTime())) rangeStart = startOfDayInTz(d, timezone);
      }
      if (toParam) {
        const d = new Date(`${toParam}T00:00:00Z`);
        if (!isNaN(d.getTime())) rangeEnd = endOfDayInTz(d, timezone);
      }
    }

    const salesReturnMatch: Record<string, any> = {
      client_id: clientId,
      type: "sale.returned",
    };
    const purchaseReturnMatch: Record<string, any> = {
      client_id: clientId,
      type: "purchase.returned",
    };

    if (rangeStart || rangeEnd) {
      salesReturnMatch.occurred_at = {};
      purchaseReturnMatch.occurred_at = {};
      if (rangeStart) {
        salesReturnMatch.occurred_at.$gte = rangeStart;
        purchaseReturnMatch.occurred_at.$gte = rangeStart;
      }
      if (rangeEnd) {
        salesReturnMatch.occurred_at.$lte = rangeEnd;
        purchaseReturnMatch.occurred_at.$lte = rangeEnd;
      }
    }

    if (refundFilter !== "all" && ["cash", "card", "wallet", "credit"].includes(refundFilter)) {
      salesReturnMatch["payload.refund_method"] = refundFilter;
    }

    const [saleReturnEvents, purchaseReturnEvents] = await Promise.all([
      AnalyticsEvent.find(salesReturnMatch)
        .sort({ occurred_at: -1 })
        .limit(150)
        .lean<any[]>(),
      AnalyticsEvent.find(purchaseReturnMatch)
        .sort({ occurred_at: -1 })
        .limit(100)
        .lean<any[]>(),
    ]);

    let salesReturns = saleReturnEvents.map((e) => {
      const p = e.payload || {};
      const items = Array.isArray(p.items)
        ? p.items.map((i: any) => {
            const qty = Number(i.qty) || 0;
            const lineTotal = Number(i.line_total ?? i.revenue_reversed ?? 0);
            const unitPrice =
              i.unit_price !== undefined
                ? Number(i.unit_price)
                : qty > 0
                ? Math.round((lineTotal / qty) * 100) / 100
                : 0;
            return {
              product_id: i.product_id,
              code: i.code || null,
              product_name: i.product_name || i.product_id,
              unit: i.unit || "unit",
              qty,
              unit_price: Math.round(unitPrice * 100) / 100,
              discount: Math.round(Number(i.discount ?? 0) * 100) / 100,
              tax: Math.round(Number(i.tax ?? 0) * 100) / 100,
              line_total: Math.round(lineTotal * 100) / 100,
              cogs_reversed: Math.round(Number(i.cogs_reversed ?? 0) * 100) / 100,
            };
          })
        : [];

      return {
        id: p.return_id || e.source_record_id,
        event_id: e.event_id,
        return_number: p.return_number || e.source_record_id,
        return_type: p.return_type || (p.invoice_id || p.invoice_number ? "INVOICE" : "LOOSE"),
        invoice_id: p.invoice_id || null,
        invoice_number: p.invoice_number || null,
        customer_id: p.customer_id || null,
        customer_name: p.customer_name || "Walk-in Customer",
        refund_method: p.refund_method || "cash",
        reason: p.reason || null,
        cashier: p.cashier || "Cashier",
        terminal_number: e.terminal_number ?? p.terminal_number ?? 1,
        occurred_at: new Date(e.occurred_at).toISOString(),
        subtotal: Math.round(Number(p.subtotal ?? p.return_amount ?? 0) * 100) / 100,
        discount: Math.round(Number(p.discount ?? 0) * 100) / 100,
        tax: Math.round(Number(p.tax ?? 0) * 100) / 100,
        return_amount: Math.round(Number(p.return_amount ?? 0) * 100) / 100,
        cogs_reversed: Math.round(Number(p.cogs_reversed ?? 0) * 100) / 100,
        items_count: items.length,
        items,
      };
    });

    // Merge purchase returns from OwnerPortalState + purchase.returned events
    const purchaseReturnsMap = new Map<string, any>();
    const statePurchaseReturns: any[] = portalState?.purchase_returns || [];
    for (const r of statePurchaseReturns) {
      const rDate = new Date(r.date);
      if (rangeStart && rDate < rangeStart) continue;
      if (rangeEnd && rDate > rangeEnd) continue;
      const key = r.id || r.number;
      purchaseReturnsMap.set(key, {
        id: key,
        return_number: r.number || key,
        occurred_at: r.date,
        supplier_id: r.supplier_id || null,
        supplier_name: r.supplier_name || "Supplier",
        purchase_id: r.purchase_id || null,
        purchase_number: r.purchase_number || null,
        return_total: Math.round(Number(r.total ?? 0) * 100) / 100,
        reason: r.reason || null,
        operator_name: r.operator_name || null,
        items_count: Array.isArray(r.items) ? r.items.length : 0,
        items: (r.items || []).map((i: any) => ({
          product_id: i.product_id,
          code: i.code || null,
          name: i.name || i.product_id,
          qty: Number(i.qty) || 0,
          cost: Math.round(Number(i.cost ?? 0) * 100) / 100,
          line_total: Math.round(Number(i.line_total ?? 0) * 100) / 100,
        })),
      });
    }

    for (const e of purchaseReturnEvents) {
      const p = e.payload || {};
      const key = p.return_id || e.source_record_id;
      if (!purchaseReturnsMap.has(key)) {
        const items = Array.isArray(p.items)
          ? p.items.map((i: any) => ({
              product_id: i.product_id,
              code: i.code || null,
              name: i.name || i.product_id,
              qty: Number(i.qty) || 0,
              cost: Math.round(Number(i.cost ?? 0) * 100) / 100,
              line_total: Math.round(Number(i.line_total ?? 0) * 100) / 100,
            }))
          : [];
        purchaseReturnsMap.set(key, {
          id: key,
          return_number: p.return_number || key,
          occurred_at: new Date(e.occurred_at).toISOString(),
          supplier_id: p.supplier_id || null,
          supplier_name: p.supplier_name || "Supplier",
          purchase_id: p.purchase_id || null,
          purchase_number: p.purchase_number || null,
          return_total: Math.round(Number(p.return_total ?? 0) * 100) / 100,
          reason: p.reason || null,
          operator_name: p.operator_name || null,
          items_count: items.length,
          items,
        });
      }
    }

    let purchaseReturns = Array.from(purchaseReturnsMap.values()).sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );

    if (q) {
      salesReturns = salesReturns.filter(
        (r) =>
          r.return_number.toLowerCase().includes(q) ||
          (r.invoice_number && r.invoice_number.toLowerCase().includes(q)) ||
          r.customer_name.toLowerCase().includes(q) ||
          r.items.some((i: any) => i.product_name.toLowerCase().includes(q))
      );
      purchaseReturns = purchaseReturns.filter(
        (r) =>
          r.return_number.toLowerCase().includes(q) ||
          (r.purchase_number && r.purchase_number.toLowerCase().includes(q)) ||
          r.supplier_name.toLowerCase().includes(q) ||
          r.items.some((i: any) => i.name.toLowerCase().includes(q))
      );
    }

    const totalSalesReturnsAmount = salesReturns.reduce((s, r) => s + r.return_amount, 0);
    const totalPurchaseReturnsAmount = purchaseReturns.reduce((s, r) => s + r.return_total, 0);

    return NextResponse.json({
      sales_returns: salesReturns,
      purchase_returns: purchaseReturns,
      summary: {
        sales_returns_count: salesReturns.length,
        sales_returns_amount: Math.round(totalSalesReturnsAmount * 100) / 100,
        purchase_returns_count: purchaseReturns.length,
        purchase_returns_amount: Math.round(totalPurchaseReturnsAmount * 100) / 100,
      },
    });
  } catch (e: any) {
    console.error("Portal returns error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

