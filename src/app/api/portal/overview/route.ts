import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import InventorySnapshot from "@/models/InventorySnapshot";
import OwnerPortalState from "@/models/OwnerPortalState";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import HistoricalTopProduct from "@/models/HistoricalTopProduct";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import {
  computeFinancialSummary,
  getClientDateRange,
  getDailyBuckets,
  splitDateRange,
  mergeFinancialSummaries,
  historicalToFinancialSummary,
  ZERO_FINANCIAL_SUMMARY,
  type EventTypeAgg,
} from "@/lib/analytics";

/**
 * GET /api/portal/overview?period=today|7d|30d
 *
 * Combined single-request Owner Portal Overview endpoint (Part C & Part I).
 * Returns KPIs for today/7d/30d, operational status, prioritized action-required
 * alerts with deep links, recent sales, top products, and daily trend buckets.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const rawPeriod = searchParams.get("period") ?? "today";
    const selectedPeriod = (["today", "7d", "30d"].includes(rawPeriod) ? rawPeriod : "today") as
      | "today"
      | "7d"
      | "30d";

    const clientId = session.client_id;

    // 1. Load Client, Licenses, Seats, Snapshots, PortalState, Bootstrap in parallel
    const [client, licenses, inventorySnapshots, portalStates, latestBootstraps, latestEvent] =
      await Promise.all([
        Client.findOne({ id: clientId }).lean<{
          id: string;
          name: string;
          email?: string;
          phone?: string;
          city?: string;
          address?: string;
          timezone?: string;
        }>(),
        License.find({ client_id: clientId })
          .sort({ created_at: -1 })
          .lean<
            Array<{
              id: string;
              license_key: string;
              status: string;
              plan_id?: string;
              plan_name?: string;
              expires_at?: Date;
              features?: any;
            }>
          >(),
        InventorySnapshot.find({ client_id: clientId }).lean<
          Array<{
            license_id: string;
            captured_at: Date;
            updated_at?: Date;
            stock_value: number;
            low_stock_count: number;
            out_of_stock_count: number;
            expiring_soon_count: number;
            reported_by_terminal?: number;
          }>
        >(),
        OwnerPortalState.find({ client_id: clientId })
          .sort({ captured_at: -1 })
          .lean<Array<any>>(),
        AnalyticsBootstrap.find({ client_id: clientId, status: "completed" })
          .sort({ bootstrap_version: -1 })
          .lean<Array<{ license_id: string; bootstrap_cutoff_utc: Date; bootstrap_cutoff_date: string }>>(),
        AnalyticsEvent.findOne({ client_id: clientId })
          .sort({ received_at: -1 })
          .select("received_at occurred_at terminal_number")
          .lean<{ received_at?: Date; occurred_at?: Date; terminal_number?: number }>(),
      ]);

    const timezone = client?.timezone ?? "Asia/Karachi";
    const primaryLicense = licenses.find((l) => l.status === "active") || licenses[0] || null;
    const licenseIds = licenses.map((l) => l.id);

    const seats = licenseIds.length
      ? await LicenseSeat.find({ license_id: { $in: licenseIds }, status: "active" })
          .select("id license_id terminal_number machine_name last_seen_at")
          .lean<
            Array<{
              id: string;
              license_id: string;
              terminal_number?: number;
              machine_name?: string;
              last_seen_at?: Date;
            }>
          >()
      : [];

    // Primary cutoff for historical vs live split
    let primaryCutoffUtc: Date | null = null;
    if (latestBootstraps.length > 0) {
      primaryCutoffUtc = latestBootstraps.reduce(
        (latest, current) =>
          current.bootstrap_cutoff_utc > latest ? current.bootstrap_cutoff_utc : latest,
        latestBootstraps[0].bootstrap_cutoff_utc
      );
    }

    // Helper to compute period KPIs (today, 7d, 30d)
    async function computePeriodKpis(period: "today" | "7d" | "30d") {
      const { start, end } = getClientDateRange(timezone, period);
      const { historical, live } = splitDateRange(start, end, primaryCutoffUtc, timezone);

      let histSummary = ZERO_FINANCIAL_SUMMARY;
      let histInvoiceCount = 0;

      if (historical) {
        const [histAgg, histSalesCount] = await Promise.all([
          HistoricalDailyAnalytics.aggregate([
            {
              $match: {
                client_id: clientId,
                date: { $gte: historical.startDate, $lte: historical.endDate },
              },
            },
            {
              $group: {
                _id: null,
                gross_sales: { $sum: "$gross_sales" },
                sales_returns: { $sum: "$sales_returns" },
                cogs: { $sum: "$cogs" },
                cogs_reversed: { $sum: "$cogs_reversed" },
                gross_profit: { $sum: "$gross_profit" },
                net_profit: { $sum: "$net_profit" },
                expenses: { $sum: "$expenses" },
                purchases: { $sum: "$purchases" },
              },
            },
          ]),
          HistoricalRecentSale.countDocuments({
            client_id: clientId,
            occurred_at: { $gte: start, $lte: primaryCutoffUtc ?? end },
          }),
        ]);
        if (histAgg.length > 0) {
          histSummary = historicalToFinancialSummary(histAgg[0]);
        }
        histInvoiceCount = histSalesCount;
      }

      let liveSummary = ZERO_FINANCIAL_SUMMARY;
      let liveInvoiceCount = 0;
      let liveReturnCount = 0;
      let livePurchaseCount = 0;
      let cardSales = 0;
      let walletSales = 0;
      let discountTotal = 0;
      let highDiscountCount = 0;
      let cogsReliableEvents = 0;

      if (live) {
        const [aggByType, expenseAgg] = await Promise.all([
          AnalyticsEvent.aggregate([
            {
              $match: {
                client_id: clientId,
                occurred_at: { $gte: live.start, $lte: live.end },
                type: { $in: ["sale.completed", "sale.returned", "purchase.received"] },
              },
            },
            {
              $group: {
                _id: "$type",
                gross_sales: { $sum: { $ifNull: ["$payload.net_sales", "$payload.gross_sales"] } },
                subtotal_sales: { $sum: { $ifNull: ["$payload.gross_sales", 0] } },
                discount_total: { $sum: { $ifNull: ["$payload.discount", 0] } },
                cogs: { $sum: { $ifNull: ["$payload.cogs", 0] } },
                return_amount: { $sum: { $ifNull: ["$payload.return_amount", 0] } },
                cogs_reversed: { $sum: { $ifNull: ["$payload.cogs_reversed", 0] } },
                purchase_total: { $sum: { $ifNull: ["$payload.purchase_total", 0] } },
                cash_sales: {
                  $sum: {
                    $cond: [
                      { $eq: ["$payload.payment_method", "cash"] },
                      { $ifNull: ["$payload.net_sales", "$payload.gross_sales"] },
                      0,
                    ],
                  },
                },
                card_sales: {
                  $sum: {
                    $cond: [
                      { $eq: ["$payload.payment_method", "card"] },
                      { $ifNull: ["$payload.net_sales", "$payload.gross_sales"] },
                      0,
                    ],
                  },
                },
                wallet_sales: {
                  $sum: {
                    $cond: [
                      { $eq: ["$payload.payment_method", "wallet"] },
                      { $ifNull: ["$payload.net_sales", "$payload.gross_sales"] },
                      0,
                    ],
                  },
                },
                credit_sales: {
                  $sum: {
                    $cond: [
                      { $eq: ["$payload.payment_method", "credit"] },
                      { $ifNull: ["$payload.net_sales", "$payload.gross_sales"] },
                      0,
                    ],
                  },
                },
                high_discount_count: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $gte: [{ $ifNull: ["$payload.discount", 0] }, 500] },
                          {
                            $and: [
                              { $gt: [{ $ifNull: ["$payload.gross_sales", 0] }, 0] },
                              {
                                $gte: [
                                  {
                                    $divide: [
                                      { $ifNull: ["$payload.discount", 0] },
                                      { $ifNull: ["$payload.gross_sales", 1] },
                                    ],
                                  },
                                  0.15,
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                cogs_positive_count: {
                  $sum: {
                    $cond: [{ $gt: [{ $ifNull: ["$payload.cogs", 0] }, 0] }, 1, 0],
                  },
                },
                count: { $sum: 1 },
              },
            },
          ]),
          CloudExpense.aggregate([
            {
              $match: {
                client_id: clientId,
                is_deleted: false,
                occurred_at: { $gte: live.start, $lte: live.end },
              },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ]),
        ]);

        const expenseTotal = expenseAgg[0]?.total ?? 0;
        liveSummary = computeFinancialSummary(aggByType as EventTypeAgg[], expenseTotal);

        const saleGroup = aggByType.find((g) => g._id === "sale.completed");
        const returnGroup = aggByType.find((g) => g._id === "sale.returned");
        const purchaseGroup = aggByType.find((g) => g._id === "purchase.received");

        liveInvoiceCount = saleGroup?.count ?? 0;
        liveReturnCount = returnGroup?.count ?? 0;
        livePurchaseCount = purchaseGroup?.count ?? 0;
        cardSales = Math.round((saleGroup?.card_sales ?? 0) * 100) / 100;
        walletSales = Math.round((saleGroup?.wallet_sales ?? 0) * 100) / 100;
        discountTotal = Math.round((saleGroup?.discount_total ?? 0) * 100) / 100;
        highDiscountCount = saleGroup?.high_discount_count ?? 0;
        cogsReliableEvents = saleGroup?.cogs_positive_count ?? 0;
      }

      const summary = mergeFinancialSummaries(histSummary, liveSummary);
      const invoiceCount = histInvoiceCount + liveInvoiceCount;
      const averageBill =
        invoiceCount > 0 ? Math.round((summary.gross_sales / invoiceCount) * 100) / 100 : 0;
      const hasReliableCosts =
        invoiceCount === 0 || summary.net_cogs > 0 || cogsReliableEvents > 0;
      const grossMarginPct =
        hasReliableCosts && summary.net_sales > 0
          ? Math.round((summary.gross_profit / summary.net_sales) * 1000) / 10
          : null;

      return {
        ...summary,
        invoice_count: invoiceCount,
        return_count: liveReturnCount,
        purchase_count: livePurchaseCount,
        average_bill: averageBill,
        card_sales: cardSales,
        wallet_sales: walletSales,
        discount_total: discountTotal,
        high_discount_count: highDiscountCount,
        has_reliable_costs: hasReliableCosts,
        gross_margin_pct: grossMarginPct,
      };
    }

    const [todayKpis, weekKpis, monthKpis] = await Promise.all([
      computePeriodKpis("today"),
      computePeriodKpis("7d"),
      computePeriodKpis("30d"),
    ]);

    const kpisByPeriod = {
      today: todayKpis,
      "7d": weekKpis,
      "30d": monthKpis,
    };
    const activeKpis = kpisByPeriod[selectedPeriod];

    // 2. Inventory & Portal State Aggregation across licenses
    const inventoryTotal = {
      stock_value: inventorySnapshots.reduce((s, r) => s + (r.stock_value ?? 0), 0),
      low_stock_count: inventorySnapshots.reduce((s, r) => s + (r.low_stock_count ?? 0), 0),
      out_of_stock_count: inventorySnapshots.reduce((s, r) => s + (r.out_of_stock_count ?? 0), 0),
      expiring_soon_count: inventorySnapshots.reduce((s, r) => s + (r.expiring_soon_count ?? 0), 0),
      last_updated:
        inventorySnapshots.length > 0
          ? inventorySnapshots
              .reduce((a, b) => (a.captured_at > b.captured_at ? a : b))
              .captured_at.toISOString()
          : null,
    };

    const primaryState = portalStates[0] || null;
    const customersList: any[] = primaryState?.customers || [];
    const suppliersList: any[] = primaryState?.suppliers || [];
    const currentDrawer = primaryState?.current_drawer || null;
    const dailyClosings: any[] = primaryState?.daily_closings || [];
    const lastDailyClosing = dailyClosings[0] || null;
    const inventoryAlerts = primaryState?.inventory_alerts || {
      expiring_items: [],
      low_stock_items: [],
    };

    // Compute live Customer & Supplier positions (falling back to live event derivation if portalState not yet synced)
    let customerOutstandingTotal = 0;
    let customerOutstandingCount = 0;
    let overdueCustomersCount = 0;

    if (customersList.length > 0) {
      for (const c of customersList) {
        const bal = Number(c.credit_balance) || 0;
        if (bal > 0.01) {
          customerOutstandingTotal += bal;
          customerOutstandingCount++;
          if (c.credit_status === "overdue" || bal >= 5000) {
            overdueCustomersCount++;
          }
        }
      }
    } else {
      // Fallback: sum credit sales from 30d events if snapshot not yet sent
      customerOutstandingTotal = monthKpis.credit_sales;
    }

    let supplierVerifiedPayableTotal = 0;
    let supplierPayableCount = 0;
    let unverifiedHistoricalSuppliersCount = 0;

    for (const s of suppliersList) {
      const payable = Number(s.verified_payable) || 0;
      if (payable > 0.01) {
        supplierVerifiedPayableTotal += payable;
        supplierPayableCount++;
      }
      if (
        s.legacy_balance_status === "historical_unverified" ||
        (Number(s.unverified_historical_purchases_count) || 0) > 0
      ) {
        unverifiedHistoricalSuppliersCount++;
      }
    }

    // Expected cash in drawer: prefer current_drawer.expected_cash, else derive today's net cash sales - cash refunds
    const expectedDrawerCash =
      currentDrawer && typeof currentDrawer.expected_cash === "number"
        ? Math.round(currentDrawer.expected_cash * 100) / 100
        : Math.max(0, Math.round((todayKpis.cash_sales - todayKpis.sales_returns - todayKpis.expenses) * 100) / 100);

    // 3. Operational Status & Freshness (Never falsely claim "Live" when stale)
    const candidateSyncTimes: number[] = [];
    if (latestEvent?.received_at) candidateSyncTimes.push(new Date(latestEvent.received_at).getTime());
    if (latestEvent?.occurred_at) candidateSyncTimes.push(new Date(latestEvent.occurred_at).getTime());
    for (const snap of inventorySnapshots) {
      if (snap.updated_at) candidateSyncTimes.push(new Date(snap.updated_at).getTime());
      if (snap.captured_at) candidateSyncTimes.push(new Date(snap.captured_at).getTime());
    }
    for (const st of portalStates) {
      if (st.updated_at) candidateSyncTimes.push(new Date(st.updated_at).getTime());
      if (st.captured_at) candidateSyncTimes.push(new Date(st.captured_at).getTime());
    }
    for (const seat of seats) {
      if (seat.last_seen_at) candidateSyncTimes.push(new Date(seat.last_seen_at).getTime());
    }

    const lastSyncMs = candidateSyncTimes.length > 0 ? Math.max(...candidateSyncTimes) : null;
    const freshnessMinutes =
      lastSyncMs !== null ? Math.max(0, Math.floor((Date.now() - lastSyncMs) / 60000)) : null;

    let posStatus: "online" | "recent" | "stale" | "offline" = "offline";
    let posStatusLabel = "Offline — Waiting for POS Sync";
    if (freshnessMinutes !== null) {
      if (freshnessMinutes <= 15) {
        posStatus = "online";
        posStatusLabel = freshnessMinutes <= 2 ? "Synced just now" : `Synced ${freshnessMinutes}m ago`;
      } else if (freshnessMinutes <= 60) {
        posStatus = "recent";
        posStatusLabel = `Last synced ${freshnessMinutes}m ago`;
      } else if (freshnessMinutes <= 1440) {
        posStatus = "stale";
        const hrs = Math.floor(freshnessMinutes / 60);
        posStatusLabel = `POS offline · Last synced ${hrs}h ago`;
      } else {
        posStatus = "offline";
        const days = Math.floor(freshnessMinutes / 1440);
        posStatusLabel = `POS offline · Last synced ${days}d ago`;
      }
    }

    // 4. Prioritized Action-Required Alerts (Part C)
    const actionRequired: Array<{
      id: string;
      severity: "critical" | "warning" | "info";
      category: string;
      title: string;
      description: string;
      badge: string;
      href: string;
    }> = [];

    // 4a. Cash closing / drawer discrepancy
    const latestVariance =
      currentDrawer?.variance !== undefined && currentDrawer?.variance !== null
        ? Number(currentDrawer.variance)
        : lastDailyClosing?.variance !== undefined && lastDailyClosing?.variance !== null
        ? Number(lastDailyClosing.variance)
        : 0;
    if (Math.abs(latestVariance) >= 1) {
      const isShort = latestVariance < 0;
      actionRequired.push({
        id: "cash-variance",
        severity: Math.abs(latestVariance) >= 500 ? "critical" : "warning",
        category: "Cash Drawer",
        title: isShort
          ? `Cash Drawer Shortage: Rs ${Math.abs(latestVariance).toLocaleString("en-PK")}`
          : `Cash Drawer Overage: Rs ${Math.abs(latestVariance).toLocaleString("en-PK")}`,
        description:
          currentDrawer?.variance_reason ||
          "Physical cash count differed from expected drawer balance during reconciliation.",
        badge: isShort ? "Shortage" : "Overage",
        href: "/portal/cash",
      });
    }

    // 4b. Overdue / High Customer Credit
    if (customerOutstandingTotal > 0) {
      actionRequired.push({
        id: "customer-credit",
        severity: overdueCustomersCount > 0 || customerOutstandingTotal >= 25000 ? "warning" : "info",
        category: "Khata Credit",
        title: `Customer Credit Due: Rs ${Math.round(customerOutstandingTotal).toLocaleString("en-PK")}`,
        description:
          overdueCustomersCount > 0
            ? `${overdueCustomersCount} customer account(s) need payment follow-up across ${customerOutstandingCount} active Khata account(s).`
            : `${customerOutstandingCount || 1} customer account(s) have open credit balances.`,
        badge: `${customerOutstandingCount || 1} Account${customerOutstandingCount === 1 ? "" : "s"}`,
        href: "/portal/khata?status=due",
      });
    }

    // 4c. High Discounts in selected period
    if (activeKpis.high_discount_count > 0) {
      actionRequired.push({
        id: "high-discounts",
        severity: activeKpis.high_discount_count >= 5 ? "warning" : "info",
        category: "Sales Supervision",
        title: `${activeKpis.high_discount_count} High-Discount Invoice${
          activeKpis.high_discount_count === 1 ? "" : "s"
        } Detected`,
        description: `Total discounts of Rs ${Math.round(activeKpis.discount_total).toLocaleString(
          "en-PK"
        )} granted in this period (≥15% or ≥Rs 500 per bill).`,
        badge: `Rs ${Math.round(activeKpis.discount_total).toLocaleString("en-PK")}`,
        href: `/portal/sales?period=${selectedPeriod}&filter=high_discount`,
      });
    }

    // 4d. Expiring Soon / Out of Stock
    if (inventoryTotal.expiring_soon_count > 0) {
      actionRequired.push({
        id: "expiring-stock",
        severity: inventoryTotal.expiring_soon_count >= 10 ? "warning" : "info",
        category: "Expiry Risk",
        title: `${inventoryTotal.expiring_soon_count} Batch${
          inventoryTotal.expiring_soon_count === 1 ? "" : "es"
        } Expiring Within 60 Days`,
        description: "Review near-expiry stock batches to prioritize counter liquidation or supplier return.",
        badge: `${inventoryTotal.expiring_soon_count} Batches`,
        href: "/portal/dashboard#inventory-alerts",
      });
    }

    if (inventoryTotal.out_of_stock_count > 0 || inventoryTotal.low_stock_count > 0) {
      actionRequired.push({
        id: "low-stock",
        severity: inventoryTotal.out_of_stock_count >= 10 ? "warning" : "info",
        category: "Stock Replenishment",
        title: `${inventoryTotal.out_of_stock_count} Out of Stock · ${inventoryTotal.low_stock_count} Low Stock`,
        description: "Items at or below reorder threshold require supplier procurement.",
        badge: `${inventoryTotal.out_of_stock_count + inventoryTotal.low_stock_count} Items`,
        href: "/portal/purchases",
      });
    }

    // 4e. Unverified Legacy Supplier Balances
    if (unverifiedHistoricalSuppliersCount > 0) {
      actionRequired.push({
        id: "legacy-supplier-review",
        severity: "info",
        category: "Supplier Audit",
        title: `${unverifiedHistoricalSuppliersCount} Supplier${
          unverifiedHistoricalSuppliersCount === 1 ? "" : "s"
        } with Historical Imported Purchases`,
        description:
          "Legacy Abuzar purchases without historical payment vouchers are kept separate from verified payable balances.",
        badge: "Review Status",
        href: "/portal/purchases?tab=suppliers&filter=unverified",
      });
    }

    // 4f. Notable Sales Returns
    if (activeKpis.return_count > 0 && activeKpis.sales_returns > 0) {
      actionRequired.push({
        id: "sales-returns",
        severity:
          activeKpis.gross_sales > 0 && activeKpis.sales_returns / activeKpis.gross_sales >= 0.1
            ? "warning"
            : "info",
        category: "Returns",
        title: `${activeKpis.return_count} Sales Return${
          activeKpis.return_count === 1 ? "" : "s"
        } (Rs ${Math.round(activeKpis.sales_returns).toLocaleString("en-PK")})`,
        description: "Inspect returned invoices, refund methods, and operator reasons.",
        badge: `Rs ${Math.round(activeKpis.sales_returns).toLocaleString("en-PK")}`,
        href: `/portal/returns?period=${selectedPeriod}`,
      });
    }

    // 5. Recent Sales (Latest 8 finalized invoices for instant Overview drill-down)
    const liveRecentEvents = await AnalyticsEvent.find({
      client_id: clientId,
      type: "sale.completed",
    })
      .sort({ occurred_at: -1 })
      .limit(8)
      .lean();

    const recentSales = liveRecentEvents.map((e: any) => ({
      id: e.source_record_id || e.event_id,
      event_id: e.event_id,
      occurred_at: e.occurred_at.toISOString(),
      invoice_number: e.payload?.invoice_number ?? e.source_record_id,
      customer_name: e.payload?.customer_name ?? "Walk-in Customer",
      cashier: e.payload?.cashier ?? "Cashier",
      gross_sales: e.payload?.gross_sales ?? 0,
      discount: e.payload?.discount ?? 0,
      net_sales: e.payload?.net_sales ?? e.payload?.gross_sales ?? 0,
      payment_method: e.payload?.payment_method ?? "cash",
      items_count: Array.isArray(e.payload?.items) ? e.payload.items.length : 0,
      terminal_number: e.terminal_number ?? e.payload?.terminal_number,
    }));

    // 6. Top 5 Products for selectedPeriod
    const { start: pStart, end: pEnd } = getClientDateRange(timezone, selectedPeriod);
    const topProductsAgg = await AnalyticsEvent.aggregate([
      {
        $match: {
          client_id: clientId,
          occurred_at: { $gte: pStart, $lte: pEnd },
          type: { $in: ["sale.completed", "sale.returned"] },
        },
      },
      { $unwind: "$payload.items" },
      {
        $group: {
          _id: "$payload.items.product_id",
          product_name: { $last: "$payload.items.product_name" },
          qty: {
            $sum: {
              $cond: [
                { $eq: ["$type", "sale.completed"] },
                { $ifNull: ["$payload.items.qty", 0] },
                { $multiply: [{ $ifNull: ["$payload.items.qty", 0] }, -1] },
              ],
            },
          },
          revenue: {
            $sum: {
              $cond: [
                { $eq: ["$type", "sale.completed"] },
                { $ifNull: ["$payload.items.revenue", 0] },
                { $multiply: [{ $ifNull: ["$payload.items.revenue_reversed", 0] }, -1] },
              ],
            },
          },
          gross_profit: {
            $sum: {
              $cond: [
                { $eq: ["$type", "sale.completed"] },
                { $ifNull: ["$payload.items.gross_profit", 0] },
                { $multiply: [{ $ifNull: ["$payload.items.gross_profit_reversed", 0] }, -1] },
              ],
            },
          },
        },
      },
      { $match: { revenue: { $gt: 0 } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]);

    return NextResponse.json({
      period: selectedPeriod,
      timezone,
      pharmacy: {
        id: client?.id ?? clientId,
        name: primaryState?.pharmacy_name || client?.name || session.client_name,
        email: client?.email || session.email,
        phone: primaryState?.pharmacy_phone || client?.phone || null,
        address: primaryState?.pharmacy_address || client?.address || client?.city || null,
        license_key: primaryLicense?.license_key || null,
        license_status: primaryLicense?.status || "active",
        plan_name: primaryLicense?.plan_name || "Standard POS",
        expires_at: primaryLicense?.expires_at || null,
      },
      operational_status: {
        pos_status: posStatus,
        pos_status_label: posStatusLabel,
        last_sync_at: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
        freshness_minutes: freshnessMinutes,
        active_terminals: seats.length,
        terminals: seats.map((s) => ({
          id: s.id,
          terminal_number: s.terminal_number ?? 1,
          machine_name: s.machine_name || `Terminal ${s.terminal_number ?? 1}`,
          last_seen_at: s.last_seen_at ? new Date(s.last_seen_at).toISOString() : null,
        })),
        last_daily_closing: lastDailyClosing,
        current_drawer: currentDrawer,
      },
      kpis: activeKpis,
      kpis_by_period: kpisByPeriod,
      live_positions: {
        customer_outstanding_total: Math.round(customerOutstandingTotal * 100) / 100,
        customer_outstanding_count: customerOutstandingCount,
        overdue_customers_count: overdueCustomersCount,
        supplier_verified_payable_total: Math.round(supplierVerifiedPayableTotal * 100) / 100,
        supplier_payable_count: supplierPayableCount,
        unverified_historical_suppliers_count: unverifiedHistoricalSuppliersCount,
        expected_drawer_cash: expectedDrawerCash,
        drawer_status: currentDrawer?.status || "closed",
        inventory: inventoryTotal,
      },
      inventory_alerts: {
        expiring_items: (inventoryAlerts.expiring_items || []).slice(0, 10),
        low_stock_items: (inventoryAlerts.low_stock_items || []).slice(0, 10),
        unverified_expiry_items: (inventoryAlerts.unverified_expiry_items || []).slice(0, 10),
      },
      supplier_price_changes: (primaryState?.supplier_price_changes || []).slice(0, 6),
      daily_brief: {
        net_sales_today: kpisByPeriod.today.net_sales,
        invoices_today: kpisByPeriod.today.invoice_count,
        verified_cash_status:
          currentDrawer?.status === "open"
            ? `Drawer Open • Expected Rs ${Math.round(expectedDrawerCash).toLocaleString()}`
            : currentDrawer?.variance
            ? `Closed • Variance Rs ${Math.round(currentDrawer.variance).toLocaleString()}`
            : "Drawer Reconciled",
        major_discounts_today: kpisByPeriod.today.discount_total,
        credit_collections_today: (primaryState?.khata_payments || [])
          .filter((kp: any) => {
            const ms = new Date(kp.date || kp.occurred_at).getTime();
            return ms >= Date.now() - 24 * 3600_000;
          })
          .reduce((s: number, kp: any) => s + Number(kp.amount || 0), 0),
        low_stock_issues: inventoryTotal.low_stock_count + inventoryTotal.out_of_stock_count,
        expiry_concerns: inventoryTotal.expiring_soon_count,
        returns_today_count: kpisByPeriod.today.return_count,
        returns_today_amount: kpisByPeriod.today.sales_returns,
        supplier_price_increases_count: (primaryState?.supplier_price_changes || []).length,
        top_three_actions: actionRequired.slice(0, 3),
      },
      action_required: actionRequired,
      recent_sales: recentSales,
      top_products: topProductsAgg.map((p) => ({
        product_id: p._id,
        product_name: p.product_name || p._id,
        qty: Math.max(0, p.qty),
        revenue: Math.round((p.revenue ?? 0) * 100) / 100,
        gross_profit: Math.round((p.gross_profit ?? 0) * 100) / 100,
      })),
    });
  } catch (e: any) {
    console.error("Portal overview error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

