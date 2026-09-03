import mongoose from "mongoose";

import crypto from "crypto";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const License = require("../src/models/License").default;
  const LicenseSeat = require("../src/models/LicenseSeat").default;
  const CloudBackup = require("../src/models/CloudBackup").default;

  // Let's use our existing test license: AIVRA-QDDRB-KKLXD-DBHGV-AXTN4
  const licenseKey = "AIVRA-QDDRB-KKLXD-DBHGV-AXTN4";
  const machineId = "d292d933bf5511d808a0e7a46ce0402939b703f0b04e273c62cb80a557feb272";
  
  const license = await License.findOne({ license_key: licenseKey });
  if (!license) throw new Error("License not found");

  console.log("=== A. Testing Cloud Backup Disabled ===");
  // Disable it
  await License.updateOne({ license_key: licenseKey }, { $set: { "features.cloud_backup": false } });

  const reqBody = {
    license_key: licenseKey,
    machine_id: machineId,
    backup_type: "manual",
    original_filename: "AivraSol_Test_DB.aivrabak",
    format: "aivrasol-backup",
    backup_version: 1,
    size_bytes: 1024,
    checksum_sha256: "dummy-hash",
  };

  let res = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody)
  });
  console.log("Disabled Session Status:", res.status); // Expect 403
  let data = await res.json();
  console.log("Disabled Session Response:", data.error); // Expect feature_disabled

  console.log("\n=== B. Testing Cloud Backup Enabled ===");
  await License.updateOne({ license_key: licenseKey }, { $set: { "features.cloud_backup": true } });

  res = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody)
  });
  console.log("Enabled Session Status:", res.status); // Expect 200
  data = await res.json();
  console.log("Upload Session URL:", data.upload_url ? "Generated" : "Missing");

  if (!data.upload_url) {
    console.error("Failed:", data);
    process.exit(1);
  }
  
  const backupId = data.backup_id;

  console.log("\n=== C. Invalid Machine Test ===");
  const badRes = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...reqBody, machine_id: "fake" })
  });
  console.log("Invalid Machine Status:", badRes.status); // 401

  console.log("\n=== D. Uploading Encrypted Test File to R2 ===");
  const dummyBuffer = Buffer.from("dummy-encrypted-bytes-12345");
  const putRes = await fetch(data.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: dummyBuffer
  });
  console.log("R2 PUT Status:", putRes.status); // 200

  console.log("\n=== E. Completion Endpoint ===");
  res = await fetch(`http://localhost:3000/api/public/backups/${backupId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey, machine_id: machineId })
  });
  console.log("Complete Status:", res.status);
  data = await res.json();
  console.log("Complete Response:", data);

  console.log("\n=== F. Idempotent Success Test ===");
  res = await fetch(`http://localhost:3000/api/public/backups/${backupId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey, machine_id: machineId })
  });
  console.log("Second Complete Status:", res.status);
  data = await res.json();
  console.log("Second Complete Response:", data);

  console.log("\n=== G. Scheduled Duplicate Period Test ===");
  const schedBody = { ...reqBody, backup_type: "day_end", period_key: "2026-09-04" };
  const sched1 = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schedBody)
  });
  const sched1Data = await sched1.json();
  // upload fake
  await fetch(sched1Data.upload_url, { method: "PUT", body: dummyBuffer });
  await fetch(`http://localhost:3000/api/public/backups/${sched1Data.backup_id}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ license_key: licenseKey, machine_id: machineId })
  });
  
  // Try to create second session for same period
  const sched2 = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schedBody)
  });
  console.log("Second Scheduled Session Status:", sched2.status); // 409
  
  console.log("\n=== H. Oversized Request Test ===");
  const giantBody = { ...reqBody, size_bytes: 300 * 1024 * 1024 }; // 300 MB
  const giantRes = await fetch("http://localhost:3000/api/public/backups/upload-session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(giantBody)
  });
  console.log("Oversized Status:", giantRes.status); // 413
  const giantData = await giantRes.json();
  console.log("Oversized Response:", giantData.error);

  console.log("\nAll Backend POS tests executed successfully.");
  mongoose.disconnect();
}

run().catch(console.error);
