import * as fs from 'fs';
import connectToDatabase from "../src/lib/db";
import AnalyticsEvent from "../src/models/AnalyticsEvent";
import License from "../src/models/License";
import mongoose from "mongoose";

// Manually parse .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
});

async function check() {
  await connectToDatabase();
  const event = await AnalyticsEvent.findOne({ type: "sale.completed" }).sort({ occurred_at: -1 }).lean();
  
  if (!event) {
    console.log("No sale.completed events found");
  } else {
    console.log("LATEST SALE EVENT:");
    console.log(JSON.stringify(event, null, 2));
    
    // Check License resolution
    const license = await License.findOne({ id: event.license_id }).lean();
    console.log("\nLICENSE ID:", event.license_id);
    console.log("CLIENT ID FROM EVENT:", event.client_id);
    console.log("CLIENT ID FROM LICENSE:", license?.client_id);
  }
  
  mongoose.disconnect();
}
check();
