import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface ILicense extends Document {
  id: string;
  client_id: string;
  project_id: string;
  license_key: string;
  seats: number;
  status: string;
  features: any;
  issued_at: Date;
  expires_at?: Date;
  revoked_at?: Date;
  revoked_reason?: string;
  machine_fingerprint?: string;
  notes?: string;
  issued_by?: string;
  license_version: number;
  grace_until?: Date;
  billing?: {
    enabled: boolean;
    /** Whether recurring subscription/usage billing is active. Undefined on legacy enabled docs defaults to true. */
    recurring_enabled?: boolean;
    /** Initial / one-time commercial settlement mode */
    setup_type?: "none" | "installation" | "lifetime";
    /** One-time installation & onboarding charges */
    installation_charges?: number;
    /** One-time lifetime license sale amount */
    lifetime_amount?: number;
    /** Amount received against installation or lifetime setup fee */
    setup_paid_amount?: number;
    setup_payment_status?: "paid" | "partially_paid" | "unpaid";
    setup_payment_method?: string;
    setup_payment_reference?: string;
    setup_paid_at?: Date | null;
    setup_voucher_id?: string | null;
    setup_notes?: string;
    /** 'fixed' = current subscription model; 'per_invoice' = pay per finalized invoice */
    model?: "fixed" | "per_invoice";
    amount?: number;
    /** Rate per billable invoice (PKR). Only meaningful when model='per_invoice'. */
    rate_per_invoice?: number;
    currency: string;
    cycle?: "monthly" | "yearly";
    grace_days: number;
    reminder_days: number[];
    /** Minimum POS app version required for per_invoice metering (semver string). */
    min_app_version?: string;
    /** Pending config changes scheduled for the next billing cycle. */
    pending_changes?: {
      model?: "fixed" | "per_invoice";
      amount?: number;
      rate_per_invoice?: number;
      effective_from?: Date;
    } | null;
  };
  backup_recovery_secret?: {
    encrypted_value: string;
    iv: string;
    tag: string;
    updated_at: Date;
    updated_by?: string;
  };
  /**
   * Super-Admin authorized Go-Live permission configuration for this specific license (legacy).
   */
  go_live?: {
    status: "not_enabled" | "enabled" | "completed";
    enabled_at?: Date | null;
    enabled_by?: string | null;
    completed_at?: Date | null;
    completed_by?: string | null;
    revoked_at?: Date | null;
    revoked_by?: string | null;
    notes?: string | null;
  };
  /**
   * Super-Admin authorized Fresh Start Reset permission configuration for this specific license.
   * Default status is "disabled". When enabled, the POS activated under this license displays the Fresh Start wizard.
   */
  fresh_start?: {
    status: "disabled" | "pending" | "enabled" | "completed" | "rejected";
    cycle_id?: string | null;
    authorization_version?: number;
    requested_at?: Date | null;
    requested_by?: string | null;
    app_version?: string | null;
    enabled_at?: Date | null;
    enabled_by?: string | null;
    completed_at?: Date | null;
    completed_by?: string | null;
    rejected_at?: Date | null;
    rejected_by?: string | null;
    rejection_reason?: string | null;
    revoked_at?: Date | null;
    revoked_by?: string | null;
    notes?: string | null;
  };
  created_at: Date;
  updated_at: Date;
}

const LicenseSchema = new Schema<ILicense>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true },
    project_id: { type: String, required: true },
    license_key: { type: String, required: true, unique: true },
    seats: { type: Number, default: 1 },
    status: { type: String, default: "active" },
    features: { type: Schema.Types.Mixed, default: {} },
    issued_at: { type: Date, default: Date.now },
    expires_at: { type: Date },
    revoked_at: { type: Date },
    revoked_reason: { type: String },
    machine_fingerprint: { type: String },
    notes: { type: String },
    issued_by: { type: String },
    license_version: { type: Number, default: 1 },
    grace_until: { type: Date },
    billing: {
      enabled: { type: Boolean, default: false },
      recurring_enabled: { type: Boolean, default: true },
      setup_type: { type: String, enum: ["none", "installation", "lifetime"], default: "none" },
      installation_charges: { type: Number, default: 0 },
      lifetime_amount: { type: Number, default: 0 },
      setup_paid_amount: { type: Number, default: 0 },
      setup_payment_status: { type: String, enum: ["paid", "partially_paid", "unpaid"], default: "unpaid" },
      setup_payment_method: { type: String },
      setup_payment_reference: { type: String },
      setup_paid_at: { type: Date, default: null },
      setup_voucher_id: { type: String, default: null },
      setup_notes: { type: String },
      model: { type: String, enum: ["fixed", "per_invoice"], default: "fixed" },
      amount: { type: Number },
      rate_per_invoice: { type: Number },
      currency: { type: String, default: "PKR" },
      cycle: { type: String, enum: ["monthly", "yearly"] },
      grace_days: { type: Number, default: 3 },
      reminder_days: { type: [Number], default: [1] },
      min_app_version: { type: String },
      pending_changes: {
        type: new Schema({
          model: { type: String, enum: ["fixed", "per_invoice"] },
          amount: { type: Number },
          rate_per_invoice: { type: Number },
          effective_from: { type: Date },
        }, { _id: false }),
        default: null,
      },
    },
    backup_recovery_secret: {
      type: new Schema({
        encrypted_value: { type: String, required: true },
        iv: { type: String, required: true },
        tag: { type: String, required: true },
        updated_at: { type: Date, default: Date.now },
        updated_by: { type: String },
      }, { _id: false }),
      default: null,
    },
    go_live: {
      type: new Schema({
        status: { type: String, enum: ["not_enabled", "enabled", "completed"], default: "not_enabled" },
        enabled_at: { type: Date, default: null },
        enabled_by: { type: String, default: null },
        completed_at: { type: Date, default: null },
        completed_by: { type: String, default: null },
        revoked_at: { type: Date, default: null },
        revoked_by: { type: String, default: null },
        notes: { type: String, default: null },
      }, { _id: false }),
      default: () => ({ status: "not_enabled" }),
    },
    fresh_start: {
      type: new Schema({
        status: { type: String, enum: ["disabled", "pending", "enabled", "completed", "rejected"], default: "disabled" },
        cycle_id: { type: String, default: null },
        authorization_version: { type: Number, default: 1 },
        requested_at: { type: Date, default: null },
        requested_by: { type: String, default: null },
        app_version: { type: String, default: null },
        enabled_at: { type: Date, default: null },
        enabled_by: { type: String, default: null },
        completed_at: { type: Date, default: null },
        completed_by: { type: String, default: null },
        rejected_at: { type: Date, default: null },
        rejected_by: { type: String, default: null },
        rejection_reason: { type: String, default: null },
        revoked_at: { type: Date, default: null },
        revoked_by: { type: String, default: null },
        notes: { type: String, default: null },
      }, { _id: false }),
      default: () => ({ status: "disabled" }),
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

LicenseSchema.virtual('clients', {
  ref: 'Client',
  localField: 'client_id',
  foreignField: 'id',
  justOne: true
});

LicenseSchema.virtual('projects', {
  ref: 'Project',
  localField: 'project_id',
  foreignField: 'id',
  justOne: true
});

import { calculateGraceUntil } from "@/lib/billing";

function shouldIncrementVersion(update: any) {
  if (!update) return false;
  // If the update already explicitly increments or sets license_version, don't double-increment
  if (update.$inc?.license_version || update.$set?.license_version !== undefined) return false;

  const setObj = update.$set || {};
  const unsetObj = update.$unset || {};

  const sensitiveFields = ["status", "expires_at", "grace_until", "seats", "features", "revoked_at"];
  const hasBillingChange = Object.keys(setObj).some(k => k === "billing" || k.startsWith("billing."));
  
  return sensitiveFields.some(field => setObj[field] !== undefined || unsetObj[field] !== undefined) || hasBillingChange;
}

async function recalculateGraceForUpdate(thisCtx: any) {
  const update = thisCtx.getUpdate();
  if (!update) return;
  const setObj = update.$set || {};
  
  const hasExpiryChange = setObj.expires_at !== undefined;
  const hasBillingChange = Object.keys(setObj).some(k => k === "billing" || k.startsWith("billing."));

  if (hasExpiryChange || hasBillingChange) {
    const doc = await thisCtx.model.findOne(thisCtx.getQuery());
    if (doc) {
      const expiresAt = hasExpiryChange ? setObj.expires_at : doc.expires_at;
      
      let graceDays = 0;
      if (setObj.billing !== undefined) {
         const isRec = Boolean(setObj.billing.enabled) && setObj.billing.recurring_enabled !== false;
         graceDays = isRec ? (setObj.billing.grace_days || 0) : 0;
      } else if (
         setObj["billing.grace_days"] !== undefined ||
         setObj["billing.enabled"] !== undefined ||
         setObj["billing.recurring_enabled"] !== undefined
      ) {
         const enabled = setObj["billing.enabled"] !== undefined ? setObj["billing.enabled"] : doc.billing?.enabled;
         const recEnabled = setObj["billing.recurring_enabled"] !== undefined ? setObj["billing.recurring_enabled"] : doc.billing?.recurring_enabled;
         const days = setObj["billing.grace_days"] !== undefined ? setObj["billing.grace_days"] : doc.billing?.grace_days;
         graceDays = (Boolean(enabled) && recEnabled !== false) ? (days || 0) : 0;
      } else {
         const isRec = Boolean(doc.billing?.enabled) && doc.billing?.recurring_enabled !== false;
         graceDays = isRec ? (doc.billing?.grace_days || 0) : 0;
      }

      const newGraceUntil = calculateGraceUntil(expiresAt, graceDays);
      
      if (!update.$set) update.$set = {};
      update.$set.grace_until = newGraceUntil;
    }
  }

  if (shouldIncrementVersion(update)) {
    thisCtx.setUpdate({ ...update, $inc: { ...(update.$inc || {}), license_version: 1 } });
  }
}

LicenseSchema.pre("findOneAndUpdate", async function () {
  await recalculateGraceForUpdate(this);
});

LicenseSchema.pre("updateOne", async function () {
  await recalculateGraceForUpdate(this);
});

LicenseSchema.pre("save", function () {
  if (this.isNew || this.isModified("expires_at") || this.isModified("billing")) {
    const isRec = Boolean(this.billing?.enabled) && this.billing?.recurring_enabled !== false;
    const graceDays = isRec ? (this.billing?.grace_days || 0) : 0;
    this.grace_until = calculateGraceUntil(this.expires_at, graceDays) as any;
  }

  if (
    this.isModified("status") ||
    this.isModified("expires_at") ||
    this.isModified("grace_until") ||
    this.isModified("seats") ||
    this.isModified("features") ||
    this.isModified("billing") ||
    this.isModified("revoked_at")
  ) {
    if (!this.isNew && !this.isModified("license_version")) {
      this.license_version = (this.license_version || 1) + 1;
    }
  }
});

export default mongoose.models.License || mongoose.model<ILicense>("License", LicenseSchema);
