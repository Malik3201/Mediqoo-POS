import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[match[1].trim()] = val;
  }
});

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

// Import Release model schema (simplified for standalone script)
const releaseSchema = new mongoose.Schema({
  version: { type: String, required: true },
  changelog: { type: String, default: "" },
  storage_path: { type: String },
  installer_size: { type: Number },
  mandatory: { type: Boolean, default: false },
  rollout_type: { type: String, enum: ["all", "specific"], default: "all" },
  status: { type: String, enum: ["draft", "published"], default: "draft" },
  published_at: { type: Date },
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

const Release = mongoose.models.Release || mongoose.model("Release", releaseSchema);

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  
  const zipPath = "d:\\aivrasol-pos-107bb583\\aivrasol-pos\\release\\AivraSolPOS.zip";
  if (!fs.existsSync(zipPath)) {
    throw new Error(`File not found: ${zipPath}`);
  }

  const fileStats = fs.statSync(zipPath);
  const version = "1.3.2"; // From package.json
  
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const objectKey = `releases/${version}/${Date.now()}-AivraSolPOS.zip`;
  
  console.log(`Uploading ${zipPath} (${fileStats.size} bytes) to Cloudflare R2...`);
  const fileBuffer = fs.readFileSync(zipPath);
  
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: objectKey,
    Body: fileBuffer,
    ContentType: "application/zip",
  }));

  const publicUrl = `${process.env.R2_PUBLIC_URL}/${objectKey}`;
  console.log(`Upload successful! Public URL: ${publicUrl}`);

  console.log("Creating database record...");
  
  const release = await Release.create({
    version,
    changelog: "Initial release via automated script",
    storage_path: publicUrl,
    installer_size: fileStats.size,
    rollout_type: "all",
    mandatory: false,
    status: "published",
    published_at: new Date()
  });

  console.log("Successfully published release:", release._id);
  
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
