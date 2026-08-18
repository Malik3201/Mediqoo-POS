import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { filename, fileType, version } = await req.json();

    if (!filename || !version) {
      return NextResponse.json({ error: "Filename and version are required" }, { status: 400 });
    }

    // Initialize S3 Client (compatible with Cloudflare R2)
    // Add your Cloudflare R2 credentials to .env.local
    const s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const safeVer = version.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    
    // Store in a 'releases' folder inside the bucket
    const objectKey = `releases/${safeVer}/${Date.now()}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: objectKey,
      ContentType: fileType || "application/octet-stream",
    });

    // The frontend has 15 minutes to use this URL to directly upload the file
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    // R2_PUBLIC_URL should be your custom domain or R2 public dev URL (e.g. https://pub-xyz.r2.dev)
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${objectKey}`;

    return NextResponse.json({
      uploadUrl,
      publicUrl
    });
  } catch (error: any) {
    console.error("Upload signature error:", error);
    return NextResponse.json({ error: "Failed to generate upload signature" }, { status: 500 });
  }
}
