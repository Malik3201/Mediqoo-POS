
import { resolveBillingPeriod, isWithinLegitimateUseWindow, deriveOutstanding } from "./src/lib/billing";

console.log("\n--- 2. GRACE VS NEW-CYCLE ATTRIBUTION ---");
const p1 = { id: "p_A", period_start: new Date("2026-09-12T00:00:00Z"), period_end: new Date("2026-10-12T00:00:00Z"), created_at: new Date("2026-09-12T00:00:00Z"), billing_model: "per_invoice" };
// Period B created/renewed exactly on Oct 12
const p2_renewedOnTime = { id: "p_B", period_start: new Date("2026-10-12T00:00:00Z"), period_end: new Date("2026-11-12T00:00:00Z"), created_at: new Date("2026-10-12T00:00:00Z"), billing_model: "per_invoice" };
// Period B created/renewed late on Oct 14
const p2_renewedLate = { id: "p_B", period_start: new Date("2026-10-12T00:00:00Z"), period_end: new Date("2026-11-12T00:00:00Z"), created_at: new Date("2026-10-14T00:00:00Z"), billing_model: "per_invoice" };
const g = 3;

// CASE 1: Not renewed. 13 Oct invoice -> should be p_A grace
console.log("CASE 1 (Not renewed):", resolveBillingPeriod(new Date("2026-10-13T10:00:00Z"), [p1], g).period_id);

// CASE 2: Renewed on time (Oct 12). 13 Oct invoice -> should be p_B active
console.log("CASE 2 (Renewed on 12 Oct):", resolveBillingPeriod(new Date("2026-10-13T10:00:00Z"), [p1, p2_renewedOnTime], g).period_id);

// CASE 3: Renewed late (Oct 14). 13 Oct invoice (uploaded later) -> should be p_A grace because Period B didn`t exist when it occurred
console.log("CASE 3 (Renewed late on 14 Oct):", resolveBillingPeriod(new Date("2026-10-13T10:00:00Z"), [p1, p2_renewedLate], g).period_id);

console.log("\n--- 3. BOUNDARY TIMESTAMPS ---");
const tStart = p2_renewedOnTime.period_start;
const tEnd = p2_renewedOnTime.period_end;
const tGrace = new Date("2026-11-15T00:00:00Z");
console.log("-1ms start:", resolveBillingPeriod(new Date(tStart.getTime()-1), [p2_renewedOnTime], g).ok);
console.log("EXACT start:", resolveBillingPeriod(tStart, [p2_renewedOnTime], g).ok);
console.log("+1ms start:", resolveBillingPeriod(new Date(tStart.getTime()+1), [p2_renewedOnTime], g).ok);
console.log("-1ms end:", resolveBillingPeriod(new Date(tEnd.getTime()-1), [p2_renewedOnTime], g).ok);
console.log("EXACT end:", resolveBillingPeriod(tEnd, [p2_renewedOnTime], g).ok);
console.log("+1ms end:", resolveBillingPeriod(new Date(tEnd.getTime()+1), [p2_renewedOnTime], g).ok);
console.log("-1ms grace end:", resolveBillingPeriod(new Date(tGrace.getTime()-1), [p2_renewedOnTime], g).ok);
console.log("EXACT grace end:", resolveBillingPeriod(tGrace, [p2_renewedOnTime], g).ok);
console.log("+1ms grace end:", resolveBillingPeriod(new Date(tGrace.getTime()+1), [p2_renewedOnTime], g).ok);

console.log("\n--- 4. LATE-USAGE REOPENING ---");
console.log("Outstanding:", deriveOutstanding(1800+73, [], 1800));

console.log("\n--- 5. ADJUSTMENT MATH ---");
let adjs = [{ type: "debit", amount: 100 }, { type: "credit", amount: 50 }, { type: "waiver", amount: 25 }];
console.log("Expected 525, Got:", deriveOutstanding(1000, adjs, 500));
adjs.push({ type: "debit", amount: 50 });
console.log("Expected 575, Got:", deriveOutstanding(1000, adjs, 500));

