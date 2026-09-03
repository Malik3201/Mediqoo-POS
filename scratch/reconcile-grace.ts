import mongoose from "mongoose";

// Implement the helper locally for the standalone script so we don't have compilation issues
function calculateGraceUntil(expiresAt: Date | string | null | undefined, graceDays: number | null | undefined): Date | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const days = typeof graceDays === "number" ? Math.max(0, graceDays) : 0;
  if (days === 0) return expiry;

  const graceUntil = new Date(expiry);
  graceUntil.setDate(graceUntil.getDate() + days);
  return graceUntil;
}

async function reconcile() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const License = require("../src/models/License").default;

  const isDryRun = !process.argv.includes("--execute");
  console.log(`\n--- RECONCILIATION SCRIPT (${isDryRun ? "DRY-RUN" : "EXECUTE"}) ---\n`);

  // Find broken licenses
  // Condition: billing.enabled == true, expires_at exists, grace_until is null or missing, status active/grace/blocked/suspended
  const filter = {
    "billing.enabled": true,
    expires_at: { $ne: null },
    grace_until: { $eq: null } // Matches missing or explicitly null in Mongoose lean queries
  };

  const brokenLicenses = await License.find(filter).lean();
  console.log(`Found ${brokenLicenses.length} broken licenses requiring grace_until reconciliation.\n`);

  let updatedCount = 0;

  for (const doc of brokenLicenses) {
    const graceDays = doc.billing?.grace_days || 0;
    const correctGraceUntil = calculateGraceUntil(doc.expires_at, graceDays);

    console.log(`License: ${doc.license_key}`);
    console.log(`  Expires At : ${doc.expires_at}`);
    console.log(`  Grace Days : ${graceDays}`);
    console.log(`  New Grace  : ${correctGraceUntil}`);

    if (!isDryRun) {
      // Use updateOne natively to trigger our shiny new `pre("updateOne")` hook 
      // which will atomically handle `license_version` increment!
      await License.updateOne(
        { _id: doc._id },
        { $set: { grace_until: correctGraceUntil } }
      );
      updatedCount++;
    }
  }

  if (isDryRun) {
    console.log(`\nDry-run complete. ${brokenLicenses.length} records would be updated. Run with --execute to apply.`);
  } else {
    console.log(`\nReconciliation complete. Successfully updated ${updatedCount} records.`);
  }

  mongoose.disconnect();
}

reconcile().catch(console.error);
