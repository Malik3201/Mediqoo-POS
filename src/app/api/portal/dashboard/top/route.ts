import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import Client from "@/models/Client";
import License from "@/models/License";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import { getClientDateRange } from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/top
 *
 * Returns top selling products, top profit products, and recent sales.
 *
 * Top products use the items[] array from sale.completed payload (per correction #6).
 * Sale returns correctly reduce product quantities/revenue/profit (per correction #6).
 *
 * Sale item schema (per event payload):
 *   items: [{ product_id, product_name, qty, revenue, cogs, gross_profit }]
 *
 * Return item schema (sale.returned payload):
 *   items: [{ product_id, product_name, qty, revenue, cogs, gross_profit }]
 *   (values represent what was returned — subtract from totals)
 *
 * Query params:
 *   period: "today" | "7d" | "30d" (default: "7d")
 *   license_id: optional
 *   limit: number (default: 10)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePortalSession(req);

    await connectToDatabase();

    const clientId = user.client_id;
    const periodParam = req.nextUrl.searchParams.get("period") ?? "7d";
    const licenseIdParam = req.nextUrl.searchParams.get("license_id");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "10"), 50);

    if (!["today", "7d", "30d"].includes(periodParam)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const client = await Client.findOne({ id: clientId }).select("timezone").lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";
    const { start, end } = getClientDateRange(timezone, periodParam as "today" | "7d" | "30d");

    if (licenseIdParam) {
      const licenseCheck = await License.findOne({ id: licenseIdParam, client_id: clientId }).lean();
      if (!licenseCheck) {
        return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      }
    }

    const matchFilter: Record<string, any> = {
      client_id: clientId,
      occurred_at: { $gte: start, $lte: end },
    };
    if (licenseIdParam) matchFilter.license_id = licenseIdParam;

    // ── Top Products (from sale items) ────────────────────────────────────
    // Fetch sales and returns for product-level aggregation
    const saleEvents = await AnalyticsEvent.find({
      ...matchFilter,
      type: "sale.completed",
    })
      .select("payload occurred_at")
      .lean();

    const returnEvents = await AnalyticsEvent.find({
      ...matchFilter,
      type: "sale.returned",
    })
      .select("payload")
      .lean();

    // Build product aggregation map
    const productMap = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        qty: number;
        revenue: number;
        cogs: number;
        gross_profit: number;
      }
    >();

    function aggregateItems(items: any[], multiplier: 1 | -1) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item?.product_id) continue;
        const existing = productMap.get(item.product_id) ?? {
          product_id: item.product_id,
          product_name: item.product_name ?? item.product_id,
          qty: 0,
          revenue: 0,
          cogs: 0,
          gross_profit: 0,
        };
        existing.qty += multiplier * (Number(item.qty) || 0);
        existing.revenue += multiplier * (Number(item.revenue) || 0);
        existing.cogs += multiplier * (Number(item.cogs) || 0);
        existing.gross_profit += multiplier * (Number(item.gross_profit) || 0);
        productMap.set(item.product_id, existing);
      }
    }

    // Add sales (positive) and subtract returns (negative) per product
    for (const ev of saleEvents) {
      aggregateItems(ev.payload?.items, 1);
    }
    for (const ev of returnEvents) {
      aggregateItems(ev.payload?.items, -1);
    }

    const allProducts = Array.from(productMap.values()).map((p) => ({
      ...p,
      qty: r2(p.qty),
      revenue: r2(p.revenue),
      cogs: r2(p.cogs),
      gross_profit: r2(p.gross_profit),
    }));

    const topByQty = [...allProducts]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);

    const topByProfit = [...allProducts]
      .sort((a, b) => b.gross_profit - a.gross_profit)
      .slice(0, limit);

    // ── Recent Sales ──────────────────────────────────────────────────────
    const recentSales = await AnalyticsEvent.find({
      ...matchFilter,
      type: "sale.completed",
    })
      .sort({ occurred_at: -1 })
      .limit(20)
      .select("occurred_at payload.invoice_number payload.gross_sales payload.net_sales payload.payment_method payload.customer_name")
      .lean();

    const recentSalesList = recentSales.map((ev) => ({
      occurred_at: ev.occurred_at,
      invoice_number: ev.payload?.invoice_number,
      gross_sales: ev.payload?.gross_sales,
      net_sales: ev.payload?.net_sales,
      payment_method: ev.payload?.payment_method,
      customer_name: ev.payload?.customer_name ?? null,
    }));

    return NextResponse.json({
      ok: true,
      period: periodParam,
      timezone,
      top_by_qty: topByQty,
      top_by_profit: topByProfit,
      recent_sales: recentSalesList,
    });
  } catch (err) {
    if (err instanceof PortalAuthError) return portalAuthErrorResponse(err);
    console.error("Dashboard top error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
