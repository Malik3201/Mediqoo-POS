import mongoose, { Schema, Document } from "mongoose";

export interface IFeedback extends Document {
  type: "issue" | "suggestion";
  priority?: "low" | "medium" | "high" | "critical";
  name: string;
  email: string;
  phone: string;
  description: string;
  screenshots: string[];
  status: "open" | "in-progress" | "resolved";
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema: Schema = new Schema(
  {
    type: { type: String, enum: ["issue", "suggestion"], required: true },
    priority: { type: String, enum: ["low", "medium", "high", "critical"] },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    description: { type: String, required: true },
    screenshots: [{ type: String }],
    status: { type: String, enum: ["open", "in-progress", "resolved"], default: "open" },
  },
  { timestamps: true }
);

export default mongoose.models.Feedback ||
  mongoose.model<IFeedback>("Feedback", FeedbackSchema);
