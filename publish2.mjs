import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[match[1].trim()] = val;
  }
});

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
  const zipPath = "d:\\aivrasol-pos-107bb583\\aivrasol-pos\\release\\AivraSolPOS.zip";
  const fileStats = fs.statSync(zipPath);
  const version = "1.3.2";
  
  console.log("Requesting pre-signed URL from Next.js API...");
  // Simulate what the frontend does!
  // We can't actually hit localhost:3001/api/upload without authentication (it checks session).
  // Ah! It checks `getServerSession()`. The script won't have a session!
  // BUT we can just generate the presigned URL right here in the script using @aws-sdk/s3-request-presigner
  
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const objectKey = `releases/${version}/${Date.now()}-AivraSolPOS.zip`;
  
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: objectKey,
    ContentType: "application/zip",
  });
  
  console.log("Generating pre-signed URL...");
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  
  console.log(`Uploading ${fileStats.size} bytes using fetch PUT...`);
  
  // Use native fetch to upload the file buffer directly to the pre-signed URL
  const fileBuffer = fs.readFileSync(zipPath);
  
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: fileBuffer
  });
  
  if (!uploadRes.ok) {
    throw new Error(`Upload failed! Status: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  
  console.log("Upload successful!");
  
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${objectKey}`;
  console.log("Connecting to DB...");
  await mongoose.connect(process.env.MONGODB_URI);
  
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

main().catch(console.error);
