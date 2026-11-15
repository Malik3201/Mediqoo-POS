import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Release from "@/models/Release";
import { AdminAuthError, requireAdminRequest } from "@/lib/admin-auth";
import { extractR2KeyFromUrl, getPresignedDownloadUrl } from "@/lib/r2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminRequest(req);
    await connectToDatabase();
    const { id } = await params;

    const release = (await Release.findOne({ id }).lean()) as any;
    if (!release) {
      return NextResponse.json({ error: "Release not found." }, { status: 404 });
    }

    const objectKey =
      release.object_key ||
      extractR2KeyFromUrl(release.storage_path) ||
      extractR2KeyFromUrl(release.bundle_url) ||
      extractR2KeyFromUrl(release.asar_url) ||
      extractR2KeyFromUrl(release.full_package_url);

    let url = release.storage_path || release.full_package_url || release.asar_url || "";
    if (objectKey) {
      const filename = objectKey.split("/").pop() || `release-${release.version}`;
      url = await getPresignedDownloadUrl(objectKey, filename, 300);
    }

    if (!url || !url.startsWith("http")) {
      return NextResponse.json({ error: "No downloadable URL available for this release." }, { status: 404 });
    }

    if (req.nextUrl.searchParams.get("redirect") === "1") {
      return NextResponse.redirect(url, 302);
    }

    return NextResponse.json({ url });
  } catch (err: any) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err?.message || "Download URL error." }, { status: 500 });
  }
}

