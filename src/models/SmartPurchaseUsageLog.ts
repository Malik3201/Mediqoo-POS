import mongoose, { Document, Model, Schema } from "mongoose";

export interface ISmartPurchaseUsageLog extends Document {
  licenseId: mongoose.Types.ObjectId;
  clientId?: mongoose.Types.ObjectId | null;
  seatId: string;
  machineId: string;
  sessionId?: string | null;
  captureMethod: "mobile_qr" | "desktop_upload";
  pageCount: number;
  lineCount: number;
  status: "completed" | "failed" | "limit_exceeded";
  provider: string;
  modelName: string;
  processingDurationMs: number;
  estimatedCostUsd: number;
  errorCode?: string | null;
  createdAt: Date;
}

const SmartPurchaseUsageLogSchema = new Schema<ISmartPurchaseUsageLog>(
  {
    licenseId: { type: Schema.Types.ObjectId, ref: "License", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null },
    seatId: { type: String, required: true },
    machineId: { type: String, required: true },
    sessionId: { type: String, default: null },
    captureMethod: {
      type: String,
      enum: ["mobile_qr", "desktop_upload"],
      required: true,
    },
    pageCount: { type: Number, required: true, min: 1 },
    lineCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["completed", "failed", "limit_exceeded"],
      required: true,
      index: true,
    },
    provider: { type: String, default: "groq-vision" },
    modelName: { type: String, default: "qwen/qwen3.8-27b" },
    processingDurationMs: { type: Number, required: true, min: 0 },
    estimatedCostUsd: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SmartPurchaseUsageLogSchema.index({ licenseId: 1, createdAt: -1 });

const SmartPurchaseUsageLog: Model<ISmartPurchaseUsageLog> =
  mongoose.models.SmartPurchaseUsageLog ||
  mongoose.model<ISmartPurchaseUsageLog>("SmartPurchaseUsageLog", SmartPurchaseUsageLogSchema);

export default SmartPurchaseUsageLog;
