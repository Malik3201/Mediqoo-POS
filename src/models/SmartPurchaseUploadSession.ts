import mongoose, { Schema, Document } from "mongoose";

export type UploadSessionStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "processing"
  | "completed"
  | "expired"
  | "cancelled"
  | "failed";

export interface ISmartPurchaseUploadedPage {
  pageId: string;
  pageNumber: number;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  storageKey?: string;
  encryptedDataBase64?: string;
  ivHex?: string;
  authTagHex?: string;
  uploadedAt: Date;
}

export interface ISmartPurchaseUploadSession extends Document {
  sessionId: string;
  uploadTokenHash: string;
  desktopSecretHash: string;
  licenseId: string;
  clientId: string;
  seatId: string;
  machineId: string;
  terminalNumber?: number | null;
  pharmacyName?: string;
  draftId: string;
  status: UploadSessionStatus;
  pages: ISmartPurchaseUploadedPage[];
  submissionFingerprint?: string | null;
  uploadAttempts: number;
  createdAt: Date;
  expiresAt: Date;
  uploadedAt?: Date | null;
  consumedAt?: Date | null;
  cancelledAt?: Date | null;
}

const UploadedPageSchema = new Schema<ISmartPurchaseUploadedPage>(
  {
    pageId: { type: String, required: true },
    pageNumber: { type: Number, required: true },
    mimeType: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageKey: { type: String },
    encryptedDataBase64: { type: String, select: false },
    ivHex: { type: String, select: false },
    authTagHex: { type: String, select: false },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SmartPurchaseUploadSessionSchema = new Schema<ISmartPurchaseUploadSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    uploadTokenHash: { type: String, required: true, unique: true, index: true },
    desktopSecretHash: { type: String, required: true },
    licenseId: { type: String, required: true, index: true },
    clientId: { type: String, required: true, index: true },
    seatId: { type: String, required: true },
    machineId: { type: String, required: true },
    terminalNumber: { type: Number, default: null },
    pharmacyName: { type: String, default: "Pharmacy POS" },
    draftId: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "uploading", "uploaded", "processing", "completed", "expired", "cancelled", "failed"],
      default: "pending",
      index: true,
    },
    pages: { type: [UploadedPageSchema], default: [] },
    submissionFingerprint: { type: String, default: null },
    uploadAttempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 3600 } },
    uploadedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: false }
);

const SmartPurchaseUploadSession =
  mongoose.models.SmartPurchaseUploadSession ||
  mongoose.model<ISmartPurchaseUploadSession>("SmartPurchaseUploadSession", SmartPurchaseUploadSessionSchema);

export default SmartPurchaseUploadSession;

