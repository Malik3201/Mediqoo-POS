import mongoose from "mongoose";
import connectToDatabase from "../src/lib/db";
import { getLatestPublishedHotRelease } from "../src/lib/release";
import Release from "../src/models/Release";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB\n");

  const hotRelease = await Release.findOne({ version: "1.4.0", release_type: "hot", status: "published" });
  if (!hotRelease) {
    console.log("No 1.4.0 HOT release found. Creating one...");
    await Release.create({ version: "1.4.0", release_type: "hot", status: "published", asar_url: "http://hot-1.4.0", published_at: new Date() });
  }

  const fullRelease = await Release.findOne({ version: "1.4.0", release_type: "full", status: "published" });
  if (!fullRelease) {
    console.log("No 1.4.0 FULL release found. Creating one...");
    await Release.create({ version: "1.4.0", release_type: "full", status: "published", full_package_url: "http://full-1.4.0", published_at: new Date() });
  }

  console.log("--- TEST 1: Installed POS 1.3.9 ---");
  const res1 = await getLatestPublishedHotRelease("1.3.9");
  console.log("Updater returns:", res1 ? `${res1.release_type} ${res1.version}` : "no update");

  console.log("\n--- TEST 2: Installed POS 1.4.0 ---");
  const res2 = await getLatestPublishedHotRelease("1.4.0");
  console.log("Updater returns:", res2 ? `${res2.release_type} ${res2.version}` : "no update");

  console.log("\n--- TEST 3: /download shows FULL 1.4.0 ---");
  const downloadRelease = await Release.findOne({ is_prerelease: { $ne: true }, status: "published", release_type: "full" }).sort({ published_at: -1 }).lean();
  console.log("/download returns:", downloadRelease ? `${downloadRelease.release_type} ${(downloadRelease as any).version}` : "no release");

  console.log("\n--- TEST 4: full-only 1.4.1 ignored by updater ---");
  const full141 = await Release.create({ version: "1.4.1", release_type: "full", status: "published", full_package_url: "http://full-1.4.1", published_at: new Date() });
  const res4 = await getLatestPublishedHotRelease("1.4.0");
  console.log("Updater returns for 1.4.0:", res4 ? `${res4.release_type} ${res4.version}` : "no update");

  console.log("\nCleaning up 1.4.1 test data...");
  await Release.deleteOne({ _id: full141._id });

  mongoose.disconnect();
}

run().catch(console.error);
