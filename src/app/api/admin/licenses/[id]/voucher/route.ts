import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import crypto from "crypto";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicensePayment from "@/models/LicensePayment";
import LicenseRenewalInvoice from "@/models/LicenseRenewalInvoice";
import {
  calculateNextPaymentDate,
  isRecurringBillingEnabled,
  resolveBillingModel,
} from "@/lib/billing";
import { createOrGetActivationVoucher } from "@/lib/renewal-voucher";
import { sendVoucherEmail } from "@/lib/email";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await connectToDatabase();

    const body = await req.json().catch(() => ({}));
    const license = await License.findOne({ id });
    if (!license) {
      return NextResponse.json({ error: "License not found" }, { status: 404 });
    }

    const hasExplicitOverrides =
      body.setup_type !== undefined ||
      body.installation_charges !== undefined ||
      body.lifetime_amount !== undefined ||
      body.amount_paid !== undefined ||
      body.total_payable !== undefined;

    // Return existing activation voucher when invoked as a 1-click view/reuse action
    if (body.force_new !== true && !hasExplicitOverrides) {
      let existingVoucher = license.billing?.setup_voucher_id
        ? await LicenseRenewalInvoice.findOne({
            id: license.billing.setup_voucher_id,
          })
        : null;

      if (!existingVoucher) {
        existingVoucher = await LicenseRenewalInvoice.findOne({
          license_id: license.id,
          voucher_category: "activation",
        }).sort({ issued_at: -1 });
      }

      if (existingVoucher) {
        let emailResult: any = null;
        if (body.send_email === true) {
          try {
            emailResult = await sendVoucherEmail(existingVoucher.id, {
              recipientEmail: body.recipient_email,
            });
          } catch (err: any) {
            emailResult = {
              sent: false,
              error: err?.message || "Email failed",
            };
          }
        }

        const existingObj = existingVoucher.toJSON();
        if (emailResult) {
          existingObj.email_status = emailResult.sent
            ? "sent"
            : emailResult.reason
            ? "skipped"
            : "failed";
        }

        return NextResponse.json({
          success: true,
          reused: true,
          voucher: existingObj,
          email_result: emailResult,
        });
      }
    }

    const adminIdentity =
      (token.email as string) || (token.name as string) || "Super Admin";

    const recurringEnabled =
      body.recurring_enabled !== undefined
        ? Boolean(body.recurring_enabled)
        : isRecurringBillingEnabled(license.billing);

    const savedSetupType = license.billing?.setup_type || "none";
    const inferredSetupType: "none" | "installation" | "lifetime" =
      body.setup_type === "installation" ||
      body.setup_type === "lifetime" ||
      body.setup_type === "none"
        ? body.setup_type
        : savedSetupType !== "none"
        ? savedSetupType
        : !license.expires_at && !recurringEnabled
        ? "lifetime"
        : Number(license.billing?.installation_charges || 0) > 0
        ? "installation"
        : "none";

    const installationCharges =
      inferredSetupType === "installation"
        ? Math.max(
            0,
            Number(
              body.installation_charges ??
                license.billing?.installation_charges ??
                0
            ) || 0
          )
        : 0;

    const lifetimeAmount =
      inferredSetupType === "lifetime"
        ? Math.max(
            0,
            Number(
              body.lifetime_amount ?? license.billing?.lifetime_amount ?? 0
            ) || 0
          )
        : 0;

    const recurringModel: "fixed" | "per_invoice" =
      body.recurring_model === "per_invoice" ||
      body.recurring_model === "fixed"
        ? body.recurring_model
        : resolveBillingModel(license.billing);
    const recurringCycle: "monthly" | "yearly" =
      body.recurring_cycle === "yearly" || body.recurring_cycle === "monthly"
        ? body.recurring_cycle
        : (license.billing?.cycle as "monthly" | "yearly") || "monthly";
    const recurringAmount =
      recurringEnabled && recurringModel === "fixed"
        ? Math.max(
            0,
            Number(body.recurring_amount ?? license.billing?.amount ?? 0) || 0
          )
        : 0;
    const recurringRate =
      recurringEnabled && recurringModel === "per_invoice"
        ? Math.max(
            0,
            Number(
              body.recurring_rate_per_invoice ??
                license.billing?.rate_per_invoice ??
                0
            ) || 0
          )
        : 0;

    const setupTotal =
      inferredSetupType === "installation"
        ? installationCharges
        : inferredSetupType === "lifetime"
        ? lifetimeAmount
        : 0;

    const totalPayable =
      body.total_payable !== undefined
        ? Math.max(0, Number(body.total_payable) || 0)
        : setupTotal > 0
        ? setupTotal
        : recurringEnabled && recurringModel === "fixed"
        ? recurringAmount
        : 0;

    const amountPaid =
      body.amount_paid !== undefined
        ? Math.max(0, Number(body.amount_paid) || 0)
        : license.billing?.setup_paid_amount !== undefined
        ? Math.max(0, Number(license.billing.setup_paid_amount) || 0)
        : 0;

    const currency =
      body.currency || license.billing?.currency || "PKR";
    const paymentMethod =
      body.payment_method ||
      license.billing?.setup_payment_method ||
      "Cash";
    const paymentReference =
      body.payment_reference ?? license.billing?.setup_payment_reference;
    const notes = body.notes ?? license.billing?.setup_notes;

    // Resolve or optionally record setup payment
    let linkedPayment: any = null;
    if (body.payment_id) {
      linkedPayment = await LicensePayment.findOne({ id: body.payment_id });
    } else if (body.record_payment === true && amountPaid > 0) {
      const payIdem = `setup-pay:${license.id}:${
        body.idempotency_key || crypto.randomUUID()
      }`;
      linkedPayment = await LicensePayment.findOne({
        license_id: license.id,
        idempotency_key: payIdem,
      });
      if (!linkedPayment) {
        linkedPayment = await LicensePayment.create({
          client_id: license.client_id,
          license_id: license.id,
          billing_period_id: "one_time_setup",
          billing_period_ids: [],
          amount_paid: amountPaid,
          currency,
          paid_at: new Date(),
          payment_method: paymentMethod,
          payment_reference: paymentReference || undefined,
          idempotency_key: payIdem,
          notes:
            notes ||
            (inferredSetupType === "lifetime"
              ? "Lifetime license payment voucher"
              : "Software installation charges voucher"),
          recorded_by: adminIdentity,
          receipt_number: `AV-SET-${crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase()}`,
          action:
            inferredSetupType === "lifetime"
              ? "lifetime_activation"
              : "installation_activation",
          email_status: "pending",
        });
      }
    } else {
      linkedPayment = await LicensePayment.findOne({
        license_id: license.id,
        billing_period_id: "one_time_setup",
      }).sort({ paid_at: -1 });
    }

    const voucherIdemKey = body.idempotency_key
      ? `lic-voucher:${license.id}:${body.idempotency_key}`
      : `lic-voucher:${license.id}:${crypto.randomUUID()}`;

    const nextPaymentDate = recurringEnabled
      ? body.next_payment_date !== undefined
        ? body.next_payment_date
        : calculateNextPaymentDate(license)
      : null;

    const voucher = await createOrGetActivationVoucher({
      license: license.toObject ? license.toObject() : license,
      payment: linkedPayment,
      action:
        inferredSetupType === "lifetime"
          ? "lifetime_activation"
          : inferredSetupType === "installation"
          ? "installation_activation"
          : "billing_activation",
      idempotency_key: voucherIdemKey,
      currency,
      setup_type: inferredSetupType,
      installation_charges: installationCharges,
      lifetime_amount: lifetimeAmount,
      recurring_enabled: recurringEnabled,
      recurring_model: recurringEnabled ? recurringModel : null,
      recurring_cycle: recurringEnabled ? recurringCycle : null,
      recurring_amount: recurringAmount,
      recurring_rate_per_invoice: recurringRate,
      next_payment_date: nextPaymentDate,
      discount: Number(body.discount || 0),
      tax: Number(body.tax || 0),
      total_payable: totalPayable,
      amount_paid: amountPaid,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      processed_by: adminIdentity,
      notes,
      include_acceptance_terms:
        body.include_acceptance_terms !== undefined
          ? Boolean(body.include_acceptance_terms)
          : true,
    });

    license.set("billing.setup_voucher_id", voucher.id);
    if (body.sync_billing === true) {
      license.set("billing.enabled", true);
      license.set("billing.setup_type", inferredSetupType);
      license.set("billing.installation_charges", installationCharges);
      license.set("billing.lifetime_amount", lifetimeAmount);
      license.set("billing.setup_paid_amount", amountPaid);
      license.set(
        "billing.setup_payment_status",
        totalPayable <= 0
          ? amountPaid > 0
            ? "paid"
            : "unpaid"
          : amountPaid >= totalPayable
          ? "paid"
          : amountPaid > 0
          ? "partially_paid"
          : "unpaid"
      );
      license.set("billing.setup_payment_method", paymentMethod);
      license.set("billing.setup_payment_reference", paymentReference);
      license.set("billing.setup_notes", notes);
      if (amountPaid > 0 && !license.billing?.setup_paid_at) {
        license.set("billing.setup_paid_at", new Date());
      }
      license.set("billing.recurring_enabled", recurringEnabled);
    }
    await license.save();

    let emailResult: any = null;
    if (body.send_email !== false) {
      try {
        emailResult = await sendVoucherEmail(voucher.id, {
          recipientEmail: body.recipient_email,
        });
      } catch (err: any) {
        emailResult = {
          sent: false,
          error: err?.message || "Email failed",
        };
      }
    }

    const voucherObj = voucher.toJSON();
    if (emailResult) {
      voucherObj.email_status = emailResult.sent
        ? "sent"
        : emailResult.reason
        ? "skipped"
        : "failed";
    }

    return NextResponse.json({
      success: true,
      reused: false,
      voucher: voucherObj,
      email_result: emailResult,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to generate voucher" },
      { status: 500 }
    );
  }
}

