import { NextRequest, NextResponse } from "next/server";
import { getStorefrontWorkerBaseUrl } from "@/lib/storefront/client";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ mediaId: string }> | { mediaId: string } }
) {
  const resolvedParams = await Promise.resolve(context.params);
  const mediaId = resolvedParams?.mediaId;
  if (!mediaId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const workerBase = getStorefrontWorkerBaseUrl();
  const workerMediaUrl = `${workerBase}/api/v1/public/media/${encodeURIComponent(mediaId)}`;

  try {
    const upstreamRes = await fetch(workerMediaUrl, {
      method: "GET",
      headers: {
        Accept: "image/webp,image/*,*/*",
      },
      next: { revalidate: 604800 },
    });

    if (!upstreamRes.ok) {
      return new NextResponse(upstreamRes.statusText, { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get("Content-Type") || "image/webp";
    const imageBuf = await upstreamRes.arrayBuffer();

    return new NextResponse(imageBuf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    return new NextResponse("Error fetching media asset", { status: 502 });
  }
}
