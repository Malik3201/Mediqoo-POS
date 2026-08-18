import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import SystemSetting from "@/models/SystemSetting";

export async function GET() {
  try {
    await dbConnect();
    const settings = await SystemSetting.find({});
    
    // Convert to a simple key-value object
    const config = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);
    
    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    
    // For now we only expect demo_video_url to be updated
    if (body.demo_video_url !== undefined) {
      await SystemSetting.findOneAndUpdate(
        { key: "demo_video_url" },
        { value: body.demo_video_url },
        { upsert: true, new: true }
      );
    }
    
    return NextResponse.json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
