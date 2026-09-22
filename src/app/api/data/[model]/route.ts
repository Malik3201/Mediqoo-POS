import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import BusinessTemplate from "@/models/BusinessTemplate";
import ClientTemplate from "@/models/ClientTemplate";
import Client from "@/models/Client";
import LicenseCounter from "@/models/LicenseCounter";
import LicenseSeat from "@/models/LicenseSeat";
import License from "@/models/License";
import Package from "@/models/Package";
import Profile from "@/models/Profile";
import Project from "@/models/Project";
import ReleaseInstall from "@/models/ReleaseInstall";
import Release from "@/models/Release";
import UserRole from "@/models/UserRole";
import AnalyticsBootstrap from "@/models/AnalyticsBootstrap";
import HistoricalDailyAnalytics from "@/models/HistoricalDailyAnalytics";
import HistoricalTopProduct from "@/models/HistoricalTopProduct";
import HistoricalRecentSale from "@/models/HistoricalRecentSale";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import LicensePayment from "@/models/LicensePayment";
import RenewalNotification from "@/models/RenewalNotification";
import BillingUsage from "@/models/BillingUsage";
import BillingAdjustment from "@/models/BillingAdjustment";

const modelsMap: Record<string, any> = {
  "audit_logs": AuditLog,
  "business_templates": BusinessTemplate,
  "client_templates": ClientTemplate,
  "clients": Client,
  "license_counters": LicenseCounter,
  "license_seats": LicenseSeat,
  "licenses": License,
  "packages": Package,
  "profiles": Profile,
  "projects": Project,
  "release_installs": ReleaseInstall,
  "releases": Release,
  "user_roles": UserRole,
  "analytics_bootstraps": AnalyticsBootstrap,
  "historical_daily_analytics": HistoricalDailyAnalytics,
  "historical_top_products": HistoricalTopProduct,
  "historical_recent_sales": HistoricalRecentSale,
  "license_billing_periods": LicenseBillingPeriod,
  "license_payments": LicensePayment,
  "renewal_notifications": RenewalNotification,
  "billing_usage": BillingUsage,
  "billing_adjustments": BillingAdjustment,
};

// Fields that must not be modified via the generic PATCH API.
// Structural changes to identity fields must go through dedicated endpoints.
const PATCH_PROTECTED_FIELDS: Record<string, string[]> = {
  license_seats:    ["id", "license_id", "terminal_number", "machine_id", "first_seen_at"],
  license_counters: ["id", "license_id"],  // counter value managed by register-seat only
  licenses:         ["id", "license_key", "client_id", "project_id"],
  clients:          ["id"],
  projects:         ["id", "slug"],
  // Billing records are immutable — no PATCH allowed
  billing_usage:       ["id", "license_id", "client_id", "invoice_uuid", "billing_period_id", "rate_snapshot", "amount", "occurred_at", "received_at", "unit_count", "billing_cycle_start", "billing_cycle_end", "terminal_id", "terminal_number", "invoice_number_snapshot", "created_at"],
  billing_adjustments: ["id", "license_id", "client_id", "billing_period_id", "type", "amount", "currency", "reason", "recorded_by", "reverses_adjustment_id", "created_at"],
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  const searchParams = req.nextUrl.searchParams;
  let query: any = {};
  
  // Basic query mapping (e.g. ?client_id=123)
  searchParams.forEach((value, key) => {
    if (key !== "limit" && key !== "sort" && key !== "select" && key !== "populate") {
      query[key] = value;
    }
  });

  const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit") as string, 10) : 0;
  const populateParams = searchParams.get("populate");
  
  try {
    let mQuery = Model.find(query).limit(limit);
    if (populateParams) {
      const paths = populateParams.split(",");
      paths.forEach(p => { mQuery = mQuery.populate(p.trim()); });
    }
    const data = await mQuery.lean();

    if (model === "license_billing_periods" && data.length > 0) {
      const periodIds = data.map((d: any) => d.id);
      
      // Build a map of license_id -> billing model for fallback
      const licenseIds = [...new Set(data.map((d: any) => d.license_id))];
      const licenseDocs = await License.find({ id: { $in: licenseIds } }).select("id billing.model billing.rate_per_invoice").lean();
      const licenseModelMap = new Map();
      licenseDocs.forEach((l: any) => licenseModelMap.set(l.id, l.billing?.model));

      const usageSummary = await BillingUsage.aggregate([
        { $match: { billing_period_id: { $in: periodIds } } },
        { $group: { _id: "$billing_period_id", count: { $sum: { $ifNull: ["$unit_count", 1] } }, total_amount: { $sum: "$amount" } } }
      ]);
      const usageMap = new Map();
      usageSummary.forEach(u => usageMap.set(u._id, u));

      const payments = await LicensePayment.find({ billing_period_id: { $in: periodIds } }).lean();
      const adjustments = await BillingAdjustment.find({ billing_period_id: { $in: periodIds } }).lean();
      
      const { deriveOutstanding } = await import("@/lib/billing");

      data.forEach((d: any) => {
        // Use period's billing_model if set, otherwise fallback to the license's model
        const effectiveModel = d.billing_model || licenseModelMap.get(d.license_id) || "fixed";
        
        if (effectiveModel === "per_invoice") {
          const usage = usageMap.get(d.id) || { count: 0, total_amount: 0 };
          const periodPayments = payments.filter((p: any) => p.billing_period_id === d.id);
          const periodAdjustments = adjustments.filter((a: any) => a.billing_period_id === d.id);
          
          const totalPaid = periodPayments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
          
          // Inject dynamic summary properties
          d.invoice_count = usage.count;
          d.usage_charges = usage.total_amount;
          
          d.amount_due = usage.total_amount + periodAdjustments.reduce((sum, adj) => sum + (adj.type === "debit" ? adj.amount : -adj.amount), 0);
          d.amount_paid = totalPaid;
          d.outstanding = deriveOutstanding(usage.total_amount, periodAdjustments, totalPaid);
        }
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const body = await req.json();
    const newData = await Model.create(body);
    return NextResponse.json(newData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const body = await req.json();
    const id = req.nextUrl.searchParams.get("id");
    
    if (!id) return NextResponse.json({ error: "ID required for PATCH" }, { status: 400 });

    // Strip identity-critical fields using module-level PATCH_PROTECTED_FIELDS map.
    if (PATCH_PROTECTED_FIELDS[model]) {
      for (const field of PATCH_PROTECTED_FIELDS[model]) {
        delete body[field];
      }
    }
    
    const updatedData = await Model.findOneAndUpdate({ id }, body, { new: true }).lean();
    return NextResponse.json(updatedData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID required for DELETE" }, { status: 400 });
    
    await Model.findOneAndDelete({ id });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
