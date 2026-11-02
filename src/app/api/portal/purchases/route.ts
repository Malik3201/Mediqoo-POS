import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import Client from "@/models/Client";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";
import { getClientDateRange, startOfDayInTz, endOfDayInTz } from "@/lib/analytics";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

/**
 * GET /api/portal/purchases
 *
 * Purchases / GRN History & Supplier Directory (Part E).
 * Supports:
 * - period: "today" | "7d" | "30d" | "all" | "custom"
 * - from, to: YYYY-MM-DD
 * - q: search by GRN number, supplier name, or product name
 * - supplier: filter by supplier name or supplier_id
 * - cursor: "<occurred_at_iso>|<event_id>"
 * - limit: number (default 25)
 * - id: optional specific purchase_id / GRN to retrieve full purchase detail
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const specificId = searchParams.get("id");
    const period = searchParams.get("period") ?? "30d";
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const q = (searchParams.get("q") ?? "").trim();
    const supplierFilter = (searchParams.get("supplier") ?? "all").trim();
    const supplierStatusFilter = (searchParams.get("filter") ?? "all").toLowerCase();
    const cursor = searchParams.get("cursor");
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(5, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    const clientId = session.client_id;
    const [client, portalState] = await Promise.all([
      Client.findOne({ id: clientId }).select("timezone name").lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
    ]);
    const timezone = client?.timezone ?? "Asia/Karachi";

    // If a specific purchase ID / GRN is requested for detail drawer:
    if (specificId) {
      const decoded = decodeURIComponent(specificId);
      const purDoc = await AnalyticsEvent.findOne({
        client_id: clientId,
        type: "purchase.received",
        $or: [
          { source_record_id: decoded },
          { event_id: decoded },
          { "payload.purchase_id": decoded },
          { "payload.grn": decoded },
        ],
      }).lean<any>();

      if (!purDoc) {
        return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      }

      const p = purDoc.payload || {};
      const purId = p.purchase_id || purDoc.source_record_id;
      const grnNo = p.grn || purDoc.source_record_id;

      // Match purchase returns from OwnerPortalState + purchase.returned events
      const statePurchaseReturns: any[] = (portalState?.purchase_returns || []).filter(
        (pr: any) =>
          (pr.purchase_id && pr.purchase_id === purId) ||
          (pr.purchase_number && pr.purchase_number === grnNo)
      );

      const eventPurchaseReturns = await AnalyticsEvent.find({
        client_id: clientId,
        type: "purchase.returned",
        $or: [
          { "payload.purchase_id": purId },
          { "payload.purchase_number": grnNo },
        ],
      }).lean<any[]>();

      const relatedReturnsMap = new Map<string, any>();
      for (const r of statePurchaseReturns) {
        relatedReturnsMap.set(r.id || r.number, {
          id: r.id || r.number,
          return_number: r.number,
          date: r.date,
          total: Number(r.total) || 0,
          reason: r.reason || null,
          operator_name: r.operator_name || null,
          items: r.items || [],
        });
      }
      for (const r of eventPurchaseReturns) {
        const key = r.payload?.return_id || r.source_record_id;
        if (!relatedReturnsMap.has(key)) {
          relatedReturnsMap.set(key, {
            id: key,
            return_number: r.payload?.return_number || key,
            date: new Date(r.occurred_at).toISOString(),
            total: Number(r.payload?.return_total) || 0,
            reason: r.payload?.reason || null,
            operator_name: r.payload?.operator_name || null,
            items: r.payload?.items || [],
          });
        }
      }

      const lines = Array.isArray(p.lines)
        ? p.lines.map((l: any, idx: number) => ({
            index: idx + 1,
            product_id: l.product_id,
            code: l.code || null,
            name: l.name || l.product_id,
            unit: l.unit || "unit",
            multiplier: Number(l.multiplier ?? 1),
            qty: Number(l.qty) || 0,
            free_qty: Number(l.free_qty ?? 0),
            cost: Math.round(Number(l.cost ?? 0) * 100) / 100,
            discount_pct: Number(l.discount_pct ?? 0),
            tax_amount: Math.round(Number(l.tax_amount ?? 0) * 100) / 100,
            line_total: Math.round(Number(l.line_total ?? (Number(l.qty) || 0) * (Number(l.cost) || 0)) * 100) / 100,
            batch_no: l.batch_no || null,
            expiry: l.expiry || null,
            sale_price: l.sale_price !== undefined ? Number(l.sale_price) : null,
          }))
        : [];

      const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.migration_imported);

      return NextResponse.json({
        purchase: {
          id: purId,
          event_id: purDoc.event_id,
          grn: grnNo,
          occurred_at: new Date(purDoc.occurred_at).toISOString(),
          supplier_id: p.supplier_id || null,
          supplier_name: p.supplier_name || "Supplier",
          subtotal: Math.round(Number(p.subtotal ?? p.purchase_total ?? 0) * 100) / 100,
          discount: Math.round(Number(p.discount ?? 0) * 100) / 100,
          tax_amount: Math.round(Number(p.tax_amount ?? 0) * 100) / 100,
          purchase_total: Math.round(Number(p.purchase_total ?? 0) * 100) / 100,
          paid_amount: p.paid_amount !== undefined ? Math.round(Number(p.paid_amount) * 100) / 100 : null,
          payment_verification_status: isLegacyExcluded
            ? "historical_unverified"
            : Number(p.paid_amount ?? 0) >= Number(p.purchase_total ?? 0) - 0.01 && Number(p.purchase_total ?? 0) > 0
            ? "paid"
            : Number(p.paid_amount ?? 0) > 0
            ? "partial"
            : "credit_payable",
          operator_name: p.operator_name || null,
          terminal_number: purDoc.terminal_number ?? p.terminal_number ?? 1,
          notes: p.notes || null,
          migration_imported: Boolean(p.migration_imported),
          exclude_from_supplier_balance: Boolean(p.exclude_from_supplier_balance),
          items_archived: Boolean(p.items_archived),
          has_line_details: lines.length > 0,
          lines,
          related_returns: Array.from(relatedReturnsMap.values()),
        },
      });
    }

    // List query
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

    const baseMatch: Record<string, any> = {
      client_id: clientId,
      type: "purchase.received",
    };

    if (rangeStart || rangeEnd) {
      baseMatch.occurred_at = {};
      if (rangeStart) baseMatch.occurred_at.$gte = rangeStart;
      if (rangeEnd) baseMatch.occurred_at.$lte = rangeEnd;
    }

    if (supplierFilter && supplierFilter !== "all") {
      baseMatch.$or = [
        { "payload.supplier_name": supplierFilter },
        { "payload.supplier_id": supplierFilter },
      ];
    }

    const andConditions: any[] = [];
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      andConditions.push({
        $or: [
          { "payload.grn": regex },
          { source_record_id: regex },
          { "payload.supplier_name": regex },
          { "payload.lines.name": regex },
        ],
      });
    }

    if (andConditions.length > 0) {
      baseMatch.$and = andConditions;
    }

    const paginatedMatch: Record<string, any> = { ...baseMatch };
    if (cursor && cursor.includes("|")) {
      const [cursorIso, cursorEventId] = cursor.split("|");
      const cursorDate = new Date(cursorIso);
      if (!isNaN(cursorDate.getTime()) && cursorEventId) {
        paginatedMatch.$and = [
          ...(paginatedMatch.$and || []),
          {
            $or: [
              { occurred_at: { $lt: cursorDate } },
              { occurred_at: cursorDate, event_id: { $lt: cursorEventId } },
            ],
          },
        ];
      }
    }

    const [events, summaryAgg, supplierAggFromEvents] = await Promise.all([
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
            total_amount: { $sum: { $ifNull: ["$payload.purchase_total", 0] } },
          },
        },
      ]),
      AnalyticsEvent.aggregate([
        {
          $match: {
            client_id: clientId,
            type: "purchase.received",
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$payload.supplier_name", "Unknown Supplier"] },
            supplier_id: { $first: "$payload.supplier_id" },
            purchase_count: { $sum: 1 },
            purchase_volume: { $sum: { $ifNull: ["$payload.purchase_total", 0] } },
            last_purchase_at: { $max: "$occurred_at" },
          },
        },
        { $sort: { purchase_volume: -1 } },
      ]),
    ]);

    const hasMore = events.length > limit;
    const pageDocs = hasMore ? events.slice(0, limit) : events;
    const lastDoc: any = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && lastDoc
        ? `${new Date(lastDoc.occurred_at).toISOString()}|${lastDoc.event_id}`
        : null;

    const purchases = pageDocs.map((e: any) => {
      const p = e.payload || {};
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.migration_imported);
      return {
        id: p.purchase_id || e.source_record_id,
        event_id: e.event_id,
        grn: p.grn || e.source_record_id,
        occurred_at: new Date(e.occurred_at).toISOString(),
        supplier_id: p.supplier_id || null,
        supplier_name: p.supplier_name || "Supplier",
        subtotal: Math.round(Number(p.subtotal ?? p.purchase_total ?? 0) * 100) / 100,
        discount: Math.round(Number(p.discount ?? 0) * 100) / 100,
        tax_amount: Math.round(Number(p.tax_amount ?? 0) * 100) / 100,
        purchase_total: Math.round(Number(p.purchase_total ?? 0) * 100) / 100,
        paid_amount: p.paid_amount !== undefined ? Math.round(Number(p.paid_amount) * 100) / 100 : null,
        payment_verification_status: isLegacyExcluded
          ? "historical_unverified"
          : Number(p.paid_amount ?? 0) >= Number(p.purchase_total ?? 0) - 0.01 && Number(p.purchase_total ?? 0) > 0
          ? "paid"
          : "credit_payable",
        lines_count: lines.length,
        has_line_details: lines.length > 0,
        operator_name: p.operator_name || null,
        migration_imported: Boolean(p.migration_imported),
        exclude_from_supplier_balance: Boolean(p.exclude_from_supplier_balance),
      };
    });

    // Build Supplier Directory merging OwnerPortalState.suppliers + supplierAggFromEvents
    const stateSuppliers: any[] = portalState?.suppliers || [];
    const supplierByNameMap = new Map<string, any>();

    for (const s of stateSuppliers) {
      const normKey = (s.name || "").trim().toLowerCase();
      if (!normKey) continue;
      supplierByNameMap.set(normKey, {
        id: s.id || s.name,
        name: s.name,
        phone: s.phone || null,
        email: s.email || null,
        address: s.address || null,
        opening_balance: Math.round(Number(s.opening_balance ?? 0) * 100) / 100,
        verified_payable: Math.round(Number(s.verified_payable ?? 0) * 100) / 100,
        total_purchases_amount: Math.round(Number(s.total_purchases_amount ?? 0) * 100) / 100,
        total_purchases_count: Number(s.total_purchases_count ?? 0),
        unverified_historical_purchases_count: Number(s.unverified_historical_purchases_count ?? 0),
        unverified_historical_purchases_amount: Math.round(
          Number(s.unverified_historical_purchases_amount ?? 0) * 100
        ) / 100,
        legacy_balance_status: s.legacy_balance_status || "verified",
        last_purchase_at: s.last_purchase_at || null,
        is_migrated: Boolean(s.is_migrated),
      });
    }

    for (const agg of supplierAggFromEvents) {
      const name = String(agg._id || "Supplier").trim();
      const normKey = name.toLowerCase();
      const existing = supplierByNameMap.get(normKey);
      if (!existing) {
        supplierByNameMap.set(normKey, {
          id: agg.supplier_id || encodeURIComponent(name),
          name,
          phone: null,
          email: null,
          address: null,
          opening_balance: 0,
          verified_payable: 0,
          total_purchases_amount: Math.round(Number(agg.purchase_volume ?? 0) * 100) / 100,
          total_purchases_count: Number(agg.purchase_count ?? 0),
          unverified_historical_purchases_count: 0,
          unverified_historical_purchases_amount: 0,
          legacy_balance_status: "verified",
          last_purchase_at: agg.last_purchase_at ? new Date(agg.last_purchase_at).toISOString() : null,
          is_migrated: false,
        });
      } else {
        if (!existing.total_purchases_count && agg.purchase_count) {
          existing.total_purchases_count = agg.purchase_count;
          existing.total_purchases_amount = Math.round(Number(agg.purchase_volume ?? 0) * 100) / 100;
        }
        if (!existing.last_purchase_at && agg.last_purchase_at) {
          existing.last_purchase_at = new Date(agg.last_purchase_at).toISOString();
        }
      }
    }

    let suppliersDirectory = Array.from(supplierByNameMap.values());
    if (q) {
      const qLower = q.toLowerCase();
      suppliersDirectory = suppliersDirectory.filter(
        (s) =>
          s.name.toLowerCase().includes(qLower) ||
          (s.phone && s.phone.toLowerCase().includes(qLower))
      );
    }
    if (supplierStatusFilter === "unverified") {
      suppliersDirectory = suppliersDirectory.filter(
        (s) => s.legacy_balance_status === "historical_unverified" || s.unverified_historical_purchases_count > 0
      );
    } else if (supplierStatusFilter === "payable") {
      suppliersDirectory = suppliersDirectory.filter((s) => s.verified_payable > 0);
    }

    suppliersDirectory.sort(
      (a, b) =>
        b.verified_payable - a.verified_payable ||
        b.total_purchases_amount - a.total_purchases_amount
    );

    const totalVerifiedPayable = suppliersDirectory.reduce((sum, s) => sum + s.verified_payable, 0);
    const unverifiedSuppliersCount = suppliersDirectory.filter(
      (s) => s.legacy_balance_status === "historical_unverified"
    ).length;

    return NextResponse.json({
      purchases,
      next_cursor: nextCursor,
      has_more: hasMore,
      suppliers: suppliersDirectory,
      summary: {
        purchases_count: summaryAgg[0]?.total_count ?? 0,
        purchases_amount: Math.round((summaryAgg[0]?.total_amount ?? 0) * 100) / 100,
        suppliers_count: suppliersDirectory.length,
        total_verified_payable: Math.round(totalVerifiedPayable * 100) / 100,
        unverified_suppliers_count: unverifiedSuppliersCount,
      },
    });
  } catch (e: any) {
    console.error("Portal purchases error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

