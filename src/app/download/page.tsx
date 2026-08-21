import connectToDatabase from "@/lib/db";
import Release from "@/models/Release";
import { Download } from "lucide-react";

export const dynamic = 'force-dynamic';

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return (bytes / (1024 * 1024)).toFixed(0) + " MB";
}

export default async function DownloadPage() {
  await connectToDatabase();
  
  const latestRelease = await Release.findOne({ 
    is_prerelease: { $ne: true },
    status: "published",
    release_type: { $ne: "hot" }
  }).sort({ published_at: -1 }).lean();

  const formattedDate = latestRelease?.published_at 
    ? new Date(latestRelease.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : "";

  const version = latestRelease ? (latestRelease as any).version : "1.0.0";
  const size = latestRelease ? formatBytes((latestRelease as any).installer_size) : "0 MB";
  const downloadUrl = latestRelease ? ((latestRelease as any).full_package_url || (latestRelease as any).storage_path || "#") : "#";

  return (
    <div className="min-h-screen bg-white font-sans flex flex-col">
      {/* Navbar */}
      <header className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#009A4D] rounded-lg flex items-center justify-center text-white font-bold text-xl leading-none">
            A
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-gray-900 text-[15px]">AivraSol</span>
            <span className="text-gray-500 text-[13px]">Pharmacy POS</span>
          </div>
        </div>
        <a 
          href={downloadUrl}
          className="bg-[#009A4D] hover:bg-[#008643] text-white text-sm font-medium px-5 py-2.5 rounded-md transition-colors"
        >
          Download
        </a>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center pt-16 px-4 pb-12">
        
        {/* Badge */}
        {latestRelease && (
          <div className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1 mb-8">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-sm text-gray-500">
              Latest release &middot; v{version} &middot; {formattedDate}
            </span>
          </div>
        )}

        {/* Hero Text */}
        <h1 className="text-[40px] md:text-5xl font-extrabold text-gray-900 tracking-tight text-center mb-4">
          AivraSol POS for Windows
        </h1>
        <p className="text-[17px] text-gray-500 text-center max-w-2xl leading-relaxed mb-12">
          Offline-first pharmacy point of sale. Fast keyboard billing, batch & expiry tracking,
          thermal receipts, and encrypted local storage.
        </p>

        {/* Download Card */}
        <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          
          {/* Card Top */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] font-bold text-gray-900">AivraSol POS Portable Installer</h2>
              <p className="text-[13.5px] text-gray-500">Windows 10 / 11 &middot; x64 &middot; {size}</p>
            </div>
            <a 
              href={downloadUrl}
              className="bg-[#009A4D] hover:bg-[#008643] text-white font-medium px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors w-full md:w-auto"
            >
              <Download className="w-[18px] h-[18px]" />
              Download ZIP
            </a>
          </div>

          {/* How to install section */}
          <div className="bg-[#f9fafa] rounded-xl p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2.5">How to install</h3>
            <ol className="text-[13.5px] text-gray-600 space-y-1.5 list-decimal pl-5">
              <li className="pl-1">Download the ZIP and right-click &rarr; <strong>Extract All</strong></li>
              <li className="pl-1">Open the extracted folder and double-click <strong>AivraSolPOS.exe</strong></li>
              <li className="pl-1">Inside the app, click <strong>Install to this PC</strong> to create shortcuts</li>
              <li className="pl-1">Windows SmartScreen? Click <strong>More info</strong> &rarr; <strong>Run anyway</strong></li>
            </ol>
          </div>
        </div>

        {/* Footer Disclaimer */}
        <p className="mt-8 text-[13px] text-gray-400 text-center max-w-lg">
          By downloading you accept the AivraSol end-user terms. License activation requires a valid .aivra package.
        </p>
      </main>
    </div>
  );
}
