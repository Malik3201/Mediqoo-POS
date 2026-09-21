import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import BillingAdjustment from "@/models/BillingAdjustment";

/**
 * GET /api/admin/licenses/[id]/adjustments
 *
 * List all billing adjustments for a license. Immutable history.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const adjustments = await BillingAdjustment.find({ license_id: id })
    .sort({ created_at: -1 })
    .lean();

  return NextResponse.json({ adjustments });
}

/**
 * POST /api/admin/licenses/[id]/adjustments
 *
 * Create a new billing adjustment. Adjustments are IMMUTABLE after creation.
 * To reverse, create a compensating entry (opposite type) with reverses_adjustment_id.
 *
 * No edit. No delete. No silent balance reset.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const license = await License.findOne({ id }).lean();
  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });

  const body = await req.json();

  // ── Validate required fields ──────────────────────────────────────────
  const validTypes = ["credit", "debit", "waiver"];
  if (!body.type || !validTypes.includes(body.type)) {
    return NextResponse.json({
      error: "invalid_type",
      detail: `type must be one of: ${validTypes.join(", ")}`,
    }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({
      error: "invalid_amount",
      detail: "amount must be a positive number",
    }, { status: 400 });
  }

  if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length < 3) {
    return NextResponse.json({
      error: "reason_required",
      detail: "A reason with at least 3 characters is required for every adjustment.",
    }, { status: 400 });
  }

  // ── Validate reversal target if specified ─────────────────────────────
  if (body.reverses_adjustment_id) {
    const target = await BillingAdjustment.findOne({
      id: body.reverses_adjustment_id,
      license_id: id,
    }).lean();

    if (!target) {
      return NextResponse.json({
        error: "reversal_target_not_found",
        detail: "The adjustment being reversed was not found.",
      }, { status: 400 });
    }
  }

  // ── Resolve admin identity ────────────────────────────────────────────
  const recordedBy = (token as any).email || (token as any).name || "admin";

  // ── Create immutable adjustment ───────────────────────────────────────
  const adjustment = await BillingAdjustment.create({
    client_id: license.client_id,
    license_id: id,
    billing_period_id: body.billing_period_id || null,
    type: body.type,
    amount,
    currency: body.currency || license.billing?.currency || "PKR",
    reason: body.reason.trim(),
    recorded_by: recordedBy,
    reverses_adjustment_id: body.reverses_adjustment_id || null,
  });

  return NextResponse.json({ success: true, adjustment }, { status: 201 });
}
