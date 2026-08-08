import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // In a real production environment, you might want to stream the file
  // or redirect to a signed S3 URL.
  // Here, we redirect to a static file in the public directory.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL("/pos/AivraSolPOS-v1.3.2-win-x64-portable.zip", baseUrl));
}
