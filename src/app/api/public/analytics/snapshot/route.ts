import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import InventorySnapshot from "@/models/InventorySnapshot";
import OwnerPortalState from "@/models/OwnerPortalState";
import OwnerActionState from "@/models/OwnerActionState";
import OwnerCustomerMeta from "@/models/OwnerCustomerMeta";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import CloudExpense from "@/models/CloudExpense";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import HistoricalTopProduct from "@/models/HistoricalTopProduct";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import AuditLog from "@/models/AuditLog";
import Client from "@/models/Client";
import { isCloudDashboardEnabled } from "@/lib/status";
import { extractRequestGeo } from "@/lib/geo-location";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Detailed line-item retention window in days (Part I & Prompt 2 Section 8).
 * Events older than this window keep their header totals for daily/monthly trends
 * while their bulky line-item arrays are compacted to protect MongoDB Atlas M0 storage.
 */
const DETAIL_RETENTION_DAYS = 35;
const COMPACTION_INTERVAL_MS = 12 * 60 * 60 * 1000; // Run at most once every 12 hours per pharmacy

/**
 * POST /api/public/analytics/snapshot
 *
 * Receives an inventory & operational state snapshot from POS and upserts the
 * canonical state for the license. Protects against out-of-order stale snapshots.
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const { license_key, machine_id, snapshot, portal_state, reset_portal_data } = body ?? {};

    if (!license_key || !machine_id || (!snapshot && !reset_portal_data)) {
      return NextResponse.json(
        { error: "missing_fields", message: "license_key, machine_id, and snapshot (or reset_portal_data) are required." },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // Resolve license
    const license = await License.findOne({ license_key }).lean<{
      id: string; client_id: string; status: string; features: any;
    }>();

    if (!license) {
      return NextResponse.json({ error: "invalid_license" }, { status: 401, headers: CORS });
    }

    if (license.status !== "active") {
      return NextResponse.json({ error: "license_not_active" }, { status: 403, headers: CORS });
    }

    if (!reset_portal_data && !isCloudDashboardEnabled(license)) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403, headers: CORS });
    }

    // Verify registered seat and update last_seen_at + silent geolocation
    const now = new Date();
    const seatUpdate: Record<string, any> = { last_seen_at: now };
    try {
      const client = license.client_id
        ? await Client.findOne({ id: license.client_id }).lean()
        : null;
      const geo = extractRequestGeo(
        req,
        body?.location,
        client?.address || client?.name
      );
      if (geo) {
        seatUpdate.location = geo;
        if (client && client.location?.source !== "admin_manual") {
          await Client.updateOne({ id: client.id }, { $set: { location: geo } });
        }
      }
    } catch {
      // Never block snapshot ingestion on geolocation
    }

    const seat = await LicenseSeat.findOneAndUpdate(
      {
        license_id: license.id,
        machine_id: String(machine_id),
      },
      { $set: seatUpdate },
      { new: true }
    ).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json({ error: "machine_not_registered" }, { status: 401, headers: CORS });
    }

    // ── Handle POS Factory Data Reset (Wipes operational portal data, preserves CloudBackups & Subscription/License) ──
    if (reset_portal_data && typeof reset_portal_data === "object") {
      const rawResetAt = reset_portal_data.reset_at ? new Date(reset_portal_data.reset_at) : now;
      const resetAt = isNaN(rawResetAt.getTime()) ? now : rawResetAt;
      // Allow a 2-second grace buffer for clock skew; any post-reset transactions occurring after resetCutoff remain intact
      const resetCutoff = new Date(resetAt.getTime() + 2000);
      const resetId = String(reset_portal_data.reset_id || `rst_${now.getTime()}`);

      await Promise.all([
        AnalyticsEvent.deleteMany({
          client_id: license.client_id,
          occurred_at: { $lte: resetCutoff },
        }),
        CloudExpense.deleteMany({
          client_id: license.client_id,
          occurred_at: { $lte: resetCutoff },
        }),
        HistoricalDailyAnalytics.deleteMany({ client_id: license.client_id }),
        HistoricalTopProduct.deleteMany({ client_id: license.client_id }),
        HistoricalRecentSale.deleteMany({ client_id: license.client_id }),
        AnalyticsBootstrap.deleteMany({ client_id: license.client_id }),
        OwnerActionState.deleteMany({ client_id: license.client_id }),
        OwnerCustomerMeta.deleteMany({ client_id: license.client_id }),
        InventorySnapshot.findOneAndUpdate(
          { client_id: license.client_id, license_id: license.id },
          {
            $set: {
              reported_by_terminal: seat.terminal_number,
              reported_by_seat_id: seat.id,
              captured_at: now,
              stock_value: 0,
              low_stock_count: 0,
              out_of_stock_count: 0,
              expiring_soon_count: 0,
            },
          },
          { upsert: true }
        ),
        OwnerPortalState.findOneAndUpdate(
          { client_id: license.client_id, license_id: license.id },
          {
            $set: {
              reported_by_terminal: seat.terminal_number,
              reported_by_seat_id: seat.id,
              captured_at: now,
              last_data_reset_at: resetAt,
              last_data_reset_id: resetId,
              customers: [],
              khata_payments: [],
              suppliers: [],
              supplier_payments: [],
              purchase_returns: [],
              current_drawer: null,
              drawer_sessions: [],
              daily_closings: [],
              inventory_alerts: {
                expiring_items: [],
                low_stock_items: [],
                unverified_expiry_items: [],
              },
              products_intelligence: [],
              supplier_price_changes: [],
              category_breakdown_30d: [],
              manufacturer_breakdown_30d: [],
              cashier_performance_30d: [],
            },
          },
          { upsert: true }
        ),
      ]);

      await AuditLog.create({
        action: "pos_factory_reset_synced",
        entity_type: "client",
        entity_id: license.client_id,
        actor_id: seat.id,
        metadata: {
          license_id: license.id,
          terminal_number: seat.terminal_number,
          reset_id: resetId,
          reset_at: resetAt.toISOString(),
          preserved: ["CloudBackup", "License", "Subscription", "LicenseRenewalInvoice"],
        },
      }).catch(() => {});

      // If this was a standalone reset packet (or snapshot is empty), return immediately
      if (!portal_state && (!snapshot || Number(snapshot.stock_value ?? 0) === 0)) {
        return NextResponse.json(
          {
            ok: true,
            reset_completed: true,
            reset_id: resetId,
            reset_at: resetAt.toISOString(),
          },
          { headers: CORS }
        );
      }
    }

    // Validate snapshot fields
    const capturedAt = new Date(snapshot.captured_at);
    if (isNaN(capturedAt.getTime())) {
      return NextResponse.json(
        { error: "invalid_captured_at" },
        { status: 400, headers: CORS }
      );
    }

    // Out-of-order protection: check existing state timestamp
    const existingState = await OwnerPortalState.findOne({
      client_id: license.client_id,
      license_id: license.id,
    })
      .select("captured_at last_retention_compaction_at")
      .lean<{ captured_at?: Date; last_retention_compaction_at?: Date }>();

    if (
      existingState?.captured_at &&
      capturedAt.getTime() < new Date(existingState.captured_at).getTime() - 60_000
    ) {
      // Stale out-of-order snapshot batch — acknowledge idempotently without overwriting newer state
      return NextResponse.json({ ok: true, skipped_stale: true }, { headers: CORS });
    }

    const stockValue = Number(snapshot.stock_value ?? 0);
    const lowStockCount = Number(snapshot.low_stock_count ?? 0);
    const outOfStockCount = Number(snapshot.out_of_stock_count ?? 0);
    const expiringSoonCount = Number(snapshot.expiring_soon_count ?? 0);

    // Upsert canonical snapshot per license (NOT per terminal — prevents double counting)
    await InventorySnapshot.findOneAndUpdate(
      { client_id: license.client_id, license_id: license.id },
      {
        $set: {
          reported_by_terminal: seat.terminal_number,
          reported_by_seat_id: seat.id,
          captured_at: capturedAt,
          stock_value: stockValue,
          low_stock_count: lowStockCount,
          out_of_stock_count: outOfStockCount,
          expiring_soon_count: expiringSoonCount,
        },
      },
      { upsert: true, new: true }
    );

    // Determine whether scheduled bounded retention compaction is due (at most once per 12h)
    const lastCompactedAt = existingState?.last_retention_compaction_at
      ? new Date(existingState.last_retention_compaction_at).getTime()
      : 0;
    const shouldCompact = Date.now() - lastCompactedAt >= COMPACTION_INTERVAL_MS;

    // Upsert compact OwnerPortalState if provided
    const statePayload = portal_state || snapshot.portal_state;
    if (statePayload && typeof statePayload === "object") {
      const updateSet: Record<string, any> = {
        reported_by_terminal: seat.terminal_number,
        reported_by_seat_id: seat.id,
        captured_at: capturedAt,
      };
      if (shouldCompact) {
        updateSet.last_retention_compaction_at = now;
      }
      if (typeof statePayload.movement_coverage_days === "number") {
        updateSet.movement_coverage_days = statePayload.movement_coverage_days;
      }
      if (typeof statePayload.pharmacy_name === "string") updateSet.pharmacy_name = statePayload.pharmacy_name;
      if (typeof statePayload.pharmacy_phone === "string") updateSet.pharmacy_phone = statePayload.pharmacy_phone;
      if (typeof statePayload.pharmacy_address === "string") updateSet.pharmacy_address = statePayload.pharmacy_address;
      if (Array.isArray(statePayload.customers)) updateSet.customers = statePayload.customers.slice(0, 500);
      if (Array.isArray(statePayload.khata_payments)) updateSet.khata_payments = statePayload.khata_payments.slice(0, 250);
      if (Array.isArray(statePayload.suppliers)) updateSet.suppliers = statePayload.suppliers.slice(0, 250);
      if (Array.isArray(statePayload.supplier_payments)) updateSet.supplier_payments = statePayload.supplier_payments.slice(0, 250);
      if (Array.isArray(statePayload.purchase_returns)) updateSet.purchase_returns = statePayload.purchase_returns.slice(0, 150);
      if (statePayload.current_drawer && typeof statePayload.current_drawer === "object") {
        updateSet.current_drawer = statePayload.current_drawer;
      }
      if (Array.isArray(statePayload.drawer_sessions)) updateSet.drawer_sessions = statePayload.drawer_sessions.slice(0, 40);
      if (Array.isArray(statePayload.daily_closings)) updateSet.daily_closings = statePayload.daily_closings.slice(0, 40);
      if (statePayload.inventory_alerts && typeof statePayload.inventory_alerts === "object") {
        updateSet.inventory_alerts = {
          expiring_items: Array.isArray(statePayload.inventory_alerts.expiring_items)
            ? statePayload.inventory_alerts.expiring_items.slice(0, 40)
            : [],
          low_stock_items: Array.isArray(statePayload.inventory_alerts.low_stock_items)
            ? statePayload.inventory_alerts.low_stock_items.slice(0, 40)
            : [],
          unverified_expiry_items: Array.isArray(statePayload.inventory_alerts.unverified_expiry_items)
            ? statePayload.inventory_alerts.unverified_expiry_items.slice(0, 40)
            : [],
        };
      }
      if (Array.isArray(statePayload.products_intelligence)) {
        updateSet.products_intelligence = statePayload.products_intelligence.slice(0, 300);
      }
      if (Array.isArray(statePayload.supplier_price_changes)) {
        updateSet.supplier_price_changes = statePayload.supplier_price_changes.slice(0, 50);
      }
      if (Array.isArray(statePayload.category_breakdown_30d)) {
        updateSet.category_breakdown_30d = statePayload.category_breakdown_30d.slice(0, 40);
      }
      if (Array.isArray(statePayload.manufacturer_breakdown_30d)) {
        updateSet.manufacturer_breakdown_30d = statePayload.manufacturer_breakdown_30d.slice(0, 40);
      }
      if (Array.isArray(statePayload.cashier_performance_30d)) {
        updateSet.cashier_performance_30d = statePayload.cashier_performance_30d.slice(0, 30);
      }

      await OwnerPortalState.findOneAndUpdate(
        { client_id: license.client_id, license_id: license.id },
        { $set: updateSet },
        { upsert: true }
      );
    }

    // Throttled bounded retention maintenance (once every 12h per tenant)
    if (shouldCompact) {
      const retentionCutoff = new Date(Date.now() - DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await AnalyticsEvent.updateMany(
        {
          client_id: license.client_id,
          occurred_at: { $lt: retentionCutoff },
          "payload.items_archived": { $ne: true },
          $or: [
            { "payload.items.0": { $exists: true } },
            { "payload.lines.0": { $exists: true } },
          ],
        },
        {
          $set: { "payload.items_archived": true },
          $unset: { "payload.items": "", "payload.lines": "" },
        }
      ).catch((err) => console.warn("Retention compaction warning:", err));
    }

    return NextResponse.json(
      {
        ok: true,
        ...(reset_portal_data ? { reset_completed: true, reset_id: reset_portal_data.reset_id } : {}),
      },
      { headers: CORS }
    );
  } catch (e: any) {
    console.error("Snapshot error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
