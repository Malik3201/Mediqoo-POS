import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import Client from "@/models/Client";
import License from "@/models/License";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import HistoricalTopProduct from "@/models/HistoricalTopProduct";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import {
  requirePortalSession,
  PortalAuthError,
  portalAuthErrorResponse,
} from "@/lib/portal-auth";
import { getClientDateRange, splitDateRange } from "@/lib/analytics";

/**
 * GET /api/portal/dashboard/top
 *
 * Returns top selling products, top profit products, and recent sales.
 * Combines HistoricalTopProduct/HistoricalRecentSale with live AnalyticsEvents.
 *
 * NOTE on Top Products Bootstrap:
 * HistoricalTopProduct is a single aggregated blob representing the entire
 * bootstrap period (e.g. all-time or last 90 days). If the requested date range (e.g. 7d)
 * overlaps the bootstrap cutoff, the *entire* historical blob is included.
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

    // 1. Resolve licenses
    let targetLicenses: string[] = [];
    if (licenseIdParam) {
      const licenseCheck = await License.findOne({ id: licenseIdParam, client_id: clientId }).lean();
      if (!licenseCheck) return NextResponse.json({ error: "License not found or access denied" }, { status: 403 });
      targetLicenses = [licenseIdParam];
    } else {
      const licenses = await License.find({ client_id: clientId }).select("id").lean<{ id: string }[]>();
      targetLicenses = licenses.map((l) => l.id);
    }

    // 2. Fetch bootstraps
    const bootstraps = await AnalyticsBootstrap.find({
      client_id: clientId,
      license_id: { $in: targetLicenses },
      status: "completed",
    }).lean();
    
    const bootstrapMap = new Map<string, any>();
    for (const b of bootstraps) {
      const existing = bootstrapMap.get(b.license_id);
      if (!existing || b.bootstrap_version > existing.bootstrap_version) {
        bootstrapMap.set(b.license_id, b);
      }
    }

    // Maps for aggregation
    const productMap = new Map<string, { product_id: string; product_name: string; qty: number; revenue: number; cogs: number; gross_profit: number; }>();
    const recentSalesList: any[] = [];

    // Helper for live products
    function aggregateItems(items: any[], multiplier: 1 | -1) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item?.product_id) continue;
        const existing = productMap.get(item.product_id) ?? {
          product_id: item.product_id,
          product_name: item.product_name ?? item.product_id,
          qty: 0, revenue: 0, cogs: 0, gross_profit: 0,
        };
        existing.qty += multiplier * (Number(item.qty) || 0);
        existing.revenue += multiplier * (Number(item.revenue) || 0);
        existing.cogs += multiplier * (Number(item.cogs) || 0);
        existing.gross_profit += multiplier * (Number(item.gross_profit) || 0);
        productMap.set(item.product_id, existing);
      }
    }

    // 3. Process each license
    for (const licId of targetLicenses) {
      const bootstrap = bootstrapMap.get(licId);
      const cutoffUtc = bootstrap ? bootstrap.bootstrap_cutoff_utc : null;
      
      const { historical, live } = splitDateRange(start, end, cutoffUtc, timezone);

      // --- Historical ---
      if (historical) {
        // Fetch HistoricalTopProduct
        const hProducts = await HistoricalTopProduct.find({
          client_id: clientId,
          license_id: licId,
        }).lean();

        for (const p of hProducts) {
          const existing = productMap.get(p.product_id) ?? {
            product_id: p.product_id,
            product_name: p.product_name ?? p.product_id,
            qty: 0, revenue: 0, cogs: 0, gross_profit: 0,
          };
          existing.qty += (p.qty || 0);
          existing.revenue += (p.revenue || 0);
          existing.cogs += (p.cogs || 0);
          existing.gross_profit += (p.gross_profit || 0);
          productMap.set(p.product_id, existing);
        }

        // Fetch HistoricalRecentSale
        const hSales = await HistoricalRecentSale.find({
          client_id: clientId,
          license_id: licId,
        }).sort({ occurred_at: -1 }).limit(20).lean();
        
        recentSalesList.push(...hSales.map(s => ({
          occurred_at: s.occurred_at,
          invoice_number: s.invoice_number,
          gross_sales: s.gross_sales,
          net_sales: s.net_sales,
          payment_method: s.payment_method,
          customer_name: s.customer_name ?? null,
        })));
      }

      // --- Live ---
      if (live) {
        const matchFilter = {
          client_id: clientId,
          license_id: licId,
          occurred_at: { $gte: live.start, $lte: live.end },
        };

        const saleEvents = await AnalyticsEvent.find({ ...matchFilter, type: "sale.completed" }).select("payload").lean();
        const returnEvents = await AnalyticsEvent.find({ ...matchFilter, type: "sale.returned" }).select("payload").lean();

        for (const ev of saleEvents) aggregateItems(ev.payload?.items, 1);
        for (const ev of returnEvents) aggregateItems(ev.payload?.items, -1);

        // Recent Sales
        const liveSales = await AnalyticsEvent.find({ ...matchFilter, type: "sale.completed" })
          .sort({ occurred_at: -1 }).limit(20)
          .select("occurred_at payload.invoice_number payload.gross_sales payload.net_sales payload.payment_method payload.customer_name")
          .lean();

        recentSalesList.push(...liveSales.map((ev) => ({
          occurred_at: ev.occurred_at,
          invoice_number: ev.payload?.invoice_number,
          gross_sales: ev.payload?.gross_sales,
          net_sales: ev.payload?.net_sales,
          payment_method: ev.payload?.payment_method,
          customer_name: ev.payload?.customer_name ?? null,
        })));
      }
    }

    // 4. Final Aggregation
    const allProducts = Array.from(productMap.values()).map((p) => ({
      ...p,
      qty: r2(p.qty),
      revenue: r2(p.revenue),
      cogs: r2(p.cogs),
      gross_profit: r2(p.gross_profit),
    }));

    const topByQty = [...allProducts].sort((a, b) => b.qty - a.qty).slice(0, limit);
    const topByProfit = [...allProducts].sort((a, b) => b.gross_profit - a.gross_profit).slice(0, limit);

    // Sort combined recent sales DESC and limit
    recentSalesList.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    const finalRecentSales = recentSalesList.slice(0, 20);

    return NextResponse.json({
      ok: true,
      period: periodParam,
      timezone,
      top_by_qty: topByQty,
      top_by_profit: topByProfit,
      recent_sales: finalRecentSales,
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
