import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import InventorySnapshot from "@/models/InventorySnapshot";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";
import AnalyticsEvent from "@/models/AnalyticsEvent";

/**
 * GET /api/portal/inventory
 *
 * Inventory Intelligence & Product Analysis (Prompt 2 Section 5).
 * Supports:
 * - List view with search, filter (all | low_stock | out_of_stock | expiring_soon |
 *   unverified_expiry | slow_moving | dead_stock | overstock | negative_margin |
 *   price_increased | watchlist), category filter, and pagination.
 * - Single Product Detail drill-down (?product_id=...) returning recent sales trend,
 *   purchase history, unit-normalized supplier cost comparison, and batch/expiry details.
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const { searchParams } = new URL(req.url);

    const productId = searchParams.get("product_id");
    const filter = searchParams.get("filter") || "all";
    const category = searchParams.get("category") || "all";
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(10, parseInt(searchParams.get("limit") || "25", 10)));

    const [invSnap, portalState, actionState] = await Promise.all([
      InventorySnapshot.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerPortalState.findOne({ client_id: clientId })
        .sort({ captured_at: -1 })
        .lean<any>(),
      OwnerActionState.findOne({ client_id: clientId }).lean<any>(),
    ]);

    const watchlist: any[] = actionState?.reorder_watchlist || [];
    const watchlistMap = new Map<string, any>();
    for (const w of watchlist) {
      if (w?.product_id) watchlistMap.set(w.product_id, w);
    }

    // Build unified product intelligence list (use POS products_intelligence when available,
    // or synthesize from inventory_alerts + recent AnalyticsEvents when POS is on older snapshot)
    let products: any[] = Array.isArray(portalState?.products_intelligence)
      ? [...portalState.products_intelligence]
      : [];

    const hasFullPosIntelligence = products.length > 0;
    const movementCoverageDays = hasFullPosIntelligence
      ? Number(portalState?.movement_coverage_days || 90)
      : 30;

    if (!hasFullPosIntelligence) {
      const prodMap = new Map<string, any>();

      for (const ls of portalState?.inventory_alerts?.low_stock_items || []) {
        const pid = ls.product_id || ls.code || ls.name;
        const stock = Number(ls.current_stock ?? 0);
        const reorder = Number(ls.reorder_level ?? 0);
        const cost = Number(ls.cost ?? 0);
        prodMap.set(pid, {
          product_id: pid,
          code: ls.code,
          name: ls.name,
          category: ls.category || "General",
          manufacturer: ls.supplier_name || undefined,
          unit_type: "Unit",
          current_stock: stock,
          reorder_level: reorder,
          sale_price: Number(ls.sale_price ?? 0),
          cost_wac: cost,
          stock_value: Math.max(0, stock) * cost,
          margin_pct: 0,
          sold_qty_30d: 0,
          sold_qty_90d: 0,
          sold_revenue_30d: 0,
          gross_profit_30d: 0,
          movement_status: stock <= 0 ? "out_of_stock" : "normal",
        });
      }

      for (const ex of portalState?.inventory_alerts?.expiring_items || []) {
        const pid = ex.product_id || ex.code || ex.name;
        const existing = prodMap.get(pid) || {
          product_id: pid,
          code: ex.code,
          name: ex.name,
          category: ex.category || "General",
          unit_type: "Unit",
          current_stock: Number(ex.qty ?? 0),
          reorder_level: 0,
          sale_price: Number(ex.sale_price ?? 0),
          cost_wac: Number(ex.cost ?? 0),
          stock_value: Number(ex.value ?? 0),
          margin_pct: 0,
          sold_qty_30d: 0,
          sold_qty_90d: 0,
          sold_revenue_30d: 0,
          gross_profit_30d: 0,
          movement_status: "normal",
        };
        existing.nearest_expiry = ex.expiry;
        existing.nearest_batch = ex.batch_no;
        existing.days_to_expiry = Number(ex.days_left ?? ex.days_to_expiry ?? 0);
        prodMap.set(pid, existing);
      }

      for (const unv of portalState?.inventory_alerts?.unverified_expiry_items || []) {
        const pid = unv.product_id || unv.code || unv.name;
        const existing = prodMap.get(pid) || {
          product_id: pid,
          code: unv.code,
          name: unv.name,
          category: unv.category || "General",
          unit_type: "Unit",
          current_stock: Number(unv.qty ?? 0),
          reorder_level: 0,
          sale_price: 0,
          cost_wac: Number(unv.cost ?? 0),
          stock_value: Number(unv.value ?? 0),
          margin_pct: 0,
          sold_qty_30d: 0,
          sold_qty_90d: 0,
          sold_revenue_30d: 0,
          gross_profit_30d: 0,
          movement_status: "normal",
        };
        existing.has_unverified_expiry = true;
        existing.nearest_batch = unv.batch_no;
        prodMap.set(pid, existing);
      }

      // Enrich with recent 30d sales/purchases events
      const cutoff30d = new Date(Date.now() - 30 * 86400_000);
      const recentEvents = await AnalyticsEvent.find({
        client_id: clientId,
        occurred_at: { $gte: cutoff30d },
        type: { $in: ["sale.completed", "purchase.received"] },
      })
        .sort({ occurred_at: -1 })
        .limit(250)
        .lean<any[]>();

      for (const ev of recentEvents) {
        const evType = ev.type || ev.event_type;
        const items = ev.payload?.items || ev.payload?.lines || [];
        const occurredIso = new Date(ev.occurred_at).toISOString();
        if (evType === "sale.completed") {
          for (const it of items) {
            const pid = it.product_id || it.code || it.product_name || it.name;
            if (!pid) continue;
            const entry = prodMap.get(pid) || {
              product_id: pid,
              code: it.code,
              name: it.product_name || it.name || pid,
              category: it.category || "General",
              unit_type: it.unit_type || it.unit || "Unit",
              current_stock: 0,
              reorder_level: 0,
              sale_price: Number(it.unit_price ?? 0),
              cost_wac: Number(it.cost_price ?? 0),
              stock_value: 0,
              margin_pct: 0,
              sold_qty_30d: 0,
              sold_qty_90d: 0,
              sold_revenue_30d: 0,
              gross_profit_30d: 0,
              movement_status: "normal",
            };
            const q = Number(it.qty ?? 0);
            const rev = Number(it.revenue ?? it.line_total ?? q * Number(it.unit_price ?? 0));
            entry.sold_qty_30d += q;
            entry.sold_qty_90d += q;
            entry.sold_revenue_30d += rev;
            if (!entry.sale_price && it.unit_price) entry.sale_price = Number(it.unit_price);
            if (!entry.last_sold_at || occurredIso > entry.last_sold_at) {
              entry.last_sold_at = occurredIso;
            }
            if (entry.sold_qty_30d >= 15 && entry.current_stock > 0) {
              entry.movement_status = "fast_moving";
            }
            prodMap.set(pid, entry);
          }
        } else if (evType === "purchase.received") {
          const supName = ev.payload?.supplier_name || "Supplier";
          for (const it of items) {
            const pid = it.product_id || it.code || it.product_name || it.name;
            if (!pid) continue;
            const entry = prodMap.get(pid) || {
              product_id: pid,
              code: it.code,
              name: it.product_name || it.name || pid,
              category: it.category || "General",
              unit_type: it.unit_type || it.unit || "Unit",
              current_stock: Number(it.qty ?? 0),
              reorder_level: 0,
              sale_price: Number(it.sale_price ?? 0),
              cost_wac: Number(it.cost_price ?? it.cost ?? 0),
              stock_value: 0,
              margin_pct: 0,
              sold_qty_30d: 0,
              sold_qty_90d: 0,
              sold_revenue_30d: 0,
              gross_profit_30d: 0,
              movement_status: "normal",
            };
            const c = Number(it.cost_price ?? it.cost ?? 0);
            if (c > 0 && !entry.last_purchase_cost) {
              entry.last_purchase_cost = c;
              entry.last_purchased_at = occurredIso;
              entry.last_supplier_name = supName;
              if (!entry.cost_wac) entry.cost_wac = c;
            } else if (c > 0 && entry.last_purchase_cost && !entry.prev_purchase_cost) {
              entry.prev_purchase_cost = c;
              entry.cost_change_pct = Number(
                (((entry.last_purchase_cost - c) / c) * 100).toFixed(1)
              );
            }
            if (it.sale_price && !entry.sale_price) entry.sale_price = Number(it.sale_price);
            if (entry.sale_price > 0 && entry.cost_wac > 0) {
              entry.margin_pct = Number(
                (((entry.sale_price - entry.cost_wac) / entry.sale_price) * 100).toFixed(1)
              );
              entry.is_negative_margin = entry.cost_wac > entry.sale_price;
            }
            prodMap.set(pid, entry);
          }
        }
      }

      products = Array.from(prodMap.values());
    }

    // Attach watchlist flag to every product
    products = products.map((p) => ({
      ...p,
      in_watchlist: watchlistMap.has(p.product_id),
      watchlist_item: watchlistMap.get(p.product_id) || null,
    }));

    // Handle Single Product Detail Drill-down (?product_id=...)
    if (productId) {
      const targetProd =
        products.find((p) => p.product_id === productId || p.code === productId) || null;

      const cutoff35d = new Date(Date.now() - 35 * 86400_000);
      const events = await AnalyticsEvent.find({
        client_id: clientId,
        occurred_at: { $gte: cutoff35d },
        type: { $in: ["sale.completed", "purchase.received"] },
        $or: [
          { "payload.items.product_id": productId },
          { "payload.lines.product_id": productId },
          ...(targetProd?.name
            ? [
              { "payload.items.name": targetProd.name },
              { "payload.items.product_name": targetProd.name },
              { "payload.lines.name": targetProd.name },
            ]
            : []),
        ],
      })
        .sort({ occurred_at: -1 })
        .limit(60)
        .lean<any[]>();

      const recentSales: any[] = [];
      const purchaseHistory: any[] = [];
      const supplierMap = new Map<
        string,
        {
          supplier_name: string;
          unit_type: string;
          latest_cost: number;
          min_cost: number;
          max_cost: number;
          total_qty: number;
          deliveries_count: number;
          last_date: string;
        }
      >();

      for (const ev of events) {
        const evType = ev.type || ev.event_type;
        const items = ev.payload?.items || ev.payload?.lines || [];
        const matchLine = items.find(
          (i: any) =>
            i.product_id === productId ||
            (targetProd?.name &&
              (i.name === targetProd.name || i.product_name === targetProd.name))
        );
        if (!matchLine) continue;
        const occurredIso = new Date(ev.occurred_at).toISOString();

        if (evType === "sale.completed") {
          recentSales.push({
            invoice_id: ev.payload?.invoice_id || ev.source_record_id || ev.event_id,
            invoice_number:
              ev.payload?.invoice_number || ev.source_record_id || ev.event_id,
            occurred_at: occurredIso,
            qty: Number(matchLine.qty ?? 0),
            unit_price: Number(matchLine.unit_price ?? 0),
            discount: Number(matchLine.discount ?? 0),
            line_total: Number(matchLine.revenue ?? matchLine.line_total ?? 0),
            cashier_name:
              ev.payload?.cashier || ev.payload?.cashier_name || "Cashier",
          });
        } else if (evType === "purchase.received") {
          const supName = ev.payload?.supplier_name || "Supplier";
          const cost = Number(matchLine.cost_price ?? matchLine.cost ?? 0);
          const qty = Number(matchLine.qty ?? 0);
          const bonus = Number(matchLine.bonus_qty ?? matchLine.free_qty ?? 0);
          const unitType =
            matchLine.unit_type || matchLine.unit || targetProd?.unit_type || "Unit";

          purchaseHistory.push({
            purchase_id:
              ev.payload?.purchase_id || ev.source_record_id || ev.event_id,
            grn_number:
              ev.payload?.grn ||
              ev.payload?.grn_number ||
              ev.payload?.purchase_number ||
              ev.source_record_id ||
              ev.event_id,
            supplier_id: ev.payload?.supplier_id,
            supplier_name: supName,
            occurred_at: occurredIso,
            batch_number: matchLine.batch_number || matchLine.batch_no,
            expiry_date: matchLine.expiry_date || matchLine.expiry,
            qty,
            bonus_qty: bonus,
            cost_price: cost,
            sale_price: Number(matchLine.sale_price ?? 0),
            unit_type: unitType,
            line_total: Number(matchLine.line_total ?? cost * qty),
          });

          if (cost > 0) {
            // Normalize key by supplier + unit_type to avoid comparing incompatible pack sizes
            const sKey = `${supName}__${unitType}`;
            const cur = supplierMap.get(sKey) || {
              supplier_name: supName,
              unit_type: unitType,
              latest_cost: cost,
              min_cost: cost,
              max_cost: cost,
              total_qty: 0,
              deliveries_count: 0,
              last_date: occurredIso,
            };
            cur.min_cost = Math.min(cur.min_cost, cost);
            cur.max_cost = Math.max(cur.max_cost, cost);
            cur.total_qty += qty;
            cur.deliveries_count += 1;
            if (occurredIso > cur.last_date) {
              cur.last_date = occurredIso;
              cur.latest_cost = cost;
            }
            supplierMap.set(sKey, cur);
          }
        }
      }

      return NextResponse.json({
        ok: true,
        product: targetProd,
        recent_sales: recentSales.slice(0, 25),
        purchase_history: purchaseHistory.slice(0, 25),
        supplier_comparisons: Array.from(supplierMap.values()).sort(
          (a, b) => a.latest_cost - b.latest_cost
        ),
        last_synced_at: portalState?.captured_at || invSnap?.captured_at || null,
        movement_coverage_days: movementCoverageDays,
      });
    }

    // Summary KPIs across products
    const summary = {
      total_tracked_skus: products.length,
      stock_value: Number(invSnap?.stock_value ?? 0),
      low_stock_count: Number(
        invSnap?.low_stock_count ??
        products.filter((p) => p.current_stock > 0 && p.current_stock <= p.reorder_level)
          .length
      ),
      out_of_stock_count: Number(
        invSnap?.out_of_stock_count ??
        products.filter((p) => p.current_stock <= 0).length
      ),
      expiring_soon_count: Number(
        invSnap?.expiring_soon_count ??
        products.filter((p) => p.days_to_expiry !== null && p.days_to_expiry !== undefined && p.days_to_expiry <= 60).length
      ),
      unverified_expiry_count:
        (portalState?.inventory_alerts?.unverified_expiry_items || []).length ||
        products.filter((p) => p.has_unverified_expiry).length,
      slow_moving_count: products.filter((p) => p.movement_status === "slow_moving").length,
      dead_stock_count: products.filter((p) => p.movement_status === "dead_stock").length,
      negative_margin_count: products.filter((p) => p.is_negative_margin).length,
      price_increased_count:
        (portalState?.supplier_price_changes || []).length ||
        products.filter((p) => (p.cost_change_pct || 0) >= 3).length,
      watchlist_count: watchlist.length,
    };

    const categories = Array.from(
      new Set(products.map((p) => p.category).filter(Boolean))
    ).sort();

    // Filter products
    const filtered = products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (q) {
        const match =
          (p.name || "").toLowerCase().includes(q) ||
          (p.code || "").toLowerCase().includes(q) ||
          (p.generic_name || "").toLowerCase().includes(q) ||
          (p.manufacturer || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q);
        if (!match) return false;
      }

      switch (filter) {
        case "low_stock":
          return p.current_stock > 0 && p.current_stock <= (p.reorder_level || 0);
        case "out_of_stock":
          return p.current_stock <= 0;
        case "expiring_soon":
          return (
            p.days_to_expiry !== null &&
            p.days_to_expiry !== undefined &&
            p.days_to_expiry <= 60
          );
        case "unverified_expiry":
          return Boolean(p.has_unverified_expiry);
        case "slow_moving":
          return p.movement_status === "slow_moving";
        case "dead_stock":
          return p.movement_status === "dead_stock";
        case "overstock":
          return Boolean(p.is_overstock);
        case "negative_margin":
          return Boolean(p.is_negative_margin);
        case "price_increased":
          return Number(p.cost_change_pct || 0) >= 3;
        case "watchlist":
          return Boolean(p.in_watchlist);
        default:
          return true;
      }
    });

    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
    const pageItems = filtered.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      ok: true,
      summary,
      categories,
      items: pageItems,
      supplier_price_changes: portalState?.supplier_price_changes || [],
      watchlist,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        total_pages: totalPages,
      },
      data_coverage: {
        has_full_pos_intelligence: hasFullPosIntelligence,
        movement_coverage_days: movementCoverageDays,
        last_synced_at: portalState?.captured_at || invSnap?.captured_at || null,
        coverage_notice: hasFullPosIntelligence
          ? `Movement classification (Fast / Slow / Dead Stock) is computed by POS over ${movementCoverageDays} days of local history.`
          : "Showing products from recent 30-day cloud sync & stock alerts. Full 90-day slow/dead-stock classification updates automatically on next POS snapshot.",
      },
    });
  } catch (err: any) {
    console.error("[api/portal/inventory] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load inventory intelligence", detail: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/portal/inventory
 * Add, update, or remove a product on the cloud-side Owner Reorder Watchlist.
 */
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const clientId = session.client_id;
    const body = await req.json();
    const { action, product_id } = body;

    if (!product_id) {
      return NextResponse.json({ error: "product_id is required" }, { status: 400 });
    }

    let doc = await OwnerActionState.findOne({ client_id: clientId });
    if (!doc) {
      doc = new OwnerActionState({
        client_id: clientId,
        alert_states: [],
        reorder_watchlist: [],
        cash_reviews: [],
        review_tasks: [],
      });
    }

    if (action === "remove_watchlist") {
      doc.reorder_watchlist = (doc.reorder_watchlist || []).filter(
        (w: any) => w.product_id !== product_id
      );
      doc.markModified("reorder_watchlist");
      await doc.save();
      return NextResponse.json({ ok: true, watchlist: doc.reorder_watchlist });
    }

    // Default: add or update watchlist item
    const entry = {
      product_id: String(product_id),
      code: body.code ? String(body.code) : undefined,
      name: String(body.name || product_id),
      category: body.category ? String(body.category) : undefined,
      supplier_name: body.supplier_name ? String(body.supplier_name) : undefined,
      current_stock:
        body.current_stock !== undefined ? Number(body.current_stock) : undefined,
      reorder_level:
        body.reorder_level !== undefined ? Number(body.reorder_level) : undefined,
      target_order_qty: Math.max(1, Number(body.target_order_qty || 10)),
      last_cost: body.last_cost !== undefined ? Number(body.last_cost) : undefined,
      note: body.note ? String(body.note).slice(0, 250) : undefined,
      status: ["watch", "ordered", "received"].includes(body.status)
        ? body.status
        : ("watch" as const),
      added_by: session.name || session.email || "Owner",
      added_at: new Date().toISOString(),
    };

    const nextWatchlist = [
      entry,
      ...(doc.reorder_watchlist || []).filter((w: any) => w.product_id !== product_id),
    ].slice(0, 150);

    doc.reorder_watchlist = nextWatchlist;
    doc.markModified("reorder_watchlist");
    await doc.save();

    return NextResponse.json({ ok: true, item: entry, watchlist: doc.reorder_watchlist });
  } catch (err: any) {
    console.error("[api/portal/inventory] POST error:", err);
    return NextResponse.json(
      { error: "Failed to update reorder watchlist", detail: err.message },
      { status: 500 }
    );
  }
}
