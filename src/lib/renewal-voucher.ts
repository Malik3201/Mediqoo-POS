import crypto from "crypto";
import mongoose from "mongoose";
import Counter from "@/models/Counter";
import LicenseRenewalInvoice, {
  ILicenseRenewalInvoice,
  VoucherPaymentStatus,
} from "@/models/LicenseRenewalInvoice";
import License from "@/models/License";
import Client from "@/models/Client";
import Project from "@/models/Project";
import LicensePayment from "@/models/LicensePayment";
import {
  calculateNextPaymentDate,
  isRecurringBillingEnabled,
} from "@/lib/billing";
import { hasAcceptanceTerms } from "@/lib/voucher-presentation";

export interface CreateRenewalVoucherInput {
  license: any;
  client?: any;
  project?: any;
  payment?: any | null;
  action: "payment_and_renew" | "extend_only" | "payment_only" | "renew";
  idempotency_key: string;
  periods_settled?: number;
  billing_periods?: string[];
  currency?: string;
  plan_charge?: number;
  usage_invoice_count?: number;
  usage_rate?: number;
  invoice_overage_charge?: number;
  arrears_included?: number;
  subtotal?: number;
  discount?: number;
  tax?: number;
  total_payable: number;
  amount_paid: number;
  payment_method?: string;
  payment_reference?: string;
  old_expiry?: Date | string | null;
  new_expiry?: Date | string | null;
  grace_until?: Date | string | null;
  renewal_start?: Date | string | null;
  renewal_end?: Date | string | null;
  extension_months?: number;
  custom_expiry?: string;
  is_lifetime?: boolean;
  processed_by: string;
  notes?: string;
  override_renewal?: boolean;
  override_reason?: string;
  session?: mongoose.ClientSession;
}

export interface CreateActivationVoucherInput {
  license: any;
  client?: any;
  project?: any;
  payment?: any | null;
  action?: "installation_activation" | "lifetime_activation" | "billing_activation";
  idempotency_key: string;
  currency?: string;
  setup_type: "none" | "installation" | "lifetime";
  installation_charges?: number;
  lifetime_amount?: number;
  recurring_enabled: boolean;
  recurring_model?: "fixed" | "per_invoice" | null;
  recurring_cycle?: "monthly" | "yearly" | null;
  recurring_amount?: number;
  recurring_rate_per_invoice?: number;
  next_payment_date?: Date | string | null;
  discount?: number;
  tax?: number;
  total_payable: number;
  amount_paid: number;
  payment_method?: string;
  payment_reference?: string;
  processed_by: string;
  notes?: string;
  include_acceptance_terms?: boolean;
  session?: mongoose.ClientSession;
}

/**
 * Generates an atomic, unique voucher number: AV-RNW-YYYYMMDD-XXXX or AV-ACT-YYYYMMDD-XXXX
 */
export async function generateAtomicVoucherNumber(
  session?: mongoose.ClientSession,
  prefix: "AV-RNW" | "AV-ACT" = "AV-RNW"
): Promise<string> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const counterKey = `voucher_seq_${datePart}`;

  const counterDoc = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  const seqStr = String(counterDoc.seq || 1).padStart(4, "0");
  return `${prefix}-${datePart}-${seqStr}`;
}

/**
 * Strictly derives voucher payment status from actual payment settlement.
 * NEVER marks a voucher as "paid" merely because license expiry was extended.
 */
export function deriveVoucherPaymentStatus(params: {
  action: string;
  totalPayable: number;
  amountPaid: number;
}): VoucherPaymentStatus {
  const { action, totalPayable, amountPaid } = params;
  const isExtendOnly = action === "extend_only" || action === "renew_only";

  if (isExtendOnly) {
    return totalPayable > 0 ? "payment_pending" : "unpaid";
  }

  if (amountPaid <= 0) {
    return totalPayable > 0 ? "payment_pending" : "unpaid";
  }

  if (amountPaid < totalPayable) {
    return "partially_paid";
  }

  return "paid";
}

function maskLicenseKey(key?: string): string {
  if (!key) return "AIVRA-XXXX-XXXX";
  if (key.length <= 14) return key;
  return `${key.slice(0, 11)}•••••${key.slice(-5)}`;
}

function computeDurationLabel(input: {
  action: string;
  is_lifetime?: boolean;
  extension_months?: number;
  custom_expiry?: string;
  old_expiry?: Date | null;
  new_expiry?: Date | null;
  cycle?: string;
}): { label: string; days: number | null } {
  if (input.action === "payment_only") {
    return { label: "Payment Settlement Only (No Expiry Change)", days: 0 };
  }
  if (input.is_lifetime) {
    return { label: "Lifetime / Perpetual License", days: null };
  }
  const days =
    input.old_expiry && input.new_expiry
      ? Math.max(
          0,
          Math.round(
            (input.new_expiry.getTime() - input.old_expiry.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

  if (typeof input.extension_months === "number" && input.extension_months > 0) {
    const m = input.extension_months;
    const label =
      m === 12
        ? "+1 Year (12 Months)"
        : m === 1
        ? "+1 Month"
        : `+${m} Months`;
    return { label, days };
  }
  if (input.custom_expiry) {
    return { label: `Custom Extension (${days ?? "—"} days)`, days };
  }
  const cycle = input.cycle === "yearly" ? "+1 Year (Standard Cycle)" : "+1 Month (Standard Cycle)";
  return { label: cycle, days };
}

/**
 * Creates or returns an idempotent immutable LicenseRenewalInvoice (Voucher) record.
 */
export async function createOrGetRenewalVoucher(
  input: CreateRenewalVoucherInput
): Promise<ILicenseRenewalInvoice> {
  const existing = await LicenseRenewalInvoice.findOne({
    license_id: input.license.id,
    idempotency_key: input.idempotency_key,
  }).session(input.session || null);

  if (existing) {
    return existing;
  }

  // Fetch client & project if not already populated
  let clientDoc = input.client || (input.license as any).clients;
  if (!clientDoc || typeof clientDoc !== "object" || !clientDoc.name) {
    clientDoc = await Client.findOne({ id: input.license.client_id })
      .session(input.session || null)
      .lean();
  }

  let projectDoc = input.project || (input.license as any).projects;
  if (!projectDoc || typeof projectDoc !== "object" || !projectDoc.name) {
    projectDoc = await Project.findOne({ id: input.license.project_id })
      .session(input.session || null)
      .lean();
  }

  const voucherNumber = await generateAtomicVoucherNumber(input.session);

  const totalPayable = Math.max(0, Number(input.total_payable || 0));
  const amountPaid = Math.max(0, Number(input.amount_paid || 0));
  const remainingBalance = Math.max(0, totalPayable - amountPaid);
  const discount = Math.max(0, Number(input.discount || 0));
  const tax = Math.max(0, Number(input.tax || 0));
  const subtotal =
    input.subtotal !== undefined
      ? Number(input.subtotal)
      : Math.max(0, totalPayable + discount - tax);

  const status = deriveVoucherPaymentStatus({
    action: input.action,
    totalPayable,
    amountPaid,
  });

  const oldExp = input.old_expiry ? new Date(input.old_expiry) : null;
  const newExp = input.new_expiry ? new Date(input.new_expiry) : null;
  const graceUntil = input.grace_until ? new Date(input.grace_until) : null;
  const renewalStart = input.renewal_start
    ? new Date(input.renewal_start)
    : oldExp && oldExp.getTime() > Date.now()
    ? oldExp
    : new Date();
  const renewalEnd = input.renewal_end ? new Date(input.renewal_end) : newExp;

  const billingModel: "fixed" | "per_invoice" =
    input.license.billing?.model === "per_invoice" ? "per_invoice" : "fixed";
  const cycle = input.license.billing?.cycle || "monthly";
  const currency = input.currency || input.license.billing?.currency || "PKR";

  const durationInfo = computeDurationLabel({
    action: input.action,
    is_lifetime: input.is_lifetime,
    extension_months: input.extension_months,
    custom_expiry: input.custom_expiry,
    old_expiry: oldExp,
    new_expiry: newExp,
    cycle,
  });

  const isExtendOnly = input.action === "extend_only";
  const effectivePaymentMethod = isExtendOnly
    ? "Manual Extension — No Payment Recorded"
    : input.payment_method || "Bank Transfer";

  const verificationPayload = `${voucherNumber}|${input.license.id}|${input.license.client_id}|${amountPaid}|${totalPayable}|${status}`;
  const verificationHash = crypto
    .createHash("sha256")
    .update(verificationPayload)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  const planCharge =
    input.plan_charge !== undefined
      ? Number(input.plan_charge)
      : billingModel === "fixed"
      ? Number(input.license.billing?.amount || totalPayable)
      : 0;

  const invoiceOverageCharge =
    input.invoice_overage_charge !== undefined
      ? Number(input.invoice_overage_charge)
      : billingModel === "per_invoice"
      ? Number(input.subtotal ?? totalPayable)
      : 0;

  const arrearsIncluded =
    input.arrears_included !== undefined
      ? Number(input.arrears_included)
      : Math.max(0, subtotal - planCharge - invoiceOverageCharge);

  const created = await LicenseRenewalInvoice.create(
    [
      {
        invoice_number: voucherNumber,
        voucher_number: voucherNumber,
        client_id: input.license.client_id,
        license_id: input.license.id,
        payment_id: input.payment?.id || null,
        action:
          input.action === "renew" ? "payment_and_renew" : input.action,
        issued_at: new Date(),
        periods_settled: input.periods_settled ?? 1,
        billing_periods: input.billing_periods ?? [],
        currency,
        subtotal,
        discount,
        tax,
        total_due: totalPayable,
        amount_paid: amountPaid,
        balance: remainingBalance,
        payment_method: effectivePaymentMethod,
        payment_reference: input.payment_reference || undefined,
        old_expiry: oldExp,
        new_expiry: newExp,
        seller_snapshot: {
          name: "AivraSol Technologies (Mediqoo Cloud)",
          product_line: "AivraSol Pharmacy POS & Cloud Management Suite",
          email: process.env.SMTP_FROM || "support@aivrasol.com",
          phone: "+92 300 0000000",
          website: "www.aivrasol.com",
          address: "Lahore, Pakistan",
        },
        client_snapshot: {
          id: input.license.client_id,
          name: clientDoc?.name || input.license.client_snapshot?.name || "Pharmacy Client",
          contact_name:
            clientDoc?.contact_name ||
            input.license.client_snapshot?.contact_name ||
            "",
          email:
            clientDoc?.contact_email ||
            input.license.client_snapshot?.email ||
            "",
          phone:
            clientDoc?.contact_phone ||
            input.license.client_snapshot?.phone ||
            "",
          address:
            clientDoc?.address ||
            input.license.client_snapshot?.address ||
            "",
        },
        license_snapshot: {
          license_id: input.license.id,
          license_key: input.license.license_key,
          license_key_masked: maskLicenseKey(input.license.license_key),
          product_name: "AivraSol Pharmacy POS",
          project_name: projectDoc?.name || "AivraSol Pharmacy POS",
          billing_model: billingModel,
          plan_label:
            billingModel === "per_invoice"
              ? `Pay Per Invoice (${currency} ${
                  input.usage_rate || input.license.billing?.rate_per_invoice || 1
                }/invoice)`
              : `Fixed Subscription (${currency} ${(
                  input.license.billing?.amount || 0
                ).toLocaleString()}/${cycle === "yearly" ? "yr" : "mo"})`,
          billing_cycle: cycle,
          allowed_seats: Number(input.license.seats || 1),
          status_after_renewal: "Active",
        },
        period_snapshot: {
          previous_expiry: oldExp,
          new_expiry: newExp,
          grace_until: graceUntil,
          renewal_start: renewalStart,
          renewal_end: renewalEnd,
          extension_duration_label: durationInfo.label,
          extension_days: durationInfo.days,
          is_lifetime: Boolean(input.is_lifetime),
        },
        financial_snapshot: {
          currency,
          plan_charge: planCharge,
          usage_invoice_count: Number(input.usage_invoice_count || 0),
          usage_rate: Number(
            input.usage_rate || input.license.billing?.rate_per_invoice || 0
          ),
          invoice_overage_charge: invoiceOverageCharge,
          arrears_included: arrearsIncluded,
          subtotal,
          discount,
          tax,
          total_payable: totalPayable,
          amount_paid: amountPaid,
          remaining_balance: remainingBalance,
        },
        payment_snapshot: {
          payment_id: input.payment?.id || null,
          receipt_number: input.payment?.receipt_number || voucherNumber,
          payment_method: effectivePaymentMethod,
          transaction_reference: input.payment_reference || null,
          paid_at: amountPaid > 0 ? input.payment?.paid_at || new Date() : null,
          processed_by: input.processed_by || "Super Admin",
          notes: input.notes || null,
          override_renewal: Boolean(input.override_renewal),
          override_reason: input.override_reason || null,
        },
        verification_hash: verificationHash,
        status,
        email_status: amountPaid > 0 ? "pending" : "skipped",
        email_attempt_count: 0,
        idempotency_key: input.idempotency_key,
      },
    ],
    input.session ? { session: input.session } : undefined
  );

  return created[0];
}

/**
 * Resolves a voucher by its `id`, `invoice_number`, or `payment_id` (including Mongo `_id`).
 * If a historical `LicensePayment` exists without a `LicenseRenewalInvoice` document,
 * hydrates a read-only voucher object on the fly so older payments also render in the new voucher view.
 */
export async function resolveOrHydrateVoucher(identifier: string): Promise<any | null> {
  // 1. Check LicenseRenewalInvoice directly
  const queryOr: any[] = [
    { id: identifier },
    { invoice_number: identifier },
    { voucher_number: identifier },
    { payment_id: identifier },
  ];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    queryOr.push({ _id: identifier });
  }

  const voucherDoc = await LicenseRenewalInvoice.findOne({ $or: queryOr }).lean();
  if (voucherDoc) {
    return voucherDoc;
  }

  // 2. Fallback: Check LicensePayment for historical payments recorded before LicenseRenewalInvoice was used
  const paymentOr: any[] = [{ id: identifier }, { receipt_number: identifier }];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    paymentOr.push({ _id: identifier });
  }

  const payment = (await LicensePayment.findOne({ $or: paymentOr }).lean()) as any;
  if (!payment) return null;

  const license = (await License.findOne({ id: payment.license_id }).lean()) as any;
  const client = license
    ? ((await Client.findOne({ id: license.client_id }).lean()) as any)
    : null;
  const project = license
    ? ((await Project.findOne({ id: license.project_id }).lean()) as any)
    : null;

  const totalPayable = Number(payment.outstanding_before ?? payment.amount_paid ?? 0);
  const amountPaid = Number(payment.amount_paid ?? 0);
  const remainingBalance = Math.max(
    0,
    Number(payment.outstanding_after ?? totalPayable - amountPaid)
  );
  const status = deriveVoucherPaymentStatus({
    action: payment.action || "payment_and_renew",
    totalPayable,
    amountPaid,
  });

  const billingModel: "fixed" | "per_invoice" =
    license?.billing?.model === "per_invoice" ? "per_invoice" : "fixed";
  const currency = payment.currency || license?.billing?.currency || "PKR";
  const cycle = license?.billing?.cycle || "monthly";
  const voucherNo = payment.receipt_number || `AV-RNW-${payment.id.slice(0, 8).toUpperCase()}`;

  const verificationHash = crypto
    .createHash("sha256")
    .update(`${voucherNo}|${payment.license_id}|${amountPaid}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  return {
    id: payment.id,
    invoice_number: voucherNo,
    voucher_number: voucherNo,
    client_id: payment.client_id,
    license_id: payment.license_id,
    payment_id: payment.id,
    action: payment.action || "payment_and_renew",
    issued_at: payment.paid_at || payment.created_at,
    periods_settled: payment.billing_period_ids?.length || 1,
    billing_periods: payment.billing_period_ids || [],
    currency,
    subtotal: totalPayable,
    discount: 0,
    tax: 0,
    total_due: totalPayable,
    amount_paid: amountPaid,
    balance: remainingBalance,
    payment_method: payment.payment_method || "Bank Transfer",
    payment_reference: payment.payment_reference || null,
    old_expiry: null,
    new_expiry: license?.expires_at || null,
    seller_snapshot: {
      name: "AivraSol Technologies (Mediqoo Cloud)",
      product_line: "AivraSol Pharmacy POS & Cloud Management Suite",
      email: process.env.SMTP_FROM || "support@aivrasol.com",
      phone: "+92 300 0000000",
      website: "www.aivrasol.com",
      address: "Lahore, Pakistan",
    },
    client_snapshot: {
      id: payment.client_id,
      name: client?.name || "Pharmacy Client",
      contact_name: client?.contact_name || "",
      email: client?.contact_email || "",
      phone: client?.contact_phone || "",
      address: client?.address || "",
    },
    license_snapshot: {
      license_id: payment.license_id,
      license_key: license?.license_key || "",
      license_key_masked: maskLicenseKey(license?.license_key),
      product_name: "AivraSol Pharmacy POS",
      project_name: project?.name || "AivraSol Pharmacy POS",
      billing_model: billingModel,
      plan_label:
        billingModel === "per_invoice"
          ? `Pay Per Invoice (${currency} ${payment.rate_snapshot || license?.billing?.rate_per_invoice || 1}/invoice)`
          : `Fixed Subscription (${currency} ${(license?.billing?.amount || amountPaid).toLocaleString()}/${cycle === "yearly" ? "yr" : "mo"})`,
      billing_cycle: cycle,
      allowed_seats: Number(license?.seats || 1),
      status_after_renewal: "Active",
    },
    period_snapshot: {
      previous_expiry: null,
      new_expiry: license?.expires_at || null,
      grace_until: license?.grace_until || null,
      renewal_start: payment.paid_at || null,
      renewal_end: license?.expires_at || null,
      extension_duration_label:
        payment.action === "payment_only"
          ? "Payment Settlement Only"
          : cycle === "yearly"
          ? "+1 Year"
          : "+1 Month",
      extension_days: null,
      is_lifetime: !license?.expires_at,
    },
    financial_snapshot: {
      currency,
      plan_charge: billingModel === "fixed" ? totalPayable : 0,
      usage_invoice_count: Number(payment.usage_count_snapshot || 0),
      usage_rate: Number(payment.rate_snapshot || 0),
      invoice_overage_charge:
        billingModel === "per_invoice" ? Number(payment.usage_amount_snapshot || totalPayable) : 0,
      arrears_included: 0,
      subtotal: totalPayable,
      discount: 0,
      tax: 0,
      total_payable: totalPayable,
      amount_paid: amountPaid,
      remaining_balance: remainingBalance,
    },
    payment_snapshot: {
      payment_id: payment.id,
      receipt_number: payment.receipt_number || voucherNo,
      payment_method: payment.payment_method || "Bank Transfer",
      transaction_reference: payment.payment_reference || null,
      paid_at: payment.paid_at,
      processed_by: payment.recorded_by || "Super Admin",
      notes: payment.notes || null,
      override_renewal: false,
      override_reason: null,
    },
    verification_hash: verificationHash,
    status,
    email_status: payment.email_status || "sent",
    idempotency_key: payment.idempotency_key,
  };
}

/**
 * Resolves populated Client & Project snapshots safely for any license.
 */
async function resolveClientAndProject(
  license: any,
  clientOverride?: any,
  projectOverride?: any,
  session?: mongoose.ClientSession
) {
  let clientDoc = clientOverride || license?.clients;
  if (!clientDoc || typeof clientDoc !== "object" || !clientDoc.name) {
    clientDoc = license?.client_id
      ? await Client.findOne({ id: license.client_id })
          .session(session || null)
          .lean()
      : null;
  }

  let projectDoc = projectOverride || license?.projects;
  if (!projectDoc || typeof projectDoc !== "object" || !projectDoc.name) {
    projectDoc = license?.project_id
      ? await Project.findOne({ id: license.project_id })
          .session(session || null)
          .lean()
      : null;
  }

  return { clientDoc, projectDoc };
}

/**
 * Creates an immutable Activation / Installation / Lifetime Payment Voucher
 * and stores complete setup, recurring schedule, next payment date (from license expiry),
 * and acknowledgment/confidentiality flags.
 */
export async function createOrGetActivationVoucher(
  input: CreateActivationVoucherInput
): Promise<ILicenseRenewalInvoice> {
  const existing = await LicenseRenewalInvoice.findOne({
    license_id: input.license.id,
    idempotency_key: input.idempotency_key,
  }).session(input.session || null);

  if (existing) {
    return existing;
  }

  const { clientDoc, projectDoc } = await resolveClientAndProject(
    input.license,
    input.client,
    input.project,
    input.session
  );

  const voucherNumber = await generateAtomicVoucherNumber(input.session, "AV-ACT");
  const currency = input.currency || input.license.billing?.currency || "PKR";

  const installCharge =
    input.setup_type === "installation"
      ? Math.max(0, Number(input.installation_charges || 0))
      : 0;
  const lifetimeCharge =
    input.setup_type === "lifetime"
      ? Math.max(0, Number(input.lifetime_amount || 0))
      : 0;

  const totalPayable = Math.max(0, Number(input.total_payable || 0));
  const amountPaid = Math.max(0, Number(input.amount_paid || 0));
  const remainingBalance = Math.max(0, totalPayable - amountPaid);
  const discount = Math.max(0, Number(input.discount || 0));
  const tax = Math.max(0, Number(input.tax || 0));
  const subtotal = Math.max(0, installCharge + lifetimeCharge || totalPayable + discount - tax);

  const status: VoucherPaymentStatus =
    amountPaid <= 0
      ? totalPayable > 0
        ? "payment_pending"
        : "unpaid"
      : amountPaid < totalPayable
      ? "partially_paid"
      : "paid";

  const isLifetime =
    input.setup_type === "lifetime" || !input.license?.expires_at;

  const licenseExpiry = input.license?.expires_at
    ? new Date(input.license.expires_at)
    : null;

  const recurringEnabled = Boolean(input.recurring_enabled);
  const nextPaymentDate = recurringEnabled
    ? input.next_payment_date !== undefined
      ? input.next_payment_date
        ? new Date(input.next_payment_date)
        : null
      : calculateNextPaymentDate({
          expires_at: licenseExpiry,
          billing: {
            enabled: true,
            recurring_enabled: true,
            cycle: input.recurring_cycle || input.license.billing?.cycle || "monthly",
          },
        })
    : null;

  const billingModel: "fixed" | "per_invoice" | "none" = !recurringEnabled
    ? "none"
    : input.recurring_model === "per_invoice"
    ? "per_invoice"
    : "fixed";

  const cycle = input.recurring_cycle || input.license.billing?.cycle || "monthly";
  const recurringAmount =
    recurringEnabled && billingModel === "fixed"
      ? Number(input.recurring_amount ?? input.license.billing?.amount ?? 0)
      : 0;
  const recurringRate =
    recurringEnabled && billingModel === "per_invoice"
      ? Number(
          input.recurring_rate_per_invoice ??
            input.license.billing?.rate_per_invoice ??
            1
        )
      : 0;

  const action =
    input.action ||
    (input.setup_type === "lifetime"
      ? "lifetime_activation"
      : input.setup_type === "installation"
      ? "installation_activation"
      : "billing_activation");

  const planLabel = !recurringEnabled
    ? input.setup_type === "lifetime"
      ? "Lifetime Settled (No Recurring Billing)"
      : "One-Time Installation Only (No Recurring)"
    : billingModel === "per_invoice"
    ? `Pay Per Invoice (${currency} ${recurringRate}/invoice)`
    : `Fixed Subscription (${currency} ${recurringAmount.toLocaleString()}/${
        cycle === "yearly" ? "yr" : "mo"
      })`;

  const verificationPayload = `${voucherNumber}|${input.license.id}|${input.license.client_id}|${amountPaid}|${totalPayable}|${status}`;
  const verificationHash = crypto
    .createHash("sha256")
    .update(verificationPayload)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  const durationLabel =
    input.setup_type === "lifetime"
      ? "Lifetime / Perpetual Ownership"
      : recurringEnabled
      ? `Activated (${cycle === "yearly" ? "Yearly" : "Monthly"} Schedule)`
      : "One-Time Software Installation";

  const includeTerms =
    input.include_acceptance_terms !== undefined
      ? Boolean(input.include_acceptance_terms)
      : true;

  const created = await LicenseRenewalInvoice.create(
    [
      {
        invoice_number: voucherNumber,
        voucher_number: voucherNumber,
        client_id: input.license.client_id,
        license_id: input.license.id,
        payment_id: input.payment?.id || null,
        action,
        voucher_category: "activation",
        issued_at: new Date(),
        periods_settled: 0,
        billing_periods: [],
        currency,
        subtotal,
        discount,
        tax,
        total_due: totalPayable,
        amount_paid: amountPaid,
        balance: remainingBalance,
        payment_method:
          amountPaid > 0 ? input.payment_method || "Bank Transfer" : "Pending Settlement",
        payment_reference: input.payment_reference || undefined,
        old_expiry: licenseExpiry,
        new_expiry: licenseExpiry,
        seller_snapshot: {
          name: "AivraSol Technologies (Mediqoo Cloud)",
          product_line: "AivraSol Pharmacy POS & Cloud Management Suite",
          email: process.env.SMTP_FROM || "support@aivrasol.com",
          phone: "+92 300 0000000",
          website: "www.aivrasol.com",
          address: "Lahore, Pakistan",
        },
        client_snapshot: {
          id: input.license.client_id,
          name: clientDoc?.name || input.license.client_snapshot?.name || "Pharmacy Client",
          contact_name:
            clientDoc?.contact_name ||
            input.license.client_snapshot?.contact_name ||
            "",
          email:
            clientDoc?.contact_email ||
            input.license.client_snapshot?.email ||
            "",
          phone:
            clientDoc?.contact_phone ||
            input.license.client_snapshot?.phone ||
            "",
          address:
            clientDoc?.address ||
            input.license.client_snapshot?.address ||
            "",
        },
        license_snapshot: {
          license_id: input.license.id,
          license_key: input.license.license_key,
          license_key_masked: maskLicenseKey(input.license.license_key),
          product_name: "AivraSol Pharmacy POS",
          project_name: projectDoc?.name || "AivraSol Pharmacy POS",
          billing_model: billingModel,
          plan_label: planLabel,
          billing_cycle: recurringEnabled ? cycle : "one_time",
          allowed_seats: Number(input.license.seats || 1),
          status_after_renewal: input.license.status === "active" ? "Active" : input.license.status || "Active",
        },
        setup_snapshot: {
          setup_type: input.setup_type,
          installation_charges: installCharge,
          lifetime_amount: lifetimeCharge,
          recurring_enabled: recurringEnabled,
          recurring_model: recurringEnabled ? (billingModel === "none" ? "fixed" : billingModel) : null,
          recurring_cycle: recurringEnabled ? cycle : null,
          recurring_amount: recurringAmount,
          recurring_rate_per_invoice: recurringRate,
          next_payment_date: nextPaymentDate,
          include_acceptance_terms: includeTerms,
        },
        period_snapshot: {
          previous_expiry: licenseExpiry,
          new_expiry: licenseExpiry,
          grace_until: input.license.grace_until || null,
          renewal_start: new Date(),
          renewal_end: licenseExpiry,
          extension_duration_label: durationLabel,
          extension_days: null,
          is_lifetime: isLifetime && !licenseExpiry,
        },
        financial_snapshot: {
          currency,
          installation_charge: installCharge,
          lifetime_charge: lifetimeCharge,
          plan_charge: 0,
          usage_invoice_count: 0,
          usage_rate: recurringRate,
          invoice_overage_charge: 0,
          arrears_included: 0,
          subtotal,
          discount,
          tax,
          total_payable: totalPayable,
          amount_paid: amountPaid,
          remaining_balance: remainingBalance,
        },
        payment_snapshot: {
          payment_id: input.payment?.id || null,
          receipt_number: input.payment?.receipt_number || voucherNumber,
          payment_method:
            amountPaid > 0 ? input.payment_method || "Bank Transfer" : "Pending Settlement",
          transaction_reference: input.payment_reference || null,
          paid_at: amountPaid > 0 ? input.payment?.paid_at || new Date() : null,
          processed_by: input.processed_by || "Super Admin",
          notes: input.notes || null,
          override_renewal: false,
          override_reason: null,
        },
        verification_hash: verificationHash,
        status,
        email_status: "pending",
        email_attempt_count: 0,
        idempotency_key: input.idempotency_key,
      },
    ],
    input.session ? { session: input.session } : undefined
  );

  return created[0];
}

/**
 * Ensures any old/historical LicensePayment record has a persisted LicenseRenewalInvoice voucher.
 * Supports 1-click voucher generation on legacy payment records.
 */
export async function persistVoucherFromHistoricalPayment(
  paymentIdentifier: string,
  options?: { includeAcceptanceTerms?: boolean }
): Promise<ILicenseRenewalInvoice | null> {
  const paymentOr: any[] = [{ id: paymentIdentifier }, { receipt_number: paymentIdentifier }];
  if (mongoose.Types.ObjectId.isValid(paymentIdentifier)) {
    paymentOr.push({ _id: paymentIdentifier });
  }
  const payment = (await LicensePayment.findOne({ $or: paymentOr }).lean()) as any;
  if (!payment) return null;

  // Return existing persisted voucher if already created
  const existingVoucher = await LicenseRenewalInvoice.findOne({
    $or: [{ payment_id: payment.id }, { idempotency_key: payment.idempotency_key }],
  });
  if (existingVoucher) {
    if (
      options?.includeAcceptanceTerms !== undefined &&
      (!existingVoucher.setup_snapshot ||
        existingVoucher.setup_snapshot.include_acceptance_terms !==
          options.includeAcceptanceTerms)
    ) {
      existingVoucher.setup_snapshot = {
        ...(existingVoucher.setup_snapshot || {
          setup_type: "none",
          installation_charges: 0,
          lifetime_amount: 0,
          recurring_enabled: true,
        }),
        include_acceptance_terms: options.includeAcceptanceTerms,
      } as any;
      await existingVoucher.save();
    }
    return existingVoucher;
  }

  const hydrated = await resolveOrHydrateVoucher(payment.id);
  if (!hydrated) return null;

  const voucherNumber =
    hydrated.voucher_number || (await generateAtomicVoucherNumber());

  const license = (await License.findOne({ id: payment.license_id }).lean()) as any;
  const recurringEnabled = license ? isRecurringBillingEnabled(license.billing) : true;
  const nextPayDate = license ? calculateNextPaymentDate(license) : null;

  const doc = await LicenseRenewalInvoice.create({
    ...hydrated,
    invoice_number: voucherNumber,
    voucher_number: voucherNumber,
    idempotency_key: payment.idempotency_key || `legacy_pay_${payment.id}`,
    voucher_category: hydrated.voucher_category || "renewal",
    setup_snapshot: hydrated.setup_snapshot || {
      setup_type: license?.billing?.setup_type || "none",
      installation_charges: Number(license?.billing?.installation_charges || 0),
      lifetime_amount: Number(license?.billing?.lifetime_amount || 0),
      recurring_enabled: recurringEnabled,
      recurring_model: recurringEnabled ? (license?.billing?.model || "fixed") : null,
      recurring_cycle: recurringEnabled ? (license?.billing?.cycle || "monthly") : null,
      recurring_amount: Number(license?.billing?.amount || 0),
      recurring_rate_per_invoice: Number(license?.billing?.rate_per_invoice || 0),
      next_payment_date: nextPayDate,
      include_acceptance_terms: Boolean(
        options?.includeAcceptanceTerms ?? hasAcceptanceTerms(hydrated)
      ),
    },
    email_status: payment.email_status || "pending",
    email_attempt_count: 0,
  });

  if (!payment.receipt_number) {
    await LicensePayment.updateOne(
      { _id: payment._id },
      { $set: { receipt_number: voucherNumber } }
    );
  }

  return doc;
}

