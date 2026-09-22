import mongoose from "mongoose";
import License from "../src/models/License";
import LicenseBillingPeriod from "../src/models/LicenseBillingPeriod";

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  
  const license = await License.findOne({ id: "502231e1-c065-4273-a8f1-0bb41532bbd4" }).lean();
  if (!license) throw new Error("License not found");
  
  const periods = await LicenseBillingPeriod.find({ license_id: license.id }).sort({ period_start: 1 });
  if (periods.length !== 1) throw new Error("Expected exactly one period");
  
  const period = periods[0];
  console.log("BEFORE:");
  console.log("period_start:", period.period_start);
  console.log("period_end:", period.period_end);
  console.log("billing_model:", period.billing_model);
  console.log("rate_snapshot:", period.rate_snapshot);
  console.log("status:", period.status);
  console.log("created_at:", period.created_at);
  
  // Correction
  period.period_start = new Date(license.issued_at || license.created_at);
  period.period_end = new Date(license.expires_at || license.created_at); // whatever it is
  if (period.billing_model !== "per_invoice") {
    period.billing_model = "per_invoice";
  }
  if (!period.rate_snapshot || period.rate_snapshot <= 0) {
    period.rate_snapshot = license.billing?.rate_per_invoice || 1;
  }
  
  await period.save();
  
  console.log("\nAFTER:");
  console.log("period_start:", period.period_start);
  console.log("period_end:", period.period_end);
  console.log("billing_model:", period.billing_model);
  console.log("rate_snapshot:", period.rate_snapshot);
  console.log("status:", period.status);
  console.log("created_at:", period.created_at);
  
  await mongoose.disconnect();
}

fix().catch(console.error);
