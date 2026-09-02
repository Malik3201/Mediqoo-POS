import connectToDatabase from "../src/lib/db";
import License from "../src/models/License";
import LicensePayment from "../src/models/LicensePayment";
import LicenseBillingPeriod from "../src/models/LicenseBillingPeriod";
import LicenseSeat from "../src/models/LicenseSeat";
import RenewalNotification from "../src/models/RenewalNotification";
import { addMonths, subMonths, isBefore } from "date-fns";
import mongoose from "mongoose";

async function verifyHardening() {
  await connectToDatabase();
  console.log("Connected to DB for Verification.");

  const testId = "test-license-hardening";
  const clientId = "client-hardening";

  // Cleanup old tests
  await License.deleteOne({ id: testId });
  await LicensePayment.deleteMany({ license_id: testId });
  await LicenseBillingPeriod.deleteMany({ license_id: testId });
  await LicenseSeat.deleteMany({ license_id: testId });
  await RenewalNotification.deleteMany({ license_id: testId });

  // Create baseline license
  const now = new Date();
  const nextMonth = addMonths(now, 1);
  const license = await License.create({
    id: testId,
    client_id: clientId,
    project_id: "test-project",
    license_key: "TEST-KEY-" + Date.now(),
    seats: 2,
    status: "active",
    expires_at: nextMonth,
    grace_until: nextMonth, // For test logic
    license_version: 1,
    billing: {
      enabled: true,
      amount: 5000,
      currency: "PKR",
      cycle: "monthly",
      grace_days: 3,
      reminder_days: [1, 5]
    }
  });

  const billingPeriod = await LicenseBillingPeriod.create({
    client_id: clientId,
    license_id: testId,
    period_start: now,
    period_end: nextMonth,
    due_at: nextMonth,
    amount_due: 5000,
    amount_paid: 0,
    currency: "PKR",
    status: "unpaid"
  });

  console.log("--- 1. Verification of License Version Increment ---");
  console.log(`Initial version: ${license.license_version}`);
  // Cosmetic change
  license.notes = "Testing cosmetic";
  await license.save();
  console.log(`Version after cosmetic change: ${license.license_version} (Expected: 1)`);
  // Sensitive change
  license.status = "suspended";
  await license.save();
  console.log(`Version after status change: ${license.license_version} (Expected: 2)`);
  
  // Revert status for remaining tests
  license.status = "active";
  await license.save(); // Version should become 3

  console.log("\n--- 2. Concurrent Idempotent Renewal Test ---");
  const idempotencyKey = "idem-" + Date.now();
  
  // Create a helper to simulate the renew/route POST behavior locally
  async function simulateRenewCall(id_key: string) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const lic = await License.findOne({ id: testId }).session(session);
      const bp = await LicenseBillingPeriod.findOne({ id: billingPeriod.id }).session(session);
      
      if (!lic || !bp || bp.status === "paid") {
         throw new Error("Already paid or missing");
      }

      await LicensePayment.create([{
        client_id: lic.client_id,
        license_id: lic.id,
        billing_period_id: bp.id,
        amount_paid: 5000,
        currency: "PKR",
        idempotency_key: id_key
      }], { session });

      bp.amount_paid = 5000;
      bp.status = "paid";
      await bp.save({ session });

      lic.expires_at = addMonths(lic.expires_at, 1);
      await lic.save({ session });

      await session.commitTransaction();
      return "Success";
    } catch (e: any) {
      await session.abortTransaction();
      if (e.code === 11000) return "Idempotency Hit (11000)";
      return "Error: " + e.message;
    } finally {
      session.endSession();
    }
  }

  const [res1, res2] = await Promise.all([
    simulateRenewCall(idempotencyKey),
    simulateRenewCall(idempotencyKey)
  ]);
  
  const payments = await LicensePayment.find({ license_id: testId });
  console.log(`Concurrent renew results: [${res1}, ${res2}]`);
  console.log(`Total payments created: ${payments.length} (Expected: 1)`);
  const finalLic = await License.findOne({ id: testId });
  console.log(`License Version after 1 renewal: ${finalLic.license_version} (Expected: 4, since we reverted status to active above, then renewed once)`);


  console.log("\n--- 3. BillingPeriod Duplicate Generation Protection ---");
  try {
    await LicenseBillingPeriod.create({
      client_id: clientId,
      license_id: testId,
      period_start: now,
      period_end: nextMonth,
      due_at: nextMonth,
      amount_due: 1000,
      currency: "PKR",
      status: "unpaid"
    });
    console.log("FAILED: Allowed duplicate billing period");
  } catch (e: any) {
    console.log(`Duplicate Billing Period test: Blocked as expected with error code ${e.code}`);
  }

  console.log("\n--- 4. Release Terminal Regression ---");
  const seat1 = await LicenseSeat.create({ license_id: testId, machine_id: "m1", terminal_number: 1 });
  const seat2 = await LicenseSeat.create({ license_id: testId, machine_id: "m2", terminal_number: 2 });
  await LicenseSeat.deleteOne({ id: seat1.id });
  const remainingSeats = await LicenseSeat.find({ license_id: testId });
  const survivorLic = await License.findOne({ id: testId });
  console.log(`Remaining seats: ${remainingSeats.length} (Expected: 1)`);
  console.log(`License survived: ${!!survivorLic}`);


  console.log("\n--- ALL TESTS COMPLETED ---");
  process.exit(0);
}

verifyHardening().catch(console.error);
