import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";
import Project from "@/models/Project";
import { requirePortalSession, portalAuthErrorResponse } from "@/lib/portal-auth";
import { deriveOperationalStatus, deriveBillingStatus } from "@/lib/status";
import { resolveBillingModel, getLicenseBillingSummary, getCurrentBillingPeriod } from "@/lib/billing";

export async function GET(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    await connectToDatabase();

    const licenses = await License.find({ client_id: session.client_id }).lean();
    const activeLicenses = licenses.filter((l: any) => l.billing?.enabled);

    const results = await Promise.all(activeLicenses.map(async (license: any) => {
      const project = await Project.findOne({ id: license.project_id }).lean();
      const billingModel = resolveBillingModel(license.billing);

      let totalOutstanding = 0;
      let extraDetails = {};
      let currentPeriod: any = null;
      let unpaidPeriods: any[] = [];
      let paymentHistory: any[] = [];

      if (billingModel === "per_invoice") {
        const summary = await getLicenseBillingSummary(
          license.id,
          { LicenseBillingPeriod, BillingUsage, BillingAdjustment, LicensePayment }
        );

        totalOutstanding = summary.accountOutstanding;
        currentPeriod = summary.currentPeriod;
        unpaidPeriods = summary.unpaidPeriods;
        paymentHistory = (summary.paymentHistory as any[]);

        extraDetails = {
          invoice_count: summary.accruedUsageCount,
          usage_amount: summary.accruedUsageAmount,
          payment_amount: summary.paymentsAppliedToAccrued,
          adjustments_debits: summary.adjustmentDebits,
          adjustments_credits: summary.adjustmentCredits,
        };
      } else {
        const periods = await LicenseBillingPeriod.find({ license_id: license.id })
          .sort({ period_start: 1 }).lean();
        unpaidPeriods = periods.filter((p: any) => p.status !== "paid" && p.status !== "waived");
        currentPeriod = getCurrentBillingPeriod(periods);
        totalOutstanding = periods.reduce((sum, p) => {
           if (p.status === "paid" || p.status === "waived") return sum;
           return sum + p.amount_due - (p.amount_paid || 0);
        }, 0);
        const payments = await LicensePayment.find({ license_id: license.id }).sort({ paid_at: -1 }).lean();
        paymentHistory = payments as any[];
      }

      return {
        license: {
          id: license.id,
          expires_at: license.expires_at,
          grace_until: license.grace_until,
          billing: {
            cycle: license.billing.cycle,
            amount: billingModel === "per_invoice" ? (license.billing.rate_per_invoice || 0) : (license.billing.amount || 0),
            currency: license.billing.currency,
            model: billingModel,
            rate_per_invoice: license.billing.rate_per_invoice,
          }
        },
        project: project ? { id: project.id, name: project.name } : null,
        operationalStatus: deriveOperationalStatus(license),
        billingStatus: deriveBillingStatus(license, currentPeriod, unpaidPeriods.length > 0),
        totalOutstanding: Math.max(0, totalOutstanding),
        currentPeriod,
        unpaidPeriods,
        paymentHistory: paymentHistory.map((p: any) => ({
          id: p.id,
          receipt_number: p.receipt_number,
          paid_at: p.paid_at,
          amount_paid: p.amount_paid,
          payment_method: p.payment_method,
          currency: p.currency,
          email_status: p.email_status,
        })),
        ...extraDetails
      };
    }));

    return NextResponse.json({ success: true, items: results });
  } catch (error: any) {
    return portalAuthErrorResponse(error);
  }
}
