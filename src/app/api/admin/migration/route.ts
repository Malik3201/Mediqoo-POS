import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import MigrationJob from "@/models/MigrationJob";
import { requireSuperAdmin } from "@/lib/ai/admin-auth";
import { getPresignedUploadUrl } from "@/lib/r2";
import crypto from "crypto";
import path from "path";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const query = searchParams.get("q");
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

    const filter: any = {};
    if (status && status !== "all") {
      filter.status = status;
    }
    if (query) {
      filter.$or = [
        { job_number: { $regex: query, $options: "i" } },
        { pharmacy_name: { $regex: query, $options: "i" } },
        { source_software: { $regex: query, $options: "i" } },
        { source_filename: { $regex: query, $options: "i" } },
      ];
    }

    const total = await MigrationJob.countDocuments(filter);
    const jobs = await MigrationJob.find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return NextResponse.json({
      jobs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    await connectToDatabase();
    const body = await req.json();

    const {
      source_filename,
      source_file_size,
      source_file_hash,
      source_format = ".bak",
      client_id,
      project_id,
      license_id,
      license_key,
      pharmacy_name,
    } = body;

    if (!source_filename || !source_file_size || !source_file_hash) {
      return NextResponse.json(
        { error: "source_filename, source_file_size, and source_file_hash are required." },
        { status: 400 }
      );
    }

    const jobId = crypto.randomUUID();
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const randomSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
    const jobNumber = `MIG-${dateStr}-${randomSuffix}`;

    const sanitizedFilename = path.basename(source_filename).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const sourceObjectKey = `uploads/migration-sources/${jobId}/${sanitizedFilename}`;

    // Generate presigned upload URL for Cloudflare R2
    const uploadUrl = await getPresignedUploadUrl(
      sourceObjectKey,
      "application/octet-stream",
      7200 // 2 hours for large backup upload
    );

    const job = new MigrationJob({
      id: jobId,
      job_number: jobNumber,
      source_software: "Auto-detect",
      source_format: source_format,
      source_filename: sanitizedFilename,
      source_file_size: Number(source_file_size),
      source_file_hash: source_file_hash,
      source_object_key: sourceObjectKey,
      client_id,
      project_id,
      license_id,
      license_key,
      pharmacy_name,
      created_by: {
        id: auth.actor.id,
        email: auth.actor.email,
      },
      status: "uploaded",
      stage: "Backup Uploaded — Ready for Analysis",
      progress: 0,
      audit_events: [
        {
          timestamp: new Date(),
          actor: auth.actor.email,
          action: "JOB_CREATED",
          details: `Initiated migration job ${jobNumber} for file ${sanitizedFilename} (${(
            Number(source_file_size) /
            1024 /
            1024
          ).toFixed(1)} MB)`,
        },
      ],
    });

    await job.save();

    return NextResponse.json({
      job,
      uploadUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
