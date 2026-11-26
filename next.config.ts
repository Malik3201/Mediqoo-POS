import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "@andresaya/edge-tts", "ws"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/pdfkit/**/*",
      "./public/logo-aivrasol-voucher.png",
      "./public/logo-owner-portal.png",
    ],
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
