import mongoose from "mongoose";

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const License = require("../src/models/License").default;
  const doc = await License.findOne({ license_key: "AIVRA-QDDRB-KKLXD-DBHGV-AXTN4" });

  console.log("DB values:");
  console.log(`expires_at: ${doc.expires_at?.toISOString()}`);
  console.log(`billing.grace_days: ${doc.billing?.grace_days}`);
  console.log(`grace_until: ${doc.grace_until?.toISOString()}`);
  console.log(`license_version: ${doc.license_version}`);

  const machine_id = "d292d933bf5511d808a0e7a46ce0402939b703f0b04e273c62cb80a557feb272"; // Found earlier
  const res = await fetch("http://localhost:3000/api/public/license-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: "AIVRA-QDDRB-KKLXD-DBHGV-AXTN4", machine_id })
  });

  const data = await res.json();
  console.log("\nAPI Response:");
  console.log(JSON.stringify(data, null, 2));

  mongoose.disconnect();
}

check().catch(console.error);
