import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

let cachedClient: S3Client | null = null;

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing Cloudflare R2 credentials in environment (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
    );
  }

  cachedClient = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return cachedClient;
}

export function getR2BucketName(): string {
  return process.env.R2_BUCKET_NAME || "mediqoo";
}

/**
 * Generates a presigned PUT URL for uploading legacy backup files directly to R2.
 */
export async function getPresignedUploadUrl(
  objectKey: string,
  contentType = "application/octet-stream",
  expiresInSeconds = 3600
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Generates a presigned GET URL for downloading converted .aivrabak files from R2.
 */
export async function getPresignedDownloadUrl(
  objectKey: string,
  filename?: string,
  expiresInSeconds = 1800
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename}"`
      : undefined,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Uploads a Buffer directly to Cloudflare R2.
 */
export async function uploadBufferToR2(
  objectKey: string,
  buffer: Buffer,
  contentType = "application/octet-stream"
): Promise<{ size: number }> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return { size: buffer.length };
}

/**
 * Downloads an object from R2 and buffers it into memory.
 */
export async function downloadBufferFromR2(objectKey: string): Promise<Buffer> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );

  if (!res.Body) {
    throw new Error(`R2 object empty or not found: ${objectKey}`);
  }

  const stream = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Checks if an object exists in R2 and returns its size.
 */
export async function checkR2Object(
  objectKey: string
): Promise<{ size: number; lastModified?: Date } | null> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      })
    );
    return {
      size: res.ContentLength || 0,
      lastModified: res.LastModified,
    };
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes an object from R2.
 */
export async function deleteR2Object(objectKey: string): Promise<void> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
}
