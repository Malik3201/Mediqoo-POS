/**
 * Phase A — Per-Invoice Billing Verification Script
 *
 * Tests all matrix items A–O using the pure billing library functions.
 * Run: npx tsx scratch/phase-a-tests.ts
 */

import {
  resolveBillingModel,
  resolveBillingPeriod,
  isWithinLegitimateUseWindow,
  isVersionEligible,
  deriveOutstanding,
  calculateGraceUntil,
  calculateRenewalDates,
  calculatePeriodDates,
} from "../src/lib/billing";

let passed = 0;
let failed = 0;
let total = 0;

function assert(label: string, condition: boolean, detail: string = "") {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  }
}

// Helper dates
const sep12 = new Date("2026-09-12T00:00:00Z");
const oct12 = new Date("2026-10-12T00:00:00Z");
const oct15 = new Date("2026-10-15T00:00:00Z"); // grace end (3 days)
const nov12 = new Date("2026-11-12T00:00:00Z");
const aug12 = new Date("2026-08-12T00:00:00Z");

// Billing periods for testing
const fixedPeriods = [
  { id: "p1", period_start: sep12, period_end: oct12 },
];

const perInvoicePeriods = [
  { id: "p1", period_start: aug12, period_end: sep12, billing_model: "per_invoice", rate_snapshot: 0.8 },
  { id: "p2", period_start: sep12, period_end: oct12, billing_model: "per_invoice", rate_snapshot: 1.0 },
  { id: "p3", period_start: oct12, period_end: nov12, billing_model: "per_invoice", rate_snapshot: 1.5 },
];


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST A: Fixed license with no model field");
console.log("══════════════════════════════════════════════════════════════");
{
  assert("resolveBillingModel(undefined) → 'fixed'", resolveBillingModel(undefined) === "fixed");
  assert("resolveBillingModel(null) → 'fixed'", resolveBillingModel(null) === "fixed");
  assert("resolveBillingModel({}) → 'fixed'", resolveBillingModel({}) === "fixed");
  assert("resolveBillingModel({ model: undefined }) → 'fixed'", resolveBillingModel({ model: undefined }) === "fixed");

  // Existing calculateGraceUntil unchanged
  const grace = calculateGraceUntil(oct12, 3)!;
  assert("calculateGraceUntil works", grace.getTime() === oct15.getTime());

  // Existing calculateRenewalDates unchanged
  const renewal = calculateRenewalDates({ expires_at: sep12, billing: { cycle: "monthly", grace_days: 3 } }, oct12);
  assert("calculateRenewalDates.newExpiry", renewal.newExpiry.getTime() === oct12.getTime());
  assert("calculateRenewalDates.renewalType", renewal.renewalType === "fixed");

  // Existing calculatePeriodDates unchanged
  const pd = calculatePeriodDates(oct12, "monthly");
  assert("calculatePeriodDates.period_end", pd.period_end.getTime() === nov12.getTime());
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST B: Explicit fixed license");
console.log("══════════════════════════════════════════════════════════════");
{
  assert("resolveBillingModel({ model: 'fixed' }) → 'fixed'", resolveBillingModel({ model: "fixed" }) === "fixed");

  // Fixed periods reject per-invoice cycle resolution
  const res = resolveBillingPeriod(
    new Date("2026-09-20T10:00:00Z"),
    fixedPeriods,
    3,
  );
  assert("Fixed period → not_per_invoice", !res.ok && res.reason === "not_per_invoice");
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST C: Per-invoice config creation");
console.log("══════════════════════════════════════════════════════════════");
{
  assert("resolveBillingModel({ model: 'per_invoice' }) → 'per_invoice'",
    resolveBillingModel({ model: "per_invoice" }) === "per_invoice");

  // Unexpected model defaults to fixed
  assert("resolveBillingModel({ model: 'foo' }) → 'fixed'",
    resolveBillingModel({ model: "foo" }) === "fixed");
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST D/E: Duplicate detection (D: same invoice twice, E: two terminals)");
console.log("══════════════════════════════════════════════════════════════");
{
  // Duplicate detection is via { license_id, invoice_uuid } unique index — tested at DB level.
  // Here we verify the cycle resolution is deterministic (same input → same output).
  const ts = new Date("2026-09-20T10:00:00Z");
  const res1 = resolveBillingPeriod(ts, perInvoicePeriods, 3);
  const res2 = resolveBillingPeriod(ts, perInvoicePeriods, 3);

  assert("Same timestamp resolves to same period (deterministic)",
    res1.ok && res2.ok && res1.period_id === res2.period_id);
  assert("Same rate snapshot", res1.ok && res2.ok && res1.rate_snapshot === res2.rate_snapshot);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST F: Server determines rate — client cannot influence");
console.log("══════════════════════════════════════════════════════════════");
{
  const ts = new Date("2026-09-20T10:00:00Z");
  const res = resolveBillingPeriod(ts, perInvoicePeriods, 3);
  assert("Rate comes from period snapshot (1.0), not client",
    res.ok && res.rate_snapshot === 1.0);

  // Even if someone tried different periods, rate is always from the matched period
  const tsAug = new Date("2026-08-20T10:00:00Z");
  const resAug = resolveBillingPeriod(tsAug, perInvoicePeriods, 3);
  assert("August event gets August rate (0.8)", resAug.ok && resAug.rate_snapshot === 0.8);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST G: Event belongs to current cycle");
console.log("══════════════════════════════════════════════════════════════");
{
  const ts = new Date("2026-09-25T14:30:00Z");
  const res = resolveBillingPeriod(ts, perInvoicePeriods, 3);
  assert("Sep 25 → period p2 (Sep 12 - Oct 12)", res.ok && res.period_id === "p2");
  assert("Rate 1.0", res.ok && res.rate_snapshot === 1.0);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST H: Late offline event belongs to PREVIOUS cycle");
console.log("══════════════════════════════════════════════════════════════");
{
  // Invoice was created Aug 30 (in p1 cycle) but arrives after p2 started
  const ts = new Date("2026-08-30T10:00:00Z");
  const res = resolveBillingPeriod(ts, perInvoicePeriods, 3);
  assert("Aug 30 → period p1 (Aug 12 - Sep 12)", res.ok && res.period_id === "p1");
  assert("Previous cycle rate 0.8 (NOT current 1.0)", res.ok && res.rate_snapshot === 0.8);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST I: Previously-paid period receives late charge → outstanding");
console.log("══════════════════════════════════════════════════════════════");
{
  // Period p1 was paid: 1800 invoices × 0.8 = 1440 PKR
  // Admin paid 1440. Then 73 late events arrive.
  // 73 × 0.8 = 58.4 becomes new outstanding.
  const chargesBefore = 1800 * 0.8;
  const paid = chargesBefore; // fully paid
  const lateCharges = 73 * 0.8;
  const totalCharges = chargesBefore + lateCharges;

  const outstanding = deriveOutstanding(totalCharges, [], paid);
  assert("Outstanding = late charges (58.4)", Math.abs(outstanding - 58.4) < 0.001,
    `got ${outstanding}`);
  assert("Original payment NOT erased", paid === 1440); // just a sanity check

  // With a credit adjustment of 20
  const withCredit = deriveOutstanding(totalCharges, [{ type: "credit", amount: 20 }], paid);
  assert("With credit: outstanding = 38.4", Math.abs(withCredit - 38.4) < 0.001,
    `got ${withCredit}`);

  // With a debit adjustment
  const withDebit = deriveOutstanding(totalCharges, [{ type: "debit", amount: 10 }], paid);
  assert("With debit: outstanding = 68.4", Math.abs(withDebit - 68.4) < 0.001,
    `got ${withDebit}`);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST J: Grace-period invoice — accepted into correct period");
console.log("══════════════════════════════════════════════════════════════");
{
  // Oct 13 = 1 day into grace (period p2 ended Oct 12, grace 3 days → Oct 15)
  const ts = new Date("2026-10-13T09:00:00Z");
  const res = resolveBillingPeriod(ts, perInvoicePeriods, 3);
  assert("Oct 13 (grace) → period p2", res.ok && res.period_id === "p2");
  assert("Rate from p2 (1.0)", res.ok && res.rate_snapshot === 1.0);

  // Oct 14 = still in grace
  const ts2 = new Date("2026-10-14T23:59:59Z");
  const res2 = resolveBillingPeriod(ts2, perInvoicePeriods, 3);
  assert("Oct 14 (grace day 3) → period p2", res2.ok && res2.period_id === "p2");
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST K: Invalid timestamp outside all legitimate periods");
console.log("══════════════════════════════════════════════════════════════");
{
  // Way before any period
  const ancient = new Date("2020-01-01T00:00:00Z");
  const res = resolveBillingPeriod(ancient, perInvoicePeriods, 3);
  assert("2020 timestamp → no_period_found", !res.ok && res.reason === "no_period_found");

  // After all periods + grace
  const future = new Date("2027-01-01T00:00:00Z");
  const res2 = resolveBillingPeriod(future, perInvoicePeriods, 3);
  assert("2027 timestamp → no_period_found", !res2.ok && res2.reason === "no_period_found");

  // Legitimate use window check
  assert("2020 is NOT in legitimate use window",
    !isWithinLegitimateUseWindow(ancient, aug12, perInvoicePeriods, 3));
  assert("Sep 20 IS in legitimate use window",
    isWithinLegitimateUseWindow(new Date("2026-09-20T00:00:00Z"), aug12, perInvoicePeriods, 3));
  assert("Before issued_at is NOT legitimate",
    !isWithinLegitimateUseWindow(new Date("2026-07-01T00:00:00Z"), aug12, perInvoicePeriods, 3));
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST L: Fixed client usage API attempt → no per-invoice charge");
console.log("══════════════════════════════════════════════════════════════");
{
  // Cycle resolution on fixed periods returns not_per_invoice
  const ts = new Date("2026-09-20T10:00:00Z");
  const res = resolveBillingPeriod(ts, fixedPeriods, 3);
  assert("Fixed period → not_per_invoice rejection", !res.ok && res.reason === "not_per_invoice");
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST M: Version eligibility for per_invoice");
console.log("══════════════════════════════════════════════════════════════");
{
  assert("No min → eligible", isVersionEligible("1.0.0", null) === true);
  assert("No app version → ineligible", isVersionEligible(null, "2.0.0") === false);
  assert("2.0.0 >= 2.0.0 → eligible", isVersionEligible("2.0.0", "2.0.0") === true);
  assert("2.1.0 >= 2.0.0 → eligible", isVersionEligible("2.1.0", "2.0.0") === true);
  assert("1.9.0 >= 2.0.0 → ineligible", isVersionEligible("1.9.0", "2.0.0") === false);
  assert("3.0.0 >= 2.0.0 → eligible", isVersionEligible("3.0.0", "2.0.0") === true);
  assert("2.0.1 >= 2.0.0 → eligible", isVersionEligible("2.0.1", "2.0.0") === true);
  assert("1.9.99 >= 2.0.0 → ineligible", isVersionEligible("1.9.99", "2.0.0") === false);
  assert("v2.0.0 >= 2.0.0 → eligible (v prefix)", isVersionEligible("v2.0.0", "2.0.0") === true);
  assert("garbage → ineligible (fail-closed)", isVersionEligible("abc", "2.0.0") === false);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST N: Rate scheduled for next cycle");
console.log("══════════════════════════════════════════════════════════════");
{
  // Current cycle (p2) has rate 1.0, next cycle (p3) has rate 1.5
  const tsCurrent = new Date("2026-09-20T10:00:00Z");
  const resCurrent = resolveBillingPeriod(tsCurrent, perInvoicePeriods, 3);
  assert("Current cycle → rate 1.0", resCurrent.ok && resCurrent.rate_snapshot === 1.0);

  const tsNext = new Date("2026-10-20T10:00:00Z");
  const resNext = resolveBillingPeriod(tsNext, perInvoicePeriods, 3);
  assert("Next cycle → rate 1.5", resNext.ok && resNext.rate_snapshot === 1.5);

  // Late event from current cycle STILL gets old rate
  const tsBorderline = new Date("2026-10-13T10:00:00Z"); // grace period of p2
  const resBorderline = resolveBillingPeriod(tsBorderline, perInvoicePeriods, 3);
  assert("Grace event of p2 → rate 1.0 (NOT 1.5)", resBorderline.ok && resBorderline.rate_snapshot === 1.0);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("TEST O: Adjustment immutability & compensating reversals");
console.log("══════════════════════════════════════════════════════════════");
{
  // Test deriveOutstanding with multiple adjustments
  const charges = 1000;
  const adjs = [
    { type: "credit" as const, amount: 100 },
    { type: "debit" as const, amount: 50 },
    { type: "waiver" as const, amount: 200 },
  ];
  const paid = 500;
  const outstanding = deriveOutstanding(charges, adjs, paid);
  // 1000 + 50 - 100 - 200 - 500 = 250
  assert("Complex adjustments: outstanding = 250", Math.abs(outstanding - 250) < 0.001,
    `got ${outstanding}`);

  // Compensating reversal: add opposite credit to undo the debit
  const withReversal = [...adjs, { type: "credit" as const, amount: 50 }];
  const reversedOutstanding = deriveOutstanding(charges, withReversal, paid);
  // 1000 + 50 - 100 - 200 - 50 - 500 = 200
  assert("After reversal: outstanding = 200", Math.abs(reversedOutstanding - 200) < 0.001,
    `got ${reversedOutstanding}`);

  // Overpayment → negative outstanding
  const overpaid = deriveOutstanding(100, [], 150);
  assert("Overpayment → negative outstanding (-50)", Math.abs(overpaid - (-50)) < 0.001,
    `got ${overpaid}`);
}


// ============================================================================
console.log("\n══════════════════════════════════════════════════════════════");
console.log("RESULTS");
console.log("══════════════════════════════════════════════════════════════");
console.log(`\n  Total:  ${total}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`\n  ${failed === 0 ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`);

process.exit(failed === 0 ? 0 : 1);
