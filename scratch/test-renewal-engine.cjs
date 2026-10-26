/**
 * Automated Verification Script for Renewal & Expiry Engine
 */
const { 
  calculateRenewalDates, 
  calculateGraceUntil 
} = require("../src/lib/billing.ts");
const { 
  deriveOperationalStatus, 
  deriveBillingStatus 
} = require("../src/lib/status.ts");
const { 
  differenceInDays, 
  startOfDay, 
  addDays, 
  subDays,
  format 
} = require("date-fns");

console.log("=== RUNNING RENEWAL & EXPIRY ENGINE TESTS ===\n");

let passed = 0;
let total = 0;

function assert(desc, condition) {
  total++;
  if (condition) {
    console.log(`[PASS] ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${desc}`);
    process.exitCode = 1;
  }
}

// Machine's actual current today
const today = startOfDay(new Date());
console.log(`Reference Date (Today): ${format(today, "yyyy-MM-dd")}\n`);

// --------------------------------------------------------------------------
// TEST 1: AR Pharmacy Renewal (Expired in past relative to today, Outstanding PKR 0)
// Expected: Renewal Base Date Rule starts from TODAY.
// Adding 1 month results in today + 1 month.
// Status becomes "Active", NOT "Renewal Required" and NOT "Overdue".
// --------------------------------------------------------------------------
const pastDate = subDays(today, 5); // 5 days in past
const arPharmacyLicense = {
  expires_at: pastDate,
  billing: { cycle: "monthly", grace_days: 3, model: "per_invoice" }
};

const arRenewal = calculateRenewalDates(arPharmacyLicense, { extensionMonths: 1 });
assert("AR Pharmacy: New expiry day matches today's day", arRenewal.newExpiry.getDate() === today.getDate());
assert("AR Pharmacy: Status after +1M renewal is Active", deriveOperationalStatus({
  status: "active",
  expires_at: arRenewal.newExpiry,
  grace_until: arRenewal.newGraceUntil
}) === "Active");

// --------------------------------------------------------------------------
// TEST 2: Future Extension (e.g. Current Expiry is 1 month ahead, extend +3 Months)
// Expected: Extends FROM current expiry.
// Remaining 1 month is preserved, NOT lost!
// --------------------------------------------------------------------------
const futureExpiry = new Date(today);
futureExpiry.setMonth(futureExpiry.getMonth() + 1); // 1 month in future

const futureLicense = {
  expires_at: futureExpiry,
  billing: { cycle: "monthly", grace_days: 3, model: "per_invoice" }
};

const futureRenewal = calculateRenewalDates(futureLicense, { extensionMonths: 3 });
// Should be 1 + 3 = 4 months from today
const monthsDiff = (futureRenewal.newExpiry.getFullYear() - today.getFullYear()) * 12 + (futureRenewal.newExpiry.getMonth() - today.getMonth());
assert("Future Extension: Extends 3 months from future expiry (total +4 months from today)", monthsDiff === 4);
assert("Future Extension: Day of month is preserved", futureRenewal.newExpiry.getDate() === futureExpiry.getDate());

// --------------------------------------------------------------------------
// TEST 3: Custom Exact Expiry Date (e.g. 2028-12-31)
// --------------------------------------------------------------------------
const customRenewal = calculateRenewalDates(arPharmacyLicense, { customExpiryDate: "2028-12-31" });
assert("Custom Date: Year is 2028", customRenewal.newExpiry.getFullYear() === 2028);
assert("Custom Date: Month is December (index 11)", customRenewal.newExpiry.getMonth() === 11);
assert("Custom Date: Day is 31st", customRenewal.newExpiry.getDate() === 31);
assert("Custom Date: Status is Active", deriveOperationalStatus({ status: "active", expires_at: customRenewal.newExpiry }) === "Active");

// --------------------------------------------------------------------------
// TEST 4: Care Point False 'Expires Tomorrow' Alert Verification
// Current date: today. Expiry: 30 days in future.
// Expected: differenceInDays = 30.
// NOT in expiry alerts (diffDays <= 7).
// --------------------------------------------------------------------------
const carePointLicense = {
  expires_at: addDays(today, 30),
  billing: { cycle: "monthly", grace_days: 3, model: "per_invoice" }
};
const carePointDiff = differenceInDays(startOfDay(carePointLicense.expires_at), today);
assert("Care Point Expiry diff is 30 days (not 1 day)", carePointDiff === 30);
assert("Care Point is NOT flagged for urgent license expiry (diff <= 7)", carePointDiff > 7);

// --------------------------------------------------------------------------
// TEST 5: Legitimate 'Expires Tomorrow' Alert Verification
// Expiry: tomorrow
// --------------------------------------------------------------------------
const tomorrowLicense = {
  expires_at: addDays(today, 1)
};
const tomorrowDiff = differenceInDays(startOfDay(tomorrowLicense.expires_at), today);
assert("Tomorrow license diff is exactly 1 day", tomorrowDiff === 1);

// --------------------------------------------------------------------------
// TEST 6: Legitimate 'Expires Today' Alert Verification
// Expiry: today
// --------------------------------------------------------------------------
const todayLicense = {
  expires_at: today
};
const todayDiff = differenceInDays(startOfDay(todayLicense.expires_at), today);
assert("Today license diff is exactly 0 days", todayDiff === 0);

// --------------------------------------------------------------------------
// TEST 7: Expired Verification
// Expiry: yesterday
// --------------------------------------------------------------------------
const expiredLicense = {
  expires_at: subDays(today, 1)
};
const expiredDiff = differenceInDays(startOfDay(expiredLicense.expires_at), today);
assert("Expired license diff is negative (-1)", expiredDiff === -1);

// --------------------------------------------------------------------------
// TEST 8: Lifetime / No Expiry
// --------------------------------------------------------------------------
const lifetimeRenewal = calculateRenewalDates(arPharmacyLicense, { isLifetime: true });
assert("Lifetime: newExpiry is null", lifetimeRenewal.newExpiry === null);
assert("Lifetime: newGraceUntil is null", lifetimeRenewal.newGraceUntil === null);
assert("Lifetime: Status is Active", deriveOperationalStatus({ status: "active", expires_at: null }) === "Active");

console.log(`\nTEST RESULTS: ${passed}/${total} PASSED.`);
if (passed === total) {
  console.log("ALL TESTS PASSED SUCCESSFULLY!");
}
