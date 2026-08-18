import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function POST(req: NextRequest) {
  try {
    const { files } = await req.json();

    if (!files || !Array.isArray(files)) {
      return NextResponse.json({ error: "Files array is required" }, { status: 400 });
    }

    // Initialize S3 Client (compatible with Cloudflare R2)
    const s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const results = await Promise.all(
      files.map(async (file: { filename: string; fileType: string }) => {
        const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = `feedbacks/${Date.now()}-${Math.random().toString(36).substring(7)}-${safeName}`;

        const command = new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: objectKey,
          ContentType: file.fileType || "application/octet-stream",
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${objectKey}`;

        return { uploadUrl, publicUrl, filename: file.filename, originalFile: file };
      })
    );

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Feedback upload signature error:", error);
    return NextResponse.json({ error: "Failed to generate upload signatures" }, { status: 500 });
  }
}
