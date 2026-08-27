import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import dbConnect from "@/lib/db";
import Feedback from "@/models/Feedback";
import { sendStatusUpdate, sendCustomMessage } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const { action, customMessage } = await req.json();

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const feedback = await Feedback.findById(params.id);
    if (!feedback) {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }

    if (action === "custom") {
      if (!customMessage || !customMessage.trim()) {
        return NextResponse.json({ error: "Custom message is required" }, { status: 400 });
      }
      await sendCustomMessage(feedback.name, feedback.email, customMessage);
    } else if (["analyzing", "fixing", "fixed"].includes(action)) {
      await sendStatusUpdate(feedback.name, feedback.email, action as "analyzing" | "fixing" | "fixed");
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "Email sent successfully" });
  } catch (error: any) {
    console.error("Email send error:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
