import mongoose, { Schema, Document } from "mongoose";

export interface ILicenseRenewalInvoice extends Document {
  invoice_number: string;
  client_id: string;
  license_id: string;
  payment_id: string;
  issued_at: Date;
  periods_settled: number;
  billing_periods: string[];
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total_due: number;
  amount_paid: number;
  balance: number;
  payment_method: string;
  payment_reference?: string;
  old_expiry?: Date;
  new_expiry?: Date;
  seller_snapshot: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  client_snapshot: {
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  status: "paid" | "partially_paid" | "void";
  email_status: "pending" | "sent" | "failed";
  email_sent_at?: Date;
  email_attempt_count: number;
  email_last_error?: string;
  idempotency_key: string;
}

const LicenseRenewalInvoiceSchema = new Schema<ILicenseRenewalInvoice>({
  invoice_number: { type: String, required: true, unique: true },
  client_id: { type: String, required: true },
  license_id: { type: String, required: true },
  payment_id: { type: String, required: true },
  issued_at: { type: Date, default: Date.now },
  periods_settled: { type: Number, required: true, default: 1 },
  billing_periods: [{ type: String }],
  currency: { type: String, required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total_due: { type: Number, required: true },
  amount_paid: { type: Number, required: true },
  balance: { type: Number, default: 0 },
  payment_method: { type: String, required: true },
  payment_reference: { type: String },
  old_expiry: { type: Date },
  new_expiry: { type: Date },
  seller_snapshot: {
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    address: { type: String }
  },
  client_snapshot: {
    name: { type: String, required: true },
    contact_name: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String }
  },
  status: { type: String, enum: ["paid", "partially_paid", "void"], default: "paid" },
  email_status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
  email_sent_at: { type: Date },
  email_attempt_count: { type: Number, default: 0 },
  email_last_error: { type: String },
  idempotency_key: { type: String, required: true }
}, { timestamps: true });

export default mongoose.models.LicenseRenewalInvoice || mongoose.model<ILicenseRenewalInvoice>("LicenseRenewalInvoice", LicenseRenewalInvoiceSchema);
