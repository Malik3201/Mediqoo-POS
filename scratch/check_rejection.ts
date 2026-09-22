import mongoose from "mongoose";
import AnalyticsEvent from "../src/models/AnalyticsEvent";
import License from "../src/models/License";
import LicenseSeat from "../src/models/LicenseSeat";
import LicenseBillingPeriod from "../src/models/LicenseBillingPeriod";
import { resolveBillingPeriod, isWithinLegitimateUseWindow } from "../src/lib/billing";

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  
  const licenses = await License.find({ "billing.model": "per_invoice" }).lean();
  console.log(`Found ${licenses.length} per_invoice licenses`);
  if (licenses.length === 0) return;

  for (const license of licenses) {
    const events = await AnalyticsEvent.find({ license_id: license.id, type: "sale.completed" }).lean();
    if (events.length === 0) continue;
    console.log(`\nLicense: ${license.id} - ${events.length} events, issued: ${license.issued_at}`);
    const allPeriods = await LicenseBillingPeriod.find({ license_id: license.id }).sort({ period_start: 1 }).lean();
    for (const p of allPeriods) {
      console.log(`Period: ${p.period_start?.toISOString()} to ${p.period_end?.toISOString()}`);
    }
    const graceDays = license.billing?.grace_days ?? 0;
  
  for (const ev of events) {
    const occurredAt = ev.occurred_at;
    if (!isWithinLegitimateUseWindow(occurredAt, license.issued_at, allPeriods, graceDays)) {
      console.log(`${ev.source_record_id} | ${occurredAt.toISOString()} | outside_legitimate_use`);
      continue;
    }
    const resolution = resolveBillingPeriod(occurredAt, allPeriods, graceDays);
    if (!resolution.ok) {
      console.log(`${ev.source_record_id} | ${occurredAt.toISOString()} | ${resolution.reason}`);
    } else {
      console.log(`${ev.source_record_id} | ${occurredAt.toISOString()} | OK (rate_snapshot: ${resolution.rate_snapshot})`);
    }
  }
  
  }

  await mongoose.disconnect();
}

check().catch(console.error);
