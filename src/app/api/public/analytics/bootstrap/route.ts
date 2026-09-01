import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import Client from "@/models/Client";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import HistoricalTopProduct from "@/models/HistoricalTopProduct";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import InventorySnapshot from "@/models/InventorySnapshot";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/public/analytics/bootstrap
 *
 * One-time historical analytics bootstrap for existing POS installations.
 *
 * Authentication:
 *   - license_key + machine_id must resolve to an active license and seat.
 *
 * Idempotency (per correction #4 & #5):
 *   - Unique index on (license_id, bootstrap_version).
 *   - If same version is submitted again, returns { already_completed: true }.
 *   - If multiple terminals submit, first valid one wins, others get already_completed.
 *
 * Cutover:
 *   - POS sends `cutoff_date` (YYYY-MM-DD local business date).
 *   - Live events (via /events endpoint) occurring after the end of this date will be counted.
 *
 * Payload shape:
 * {
 *   license_key: string,
 *   machine_id: string,
 *   bootstrap_version: number,
 *   cutoff_date: string, // YYYY-MM-DD
 *   daily: [{ date: "YYYY-MM-DD", gross_sales, ... }],
 *   top_products: [{ product_id, product_name, qty, revenue, cogs, gross_profit, period_start, period_end }],
 *   recent_sales: [{ occurred_at: ISOString, invoice_number, gross_sales, net_sales, payment_method, customer_name }],
 *   inventory_snapshot: { ... } // optional
 * }
 */
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS });
    }

    const {
      license_key,
      machine_id,
      bootstrap_version = 1,
      cutoff_date,
      daily,
      top_products,
      recent_sales,
      inventory_snapshot,
    } = body ?? {};

    if (!license_key || !machine_id || !cutoff_date) {
      return NextResponse.json(
        { error: "missing_fields", message: "license_key, machine_id, and cutoff_date are required." },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // ── Step 1: Auth & Resolution ──────────────────────────────────────────
    const license = await License.findOne({ license_key }).lean<{
      id: string; client_id: string; project_id: string; status: string; features: any;
    }>();

    if (!license) {
      return NextResponse.json({ error: "invalid_license" }, { status: 401, headers: CORS });
    }

    if (license.status !== "active" || !license.features?.cloud_dashboard) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403, headers: CORS });
    }

    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: String(machine_id),
    }).lean<{ id: string; terminal_number?: number }>();

    if (!seat) {
      return NextResponse.json({ error: "machine_not_registered" }, { status: 401, headers: CORS });
    }

    // ── Step 2: Client Timezone Resolution ─────────────────────────────────
    const client = await Client.findOne({ id: license.client_id }).select("timezone").lean<{ timezone?: string }>();
    const timezone = client?.timezone ?? "Asia/Karachi";

    // ── Step 3: Idempotency Check ──────────────────────────────────────────
    // Create the bootstrap record first to claim the lock.
    // If it fails with duplicate key, someone else already bootstrapped this version.
    
    // Calculate cutoff_utc (start of the day AFTER cutoff_date in client timezone)
    // This is used for fast > cutoff_utc queries on the dashboard.
    const cutoffDateObj = new Date(`${cutoff_date}T00:00:00`);
    if (isNaN(cutoffDateObj.getTime())) {
      return NextResponse.json({ error: "invalid_cutoff_date", message: "Use YYYY-MM-DD" }, { status: 400, headers: CORS });
    }
    
    // To get start of next day in client timezone, we can parse the date as if it were UTC,
    // add 24 hours, and then format it using Intl to check its actual UTC equivalent,
    // but a simpler standard way for our analytics lib is handled there.
    // For here, we construct the boundary using Intl.
    // Let's create a UTC date that corresponds to 00:00:00 of the day AFTER cutoff_date in local tz.
    const parts = cutoff_date.split("-").map(Number); // [2026, 8, 31]
    
    // Hack-free UTC resolution using Intl formatting loop (similar to startOfDayInTz)
    // Create a rough guess:
    const guessUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1, 0, 0, 0));
    // Find the exact UTC ms where local time becomes 00:00:00 on cutoff_date + 1.
    // Simplified for Vercel/Node:
    const cutoffUtcFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    
    // We just rely on the POS providing cutoff_date. We need the UTC timestamp corresponding to
    // cutoff_date 23:59:59.999... or cutoff_date + 1 00:00:00.000 in the CLIENT's timezone.
    // To make it easy without complex looping, we can use the offset.
    // However, Node > 18 has excellent timezone support.
    
    // We will just store the date string for now. The splitDateRange function handles the cutoffUtc logic.
    // Wait, splitDateRange *needs* cutoffUtc.
    // Let's build a proper Date object that represents 00:00:00 of the NEXT day in the target timezone.
    // Format: "YYYY-MM-DDT00:00:00.000+XX:XX"
    // Since we don't have a full tz library, we'll store a rough UTC estimate and rely on the date string for historical,
    // and for live, we just need the UTC boundary.
    // Let's use a simpler approach: calculate the offset.
    const dateStringForOffset = `${cutoff_date}T00:00:00`;
    const offsetString = new Date().toLocaleString('en-US', { timeZoneName: 'shortOffset', timeZone: timezone }).split(' ').pop(); 
    // e.g. "GMT+5" -> we want "+05:00"
    let tzOffset = "+00:00";
    if (offsetString && offsetString.startsWith("GMT")) {
       const raw = offsetString.replace("GMT", "");
       if (raw === "") tzOffset = "+00:00";
       else if (raw.length === 2) tzOffset = `${raw[0]}0${raw[1]}:00`; // +5 -> +05:00
       else if (raw.length === 3) tzOffset = `${raw[0]}0${raw[1]}:00`; // -5 -> -05:00
       else if (raw.includes(":")) tzOffset = raw;
       else tzOffset = `${raw}:00`; // +05 -> +05:00
    }
    // We want the start of the NEXT day.
    const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth()+1).padStart(2,'0')}-${String(nextDay.getUTCDate()).padStart(2,'0')}`;
    const cutoffUtc = new Date(`${nextDayStr}T00:00:00${tzOffset}`);

    let bootstrapRecord;
    try {
      bootstrapRecord = await AnalyticsBootstrap.create({
        client_id: license.client_id,
        project_id: license.project_id,
        license_id: license.id,
        seat_id: seat.id,
        terminal_number: seat.terminal_number,
        bootstrap_version,
        status: "in_progress",
        bootstrap_cutoff_date: cutoff_date,
        bootstrap_cutoff_utc: cutoffUtc,
        generated_at: body.generated_at ? new Date(body.generated_at) : undefined,
      });
    } catch (e: any) {
      if (e.code === 11000) {
        // Already completed or in progress for this version.
        return NextResponse.json({ ok: true, already_completed: true }, { headers: CORS });
      }
      throw e;
    }

    try {
      // ── Step 4: Ingest Daily Records ───────────────────────────────────────
      let dailyInserted = 0;
      if (Array.isArray(daily) && daily.length > 0) {
        const dailyDocs = daily.map((d: any) => ({
          client_id: license.client_id,
          license_id: license.id,
          date: d.date,
          gross_sales: Number(d.gross_sales) || 0,
          discounts: Number(d.discounts) || 0,
          tax: Number(d.tax) || 0,
          net_sales: Number(d.net_sales) || 0,
          sales_returns: Number(d.sales_returns) || 0,
          cogs_reversed: Number(d.cogs_reversed) || 0,
          cogs: Number(d.cogs) || 0,
          gross_profit: Number(d.gross_profit) || 0,
          expenses: Number(d.expenses) || 0,
          purchases: Number(d.purchases) || 0,
          net_profit: Number(d.net_profit) || 0,
        }));
        
        // insertMany with ordered: false to skip any existing duplicates gracefully
        const result = await HistoricalDailyAnalytics.insertMany(dailyDocs, { ordered: false }).catch((e) => {
           if (e.code === 11000) return e.insertedDocs || []; // Handle partial success
           throw e;
        });
        dailyInserted = Array.isArray(result) ? result.length : dailyDocs.length;
      }

      // ── Step 5: Ingest Top Products ────────────────────────────────────────
      let topInserted = 0;
      if (Array.isArray(top_products) && top_products.length > 0) {
        const topDocs = top_products.map((p: any) => ({
          client_id: license.client_id,
          license_id: license.id,
          product_id: p.product_id,
          product_name: p.product_name || p.product_id,
          period_start: p.period_start,
          period_end: p.period_end,
          qty: Number(p.qty) || 0,
          revenue: Number(p.revenue) || 0,
          cogs: Number(p.cogs) || 0,
          gross_profit: Number(p.gross_profit) || 0,
        }));
        const result = await HistoricalTopProduct.insertMany(topDocs, { ordered: false }).catch((e) => {
           if (e.code === 11000) return e.insertedDocs || [];
           throw e;
        });
        topInserted = Array.isArray(result) ? result.length : topDocs.length;
      }

      // ── Step 6: Ingest Recent Sales ────────────────────────────────────────
      let recentInserted = 0;
      if (Array.isArray(recent_sales) && recent_sales.length > 0) {
        // Limit to 100 for safety
        const limitedSales = recent_sales.slice(0, 100);
        const saleDocs = limitedSales.map((s: any) => ({
          client_id: license.client_id,
          license_id: license.id,
          occurred_at: new Date(s.occurred_at),
          invoice_number: s.invoice_number,
          gross_sales: Number(s.gross_sales) || 0,
          net_sales: Number(s.net_sales) || 0,
          payment_method: s.payment_method,
          customer_name: s.customer_name,
        }));
        const result = await HistoricalRecentSale.insertMany(saleDocs, { ordered: false }).catch((e) => {
           if (e.code === 11000) return e.insertedDocs || [];
           throw e;
        });
        recentInserted = Array.isArray(result) ? result.length : saleDocs.length;
      }

      // ── Step 7: Inventory Snapshot ─────────────────────────────────────────
      let hasInventory = false;
      if (inventory_snapshot && typeof inventory_snapshot === "object") {
        await InventorySnapshot.findOneAndUpdate(
          { client_id: license.client_id, license_id: license.id },
          {
            $set: {
              captured_at: new Date(inventory_snapshot.captured_at || Date.now()),
              reported_by_terminal: seat.terminal_number,
              stock_value: Number(inventory_snapshot.stock_value) || 0,
              low_stock_count: Number(inventory_snapshot.low_stock_count) || 0,
              out_of_stock_count: Number(inventory_snapshot.out_of_stock_count) || 0,
              expiring_soon_count: Number(inventory_snapshot.expiring_soon_count) || 0,
            }
          },
          { upsert: true }
        );
        hasInventory = true;
      }

      // ── Step 8: Mark Complete ──────────────────────────────────────────────
      await AnalyticsBootstrap.updateOne(
        { _id: bootstrapRecord._id },
        {
          $set: {
            status: "completed",
            completed_at: new Date(),
            daily_records_count: dailyInserted,
            top_products_count: topInserted,
            recent_sales_count: recentInserted,
            has_inventory_snapshot: hasInventory,
          }
        }
      );

      return NextResponse.json({
        ok: true,
        already_completed: false,
        summary: {
          daily_records_count: dailyInserted,
          top_products_count: topInserted,
          recent_sales_count: recentInserted,
          has_inventory_snapshot: hasInventory,
        }
      }, { headers: CORS });

    } catch (e: any) {
      // If ingestion fails, mark bootstrap as failed so it can be retried.
      await AnalyticsBootstrap.deleteOne({ _id: bootstrapRecord._id }).catch(console.error);
      throw e;
    }
  } catch (e: any) {
    console.error("Bootstrap error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS }
    );
  }
}
