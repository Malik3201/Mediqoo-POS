import mongoose from "mongoose";
import connectToDatabase from "../src/lib/db";
import CloudBackup from "../src/models/CloudBackup";
import PortalUser from "../src/models/PortalUser";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const backupId = "144619d5-82b0-4486-9ec4-1e663c25a2e8";
  const backup = await CloudBackup.findOne({ id: backupId }).lean();
  
  if (!backup) {
    console.log("Backup not found!");
  } else {
    console.log("\n=== Real Backup Record ===");
    console.log("backup.id:", backup.id);
    console.log("backup.client_id:", backup.client_id);
    console.log("backup.license_id:", backup.license_id);
    console.log("backup.status:", backup.status);
    console.log("backup.backup_type:", backup.backup_type);
    console.log("backup.size_bytes:", backup.size_bytes);
    console.log("backup.uploaded_at:", backup.uploaded_at);
    console.log("backup.checksum_sha256:", backup.checksum_sha256);
  }

  const user = await PortalUser.findOne({ email: "owner@aivrasol.com" }).lean();
  if (user) {
    console.log("\n=== Authenticated PortalUser (owner@aivrasol.com) ===");
    console.log("client_id:", user.client_id);
    if (backup && user.client_id === backup.client_id) {
      console.log("SUCCESS: Client IDs Match!");
    } else {
      console.log("FAILURE: Client IDs Mismatch!");
    }
  }

  mongoose.disconnect();
}

run().catch(console.error);
