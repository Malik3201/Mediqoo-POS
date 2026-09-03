import connectToDatabase from "../src/lib/db";
import License from "../src/models/License";
import LicenseBillingPeriod from "../src/models/LicenseBillingPeriod";
import { calculatePeriodDates } from "../src/lib/billing";
import { isBefore, subMonths, subYears } from "date-fns";

async function run() {
  await connectToDatabase();

  console.log("Reconciling missing billing periods...");

  // Find all licenses with billing enabled
  const licenses = await License.find({ "billing.enabled": true }).lean();
  let created = 0;
  let fixed = 0;
  let alreadyOk = 0;

  for (const lic of licenses as any[]) {
    // Check if a billing period exists
    const existing = await LicenseBillingPeriod.findOne({ license_id: lic.id }).lean();
    
    if (existing) {
      alreadyOk++;
      continue;
    }

    console.log(`License ${lic.license_key} (${lic.id}) is missing a period.`);

    // If it has expires_at, we assume the period was supposed to end at expires_at.
    // Wait, period_start = expires_at - 1 cycle
    let period_end = lic.expires_at ? new Date(lic.expires_at) : new Date();
    let period_start = lic.billing.cycle === "yearly" ? subYears(period_end, 1) : subMonths(period_end, 1);
    
    // We create an unpaid period due on period_start
    await LicenseBillingPeriod.create({
      client_id: lic.client_id,
      license_id: lic.id,
      period_start,
      period_end,
      due_at: period_start,
      amount_due: lic.billing.amount,
      status: "unpaid",
    });

    created++;
  }

  console.log(`Reconciliation complete. Fixed ${created} licenses. ${alreadyOk} were already OK.`);
  process.exit(0);
}

run().catch(console.error);
