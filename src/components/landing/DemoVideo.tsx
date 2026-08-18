import dbConnect from "@/lib/db";
import SystemSetting from "@/models/SystemSetting";
import { PlayCircle } from "lucide-react";

export async function DemoVideo() {
  let videoUrl = "";
  try {
    await dbConnect();
    const setting = await SystemSetting.findOne({ key: "demo_video_url" });
    if (setting && setting.value) {
      videoUrl = setting.value;
      // Convert standard sharing links to preview links if it's a google drive link
      if (videoUrl.includes("drive.google.com/file/d/")) {
         // extract ID
         const match = videoUrl.match(/\/d\/(.*?)\//);
         if (match && match[1]) {
           videoUrl = `https://drive.google.com/file/d/${match[1]}/preview`;
         }
      }
    }
  } catch (err) {
    console.error("Failed to fetch demo video:", err);
  }

  if (!videoUrl) return null;

  return (
    <section className="bg-muted/30 py-24 md:py-32 border-y border-border">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 mb-4 text-sm font-medium text-primary">
            <PlayCircle className="mr-2 h-4 w-4" />
            See it in action
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Watch the Demo
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Take a quick tour of Aivrasol POS and see how it can transform your pharmacy operations.
          </p>
        </div>

        <div className="mx-auto max-w-5xl">
          <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl relative group">
            <iframe
              src={videoUrl}
              allow="autoplay; fullscreen"
              className="absolute inset-0 h-full w-full border-none"
              title="Aivrasol POS Demo Video"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
}
