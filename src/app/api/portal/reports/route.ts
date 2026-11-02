import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import InventorySnapshot from "@/models/InventorySnapshot";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";
import OwnerCustomerMeta from "@/models/OwnerCustomerMeta";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import {
  getClientDateRange,
  getDailyBuckets,
  formatLocalDate,
} from "@/lib/analytics";

/**
 * GET /api/portal/reports?category=sales|purchases|customers|inventory|financial&period=today|7d|30d|90d
 *
 * Categorized Advanced Report Center (Prompt 2 Section 2 & Section 11).
 * Uses compact pre-aggregated daily records and bounded event queries.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const { searchParams } = new URL(req.url);

    const periodParam = searchParams.get("period") || "30d";
    const categoryParam = searchParams.get("category") || "sales";

    const [client, portalState, invSnap, actionState] = await Promise.all([
      Client.findOne({ id: clientId }).select("name timezone").lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      InventorySnapshot.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerActionState.findOne({ client_id: clientId }).lean<any>(),
    ]);

    const timezone = client?.timezone || "Asia/Karachi";
    const pharmacyName =
      portalState?.pharmacy_name || client?.name || "AivraSol Pharmacy";

    // Compute date range
    let startUtc: Date;
    let endUtc: Date = new Date();
    if (periodParam === "today" || periodParam === "7d" || periodParam === "30d") {
      const r = getClientDateRange(timezone, periodParam);
      startUtc = r.start;
      endUtc = r.end;
    } else {
      // 90d
      const r30 = getClientDateRange(timezone, "30d");
      endUtc = r30.end;
      startUtc = new Date(endUtc.getTime() - 90 * 86400_000);
    }

    // Fetch events in range (bounded projection) + expenses + historical daily summaries
    const startDateKey = formatLocalDate(startUtc, timezone);
    const endDateKey = formatLocalDate(endUtc, timezone);

    const [events, expenses, histDaily, customerMetas] = await Promise.all([
      AnalyticsEvent.find({
        client_id: clientId,
        occurred_at: { $gte: startUtc, $lte: endUtc },
      })
        .sort({ occurred_at: -1 })
        .limit(600)
        .lean<any[]>(),
      CloudExpense.find({
        client_id: clientId,
        occurred_at: { $gte: startUtc, $lte: endUtc },
      })
        .sort({ occurred_at: -1 })
        .lean<any[]>(),
      HistoricalDailyAnalytics.find({
        client_id: clientId,
        date: { $gte: startDateKey, $lte: endDateKey },
      })
        .sort({ date: 1 })
        .lean<any[]>(),
      OwnerCustomerMeta.find({ client_id: clientId }).lean<any[]>(),
    ]);

    // 1. Aggregate Sales, Returns, Payment Methods, Cashier, Products, Categories, Manufacturers
    let grossRevenue = 0;
    let totalDiscounts = 0;
    let totalReturns = 0;
    let netSales = 0;
    let totalCogs = 0;
    let invoicesWithReliableCost = 0;
    let invoicesCount = 0;
    let returnsCount = 0;

    const paymentBreakdown = {
      cash: { count: 0, amount: 0 },
      card: { count: 0, amount: 0 },
      wallet: { count: 0, amount: 0 },
      credit: { count: 0, amount: 0 },
    };

    const dailyMap = new Map<
      string,
      {
        date: string;
        invoices: number;
        gross_sales: number;
        discounts: number;
        returns: number;
        net_sales: number;
        cogs: number;
        gross_profit: number;
      }
    >();

    // Seed from historical daily analytics if available
    for (const hd of histDaily) {
      dailyMap.set(hd.date, {
        date: hd.date,
        invoices: Number(hd.sales_count || 0),
        gross_sales: Number(hd.gross_sales || 0) + Number(hd.discounts_total || 0),
        discounts: Number(hd.discounts_total || 0),
        returns: Number(hd.returns_total || 0),
        net_sales: Number(hd.gross_sales || 0) - Number(hd.returns_total || 0),
        cogs: Number(hd.cogs_total || 0),
        gross_profit:
          Number(hd.gross_sales || 0) -
          Number(hd.returns_total || 0) -
          Number(hd.cogs_total || 0),
      });
    }

    const productSalesMap = new Map<
      string,
      {
        product_id: string;
        code?: string;
        name: string;
        category?: string;
        qty_sold: number;
        gross_revenue: number;
        discount: number;
        net_revenue: number;
        cogs: number;
        gross_profit: number;
        has_reliable_cost: boolean;
      }
    >();

    const categorySalesMap = new Map<
      string,
      { category: string; qty_sold: number; net_revenue: number; gross_profit: number }
    >();
    const cashierSalesMap = new Map<
      string,
      {
        cashier_name: string;
        invoices_count: number;
        gross_sales: number;
        discounts: number;
        net_sales: number;
        returns_count: number;
        returns_amount: number;
      }
    >();

    const supplierPurchasesMap = new Map<
      string,
      {
        supplier_id: string;
        supplier_name: string;
        grn_count: number;
        total_amount: number;
        paid_amount: number;
        balance_due: number;
        bonus_units: number;
        last_purchase_at: string;
      }
    >();

    const productPurchaseMap = new Map<
      string,
      {
        product_id: string;
        name: string;
        supplier_name: string;
        grn_number: string;
        purchase_id: string;
        date: string;
        qty: number;
        bonus_qty: number;
        cost_price: number;
        sale_price: number;
        line_total: number;
      }
    >();

    // Map product cost_wac and category from portalState.products_intelligence
    const catalogLookup = new Map<string, any>();
    for (const pi of portalState?.products_intelligence || []) {
      if (pi?.product_id) catalogLookup.set(pi.product_id, pi);
    }

    const liveDailyAccum = new Map<
      string,
      {
        date: string;
        invoices: number;
        gross_sales: number;
        discounts: number;
        returns: number;
        net_sales: number;
        cogs: number;
        gross_profit: number;
      }
    >();

    for (const ev of events) {
      const p = ev.payload || {};
      const evType = ev.type || ev.event_type;
      const dateKey = formatLocalDate(new Date(ev.occurred_at), timezone);
      const occurredIso = new Date(ev.occurred_at).toISOString();

      if (evType === "sale.completed") {
        const net = Number(p.net_sales ?? p.total_amount ?? p.net_total ?? p.gross_sales ?? 0);
        const disc = Number(p.discount ?? p.discount_amount ?? 0);
        const gross = Number(p.gross_sales ?? p.subtotal ?? net + disc);
        let cogs = Number(p.cogs ?? p.cost_total ?? 0);

        invoicesCount += 1;
        grossRevenue += gross;
        totalDiscounts += disc;
        netSales += net;

        const pm = String(p.payment_method || "cash").toLowerCase();
        if (pm.includes("credit") || pm.includes("khata") || Number(p.credit_amount || 0) > 0) {
          paymentBreakdown.credit.count += 1;
          paymentBreakdown.credit.amount += Number(p.credit_amount || net);
          if (Number(p.paid_amount || 0) > 0) {
            paymentBreakdown.cash.amount += Number(p.paid_amount || 0);
          }
        } else if (pm.includes("card") || pm.includes("pos")) {
          paymentBreakdown.card.count += 1;
          paymentBreakdown.card.amount += net;
        } else if (pm.includes("wallet") || pm.includes("bank") || pm.includes("online")) {
          paymentBreakdown.wallet.count += 1;
          paymentBreakdown.wallet.amount += net;
        } else {
          paymentBreakdown.cash.count += 1;
          paymentBreakdown.cash.amount += net;
        }

        const cashier = p.cashier || p.cashier_name || "POS Cashier";
        const cEntry = cashierSalesMap.get(cashier) || {
          cashier_name: cashier,
          invoices_count: 0,
          gross_sales: 0,
          discounts: 0,
          net_sales: 0,
          returns_count: 0,
          returns_amount: 0,
        };
        cEntry.invoices_count += 1;
        cEntry.gross_sales += gross;
        cEntry.discounts += disc;
        cEntry.net_sales += net;
        cashierSalesMap.set(cashier, cEntry);

        let calcLineCogs = 0;
        const lines = p.items || p.lines || [];
        for (const l of lines) {
          const pid = l.product_id || l.code || l.product_name || l.name;
          if (!pid) continue;
          const catProd = catalogLookup.get(pid);
          const q = Number(l.qty ?? 0);
          const lDisc = Number(l.discount ?? 0);
          const lNet = Number(l.revenue ?? l.line_total ?? q * Number(l.unit_price ?? 0));
          const lineSnapshotCogs = Number(l.cogs ?? 0);
          const unitCost = Number(l.cost_price ?? l.unit_cost ?? catProd?.cost_wac ?? 0);
          const lCogs = lineSnapshotCogs > 0 ? lineSnapshotCogs : unitCost > 0 ? unitCost * q : 0;
          calcLineCogs += lCogs;

          const ps = productSalesMap.get(pid) || {
            product_id: pid,
            code: l.code || catProd?.code,
            name: l.product_name || l.name || catProd?.name || pid,
            category: l.category || catProd?.category || "General",
            qty_sold: 0,
            gross_revenue: 0,
            discount: 0,
            net_revenue: 0,
            cogs: 0,
            gross_profit: 0,
            has_reliable_cost: false,
          };
          ps.qty_sold += q;
          ps.gross_revenue += lNet + lDisc;
          ps.discount += lDisc;
          ps.net_revenue += lNet;
          ps.cogs += lCogs;
          ps.gross_profit = ps.net_revenue - ps.cogs;
          if (lCogs > 0) ps.has_reliable_cost = true;
          productSalesMap.set(pid, ps);

          const catName = ps.category || "General";
          const catEntry = categorySalesMap.get(catName) || {
            category: catName,
            qty_sold: 0,
            net_revenue: 0,
            gross_profit: 0,
          };
          catEntry.qty_sold += q;
          catEntry.net_revenue += lNet;
          catEntry.gross_profit += lNet - lCogs;
          categorySalesMap.set(catName, catEntry);
        }

        if (cogs <= 0 && calcLineCogs > 0) {
          cogs = calcLineCogs;
        }
        if (cogs > 0) {
          totalCogs += cogs;
          invoicesWithReliableCost += 1;
        }

        const dBucket = liveDailyAccum.get(dateKey) || {
          date: dateKey,
          invoices: 0,
          gross_sales: 0,
          discounts: 0,
          returns: 0,
          net_sales: 0,
          cogs: 0,
          gross_profit: 0,
        };
        dBucket.invoices += 1;
        dBucket.gross_sales += gross;
        dBucket.discounts += disc;
        dBucket.net_sales += net;
        dBucket.cogs += cogs;
        dBucket.gross_profit = dBucket.net_sales - dBucket.cogs;
        liveDailyAccum.set(dateKey, dBucket);
      } else if (evType === "sale.returned") {
        const retAmt = Math.abs(
          Number(p.return_amount ?? p.total_refund ?? p.total ?? 0)
        );
        const revCogs = Math.abs(Number(p.cogs_reversed ?? 0));
        returnsCount += 1;
        totalReturns += retAmt;
        netSales -= retAmt;
        if (revCogs > 0) {
          totalCogs = Math.max(0, totalCogs - revCogs);
        }

        const cashier = p.cashier || p.cashier_name || p.operator_name || "POS Cashier";
        const cEntry = cashierSalesMap.get(cashier) || {
          cashier_name: cashier,
          invoices_count: 0,
          gross_sales: 0,
          discounts: 0,
          net_sales: 0,
          returns_count: 0,
          returns_amount: 0,
        };
        cEntry.returns_count += 1;
        cEntry.returns_amount += retAmt;
        cashierSalesMap.set(cashier, cEntry);

        const dBucket = liveDailyAccum.get(dateKey) || {
          date: dateKey,
          invoices: 0,
          gross_sales: 0,
          discounts: 0,
          returns: 0,
          net_sales: 0,
          cogs: 0,
          gross_profit: 0,
        };
        dBucket.returns += retAmt;
        dBucket.net_sales -= retAmt;
        dBucket.cogs = Math.max(0, dBucket.cogs - revCogs);
        dBucket.gross_profit = dBucket.net_sales - dBucket.cogs;
        liveDailyAccum.set(dateKey, dBucket);
      } else if (evType === "purchase.received") {
        const purId = p.purchase_id || ev.source_record_id || ev.event_id;
        const grnNo = p.grn || p.grn_number || p.purchase_number || purId;
        const supId = p.supplier_id || p.supplier_name || "unknown";
        const supName = p.supplier_name || "Supplier";
        const tot = Number(p.purchase_total ?? p.total_amount ?? p.total ?? 0);
        const paid = Number(p.paid_amount ?? p.paid ?? 0);
        const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.migration_imported);
        const bal = isLegacyExcluded ? 0 : Math.max(0, Number(p.balance_due ?? tot - paid));

        let bonusTotal = 0;
        for (const it of p.lines || p.items || []) {
          const bq = Number(it.free_qty ?? it.bonus_qty ?? 0);
          bonusTotal += bq;
          const pid = it.product_id || it.code || it.product_name || it.name;
          if (pid && !productPurchaseMap.has(`${purId}_${pid}`)) {
            productPurchaseMap.set(`${purId}_${pid}`, {
              product_id: pid,
              name: it.product_name || it.name || pid,
              supplier_name: supName,
              grn_number: grnNo,
              purchase_id: purId,
              date: occurredIso,
              qty: Number(it.qty ?? 0),
              bonus_qty: bq,
              cost_price: Number(it.cost ?? it.cost_price ?? 0),
              sale_price: Number(it.sale_price ?? 0),
              line_total: Number(it.line_total ?? 0),
            });
          }
        }

        const sAgg = supplierPurchasesMap.get(supId) || {
          supplier_id: supId,
          supplier_name: supName,
          grn_count: 0,
          total_amount: 0,
          paid_amount: 0,
          balance_due: 0,
          bonus_units: 0,
          last_purchase_at: occurredIso,
        };
        sAgg.grn_count += 1;
        sAgg.total_amount += tot;
        sAgg.paid_amount += paid;
        sAgg.balance_due += bal;
        sAgg.bonus_units += bonusTotal;
        if (occurredIso > sAgg.last_purchase_at) {
          sAgg.last_purchase_at = occurredIso;
        }
        supplierPurchasesMap.set(supId, sAgg);
      }
    }

    // Merge live daily buckets over historical daily buckets
    for (const [dKey, liveVal] of liveDailyAccum.entries()) {
      dailyMap.set(dKey, liveVal);
    }

    const dailySeries = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const avgBillValue =
      invoicesCount > 0 ? Number((netSales / invoicesCount).toFixed(2)) : 0;
    const grossProfit = Number((netSales - totalCogs).toFixed(2));
    const grossMarginPct =
      netSales > 0 && totalCogs > 0
        ? Number(((grossProfit / netSales) * 100).toFixed(1))
        : 0;

    // Expenses & Financial Summary
    const verifiedExpensesTotal = expenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0
    );
    const operatingSurplusAfterVerifiedExpenses = Number(
      (grossProfit - verifiedExpensesTotal).toFixed(2)
    );

    // Customers & Khata Report
    const metaByCustomer = new Map<string, any>();
    for (const m of customerMetas) {
      if (m?.customer_id) metaByCustomer.set(m.customer_id, m);
    }

    const customersList = (portalState?.customers || []).map((c: any) => {
      const meta = metaByCustomer.get(c.id);
      const bal = Number(c.credit_balance ?? c.outstanding_balance ?? 0);
      const lastPurMs = c.last_purchase_at ? new Date(c.last_purchase_at).getTime() : 0;
      const daysSincePurchase = lastPurMs
        ? Math.floor((Date.now() - lastPurMs) / 86400_000)
        : 0;
      let agingBucket = "0_7d";
      if (daysSincePurchase > 60) agingBucket = "60d_plus";
      else if (daysSincePurchase > 30) agingBucket = "31_60d";
      else if (daysSincePurchase > 7) agingBucket = "8_30d";

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        credit_balance: bal,
        total_credit_sales: Number(c.total_credit_sales ?? c.total_purchases ?? 0),
        total_payments: Number(c.total_payments ?? 0),
        credit_status: c.credit_status || (bal > 0 ? "due" : "clear"),
        aging_bucket: agingBucket,
        days_since_purchase: daysSincePurchase,
        follow_up_status: meta?.follow_up_status || "none",
        owner_note: meta?.owner_note || "",
        promised_date: meta?.promised_date || null,
      };
    });

    const creditCustomers = customersList
      .filter((c: any) => c.credit_balance > 0)
      .sort((a: any, b: any) => b.credit_balance - a.credit_balance);

    const agingSummary = {
      bucket_0_7d: creditCustomers
        .filter((c: any) => c.aging_bucket === "0_7d")
        .reduce((s: number, c: any) => s + c.credit_balance, 0),
      bucket_8_30d: creditCustomers
        .filter((c: any) => c.aging_bucket === "8_30d")
        .reduce((s: number, c: any) => s + c.credit_balance, 0),
      bucket_31_60d: creditCustomers
        .filter((c: any) => c.aging_bucket === "31_60d")
        .reduce((s: number, c: any) => s + c.credit_balance, 0),
      bucket_60d_plus: creditCustomers
        .filter((c: any) => c.aging_bucket === "60d_plus")
        .reduce((s: number, c: any) => s + c.credit_balance, 0),
    };

    const totalCustomerReceivables = creditCustomers.reduce(
      (s: number, c: any) => s + c.credit_balance,
      0
    );

    // Suppliers & Payables Report (Strictly distinguishing verified vs historical_unverified)
    const suppliersDirectory = (portalState?.suppliers || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      verified_payable: Number(s.verified_payable ?? s.payable_balance ?? 0),
      total_purchases_amount: Number(
        s.total_purchases_amount ?? s.total_purchases_30d ?? 0
      ),
      total_purchases_count: Number(s.total_purchases_count ?? 0),
      unverified_historical_amount: Number(
        s.unverified_historical_purchases_amount ??
          s.historical_unverified_total ??
          0
      ),
      unverified_historical_count: Number(
        s.unverified_historical_purchases_count ??
          s.historical_unverified_count ??
          0
      ),
      legacy_balance_status:
        s.legacy_balance_status || s.balance_status || "verified",
      last_purchase_at: s.last_purchase_at,
    }));

    const totalVerifiedSupplierPayables = suppliersDirectory.reduce(
      (sum: number, s: any) => sum + s.verified_payable,
      0
    );
    const totalUnverifiedHistoricalPurchases = suppliersDirectory.reduce(
      (sum: number, s: any) => sum + s.unverified_historical_amount,
      0
    );

    // Inventory Report Summary
    const intelProducts = portalState?.products_intelligence || [];
    const inventoryReport = {
      stock_value: Number(invSnap?.stock_value ?? 0),
      low_stock_count: Number(invSnap?.low_stock_count ?? 0),
      out_of_stock_count: Number(invSnap?.out_of_stock_count ?? 0),
      expiring_soon_count: Number(invSnap?.expiring_soon_count ?? 0),
      unverified_expiry_count: (
        portalState?.inventory_alerts?.unverified_expiry_items || []
      ).length,
      low_stock_items: (portalState?.inventory_alerts?.low_stock_items || []).slice(
        0,
        30
      ),
      expiring_items: (portalState?.inventory_alerts?.expiring_items || []).slice(
        0,
        30
      ),
      unverified_expiry_items: (
        portalState?.inventory_alerts?.unverified_expiry_items || []
      ).slice(0, 30),
      slow_moving_items: intelProducts
        .filter((p: any) => p.movement_status === "slow_moving" || p.movement_status === "dead_stock")
        .slice(0, 30),
      overstock_items: intelProducts.filter((p: any) => p.is_overstock).slice(0, 25),
      negative_margin_items: intelProducts
        .filter((p: any) => p.is_negative_margin)
        .slice(0, 25),
      category_breakdown:
        portalState?.category_breakdown_30d?.length > 0
          ? portalState.category_breakdown_30d
          : Array.from(categorySalesMap.values()).sort(
              (a, b) => b.net_revenue - a.net_revenue
            ),
      manufacturer_breakdown: portalState?.manufacturer_breakdown_30d || [],
    };

    return NextResponse.json({
      ok: true,
      pharmacy_name: pharmacyName,
      period: periodParam,
      category: categoryParam,
      saved_prefs: actionState?.saved_report_prefs || {},
      sales_report: {
        summary: {
          invoices_count: invoicesCount,
          returns_count: returnsCount,
          gross_revenue: Number(grossRevenue.toFixed(2)),
          discounts_given: Number(totalDiscounts.toFixed(2)),
          returns_total: Number(totalReturns.toFixed(2)),
          net_sales: Number(netSales.toFixed(2)),
          avg_bill_value: avgBillValue,
          cogs: Number(totalCogs.toFixed(2)),
          gross_profit: grossProfit,
          gross_margin_pct: grossMarginPct,
          cost_coverage_pct:
            invoicesCount > 0
              ? Math.round((invoicesWithReliableCost / invoicesCount) * 100)
              : 100,
        },
        payment_methods: paymentBreakdown,
        daily_series: dailySeries,
        top_products: Array.from(productSalesMap.values())
          .sort((a, b) => b.net_revenue - a.net_revenue)
          .slice(0, 40),
        category_sales:
          portalState?.category_breakdown_30d?.length > 0
            ? portalState.category_breakdown_30d
            : Array.from(categorySalesMap.values()).sort(
                (a, b) => b.net_revenue - a.net_revenue
              ),
        manufacturer_sales: portalState?.manufacturer_breakdown_30d || [],
        cashier_sales:
          portalState?.cashier_performance_30d?.length > 0 && periodParam === "30d"
            ? portalState.cashier_performance_30d
            : Array.from(cashierSalesMap.values()).sort(
                (a, b) => b.net_sales - a.net_sales
              ),
      },
      purchase_report: {
        supplier_purchases: Array.from(supplierPurchasesMap.values()).sort(
          (a, b) => b.total_amount - a.total_amount
        ),
        suppliers_directory: suppliersDirectory.sort(
          (a: any, b: any) =>
            b.verified_payable - a.verified_payable ||
            b.total_purchases_amount - a.total_purchases_amount
        ),
        product_purchases: Array.from(productPurchaseMap.values()).slice(0, 50),
        price_changes: portalState?.supplier_price_changes || [],
      },
      customer_report: {
        summary: {
          total_credit_customers: creditCustomers.length,
          verified_outstanding_balance: Number(totalCustomerReceivables.toFixed(2)),
          collections_count_recent: (portalState?.khata_payments || []).length,
          collections_total_recent: (portalState?.khata_payments || []).reduce(
            (s: number, k: any) => s + Number(k.amount || 0),
            0
          ),
          aging: agingSummary,
        },
        top_credit_customers: creditCustomers.slice(0, 50),
        recent_collections: (portalState?.khata_payments || []).slice(0, 35),
      },
      inventory_report: inventoryReport,
      financial_report: {
        summary: {
          gross_revenue: Number(grossRevenue.toFixed(2)),
          sales_returns: Number(totalReturns.toFixed(2)),
          discounts_given: Number(totalDiscounts.toFixed(2)),
          net_sales: Number(netSales.toFixed(2)),
          verified_cogs: Number(totalCogs.toFixed(2)),
          gross_profit: grossProfit,
          gross_margin_pct: grossMarginPct,
          verified_expenses: Number(verifiedExpensesTotal.toFixed(2)),
          operating_surplus_after_verified_expenses:
            operatingSurplusAfterVerifiedExpenses,
          customer_receivables: Number(totalCustomerReceivables.toFixed(2)),
          verified_supplier_payables: Number(
            totalVerifiedSupplierPayables.toFixed(2)
          ),
          unverified_historical_purchases: Number(
            totalUnverifiedHistoricalPurchases.toFixed(2)
          ),
          inventory_valuation: Number(invSnap?.stock_value ?? 0),
        },
        profit_disclaimer:
          "Gross Profit equals Returns-Adjusted Net Sales minus Verified COGS (WAC). Operating Surplus deducts only cloud-synced/recorded expenses; full accounting Net Profit requires all store overheads (rent, utilities, salaries) to be recorded.",
        cash_reconciliation: {
          current_drawer: portalState?.current_drawer || null,
          recent_shifts: (portalState?.drawer_sessions || []).slice(0, 20),
          recent_closings: (portalState?.daily_closings || []).slice(0, 20),
        },
      },
    });
  } catch (err: any) {
    console.error("[api/portal/reports] GET error:", err);
    return NextResponse.json(
      { error: "Failed to generate report", detail: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/portal/reports
 * Save owner's default report category/period preferences.
 */
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const body = await req.json();

    const prefs = {
      default_category: body.default_category || "sales",
      default_period: body.default_period || "30d",
      pinned_subreports: Array.isArray(body.pinned_subreports)
        ? body.pinned_subreports.slice(0, 10)
        : [],
      updated_at: new Date().toISOString(),
    };

    const doc = await OwnerActionState.findOneAndUpdate(
      { client_id: clientId },
      { $set: { saved_report_prefs: prefs } },
      { upsert: true, new: true }
    ).lean<any>();

    return NextResponse.json({
      ok: true,
      saved_prefs: doc?.saved_report_prefs || prefs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to save report preferences", detail: err.message },
      { status: 500 }
    );
  }
}
