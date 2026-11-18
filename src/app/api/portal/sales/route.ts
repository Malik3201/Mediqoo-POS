import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import { getClientDateRange, startOfDayInTz, endOfDayInTz } from "@/lib/analytics";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DETAIL_RETENTION_DAYS = 30;

/**
 * GET /api/portal/sales
 *
 * Cursor-paginated Sales & Invoice Explorer (Part D & Part I).
 * Supports:
 * - period: "today" | "7d" | "30d" | "all" | "custom"
 * - from, to: YYYY-MM-DD (when period=custom)
 * - q: invoice number or customer name or product search
 * - payment: "all" | "cash" | "card" | "wallet" | "credit"
 * - cashier: cashier name filter
 * - filter: "all" | "high_discount" | "has_returns" | "credit"
 * - cursor: "<occurred_at_iso>|<event_id>"
 * - limit: number (20-30 default)
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
    const q = (searchParams.get("q") ?? "").trim();
    const payment = (searchParams.get("payment") ?? "all").toLowerCase();
    const cashier = (searchParams.get("cashier") ?? "all").trim();
    const filter = (searchParams.get("filter") ?? "all").toLowerCase();
    const cursor = searchParams.get("cursor");
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(5, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    const clientId = session.client_id;
    const client = await Client.findOne({ id: clientId })
      .select("timezone name")
      .lean<{ timezone?: string; name?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";

    // Resolve date boundaries
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

    // Build base filter (before cursor)
    const baseMatch: Record<string, any> = {
      client_id: clientId,
      type: "sale.completed",
    };

    if (rangeStart || rangeEnd) {
      baseMatch.occurred_at = {};
      if (rangeStart) baseMatch.occurred_at.$gte = rangeStart;
      if (rangeEnd) baseMatch.occurred_at.$lte = rangeEnd;
    }

    const andConditions: any[] = [];

    if (payment !== "all" && ["cash", "card", "wallet", "credit"].includes(payment)) {
      andConditions.push({
        $or: [
          { "payload.payment_method": payment },
          { "payload.paymentMethod": payment },
        ],
      });
    }

    if (cashier && cashier !== "all") {
      baseMatch["payload.cashier"] = cashier;
    }

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      andConditions.push({
        $or: [
          { "payload.invoice_number": regex },
          { "payload.invoiceNumber": regex },
          { source_record_id: regex },
          { "payload.customer_name": regex },
          { "payload.customerName": regex },
          { "payload.customer_phone": regex },
          { "payload.customerPhone": regex },
          { "payload.items.product_name": regex },
          { "payload.items.productName": regex },
          { "payload.items.name": regex },
        ],
      });
    }

    if (filter === "high_discount") {
      andConditions.push({
        $or: [
          { "payload.discount": { $gte: 500 } },
          {
            $expr: {
              $and: [
                {
                  $gt: [
                    {
                      $convert: {
                        input: { $ifNull: ["$payload.grossSales", { $ifNull: ["$payload.gross_sales", 0] }] },
                        to: "double",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                    0,
                  ],
                },
                {
                  $gte: [
                    {
                      $divide: [
                        {
                          $convert: {
                            input: { $ifNull: ["$payload.discount", 0] },
                            to: "double",
                            onError: 0,
                            onNull: 0,
                          },
                        },
                        {
                          $convert: {
                            input: { $ifNull: ["$payload.grossSales", { $ifNull: ["$payload.gross_sales", 1] }] },
                            to: "double",
                            onError: 0,
                            onNull: 1,
                          },
                        },
                      ],
                    },
                    0.15,
                  ],
                },
              ],
            },
          },
        ],
      });
    } else if (filter === "credit") {
      andConditions.push({
        $or: [
          { "payload.payment_method": "credit" },
          { "payload.paymentMethod": "credit" },
        ],
      });
    }

    // If filter === "has_returns", find invoice_ids / invoice_numbers that have sale.returned events
    let returnedInvoiceIds: Set<string> | null = null;
    let returnedInvoiceNumbers: Set<string> | null = null;
    const returnEvents = await AnalyticsEvent.find({
      client_id: clientId,
      type: "sale.returned",
    })
      .select("payload.invoice_id payload.invoice_number payload.return_amount payload.return_number")
      .lean();

    const returnsByInvoiceId = new Map<string, { count: number; amount: number; numbers: string[] }>();
    const returnsByInvoiceNo = new Map<string, { count: number; amount: number; numbers: string[] }>();

    for (const r of returnEvents as any[]) {
      const invId = r.payload?.invoice_id;
      const invNo = r.payload?.invoice_number;
      const amt = Number(r.payload?.return_amount) || 0;
      const rNo = r.payload?.return_number || r.source_record_id;
      if (invId) {
        const cur = returnsByInvoiceId.get(invId) || { count: 0, amount: 0, numbers: [] };
        cur.count++;
        cur.amount += amt;
        if (rNo) cur.numbers.push(rNo);
        returnsByInvoiceId.set(invId, cur);
      }
      if (invNo) {
        const cur = returnsByInvoiceNo.get(invNo) || { count: 0, amount: 0, numbers: [] };
        cur.count++;
        cur.amount += amt;
        if (rNo) cur.numbers.push(rNo);
        returnsByInvoiceNo.set(invNo, cur);
      }
    }

    if (filter === "has_returns") {
      returnedInvoiceIds = new Set(returnsByInvoiceId.keys());
      returnedInvoiceNumbers = new Set(returnsByInvoiceNo.keys());
      andConditions.push({
        $or: [
          { source_record_id: { $in: Array.from(returnedInvoiceIds) } },
          { "payload.invoice_id": { $in: Array.from(returnedInvoiceIds) } },
          { "payload.invoice_number": { $in: Array.from(returnedInvoiceNumbers) } },
        ],
      });
    }

    if (andConditions.length > 0) {
      baseMatch.$and = andConditions;
    }

    // Build cursor query
    const paginatedMatch: Record<string, any> = { ...baseMatch };
    if (cursor && cursor.includes("|")) {
      const [cursorIso, cursorEventId] = cursor.split("|");
      const cursorDate = new Date(cursorIso);
      if (!isNaN(cursorDate.getTime()) && cursorEventId) {
        const cursorCond = {
          $or: [
            { occurred_at: { $lt: cursorDate } },
            { occurred_at: cursorDate, event_id: { $lt: cursorEventId } },
          ],
        };
        paginatedMatch.$and = [...(paginatedMatch.$and || []), cursorCond];
      }
    }

    // Run paginated query + summary aggregation + distinct cashiers in parallel
    const [events, summaryAgg, cashiersList] = await Promise.all([
      AnalyticsEvent.find(paginatedMatch)
        .sort({ occurred_at: -1, event_id: -1 })
        .limit(limit + 1)
        .lean(),
      AnalyticsEvent.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: null,
            total_count: { $sum: 1 },
            gross_sales: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.grossSales", { $ifNull: ["$payload.gross_sales", { $ifNull: ["$payload.subtotal", 0] }] }] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            discount_total: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.discount", 0] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            tax_total: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.tax", 0] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            net_sales: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.netSales", { $ifNull: ["$payload.net_sales", { $ifNull: ["$payload.total", 0] }] }] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            cogs_total: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.cogs", 0] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            gross_profit: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.grossProfit", { $ifNull: ["$payload.gross_profit", 0] }] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            credit_sales: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      { $toLower: { $ifNull: ["$payload.paymentMethod", { $ifNull: ["$payload.payment_method", ""] }] } },
                      ["credit", "khata"],
                    ],
                  },
                  {
                    $convert: {
                      input: { $ifNull: ["$payload.netSales", { $ifNull: ["$payload.net_sales", 0] }] },
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
      ]),
      AnalyticsEvent.distinct("payload.cashier", {
        client_id: clientId,
        type: "sale.completed",
        "payload.cashier": { $exists: true, $nin: [null, ""] },
      }),
    ]);

    const hasMore = events.length > limit;
    const pageDocs = hasMore ? events.slice(0, limit) : events;
    const lastDoc: any = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && lastDoc
        ? `${new Date(lastDoc.occurred_at).toISOString()}|${lastDoc.event_id}`
        : null;

    const invoices = pageDocs.map((e: any) => {
      const p = e.payload || {};
      const invId = p.invoice_id || p.invoiceId || e.source_record_id;
      const invNo = p.invoice_number || p.invoiceNumber || e.source_record_id;
      const retInfo =
        returnsByInvoiceId.get(invId) ||
        returnsByInvoiceNo.get(invNo) || { count: 0, amount: 0, numbers: [] };

      const grossSales = Number(p.grossSales ?? p.gross_sales ?? p.subtotal ?? p.netSales ?? p.net_sales ?? 0);
      const discount = Number(p.discount ?? 0);
      const netSales = Number(p.netSales ?? p.net_sales ?? (grossSales - discount));
      const discountPct =
        grossSales > 0 ? Math.round((discount / grossSales) * 1000) / 10 : 0;

      return {
        id: invId,
        event_id: e.event_id,
        invoice_number: invNo,
        occurred_at: new Date(e.occurred_at).toISOString(),
        customer_id: p.customer_id || p.customerId || null,
        customer_name: p.customer_name || p.customerName || "Walk-in Customer",
        customer_phone: p.customer_phone || p.customerPhone || null,
        cashier: p.cashier || "Cashier",
        terminal_number: e.terminal_number ?? p.terminalNumber ?? p.terminal_number ?? 1,
        payment_method: String(p.paymentMethod ?? p.payment_method ?? "cash").toLowerCase(),
        status: p.status || "paid",
        gross_sales: Math.round(grossSales * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        discount_pct: discountPct,
        tax: Math.round(Number(p.tax ?? 0) * 100) / 100,
        net_sales: Math.round(netSales * 100) / 100,
        gross_profit: Math.round(Number(p.grossProfit ?? p.gross_profit ?? 0) * 100) / 100,
        items_count: Array.isArray(p.items) ? p.items.length : 0,
        items_archived: Boolean(p.items_archived),
        return_count: retInfo.count,
        returned_amount: Math.round(retInfo.amount * 100) / 100,
        return_numbers: retInfo.numbers,
      };
    });

    // Check if the query spans older than the 30-day detailed cloud retention window
    const retentionCutoff = new Date(Date.now() - DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const isOlderThanRetention =
      period === "all" || (rangeStart !== null && rangeStart.getTime() < retentionCutoff.getTime());

    // If no live events matched and user asked for "all" or older range, check HistoricalRecentSale
    let historicalRecentSales: any[] = [];
    if (invoices.length === 0 && !cursor && isOlderThanRetention) {
      const histDocs = await HistoricalRecentSale.find({ client_id: clientId })
        .sort({ occurred_at: -1 })
        .limit(limit)
        .lean();
      historicalRecentSales = histDocs.map((h: any) => ({
        id: h.invoice_number,
        event_id: `hist-${h.id || h.invoice_number}`,
        invoice_number: h.invoice_number,
        occurred_at: new Date(h.occurred_at).toISOString(),
        customer_id: null,
        customer_name: h.customer_name || "Walk-in Customer",
        customer_phone: null,
        cashier: "Historical POS",
        terminal_number: 1,
        payment_method: h.payment_method || "cash",
        status: "paid",
        gross_sales: Number(h.gross_sales) || 0,
        discount: Math.max(0, (Number(h.gross_sales) || 0) - (Number(h.net_sales) || 0)),
        discount_pct: 0,
        tax: 0,
        net_sales: Number(h.net_sales) || Number(h.gross_sales) || 0,
        gross_profit: 0,
        items_count: 0,
        items_archived: true,
        return_count: 0,
        returned_amount: 0,
        return_numbers: [],
      }));
    }

    const agg = summaryAgg[0] || {
      total_count: historicalRecentSales.length,
      gross_sales: historicalRecentSales.reduce((s, i) => s + i.gross_sales, 0),
      discount_total: historicalRecentSales.reduce((s, i) => s + i.discount, 0),
      tax_total: 0,
      net_sales: historicalRecentSales.reduce((s, i) => s + i.net_sales, 0),
      cogs_total: 0,
      gross_profit: 0,
      credit_sales: 0,
    };

    return NextResponse.json({
      invoices: invoices.length > 0 ? invoices : historicalRecentSales,
      next_cursor: nextCursor,
      has_more: hasMore,
      cashiers: (cashiersList as string[]).filter(Boolean).sort(),
      summary: {
        total_count: agg.total_count ?? 0,
        gross_sales: Math.round((agg.gross_sales ?? 0) * 100) / 100,
        discount_total: Math.round((agg.discount_total ?? 0) * 100) / 100,
        tax_total: Math.round((agg.tax_total ?? 0) * 100) / 100,
        net_sales: Math.round((agg.net_sales ?? 0) * 100) / 100,
        gross_profit: Math.round((agg.gross_profit ?? 0) * 100) / 100,
        credit_sales: Math.round((agg.credit_sales ?? 0) * 100) / 100,
      },
      retention_policy: {
        detail_retention_days: DETAIL_RETENTION_DAYS,
        includes_archived_window: isOlderThanRetention,
        notice: isOlderThanRetention
          ? `Detailed cloud line-item drill-down is retained for the most recent ${DETAIL_RETENTION_DAYS} days. Older daily/monthly financial totals remain available here, while full historical line-item archives are preserved in your local AivraSol POS and encrypted .aivrabak backups.`
          : null,
      },
    });
  } catch (e: any) {
    console.error("Portal sales list error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

