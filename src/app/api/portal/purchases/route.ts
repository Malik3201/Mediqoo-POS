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
          { "payload.purchaseId": decoded },
          { "payload.grn": decoded },
          { "payload.purchase_number": decoded },
          { "payload.purchaseNumber": decoded },
        ],
      }).lean<any>();

      if (!purDoc) {
        // Fallback to historical / synced GRN stored in OwnerPortalState.recent_purchases
        const snapPur = (portalState?.recent_purchases || []).find(
          (rp: any) => rp && (rp.id === decoded || rp.grn === decoded || rp.purchase_number === decoded)
        );
        if (!snapPur) {
          return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
        }
        const purId = snapPur.id || decoded;
        const grnNo = snapPur.grn || snapPur.purchase_number || purId;
        const snapRelatedReturns = (portalState?.purchase_returns || [])
          .filter(
            (pr: any) =>
              (pr.purchase_id && (pr.purchase_id === purId || pr.purchase_id === grnNo)) ||
              (pr.purchase_number && (pr.purchase_number === grnNo || pr.purchase_number === purId))
          )
          .map((r: any) => ({
            id: r.id || r.number,
            return_number: r.number,
            date: r.date,
            total: Number(r.total) || 0,
            reason: r.reason || null,
            operator_name: r.operator_name || null,
            items: r.items || [],
          }));
        const snapLines = Array.isArray(snapPur.lines)
          ? snapPur.lines.map((l: any, idx: number) => ({
              index: idx + 1,
              product_id: l.product_id || l.productId || l.code || l.name,
              code: l.code || null,
              name: l.name || l.product_name || l.product_id,
              unit: l.unit || "unit",
              multiplier: Number(l.multiplier ?? 1),
              qty: Number(l.qty) || 0,
              free_qty: Number(l.free_qty ?? l.freeQty ?? 0),
              cost: Math.round(Number(l.cost ?? 0) * 100) / 100,
              discount_pct: Number(l.discount_pct ?? l.discountPct ?? 0),
              tax_amount: Math.round(Number(l.tax_amount ?? l.taxAmount ?? 0) * 100) / 100,
              line_total: Math.round(Number(l.line_total ?? l.lineTotal ?? (Number(l.qty) || 0) * (Number(l.cost) || 0)) * 100) / 100,
              batch_no: l.batch_no || l.batchNo || null,
              expiry: l.expiry || null,
              sale_price: l.sale_price !== undefined ? Number(l.sale_price) : null,
            }))
          : [];
        const purTot = Number(snapPur.purchase_total ?? snapPur.total ?? 0);
        const paid = snapPur.paid_amount !== undefined && snapPur.paid_amount !== null ? Number(snapPur.paid_amount) : null;
        const isLegacyExcluded = Boolean(snapPur.exclude_from_supplier_balance || snapPur.migration_imported);

        return NextResponse.json({
          purchase: {
            id: purId,
            event_id: `snap_${purId}`,
            grn: grnNo,
            occurred_at: snapPur.date ? new Date(snapPur.date).toISOString() : new Date().toISOString(),
            supplier_id: snapPur.supplier_id || null,
            supplier_name: snapPur.supplier_name || "Supplier",
            subtotal: Math.round(Number(snapPur.subtotal ?? purTot) * 100) / 100,
            discount: Math.round(Number(snapPur.discount ?? 0) * 100) / 100,
            tax_amount: Math.round(Number(snapPur.tax_amount ?? 0) * 100) / 100,
            purchase_total: Math.round(purTot * 100) / 100,
            paid_amount: paid !== null ? Math.round(paid * 100) / 100 : null,
            payment_verification_status: isLegacyExcluded
              ? "historical_unverified"
              : (paid ?? 0) >= purTot - 0.01 && purTot > 0
              ? "paid"
              : (paid ?? 0) > 0
              ? "partial"
              : "credit_payable",
            operator_name: snapPur.operator_name || null,
            terminal_number: 1,
            notes: snapPur.notes || null,
            migration_imported: Boolean(snapPur.migration_imported),
            exclude_from_supplier_balance: Boolean(snapPur.exclude_from_supplier_balance),
            items_archived: false,
            has_line_details: snapLines.length > 0,
            lines: snapLines,
            related_returns: snapRelatedReturns,
          },
        });
      }

      const p = purDoc.payload || {};
      const purId = p.purchase_id || p.purchaseId || purDoc.source_record_id;
      const grnNo = p.grn || p.purchase_number || p.purchaseNumber || purDoc.source_record_id;

      // Match purchase returns from OwnerPortalState + purchase.returned events
      const statePurchaseReturns: any[] = (portalState?.purchase_returns || []).filter(
        (pr: any) =>
          (pr.purchase_id && (pr.purchase_id === purId || pr.purchase_id === grnNo)) ||
          (pr.purchase_number && (pr.purchase_number === grnNo || pr.purchase_number === purId))
      );

      const eventPurchaseReturns = await AnalyticsEvent.find({
        client_id: clientId,
        type: "purchase.returned",
        $or: [
          { "payload.purchase_id": purId },
          { "payload.purchaseId": purId },
          { "payload.purchase_number": grnNo },
          { "payload.purchaseNumber": grnNo },
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
            product_id: l.product_id || l.productId || l.code || l.name,
            code: l.code || null,
            name: l.name || l.product_name || l.productName || l.product_id,
            unit: l.unit || "unit",
            multiplier: Number(l.multiplier ?? 1),
            qty: Number(l.qty) || 0,
            free_qty: Number(l.free_qty ?? l.freeQty ?? 0),
            cost: Math.round(Number(l.cost ?? l.cost_price ?? 0) * 100) / 100,
            discount_pct: Number(l.discount_pct ?? l.discountPct ?? 0),
            tax_amount: Math.round(Number(l.tax_amount ?? l.taxAmount ?? 0) * 100) / 100,
            line_total: Math.round(Number(l.line_total ?? l.lineTotal ?? (Number(l.qty) || 0) * (Number(l.cost) || 0)) * 100) / 100,
            batch_no: l.batch_no || l.batchNo || null,
            expiry: l.expiry || null,
            sale_price: l.sale_price !== undefined ? Number(l.sale_price) : (l.salePrice !== undefined ? Number(l.salePrice) : null),
          }))
        : [];

      const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.excludeFromSupplierBalance || p.migration_imported || p.migrationImported);

      return NextResponse.json({
        purchase: {
          id: purId,
          event_id: purDoc.event_id,
          grn: grnNo,
          occurred_at: new Date(purDoc.occurred_at).toISOString(),
          supplier_id: p.supplier_id || p.supplierId || null,
          supplier_name: p.supplier_name || p.supplierName || p.supplier || "Supplier",
          subtotal: Math.round(Number(p.subtotal ?? p.purchase_total ?? p.purchaseTotal ?? 0) * 100) / 100,
          discount: Math.round(Number(p.discount ?? 0) * 100) / 100,
          tax_amount: Math.round(Number(p.tax_amount ?? p.taxAmount ?? 0) * 100) / 100,
          purchase_total: Math.round(Number(p.purchase_total ?? p.purchaseTotal ?? 0) * 100) / 100,
          paid_amount: p.paid_amount !== undefined ? Math.round(Number(p.paid_amount) * 100) / 100 : (p.paidAmount !== undefined ? Math.round(Number(p.paidAmount) * 100) / 100 : null),
          payment_verification_status: isLegacyExcluded
            ? "historical_unverified"
            : Number(p.paid_amount ?? p.paidAmount ?? 0) >= Number(p.purchase_total ?? p.purchaseTotal ?? 0) - 0.01 && Number(p.purchase_total ?? p.purchaseTotal ?? 0) > 0
            ? "paid"
            : Number(p.paid_amount ?? p.paidAmount ?? 0) > 0
            ? "partial"
            : "credit_payable",
          operator_name: p.operator_name || p.operatorName || null,
          terminal_number: purDoc.terminal_number ?? p.terminal_number ?? p.terminalNumber ?? 1,
          notes: p.notes || null,
          migration_imported: Boolean(p.migration_imported || p.migrationImported),
          exclude_from_supplier_balance: Boolean(p.exclude_from_supplier_balance || p.excludeFromSupplierBalance),
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
        { "payload.supplierName": supplierFilter },
        { "payload.supplier": supplierFilter },
        { "payload.supplier_id": supplierFilter },
        { "payload.supplierId": supplierFilter },
      ];
    }

    const andConditions: any[] = [];
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      andConditions.push({
        $or: [
          { "payload.grn": regex },
          { "payload.purchase_number": regex },
          { "payload.purchaseNumber": regex },
          { source_record_id: regex },
          { "payload.supplier_name": regex },
          { "payload.supplierName": regex },
          { "payload.supplier": regex },
          { "payload.lines.name": regex },
          { "payload.lines.productName": regex },
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
            total_amount: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.purchaseTotal", { $ifNull: ["$payload.purchase_total", { $ifNull: ["$payload.total", 0] }] }] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
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
            _id: { $ifNull: ["$payload.supplierName", { $ifNull: ["$payload.supplier_name", { $ifNull: ["$payload.supplier", "Unknown Supplier"] }] }] },
            supplier_id: { $first: { $ifNull: ["$payload.supplierId", "$payload.supplier_id"] } },
            purchase_count: { $sum: 1 },
            purchase_volume: {
              $sum: {
                $convert: {
                  input: { $ifNull: ["$payload.purchaseTotal", { $ifNull: ["$payload.purchase_total", { $ifNull: ["$payload.total", 0] }] }] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
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

    const livePurchases = pageDocs.map((e: any) => {
      const p = e.payload || {};
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.excludeFromSupplierBalance || p.migration_imported || p.migrationImported);
      const purTot = Number(p.purchase_total ?? p.purchaseTotal ?? p.total ?? 0);
      const paid = p.paid_amount !== undefined ? Number(p.paid_amount) : (p.paidAmount !== undefined ? Number(p.paidAmount) : (p.paid !== undefined ? Number(p.paid) : null));
      return {
        id: p.purchase_id || p.purchaseId || e.source_record_id,
        event_id: e.event_id,
        grn: p.grn || p.purchase_number || p.purchaseNumber || e.source_record_id,
        occurred_at: new Date(e.occurred_at).toISOString(),
        supplier_id: p.supplier_id || p.supplierId || null,
        supplier_name: p.supplier_name || p.supplierName || p.supplier || "Supplier",
        subtotal: Math.round(Number(p.subtotal ?? purTot) * 100) / 100,
        discount: Math.round(Number(p.discount ?? 0) * 100) / 100,
        tax_amount: Math.round(Number(p.tax_amount ?? p.taxAmount ?? 0) * 100) / 100,
        purchase_total: Math.round(purTot * 100) / 100,
        paid_amount: paid !== null ? Math.round(paid * 100) / 100 : null,
        payment_verification_status: isLegacyExcluded
          ? "historical_unverified"
          : (paid !== null ? paid : 0) >= purTot - 0.01 && purTot > 0
          ? "paid"
          : (paid !== null ? paid : 0) > 0
          ? "partial"
          : "credit_payable",
        lines_count: lines.length,
        has_line_details: lines.length > 0,
        operator_name: p.operator_name || p.operatorName || null,
        migration_imported: Boolean(p.migration_imported || p.migrationImported),
        exclude_from_supplier_balance: Boolean(p.exclude_from_supplier_balance || p.excludeFromSupplierBalance),
      };
    });

    // Merge historical / snapshot GRNs from OwnerPortalState.recent_purchases (zero duplicates!)
    const seenPurchaseIds = new Set<string>();
    const seenGrns = new Set<string>();
    for (const lp of livePurchases) {
      if (lp.id) seenPurchaseIds.add(String(lp.id));
      if (lp.grn) seenGrns.add(String(lp.grn));
    }

    const qLowerFilter = q.toLowerCase();
    const supLowerFilter = supplierFilter && supplierFilter !== "all" ? supplierFilter.toLowerCase() : "";

    const filteredSnapPurchases = (portalState?.recent_purchases || [])
      .filter((rp: any) => {
        if (!rp) return false;
        const rpId = String(rp.id || "");
        const rpGrn = String(rp.grn || rp.purchase_number || rpId);
        if ((rpId && seenPurchaseIds.has(rpId)) || (rpGrn && seenGrns.has(rpGrn))) return false;
        const rpDate = rp.date ? new Date(rp.date) : null;
        if (rpDate && !isNaN(rpDate.getTime())) {
          if (rangeStart && rpDate < rangeStart) return false;
          if (rangeEnd && rpDate > rangeEnd) return false;
        }
        if (supLowerFilter) {
          const sName = String(rp.supplier_name || "").toLowerCase();
          const sId = String(rp.supplier_id || "").toLowerCase();
          if (sName !== supLowerFilter && sId !== supLowerFilter) return false;
        }
        if (qLowerFilter) {
          const hay = `${rpGrn} ${rp.supplier_name || ""} ${(rp.lines || []).map((l: any) => l.name || "").join(" ")}`.toLowerCase();
          if (!hay.includes(qLowerFilter)) return false;
        }
        return true;
      })
      .map((rp: any) => {
        const rpId = String(rp.id || rp.grn || "");
        const rpGrn = String(rp.grn || rp.purchase_number || rpId);
        const purTot = Number(rp.purchase_total ?? rp.total ?? 0);
        const paid = rp.paid_amount !== undefined && rp.paid_amount !== null ? Number(rp.paid_amount) : null;
        const isLegacyExcluded = Boolean(rp.exclude_from_supplier_balance || rp.migration_imported);
        const lines = Array.isArray(rp.lines) ? rp.lines : [];
        return {
          id: rpId,
          event_id: `snap_${rpId}`,
          grn: rpGrn,
          occurred_at: rp.date ? new Date(rp.date).toISOString() : new Date().toISOString(),
          supplier_id: rp.supplier_id || null,
          supplier_name: rp.supplier_name || "Supplier",
          subtotal: Math.round(Number(rp.subtotal ?? purTot) * 100) / 100,
          discount: Math.round(Number(rp.discount ?? 0) * 100) / 100,
          tax_amount: Math.round(Number(rp.tax_amount ?? 0) * 100) / 100,
          purchase_total: Math.round(purTot * 100) / 100,
          paid_amount: paid !== null ? Math.round(paid * 100) / 100 : null,
          payment_verification_status: isLegacyExcluded
            ? "historical_unverified"
            : (paid ?? 0) >= purTot - 0.01 && purTot > 0
            ? "paid"
            : (paid ?? 0) > 0
            ? "partial"
            : "credit_payable",
          lines_count: Number(rp.lines_count ?? lines.length),
          has_line_details: lines.length > 0,
          operator_name: rp.operator_name || null,
          migration_imported: Boolean(rp.migration_imported),
          exclude_from_supplier_balance: Boolean(rp.exclude_from_supplier_balance),
        };
      })
      .sort((a: any, b: any) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

    let snapPageSlice = filteredSnapPurchases;
    if (cursor && cursor.includes("|")) {
      const [cursorIso, cursorId] = cursor.split("|");
      const cursorMs = new Date(cursorIso).getTime();
      if (!isNaN(cursorMs)) {
        snapPageSlice = filteredSnapPurchases.filter((sp: any) => {
          const t = new Date(sp.occurred_at).getTime();
          return t < cursorMs || (t === cursorMs && sp.event_id < cursorId);
        });
      }
    }

    let purchases = livePurchases;
    let mergedHasMore = hasMore;
    let mergedNextCursor = nextCursor;

    if (purchases.length < limit && snapPageSlice.length > 0) {
      const needed = limit - purchases.length;
      const take = snapPageSlice.slice(0, needed);
      purchases = [...purchases, ...take];
      if (snapPageSlice.length > needed && take.length > 0) {
        const lastSnap = take[take.length - 1];
        mergedHasMore = true;
        mergedNextCursor = `${lastSnap.occurred_at}|${lastSnap.event_id}`;
      }
    } else if (!mergedHasMore && purchases.length === limit && snapPageSlice.length > 0 && lastDoc) {
      mergedHasMore = true;
      mergedNextCursor = `${new Date(lastDoc.occurred_at).toISOString()}|${lastDoc.event_id}`;
    }

    const combinedPurchasesCount = (summaryAgg[0]?.total_count ?? 0) + filteredSnapPurchases.length;
    const combinedPurchasesAmount =
      (summaryAgg[0]?.total_amount ?? 0) +
      filteredSnapPurchases.reduce((s: number, p: any) => s + (Number(p.purchase_total) || 0), 0);

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
      next_cursor: mergedNextCursor,
      has_more: mergedHasMore,
      suppliers: suppliersDirectory,
      summary: {
        purchases_count: combinedPurchasesCount,
        purchases_amount: Math.round(combinedPurchasesAmount * 100) / 100,
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

