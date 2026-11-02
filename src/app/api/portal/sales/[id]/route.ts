import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";

/**
 * GET /api/portal/sales/[id]
 *
 * Full Invoice Detail endpoint (Part D).
 * Resolves by source_record_id, event_id, or payload.invoice_number.
 * Includes pharmacy header, invoice metadata, line items, totals, payment breakdown,
 * and linked sales returns.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const clientId = session.client_id;

    const [client, portalState, eventDoc] = await Promise.all([
      Client.findOne({ id: clientId })
        .select("id name email phone city address timezone")
        .lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .select("pharmacy_name pharmacy_phone pharmacy_address")
        .lean<any>(),
      AnalyticsEvent.findOne({
        client_id: clientId,
        type: "sale.completed",
        $or: [
          { source_record_id: decodedId },
          { event_id: decodedId },
          { "payload.invoice_id": decodedId },
          { "payload.invoice_number": decodedId },
        ],
      }).lean<any>(),
    ]);

    const pharmacyInfo = {
      name: portalState?.pharmacy_name || client?.name || session.client_name,
      phone: portalState?.pharmacy_phone || client?.phone || null,
      address: portalState?.pharmacy_address || client?.address || client?.city || null,
      email: client?.email || session.email,
      timezone: client?.timezone || "Asia/Karachi",
    };

    if (!eventDoc) {
      // Check HistoricalRecentSale fallback
      const hist = await HistoricalRecentSale.findOne({
        client_id: clientId,
        invoice_number: decodedId.replace(/^hist-/, ""),
      }).lean<any>();

      if (!hist) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }

      return NextResponse.json({
        pharmacy: pharmacyInfo,
        invoice: {
          id: hist.invoice_number,
          event_id: `hist-${hist.invoice_number}`,
          invoice_number: hist.invoice_number,
          occurred_at: new Date(hist.occurred_at).toISOString(),
          customer_id: null,
          customer_name: hist.customer_name || "Walk-in Customer",
          customer_phone: null,
          cashier: "Historical POS",
          terminal_number: 1,
          payment_method: hist.payment_method || "cash",
          status: "paid",
          subtotal: Number(hist.gross_sales) || 0,
          discount: Math.max(0, (Number(hist.gross_sales) || 0) - (Number(hist.net_sales) || 0)),
          tax: 0,
          grand_total: Number(hist.net_sales) || Number(hist.gross_sales) || 0,
          paid_amount: Number(hist.net_sales) || Number(hist.gross_sales) || 0,
          change_amount: 0,
          cogs: 0,
          gross_profit: 0,
          has_reliable_cogs: false,
          notes: null,
          items_archived: true,
          items: [],
          related_returns: [],
          returned_total: 0,
          net_effective_total: Number(hist.net_sales) || Number(hist.gross_sales) || 0,
        },
      });
    }

    const p = eventDoc.payload || {};
    const invId = p.invoice_id || eventDoc.source_record_id;
    const invNo = p.invoice_number || eventDoc.source_record_id;

    // Fetch related sales returns
    const returnDocs = await AnalyticsEvent.find({
      client_id: clientId,
      type: "sale.returned",
      $or: [
        { "payload.invoice_id": invId },
        { "payload.invoice_number": invNo },
      ],
    })
      .sort({ occurred_at: -1 })
      .lean<any[]>();

    const relatedReturns = returnDocs.map((r) => ({
      id: r.payload?.return_id || r.source_record_id,
      return_number: r.payload?.return_number || r.source_record_id,
      occurred_at: new Date(r.occurred_at).toISOString(),
      return_amount: Math.round(Number(r.payload?.return_amount ?? 0) * 100) / 100,
      refund_method: r.payload?.refund_method || "cash",
      reason: r.payload?.reason || null,
      cashier: r.payload?.cashier || "Cashier",
      items: Array.isArray(r.payload?.items)
        ? r.payload.items.map((ri: any) => ({
            product_id: ri.product_id,
            product_name: ri.product_name,
            qty: Number(ri.qty) || 0,
            unit: ri.unit || "unit",
            unit_price:
              ri.unit_price !== undefined
                ? Number(ri.unit_price)
                : Number(ri.qty) > 0
                ? Math.round((Number(ri.revenue_reversed ?? ri.line_total ?? 0) / Number(ri.qty)) * 100) / 100
                : 0,
            line_total: Math.round(Number(ri.line_total ?? ri.revenue_reversed ?? 0) * 100) / 100,
          }))
        : [],
    }));

    const returnedTotal = relatedReturns.reduce((s, r) => s + r.return_amount, 0);
    const subtotal = Number(p.gross_sales ?? p.net_sales ?? 0);
    const discount = Number(p.discount ?? 0);
    const tax = Number(p.tax ?? 0);
    const grandTotal = Number(p.net_sales ?? subtotal - discount + tax);

    const items = Array.isArray(p.items)
      ? p.items.map((item: any, idx: number) => {
          const qty = Number(item.qty) || 0;
          const revenue = Number(item.revenue ?? item.line_total ?? 0);
          const discountAmt = Number(item.discount_amt ?? 0);
          const taxAmt = Number(item.tax_amt ?? 0);
          const derivedUnitPrice =
            item.unit_price !== undefined && Number(item.unit_price) > 0
              ? Number(item.unit_price)
              : qty > 0
              ? Math.round(((revenue + discountAmt - taxAmt) / qty) * 100) / 100
              : 0;
          const cogs = Number(item.cogs ?? 0);
          const grossProfit = Number(item.gross_profit ?? revenue - cogs);

          return {
            index: idx + 1,
            product_id: item.product_id,
            code: item.code || null,
            product_name: item.product_name || item.product_id,
            unit: item.unit || item.unit_type || "unit",
            multiplier: Number(item.multiplier ?? item.unit_multiplier ?? 1),
            qty,
            unit_price: Math.round(derivedUnitPrice * 100) / 100,
            discount_amt: Math.round(discountAmt * 100) / 100,
            discount_pct: Number(item.discount_pct ?? 0),
            tax_pct: Number(item.tax_pct ?? 0),
            tax_amt: Math.round(taxAmt * 100) / 100,
            line_total: Math.round((Number(item.line_total ?? revenue) || 0) * 100) / 100,
            cogs: Math.round(cogs * 100) / 100,
            gross_profit: Math.round(grossProfit * 100) / 100,
          };
        })
      : [];

    const totalCogs = Number(p.cogs ?? 0);
    const hasReliableCogs = p.has_reliable_cogs !== undefined ? Boolean(p.has_reliable_cogs) : totalCogs > 0;

    return NextResponse.json({
      pharmacy: pharmacyInfo,
      invoice: {
        id: invId,
        event_id: eventDoc.event_id,
        invoice_number: invNo,
        occurred_at: new Date(eventDoc.occurred_at).toISOString(),
        received_at: eventDoc.received_at ? new Date(eventDoc.received_at).toISOString() : null,
        customer_id: p.customer_id || null,
        customer_name: p.customer_name || "Walk-in Customer",
        customer_phone: p.customer_phone || null,
        cashier: p.cashier || "Cashier",
        terminal_number: eventDoc.terminal_number ?? p.terminal_number ?? 1,
        payment_method: p.payment_method || "cash",
        status:
          returnedTotal >= grandTotal - 0.01 && grandTotal > 0
            ? "refunded"
            : returnedTotal > 0.01
            ? "partially_returned"
            : p.status || "paid",
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        grand_total: Math.round(grandTotal * 100) / 100,
        paid_amount: Math.round(Number(p.paid_amount ?? grandTotal) * 100) / 100,
        change_amount: Math.round(Number(p.change_amount ?? 0) * 100) / 100,
        cogs: Math.round(totalCogs * 100) / 100,
        gross_profit: Math.round(Number(p.gross_profit ?? grandTotal - totalCogs) * 100) / 100,
        has_reliable_cogs: hasReliableCogs,
        notes: p.notes || null,
        items_archived: Boolean(p.items_archived),
        items,
        related_returns: relatedReturns,
        returned_total: Math.round(returnedTotal * 100) / 100,
        net_effective_total: Math.max(0, Math.round((grandTotal - returnedTotal) * 100) / 100),
      },
    });
  } catch (e: any) {
    console.error("Portal invoice detail error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

