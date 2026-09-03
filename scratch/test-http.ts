import { encode } from "next-auth/jwt";

const baseUrl = "http://localhost:3000";

async function generateTokenCookie() {
  const token = await encode({
    token: { name: "Admin", email: "admin@aivrasol.com" },
    secret: process.env.NEXTAUTH_SECRET as string,
  });
  return `next-auth.session-token=${token}`;
}

async function runTests() {
  const cookie = await generateTokenCookie();
  
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const License = require("../src/models/License").default;
  const LicenseSeat = require("../src/models/LicenseSeat").default;
  const lic = await License.findOne({ status: "active" });
  if (!lic) throw new Error("No active license");
  const licenseId = lic.id;
  console.log(`Testing License ID: ${licenseId}`);

  const seat = await LicenseSeat.findOne({ license_id: licenseId });
  if (!seat) throw new Error("No seat found for this license");

  // Fetch initial /license-status
  const statusPayload = { license_key: lic.license_key, machine_id: seat.machine_id };
  
  async function checkStatus() {
    const r = await fetch(`${baseUrl}/api/public/license-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusPayload)
    });
    const d = await r.json();
    console.log(`[Status] cloud_dashboard_enabled: ${d.metadata?.cloud_dashboard_enabled}, license_version: ${d.metadata?.license_version}`);
    return d.metadata;
  }

  async function toggle(enabled: boolean) {
    console.log(`\n--- Toggling to ${enabled} ---`);
    const r = await fetch(`${baseUrl}/api/admin/licenses/${licenseId}/cloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify({ enabled })
    });
    const d = await r.json();
    console.log(`[Toggle] ok: ${d.ok}, changed: ${d.changed}, cloud_dashboard_enabled: ${d.cloud_dashboard_enabled}, license_version: ${d.license_version}`);
    return d;
  }

  const initialStatus = await checkStatus();
  console.log(`Initial version: ${initialStatus.license_version}`);

  if (initialStatus.cloud_dashboard_enabled) {
     await toggle(false);
  }

  console.log("\n=== STARTING 4-TOGGLE SEQUENCE ===");
  await toggle(true);
  await checkStatus();

  await toggle(false);
  await checkStatus();

  await toggle(true);
  await checkStatus();

  await toggle(false);
  await checkStatus();

  console.log("\n=== TESTING NO-OP SEQUENCE ===");
  await toggle(false);
  await checkStatus();

  mongoose.disconnect();
}

runTests().catch(console.error);
