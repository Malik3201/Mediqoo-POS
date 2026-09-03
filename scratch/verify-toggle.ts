import mongoose from "mongoose";
import { isCloudDashboardEnabled } from "../src/lib/status";
import License from "../src/models/License";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

(ed as any).hashes ||= {};
(ed as any).hashes.sha512 = sha512;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}
function toBytes(str: string) {
  return new TextEncoder().encode(str);
}
function b64encode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}
function canonicalSerialize(payload: any): string {
  const sortedPayload: any = {};
  Object.keys(payload).sort().forEach(key => {
    sortedPayload[key] = payload[key];
  });
  return JSON.stringify(sortedPayload);
}

async function runTest() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB");

  const license = await License.findOne({ status: "active" });
  if (!license) throw new Error("No active license found");
  console.log(`Testing License ID: ${license.id}`);

  const initialVersion = license.license_version || 1;
  const initialCloud = isCloudDashboardEnabled(license);
  console.log(`Initial: Version=${initialVersion}, Cloud=${initialCloud}`);

  // TOGGLE: Cloud Dashboard
  const newFeatures = { ...(license.features || {}), cloud_dashboard: !initialCloud };
  await License.findOneAndUpdate({ id: license.id }, { $set: { features: newFeatures } });

  const updatedLicense = await License.findOne({ id: license.id });
  const updatedVersion = updatedLicense?.license_version;
  const updatedCloud = isCloudDashboardEnabled(updatedLicense);
  
  console.log(`Updated: Version=${updatedVersion}, Cloud=${updatedCloud}`);
  if (updatedVersion === initialVersion + 1) {
    console.log("SUCCESS: license_version correctly incremented exactly once!");
  } else {
    console.log("FAIL: license_version did not increment correctly.");
  }

  // SIGNATURE TEST
  const payload = {
    cloud_dashboard_enabled: updatedCloud,
    effective_status: "active",
    expires_at: updatedLicense?.expires_at ? updatedLicense.expires_at.toISOString() : null,
    grace_until: updatedLicense?.grace_until ? updatedLicense.grace_until.toISOString() : null,
    issued_at: updatedLicense?.issued_at ? updatedLicense.issued_at.toISOString() : null,
    license_id: updatedLicense?.id,
    license_version: updatedVersion,
    machine_id: "test-machine",
    seat_id: "test-seat",
  };

  const seed = hexToBytes(process.env.LICENSE_STATUS_SIGNING_SEED!);
  const publicKey = ed.getPublicKey(seed);
  
  const dataString = canonicalSerialize(payload);
  const dataBytes = toBytes(dataString);
  const signatureBytes = ed.sign(dataBytes, seed);
  const verified = ed.verify(signatureBytes, dataBytes, publicKey);

  console.log(`\nSigned Metadata JSON: ${dataString}`);
  console.log(`Base64 Signature: ${b64encode(signatureBytes)}`);
  console.log(`Signature Verified Successfully: ${verified}`);

  // Revert
  await License.findOneAndUpdate({ id: license.id }, { $set: { features: license.features } });
  console.log("Reverted DB state.");

  mongoose.disconnect();
}

runTest().catch(console.error);
