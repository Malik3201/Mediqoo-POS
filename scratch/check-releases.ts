import mongoose from "mongoose";
import connectToDatabase from "../src/lib/db";
import Release from "../src/models/Release";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const releases = await Release.find().lean();
  console.log(`Found ${releases.length} releases.`);
  
  for (const r of releases) {
    console.log(`- v${r.version} | type: ${r.release_type || 'undefined'} | status: ${r.status} | id: ${r.id}`);
  }

  mongoose.disconnect();
}

run().catch(console.error);
