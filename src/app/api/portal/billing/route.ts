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
import { resolveBillingModel, deriveOutstanding } from "@/lib/billing";

export async function GET(req: NextRequest) {
  try {
    const session = await requirePortalSession(req);
    await connectToDatabase();

    const licenses = await License.find({ client_id: session.client_id }).lean();
    const activeLicenses = licenses.filter((l: any) => l.billing?.enabled);

    const results = await Promise.all(activeLicenses.map(async (license: any) => {
      const project = await Project.findOne({ id: license.project_id }).lean();
      
      const periods = await LicenseBillingPeriod.find({ license_id: license.id })
        .sort({ period_start: 1 })
        .lean();

      const billingModel = resolveBillingModel(license.billing);
      let totalOutstanding = 0;
      let extraDetails = {};

      const payments = await LicensePayment.find({ license_id: license.id }).sort({ paid_at: -1 }).lean();
      const unpaidPeriods = periods.filter((p: any) => p.status !== "paid" && p.status !== "waived");
      const unpaidPeriodIds = unpaidPeriods.map((p: any) => p.id);

      if (billingModel === "per_invoice") {
        // Only count usages/adjustments for UNPAID periods for the "Current" ledger
        const unpaidUsages = await BillingUsage.find({ billing_period_id: { $in: unpaidPeriodIds } }).lean();
        const unpaidAdjustments = await BillingAdjustment.find({ billing_period_id: { $in: unpaidPeriodIds } }).lean();
        
        // Find payments that were applied to these unpaid periods
        const unpaidPeriodPayments = payments.filter((p: any) => unpaidPeriodIds.includes(p.billing_period_id));

        const usage_amount = unpaidUsages.reduce((sum, u) => sum + u.amount, 0);
        const payment_amount = unpaidPeriodPayments.reduce((sum, p) => sum + p.amount_paid, 0);
        const adjustments_amount = unpaidAdjustments.reduce((sum, a) => sum + (a.type === "debit" ? a.amount : -a.amount), 0);
        
        totalOutstanding = deriveOutstanding(usage_amount, unpaidAdjustments, payment_amount);

        extraDetails = {
          invoice_count: unpaidUsages.reduce((sum, u) => sum + (u.unit_count || 1), 0),
          usage_amount,
          payment_amount, // only for currently unpaid periods (partial payments)
          adjustments_amount,
        };
      } else {
        totalOutstanding = periods.reduce((sum, p) => {
           if (p.status === "paid" || p.status === "waived") return sum;
           return sum + p.amount_due - (p.amount_paid || 0);
        }, 0);
      }

      const now = Date.now();
      const currentPeriod = periods.find((p: any) => {
        const start = new Date(p.period_start).getTime();
        const end = new Date(p.period_end).getTime();
        return now >= start && now < end;
      });

      return {
        license: {
          id: license.id,
          expires_at: license.expires_at,
          grace_until: license.grace_until,
          billing: {
            cycle: license.billing.cycle,
            amount: license.billing.amount,
            currency: license.billing.currency,
            model: billingModel,
          }
        },
        project: project ? { id: project.id, name: project.name } : null,
        operationalStatus: deriveOperationalStatus(license),
        billingStatus: deriveBillingStatus(unpaidPeriods),
        totalOutstanding: Math.max(0, totalOutstanding),
        periods,
        currentPeriod,
        unpaidPeriods,
        paymentHistory: payments.map(p => ({
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
