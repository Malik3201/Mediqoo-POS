import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import { calculateRenewalDates } from "@/lib/billing";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  await connectToDatabase();
  
  try {
    const license = await License.findOne({ id }).lean();
    if (!license) throw new Error("License not found");
    if (!license.billing?.enabled) throw new Error("Billing is not enabled for this license");

    const preview = calculateRenewalDates(license as any);

    return NextResponse.json({
      renewal_type: preview.renewalType,
      current_expiry: license.expires_at,
      base_date: preview.baseDate,
      new_expiry: preview.newExpiry,
      new_grace_until: preview.newGraceUntil,
      amount_due: license.billing.amount,
      currency: license.billing.currency,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
