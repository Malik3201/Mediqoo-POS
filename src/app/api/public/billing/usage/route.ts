import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseSeat from "@/models/LicenseSeat";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import BillingUsage from "@/models/BillingUsage";
import { resolveBillingModel } from "@/lib/billing";
import { meterFinalizedInvoiceUsage } from "@/lib/metering";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-event result types
// ─────────────────────────────────────────────────────────────────────────────
type EventResult =
  | { status: "accepted"; billing_period_id: string; rate: number; amount: number }
  | { status: "duplicate"; billing_period_id: string }
  | { status: "rejected"; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/billing/usage
//
// Idempotent batch endpoint for POS to report finalized invoices.
//
// Auth: license_key + machine_id (same pattern as license-status).
// Body: { license_key, machine_id, events: [...] }
//
// Each event: { invoice_uuid, invoice_number, occurred_at, terminal_id?, terminal_number? }
//
// Server resolves: billing period, rate, amount. POS never sends monetary data.
//
// Late/offline events are accepted as long as occurred_at falls within a
// legitimate billing period + grace window. Previously-settled periods can
// receive late charges (they become outstanding carry-forward).
//
// Max 100 events per batch.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── Validate request shape ──────────────────────────────────────────
    if (!body.license_key || !body.machine_id) {
      return NextResponse.json(
        { error: "missing_fields", detail: "license_key and machine_id required" },
        { status: 400, headers: CORS }
      );
    }

    if (!Array.isArray(body.events) || body.events.length === 0) {
      return NextResponse.json(
        { error: "missing_events", detail: "events array required" },
        { status: 400, headers: CORS }
      );
    }

    if (body.events.length > 100) {
      return NextResponse.json(
        { error: "batch_too_large", detail: "max 100 events per batch" },
        { status: 400, headers: CORS }
      );
    }

    await connectToDatabase();

    // ── Authenticate license ────────────────────────────────────────────
    const license = await License.findOne({ license_key: body.license_key }).lean();
    if (!license) {
      return NextResponse.json(
        { error: "invalid_license" },
        { status: 401, headers: CORS }
      );
    }

    // ── Validate seat ───────────────────────────────────────────────────
    const seat = await LicenseSeat.findOne({
      license_id: license.id,
      machine_id: body.machine_id,
    }).lean();

    if (!seat) {
      return NextResponse.json(
        { error: "unregistered_machine" },
        { status: 403, headers: CORS }
      );
    }

    // ── Validate billing model ──────────────────────────────────────────
    const billingModel = resolveBillingModel(license.billing);
    if (billingModel !== "per_invoice") {
      return NextResponse.json(
        { error: "not_per_invoice", detail: "License billing model is not per_invoice" },
        { status: 400, headers: CORS }
      );
    }

    if (!license.billing?.enabled) {
      return NextResponse.json(
        { error: "billing_disabled", detail: "Billing is not enabled for this license" },
        { status: 400, headers: CORS }
      );
    }

    // ── Process each event via Shared Helper ────────────────────────────
    const results: Record<string, EventResult> = {};

    for (const event of body.events) {
      const invoiceUuid = event.invoice_uuid;
      
      if (!invoiceUuid || typeof invoiceUuid !== "string") {
        results[invoiceUuid || "unknown"] = { status: "rejected", reason: "missing_invoice_uuid" };
        continue;
      }
      if (!event.occurred_at) {
        results[invoiceUuid] = { status: "rejected", reason: "missing_occurred_at" };
        continue;
      }

      const occurredAt = new Date(event.occurred_at);

      const res = await meterFinalizedInvoiceUsage({
        license,
        seat,
        invoiceUuid,
        invoiceNumber: typeof event.invoice_number === "string" ? event.invoice_number : undefined,
        occurredAt,
        terminalId: event.terminal_id,
        terminalNumber: event.terminal_number,
      });

      if (res.status === "skipped") {
        results[invoiceUuid] = { status: "rejected", reason: res.reason || "skipped" };
      } else {
        results[invoiceUuid] = res;
      }
    }

    return NextResponse.json({
      ok: true,
      license_id: license.id,
      billing_model: "per_invoice",
      results,
    }, { headers: CORS });

  } catch (e: any) {
    console.error("Billing usage API Error:", e);
    return NextResponse.json(
      { error: e.message || "unknown" },
      { status: 500, headers: CORS }
    );
  }
}
