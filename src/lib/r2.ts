import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

export interface R2ObjectSummary {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
}

export interface R2MultipartUploadSummary {
  key: string;
  uploadId: string;
  initiated?: Date;
}

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
  expiresInSeconds = 3600,
  metadata?: Record<string, string>
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
    ...(metadata && Object.keys(metadata).length > 0 ? { Metadata: metadata } : {}),
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
  contentType = "application/octet-stream",
  metadata?: Record<string, string>
): Promise<{ size: number }> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      ...(metadata && Object.keys(metadata).length > 0 ? { Metadata: metadata } : {}),
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
 * Checks if an object exists in R2 and returns its size, lastModified, and ETag.
 */
export async function checkR2Object(
  objectKey: string
): Promise<{ size: number; lastModified?: Date; etag?: string } | null> {
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
      etag: res.ETag?.replace(/^"|"$/g, ""),
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
  if (!objectKey || objectKey.includes("..")) {
    throw new Error(`Invalid R2 object key: ${objectKey}`);
  }
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
}

/**
 * Paginates through R2 bucket objects using ListObjectsV2Command.
 */
export async function listAllR2Objects(options?: {
  prefix?: string;
  pageSize?: number;
  maxObjects?: number;
}): Promise<{ bucket: string; objects: R2ObjectSummary[]; truncated: boolean }> {
  const client = getR2Client();
  const bucket = getR2BucketName();
  const pageSize = Math.min(1000, Math.max(1, options?.pageSize || 1000));
  const maxObjects = options?.maxObjects || 50000;

  const objects: R2ObjectSummary[] = [];
  let continuationToken: string | undefined = undefined;
  let truncated = false;

  do {
    const res: any = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: options?.prefix,
        MaxKeys: pageSize,
        ContinuationToken: continuationToken,
      })
    );
    for (const item of res.Contents || []) {
      if (!item.Key) continue;
      objects.push({
        key: item.Key,
        size: item.Size || 0,
        lastModified: item.LastModified,
        etag: item.ETag?.replace(/^"|"$/g, ""),
        storageClass: item.StorageClass,
      });
      if (objects.length >= maxObjects) {
        truncated = Boolean(res.IsTruncated);
        return { bucket, objects, truncated };
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return { bucket, objects, truncated };
}

/**
 * Lists open (in-progress/abandoned) multipart uploads in the R2 bucket.
 */
export async function listR2MultipartUploads(
  prefix?: string
): Promise<R2MultipartUploadSummary[]> {
  const client = getR2Client();
  const bucket = getR2BucketName();
  const uploads: R2MultipartUploadSummary[] = [];

  try {
    let keyMarker: string | undefined = undefined;
    let uploadIdMarker: string | undefined = undefined;
    do {
      const res: any = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        })
      );
      for (const u of res.Uploads || []) {
        if (!u.Key || !u.UploadId) continue;
        uploads.push({
          key: u.Key,
          uploadId: u.UploadId,
          initiated: u.Initiated,
        });
      }
      if (res.IsTruncated) {
        keyMarker = res.NextKeyMarker;
        uploadIdMarker = res.NextUploadIdMarker;
      } else {
        keyMarker = undefined;
        uploadIdMarker = undefined;
      }
    } while (keyMarker);
  } catch (err: any) {
    console.warn("[r2] ListMultipartUploads warning:", err?.message || err);
  }

  return uploads;
}

/**
 * Aborts an incomplete multipart upload in R2.
 */
export async function abortR2MultipartUpload(
  objectKey: string,
  uploadId: string
): Promise<void> {
  if (!objectKey || objectKey.includes("..") || !uploadId) {
    throw new Error("Invalid multipart upload key or uploadId");
  }
  const client = getR2Client();
  const bucket = getR2BucketName();

  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: objectKey,
      UploadId: uploadId,
    })
  );
}

/**
 * Safely extracts an R2 object key from a public URL or relative storage path.
 */
export function extractR2KeyFromUrl(urlOrPath?: string | null): string | null {
  if (!urlOrPath || typeof urlOrPath !== "string") return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed || trimmed.includes("..")) return null;

  const publicBase = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
  if (publicBase && trimmed.startsWith(publicBase + "/")) {
    return trimmed.slice(publicBase.length + 1);
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      if (u.hostname.endsWith(".r2.dev") || u.hostname.endsWith(".r2.cloudflarestorage.com")) {
        const key = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        return key && !key.includes("..") ? key : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  const normalized = trimmed.replace(/^\/+/, "");
  if (
    normalized.startsWith("releases/") ||
    normalized.startsWith("backups/") ||
    normalized.startsWith("migrations/") ||
    normalized.startsWith("uploads/") ||
    normalized.startsWith("feedbacks/")
  ) {
    return normalized;
  }
  return null;
}
