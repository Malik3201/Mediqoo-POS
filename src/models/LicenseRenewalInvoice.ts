import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type VoucherPaymentStatus = "paid" | "partially_paid" | "payment_pending" | "unpaid" | "void";

export interface ILicenseRenewalInvoice extends Document {
  id: string;
  invoice_number: string; // e.g. AV-RNW-20261102-0001
  voucher_number: string; // alias for invoice_number
  client_id: string;
  license_id: string;
  payment_id?: string | null;
  action: "payment_and_renew" | "extend_only" | "payment_only" | "renew";
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
  old_expiry?: Date | null;
  new_expiry?: Date | null;
  seller_snapshot: {
    name: string;
    product_line?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
  };
  client_snapshot: {
    id: string;
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
  };
  license_snapshot: {
    license_id: string;
    license_key: string;
    license_key_masked: string;
    product_name: string;
    project_name?: string;
    billing_model: "fixed" | "per_invoice";
    plan_label: string;
    billing_cycle: string;
    allowed_seats: number;
    status_after_renewal: string;
  };
  period_snapshot: {
    previous_expiry?: Date | null;
    new_expiry?: Date | null;
    grace_until?: Date | null;
    renewal_start?: Date | null;
    renewal_end?: Date | null;
    extension_duration_label: string;
    extension_days?: number | null;
    is_lifetime?: boolean;
  };
  financial_snapshot: {
    currency: string;
    plan_charge: number;
    usage_invoice_count: number;
    usage_rate: number;
    invoice_overage_charge: number;
    arrears_included: number;
    subtotal: number;
    discount: number;
    tax: number;
    total_payable: number;
    amount_paid: number;
    remaining_balance: number;
  };
  payment_snapshot: {
    payment_id?: string | null;
    receipt_number?: string | null;
    payment_method: string;
    transaction_reference?: string | null;
    paid_at?: Date | null;
    processed_by: string;
    notes?: string | null;
    override_renewal?: boolean;
    override_reason?: string | null;
  };
  verification_hash: string;
  status: VoucherPaymentStatus;
  email_status: "pending" | "sent" | "failed" | "skipped";
  email_sent_at?: Date;
  email_attempt_count: number;
  email_last_error?: string;
  idempotency_key: string;
}

const LicenseRenewalInvoiceSchema = new Schema<ILicenseRenewalInvoice>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    invoice_number: { type: String, required: true, unique: true, index: true },
    voucher_number: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true, index: true },
    payment_id: { type: String, default: null, index: true },
    action: {
      type: String,
      enum: ["payment_and_renew", "extend_only", "payment_only", "renew"],
      default: "payment_and_renew",
    },
    issued_at: { type: Date, default: Date.now, index: true },
    periods_settled: { type: Number, required: true, default: 1 },
    billing_periods: [{ type: String }],
    currency: { type: String, required: true, default: "PKR" },
    subtotal: { type: Number, required: true, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total_due: { type: Number, required: true, default: 0 },
    amount_paid: { type: Number, required: true, default: 0 },
    balance: { type: Number, default: 0 },
    payment_method: { type: String, required: true, default: "N/A" },
    payment_reference: { type: String },
    old_expiry: { type: Date, default: null },
    new_expiry: { type: Date, default: null },
    seller_snapshot: {
      name: { type: String, required: true, default: "AivraSol Technologies (Mediqoo Cloud)" },
      product_line: { type: String, default: "AivraSol Pharmacy POS & Cloud Management Suite" },
      email: { type: String, default: "support@aivrasol.com" },
      phone: { type: String, default: "+92 300 0000000" },
      website: { type: String, default: "www.aivrasol.com" },
      address: { type: String, default: "Lahore, Pakistan" },
    },
    client_snapshot: {
      id: { type: String },
      name: { type: String, required: true },
      contact_name: { type: String },
      email: { type: String },
      phone: { type: String },
      address: { type: String },
      city: { type: String },
    },
    license_snapshot: {
      license_id: { type: String },
      license_key: { type: String },
      license_key_masked: { type: String },
      product_name: { type: String, default: "AivraSol Pharmacy POS" },
      project_name: { type: String },
      billing_model: { type: String, enum: ["fixed", "per_invoice"], default: "fixed" },
      plan_label: { type: String },
      billing_cycle: { type: String, default: "monthly" },
      allowed_seats: { type: Number, default: 1 },
      status_after_renewal: { type: String, default: "Active" },
    },
    period_snapshot: {
      previous_expiry: { type: Date, default: null },
      new_expiry: { type: Date, default: null },
      grace_until: { type: Date, default: null },
      renewal_start: { type: Date, default: null },
      renewal_end: { type: Date, default: null },
      extension_duration_label: { type: String, default: "Standard Cycle" },
      extension_days: { type: Number, default: null },
      is_lifetime: { type: Boolean, default: false },
    },
    financial_snapshot: {
      currency: { type: String, default: "PKR" },
      plan_charge: { type: Number, default: 0 },
      usage_invoice_count: { type: Number, default: 0 },
      usage_rate: { type: Number, default: 0 },
      invoice_overage_charge: { type: Number, default: 0 },
      arrears_included: { type: Number, default: 0 },
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      total_payable: { type: Number, default: 0 },
      amount_paid: { type: Number, default: 0 },
      remaining_balance: { type: Number, default: 0 },
    },
    payment_snapshot: {
      payment_id: { type: String, default: null },
      receipt_number: { type: String, default: null },
      payment_method: { type: String, default: "N/A" },
      transaction_reference: { type: String, default: null },
      paid_at: { type: Date, default: null },
      processed_by: { type: String, default: "Super Admin" },
      notes: { type: String, default: null },
      override_renewal: { type: Boolean, default: false },
      override_reason: { type: String, default: null },
    },
    verification_hash: { type: String, required: true },
    status: {
      type: String,
      enum: ["paid", "partially_paid", "payment_pending", "unpaid", "void"],
      required: true,
    },
    email_status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
    },
    email_sent_at: { type: Date },
    email_attempt_count: { type: Number, default: 0 },
    email_last_error: { type: String },
    idempotency_key: { type: String, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

LicenseRenewalInvoiceSchema.index({ license_id: 1, idempotency_key: 1 }, { unique: true });

if (mongoose.models.LicenseRenewalInvoice) {
  delete mongoose.models.LicenseRenewalInvoice;
}

export default mongoose.model<ILicenseRenewalInvoice>(
  "LicenseRenewalInvoice",
  LicenseRenewalInvoiceSchema
);
