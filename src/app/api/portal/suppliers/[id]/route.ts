import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { requirePortalSession } from "@/lib/portal-auth";
import AnalyticsEvent from "@/models/AnalyticsEvent";
import OwnerPortalState from "@/models/OwnerPortalState";

/**
 * GET /api/portal/suppliers/[id]
 *
 * Supplier Profile, Purchase History, Verified Payments, and Explicit Legacy Balance Review Status (Part E).
 * Never adds historical purchases with unknown settlement status to verified payable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, errorResponse } = await requirePortalSession();
  if (errorResponse) return errorResponse;

  try {
    await connectToDatabase();
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    const clientId = session.client_id;

    const portalState = await OwnerPortalState.findOne({ client_id: clientId })
      .sort({ captured_at: -1 })
      .lean<any>();

    const stateSuppliers: any[] = portalState?.suppliers || [];
    const matchedSupplier = stateSuppliers.find(
      (s) =>
        s.id === decodedId ||
        (s.name && s.name.trim().toLowerCase() === decodedId.trim().toLowerCase())
    );

    const supplierName = matchedSupplier?.name || decodedId;
    const supplierId = matchedSupplier?.id || decodedId;

    // Fetch purchases (GRNs) for this supplier
    const purchaseDocs = await AnalyticsEvent.find({
      client_id: clientId,
      type: "purchase.received",
      $or: [
        { "payload.supplier_id": supplierId },
        { "payload.supplier_name": new RegExp(`^${supplierName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ],
    })
      .sort({ occurred_at: -1 })
      .limit(100)
      .lean<any[]>();

    const purchases = purchaseDocs.map((e) => {
      const p = e.payload || {};
      const isLegacyExcluded = Boolean(p.exclude_from_supplier_balance || p.migration_imported);
      return {
        id: p.purchase_id || e.source_record_id,
        event_id: e.event_id,
        grn: p.grn || e.source_record_id,
        occurred_at: new Date(e.occurred_at).toISOString(),
        purchase_total: Math.round(Number(p.purchase_total ?? 0) * 100) / 100,
        paid_amount: p.paid_amount !== undefined ? Math.round(Number(p.paid_amount) * 100) / 100 : null,
        lines_count: Array.isArray(p.lines) ? p.lines.length : 0,
        has_line_details: Array.isArray(p.lines) && p.lines.length > 0,
        migration_imported: Boolean(p.migration_imported),
        exclude_from_supplier_balance: Boolean(p.exclude_from_supplier_balance),
        payment_verification_status: isLegacyExcluded ? "historical_unverified" : "verified",
      };
    });

    // Verified supplier payments from OwnerPortalState + supplier.payment events
    const statePayments: any[] = (portalState?.supplier_payments || []).filter(
      (pay: any) =>
        pay.supplier_id === supplierId ||
        (pay.supplier_name && pay.supplier_name.trim().toLowerCase() === supplierName.trim().toLowerCase())
    );

    const eventPayments = await AnalyticsEvent.find({
      client_id: clientId,
      type: "supplier.payment",
      $or: [
        { "payload.supplier_id": supplierId },
        { "payload.supplier_name": supplierName },
      ],
    })
      .sort({ occurred_at: -1 })
      .limit(100)
      .lean<any[]>();

    const paymentsMap = new Map<string, any>();
    for (const pay of statePayments) {
      paymentsMap.set(pay.id, {
        id: pay.id,
        date: pay.date,
        amount: Math.round(Number(pay.amount ?? 0) * 100) / 100,
        method: pay.method || "cash",
        reference: pay.reference || null,
        note: pay.note || null,
        operator_name: pay.operator_name || null,
      });
    }
    for (const ev of eventPayments) {
      const pid = ev.payload?.payment_id || ev.source_record_id;
      if (!paymentsMap.has(pid)) {
        paymentsMap.set(pid, {
          id: pid,
          date: new Date(ev.occurred_at).toISOString(),
          amount: Math.round(Number(ev.payload?.amount ?? 0) * 100) / 100,
          method: ev.payload?.method || "cash",
          reference: ev.payload?.reference || null,
          note: ev.payload?.note || null,
          operator_name: ev.payload?.operator_name || null,
        });
      }
    }

    const payments = Array.from(paymentsMap.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Purchase returns for this supplier
    const stateReturns: any[] = (portalState?.purchase_returns || []).filter(
      (r: any) =>
        r.supplier_id === supplierId ||
        (r.supplier_name && r.supplier_name.trim().toLowerCase() === supplierName.trim().toLowerCase())
    );

    const totalPurchaseVolume =
      matchedSupplier?.total_purchases_amount ??
      purchases.reduce((sum, p) => sum + p.purchase_total, 0);
    const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalReturns = stateReturns.reduce((sum, r) => sum + (Number(r.total) || 0), 0);

    const unverifiedCount =
      matchedSupplier?.unverified_historical_purchases_count ??
      purchases.filter((p) => p.exclude_from_supplier_balance || p.migration_imported).length;
    const unverifiedAmount =
      matchedSupplier?.unverified_historical_purchases_amount ??
      purchases
        .filter((p) => p.exclude_from_supplier_balance || p.migration_imported)
        .reduce((sum, p) => sum + p.purchase_total, 0);

    const legacyBalanceStatus =
      matchedSupplier?.legacy_balance_status === "historical_unverified" || unverifiedCount > 0
        ? "historical_unverified"
        : "verified";

    return NextResponse.json({
      supplier: {
        id: supplierId,
        name: supplierName,
        phone: matchedSupplier?.phone || null,
        email: matchedSupplier?.email || null,
        address: matchedSupplier?.address || null,
        opening_balance: Math.round(Number(matchedSupplier?.opening_balance ?? 0) * 100) / 100,
        verified_payable: Math.round(Number(matchedSupplier?.verified_payable ?? 0) * 100) / 100,
        total_purchases_amount: Math.round(totalPurchaseVolume * 100) / 100,
        total_purchases_count: matchedSupplier?.total_purchases_count ?? purchases.length,
        total_payments_amount: Math.round(totalPayments * 100) / 100,
        total_returns_amount: Math.round(totalReturns * 100) / 100,
        unverified_historical_purchases_count: unverifiedCount,
        unverified_historical_purchases_amount: Math.round(unverifiedAmount * 100) / 100,
        legacy_balance_status: legacyBalanceStatus,
        legacy_balance_explanation:
          legacyBalanceStatus === "historical_unverified"
            ? "Historical purchases imported from Abuzar legacy database without source payment settlement records are preserved for procurement history only and are excluded from verified payable balance."
            : "All recorded purchases and payments for this supplier have verified accounting balances.",
        last_purchase_at: matchedSupplier?.last_purchase_at || purchases[0]?.occurred_at || null,
        is_migrated: Boolean(matchedSupplier?.is_migrated),
      },
      purchases,
      payments,
      purchase_returns: stateReturns,
    });
  } catch (e: any) {
    console.error("Portal supplier detail error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

