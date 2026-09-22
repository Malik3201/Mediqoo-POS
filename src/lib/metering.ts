import {
  resolveBillingModel,
  resolveBillingPeriod,
  isWithinLegitimateUseWindow,
} from "./billing";
import LicenseBillingPeriod from "../models/LicenseBillingPeriod";
import BillingUsage from "../models/BillingUsage";

export type MeteringResult =
  | { status: "skipped"; reason?: string }
  | { status: "accepted"; billing_period_id: string; rate: number; amount: number }
  | { status: "duplicate"; billing_period_id: string }
  | { status: "rejected"; reason: string };

export interface MeteringArgs {
  license: any;
  seat?: any;
  invoiceUuid: string;
  invoiceNumber?: string;
  occurredAt: Date;
  terminalId?: string;
  terminalNumber?: number;
}

/**
 * Idempotently meters usage for a finalized invoice if the license is on per_invoice billing.
 * Uses a unique index on { license_id, invoice_uuid } to safely handle duplicates.
 */
export async function meterFinalizedInvoiceUsage({
  license,
  seat,
  invoiceUuid,
  invoiceNumber,
  occurredAt,
  terminalId,
  terminalNumber,
}: MeteringArgs): Promise<MeteringResult> {
  try {
    // 1. Verify billing is enabled and model is per_invoice
    if (!license.billing?.enabled) {
      return { status: "skipped", reason: "billing_disabled" };
    }

    const billingModel = resolveBillingModel(license.billing);
    if (billingModel !== "per_invoice") {
      return { status: "skipped", reason: "not_per_invoice" };
    }

    // 2. Validate inputs
    if (!invoiceUuid || typeof invoiceUuid !== "string") {
      return { status: "rejected", reason: "missing_invoice_uuid" };
    }
    if (isNaN(occurredAt.getTime())) {
      return { status: "rejected", reason: "invalid_occurred_at" };
    }

    // 3. Fast-path duplicate check
    const existing = await BillingUsage.findOne({
      license_id: license.id,
      invoice_uuid: invoiceUuid,
    }).lean();

    if (existing) {
      return { status: "duplicate", billing_period_id: existing.billing_period_id };
    }

    // 4. Resolve legitimate use window and billing period
    const allPeriods = await LicenseBillingPeriod.find({
      license_id: license.id,
    })
      .sort({ period_start: 1 })
      .lean();

    if (allPeriods.length === 0) {
      return { status: "rejected", reason: "no_billing_periods" };
    }

    const graceDays = license.billing?.grace_days ?? 0;

    if (!isWithinLegitimateUseWindow(occurredAt, license.issued_at, allPeriods, graceDays)) {
      return { status: "rejected", reason: "outside_legitimate_use" };
    }

    const resolution = resolveBillingPeriod(occurredAt, allPeriods, graceDays);

    if (!resolution.ok) {
      return { status: "rejected", reason: resolution.reason };
    }

    // 5. Server determines rate and amount
    const rate = resolution.rate_snapshot;
    if (typeof rate !== "number" || rate <= 0 || !isFinite(rate)) {
      return { status: "rejected", reason: "invalid_rate_snapshot" };
    }

    const unitCount = 1;
    const amount = unitCount * rate;

    // 6. Create BillingUsage idempotently
    try {
      await BillingUsage.create({
        client_id: license.client_id,
        license_id: license.id,
        invoice_uuid: invoiceUuid,
        invoice_number_snapshot: typeof invoiceNumber === "string" ? invoiceNumber.slice(0, 50) : "",
        terminal_id: terminalId || seat?.machine_id || "",
        terminal_number: typeof terminalNumber === "number" ? terminalNumber : (seat?.terminal_number || null),
        occurred_at: occurredAt,
        received_at: new Date(),
        billing_period_id: resolution.period_id,
        billing_cycle_start: resolution.period_start,
        billing_cycle_end: resolution.period_end,
        unit_count: unitCount,
        rate_snapshot: rate,
        amount,
      });

      return {
        status: "accepted",
        billing_period_id: resolution.period_id,
        rate,
        amount,
      };
    } catch (err: any) {
      // 11000 = duplicate key error (race condition)
      if (err.code === 11000) {
        const dup = await BillingUsage.findOne({
          license_id: license.id,
          invoice_uuid: invoiceUuid,
        }).lean();
        return {
          status: "duplicate",
          billing_period_id: dup?.billing_period_id || resolution.period_id,
        };
      }
      throw err;
    }
  } catch (e: any) {
    console.error("meterFinalizedInvoiceUsage error:", e);
    return { status: "rejected", reason: `server_error: ${e.message}` };
  }
}
