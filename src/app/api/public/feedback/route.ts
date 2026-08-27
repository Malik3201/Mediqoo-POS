import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import Feedback from "@/models/Feedback";

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = await req.json();

    const { type, priority, name, email, phone, description, screenshots } = body;

    if (!type || !name || !email || !phone || !description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const feedback = await Feedback.create({
      type,
      priority: type === "issue" ? priority : undefined,
      name,
      email,
      phone,
      description,
      screenshots: Array.isArray(screenshots) ? screenshots : [],
    });

    // Asynchronously send emails (do not await to avoid blocking the response)
    import("@/lib/email").then(({ sendUserAutoReply, sendAdminAlert }) => {
      sendUserAutoReply(name, email, type);
      sendAdminAlert(name, email, type, description);
    }).catch(err => console.error("Failed to load email module:", err));

    return NextResponse.json({ success: true, data: feedback });
  } catch (error: any) {
    console.error("Feedback submission error:", error);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}
