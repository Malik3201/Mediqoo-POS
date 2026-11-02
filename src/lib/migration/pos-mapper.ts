/**
 * Canonical → AivraSol POS mapping contract (single source of truth).
 *
 * Every field written here matches the POS schema in `aivrasol-pos/src/lib/db.ts`
 * (Product / Batch / Customer / Supplier / Invoice / InvoiceItem / Purchase /
 * PurchaseLine / SalesReturn / SalesReturnItem / MigrationHistoryRecord).
 *
 * Rules:
 *  - A missing source amount is NEVER converted into a valid-looking 0.
 *    Optional POS fields stay `undefined`; required document amounts must be
 *    present or the document fails validation (conversion → Needs Review).
 *  - Historical documents never move stock, cash, khata, supplier payable,
 *    FBR or SaaS billing (migrationImported / billable:false / fbrStatus).
 */
import type { CanonicalBundle } from "./core/adapter";

export const MAPPING_VERSION = "3.0.0";
export const CONVERTER_VERSION = "3.0.0";
export const LEGACY_ARCHIVE_COLLECTION = "legacy-archive";
const ARCHIVE_CHUNK_ROWS = 4000;

export interface PosMappingContext {
  batchId: string;
  sourceFileName: string;
  sourceSha256?: string;
  sourceDatabaseName?: string;
  sourceSoftware: string;
}

export interface PosMappingResult {
  collections: Record<string, unknown[]>;
  archiveRecords: unknown[];
  normalizedCounts: {
    products: number;
    customers: number;
    suppliers: number;
    invoices: number;
    purchases: number;
    sales_returns: number;
    total: number;
  };
  archiveCounts: {
    tables: number;
    source_rows: number;
    archive_records: number;
    orphan_sales: number;
    orphan_purchases: number;
    header_only_returns: number;
    cmh_tables: number;
    unmapped_tables: number;
    cmh_tables_legacy?: number;
    total: number;
  };
  reconciliation: {
    stock_total_units: number;
    stock_valuation_pkr: number;
    sales_total_pkr: number;
    purchases_total_pkr: number;
    returns_total_pkr: number;
    customer_receivable_pkr: number;
    supplier_payable_pkr: number;
  };
  review: Record<string, number | string | boolean | null>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optNum = (v: unknown): number | undefined => (isNum(v) ? v : undefined);
const nd = (rec: any) => (rec && rec.normalizedData ? rec.normalizedData : rec) || {};
const isoDate = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};
const dateOnly = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
const strip = <T extends Record<string, any>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};
const payMode = (m: unknown): "cash" | "card" | "credit" | "wallet" => {
  const s = String(m || "").toLowerCase();
  return s === "card" ? "card" : s === "credit" ? "credit" : s === "wallet" ? "wallet" : "cash";
};

export function buildPosCollections(canonical: CanonicalBundle & Record<string, any>, ctx: PosMappingContext): PosMappingResult {
  const isAbuzar = canonical.sourceSystem === "ABUZAR_LEGACY";
  const sourceSystem = canonical.sourceSystem || "UNKNOWN";
  const scope = (raw: unknown) => (isAbuzar ? `ABZ-${raw}` : `KP-${raw}`);
  const now = new Date().toISOString();
  const meta = { migrationSource: sourceSystem, migrationBatchId: ctx.batchId };

  // ── Products ─────────────────────────────────────────────────────────────
  const batchesByProduct = new Map<string, any[]>();
  for (const b of canonical.stockBatches as any[]) {
    const d = nd(b);
    const key = String(d.productId);
    (batchesByProduct.get(key) || batchesByProduct.set(key, []).get(key)!).push(d);
  }

  const productIdSet = new Set<string>();
  const products = (canonical.products as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const id = `PROD-${scope(raw)}`;
    productIdSet.add(id);
    const currentStock = isNum(d.currentStock) ? d.currentStock : 0;
    const priceKnown = d.priceKnown !== undefined ? Boolean(d.priceKnown) : isNum(d.salePrice ?? d.price);
    const costKnown = d.costKnown !== undefined ? Boolean(d.costKnown) : isNum(d.costPrice ?? d.cost);
    const price = priceKnown ? r4(Number(d.salePrice ?? d.price)) : 0;
    const cost = costKnown ? r4(Number(d.costPrice ?? d.cost)) : undefined;

    const srcBatches: any[] = Array.isArray(d.batches) && d.batches.length ? d.batches : batchesByProduct.get(raw) || [];
    const batches = currentStock > 0
      ? srcBatches.map((b: any, i: number) =>
          strip({
            id: `BATCH-${scope(raw)}-${i + 1}`,
            batchNo: String(b.batchNo || "LEGACY-OPENING"),
            expiry: dateOnly(b.expiry ?? b.expiryDate),
            qty: r4(Number(b.qty)),
            cost: optNum(b.cost) !== undefined ? r4(b.cost) : cost,
            isLegacyOpeningBatch: true,
            requiresExpiryReview: Boolean(b.requiresExpiryReview ?? !(b.expiry ?? b.expiryDate)),
          })
        )
      : [];
    if (currentStock > 0 && batches.length === 0) {
      batches.push(strip({ id: `BATCH-${scope(raw)}-1`, batchNo: "LEGACY-OPENING", expiry: undefined, qty: currentStock, cost, isLegacyOpeningBatch: true, requiresExpiryReview: true }));
    }

    const conf = String(d.packingsConfidence || "").toLowerCase();
    const packingConfidence = conf === "exact" ? "EXACT" : conf === "safe_single" ? "SAFE_SINGLE" : conf === "ambiguous" ? "NEEDS_REVIEW" : "NOT_AVAILABLE";
    const packUnits = isNum(d.packingSize) ? d.packingSize : 1;

    return strip({
      id,
      code: String(d.code || scope(raw)),
      barcode: d.barcode || undefined,
      name: String(d.name || rec.name || `Legacy item ${raw}`),
      generic: d.genericName || d.generic || undefined,
      category: d.categoryName || d.category || undefined,
      unit: String(d.baseUnit || d.unit || "unit"),
      packings: Array.isArray(d.packings) && d.packings.length
        ? d.packings.map((p: any) => strip({ name: String(p.name), multiplier: Number(p.multiplier), price: optNum(p.price), barcode: p.barcode || undefined }))
        : undefined,
      price,
      cost,
      taxPct: optNum(d.taxPct),
      reorderLevel: optNum(d.reorderLevel),
      currentStock,
      batches,
      archived: d.isActive === false || d.archived === true,
      manufacturer: d.manufacturerName || d.manufacturer || undefined,
      controlled: d.isControlled === true || d.controlled === true || undefined,
      location: d.location || undefined,
      legacyId: scope(raw),
      legacyReference: d.code || undefined,
      ...meta,
      isLegacyOpeningStock: currentStock > 0 || undefined,
      requiresPricingReview: Boolean(d.requiresPricingReview || !priceKnown || (currentStock > 0 && !costKnown)),
      requiresExpiryReview: Boolean(d.requiresExpiryReview || batches.some((b: any) => b.requiresExpiryReview)),
      requiresPackingReview: packingConfidence === "NEEDS_REVIEW" || undefined,
      requiresStockReview: d.requiresStockReview ? true : undefined,
      packingConfidence,
      packingDetails: packUnits > 1 ? `1 Pack = ${packUnits} ${d.baseUnit || "unit"}` : undefined,
      legacyPriceStatus: priceKnown ? undefined : "unavailable_in_source",
      legacyCostStatus: costKnown ? undefined : "unavailable_in_source",
      legacyCostSource: d.costSource || undefined,
      legacyPackSalePrice: optNum(d.legacyPackSalePrice),
      legacyPackPurchasePrice: optNum(d.legacyPackPurPrice),
      legacyStockSource: d.stockSource || undefined,
      legacyStockAsOf: d.stockAsOf || undefined,
      legacySourceStock: isNum(d.sourceStock) && d.sourceStock !== currentStock ? d.sourceStock : undefined,
      legacyRecoveredFrom: d.recoveredFrom || undefined,
      createdAt: now,
      updatedAt: now,
    });
  });

  const pid = (raw: unknown) => {
    const id = `PROD-${scope(raw)}`;
    return productIdSet.has(id) ? id : id; // product always emitted for referenced codes by Abuzar adapter
  };

  // ── Customers ────────────────────────────────────────────────────────────
  const customerIdSet = new Set<string>();
  const customers = (canonical.customers as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const id = `CUST-${scope(raw)}`;
    customerIdSet.add(id);
    const balanceKnown = d.balanceKnown !== false && isNum(d.currentBalance ?? d.creditBalance);
    return strip({
      id,
      name: String(d.name || rec.name),
      phone: d.phone || d.mobile || undefined,
      email: d.email || undefined,
      address: d.address || undefined,
      creditBalance: balanceKnown ? r2(Number(d.currentBalance ?? d.creditBalance)) : undefined,
      notes: balanceKnown
        ? d.notes
        : `Migrated from ${ctx.sourceSoftware}. Opening/current balance unavailable in source — Needs Review.` +
          (isNum(d.legacyLedgerNet) ? ` Partial legacy GL net (unverified): Rs ${d.legacyLedgerNet.toFixed(2)}.` : ""),
      legacyId: scope(raw),
      isMigrationAccount: true,
      ...meta,
      legacyBalanceStatus: balanceKnown ? "verified" : "unavailable_in_source",
      legacyLedgerNet: optNum(d.legacyLedgerNet),
      createdAt: now,
      updatedAt: now,
    });
  });

  // ── Suppliers ────────────────────────────────────────────────────────────
  const supplierIdSet = new Set<string>();
  const suppliers = (canonical.suppliers as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const id = `SUP-${scope(raw)}`;
    supplierIdSet.add(id);
    const balanceKnown = d.balanceKnown !== false && isNum(d.openingBalance);
    const parts = [
      d.contactPerson ? `Contact: ${d.contactPerson}` : "",
      d.ntn ? `NTN: ${d.ntn}` : "",
      d.strn ? `STRN: ${d.strn}` : "",
      balanceKnown ? "" : "Legacy payable unavailable/unverified in source — Needs Review.",
      isNum(d.legacyInvoiceOutstanding) && d.legacyInvoiceOutstanding > 0 ? `Recovered invoice outstanding (unverified): Rs ${d.legacyInvoiceOutstanding.toFixed(2)}.` : "",
    ].filter(Boolean);
    return strip({
      id,
      name: String(d.name || rec.name),
      phone: d.phone || d.mobile || undefined,
      email: d.email || undefined,
      address: d.address || undefined,
      manufacturers: Array.isArray(d.providedManufacturers) && d.providedManufacturers.length ? d.providedManufacturers : undefined,
      openingBalance: balanceKnown ? r2(Number(d.openingBalance)) : undefined,
      notes: parts.join(" ") || undefined,
      legacyId: scope(raw),
      ...meta,
      excludeMigratedPurchasesFromBalance: true,
      legacyBalanceStatus: balanceKnown ? "verified" : "unavailable_in_source",
      legacyLedgerNet: optNum(d.legacyLedgerNet),
      legacyInvoiceOutstanding: optNum(d.legacyInvoiceOutstanding),
      createdAt: now,
      updatedAt: now,
    });
  });

  // ── Sales invoices ──────────────────────────────────────────────────────
  const invoiceIdSet = new Set<string>();
  const invoices = (canonical.salesInvoices as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const id = `INV-${scope(raw)}`;
    invoiceIdSet.add(id);
    const custId = d.customerId !== undefined && d.customerId !== null ? `CUST-${scope(d.customerId)}` : null;
    const items = (d.lines || []).map((l: any) => {
      const qty = Number(l.qty);
      const price = Number(l.unitPrice ?? l.price);
      const lineTotal = isNum(l.lineTotal) ? l.lineTotal : isNum(qty) && isNum(price) ? r2(qty * price - (Number(l.discountAmt) || 0)) : NaN;
      return strip({
        productId: pid(l.productId),
        manufacturer: l.manufacturer || undefined,
        code: String(l.productCode || scope(l.productId)),
        name: String(l.productName || `Legacy item ${l.productId}`),
        unit: String(l.unit || "unit"),
        multiplier: isNum(l.multiplier) ? l.multiplier : 1,
        qty,
        price,
        cost: optNum(l.cost),
        discountPct: optNum(l.discountPct),
        discountAmt: optNum(l.discountAmt),
        discountType: isNum(l.discountPct) && l.discountPct > 0 ? "pct" : isNum(l.discountAmt) && l.discountAmt > 0 ? "pkr" : undefined,
        taxPct: optNum(l.taxPct),
        lineTotal,
        legacyTaxAmt: optNum(l.taxAmt),
        legacyBatchNo: l.batchNo || undefined,
        legacyExpiry: dateOnly(l.expiry),
        legacyPackUnits: optNum(l.packUnits),
      });
    });
    const total = Number(d.grandTotal ?? d.total);
    const extraCharges: { label: string; amount: number }[] = [];
    if (isNum(d.miscCharges) && d.miscCharges !== 0) extraCharges.push({ label: "Misc charges (source)", amount: d.miscCharges });
    if (isNum(d.roundingAdjustment) && d.roundingAdjustment !== 0) extraCharges.push({ label: "Rounding (source)", amount: d.roundingAdjustment });
    const payment = payMode(d.paymentMethod);
    return strip({
      id,
      number: String(d.invoiceNo || id),
      date: isoDate(d.date) as string,
      customerId: custId && customerIdSet.has(custId) ? custId : null,
      customerName: d.customerName || "Walk-in Customer",
      customerPhone: d.customerPhone || undefined,
      items,
      subtotal: Number(d.subtotal),
      discount: Number(d.discount),
      tax: Number(d.tax),
      extraCharges: extraCharges.length ? extraCharges : undefined,
      total,
      paid: isNum(d.paidAmount) ? d.paidAmount : total,
      change: 0,
      payment,
      notes: d.notes || undefined,
      status: "paid",
      fbrStatus: "not_applicable",
      migrationImported: true,
      ...meta,
      legacyId: scope(raw),
      legacyReference: rec.legacyReference || d.invoiceNo || undefined,
      legacyOperatorName: d.operatorName || undefined,
      billable: false,
      isHistoricalImport: true,
      legacyPaymentVerified: d.paymentVerified === true ? true : d.paymentVerified === false ? false : undefined,
      createdAt: isoDate(d.date) || now,
      updatedAt: now,
    });
  });

  // ── Purchases ────────────────────────────────────────────────────────────
  const purchases = (canonical.purchases as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const number = String(d.purchaseNo || `GRN-${scope(raw)}`);
    const supId = d.supplierId !== undefined && d.supplierId !== null ? `SUP-${scope(d.supplierId)}` : undefined;
    const lines = (d.lines || []).map((l: any) => {
      const qty = Number(l.qty);
      const cost = Number(l.costPerUnit ?? l.cost);
      const freeQty = isNum(l.freeQty) ? l.freeQty : 0;
      const gross = isNum(l.grossAmount) ? l.grossAmount : isNum(qty) && isNum(cost) ? r2(qty * cost) : NaN;
      const netBeforeTax = isNum(l.netBeforeTax) ? l.netBeforeTax : isNum(gross) ? r2(gross * (1 - (Number(l.discountPct) || 0) / 100)) : NaN;
      const taxAmount = isNum(l.taxAmount) ? l.taxAmount : 0;
      const lineTotal = isNum(l.lineTotal) ? l.lineTotal : isNum(netBeforeTax) ? r2(netBeforeTax + taxAmount) : NaN;
      const mult = isNum(l.multiplier) ? l.multiplier : 1;
      const baseQtyReceived = r4((qty + freeQty) * mult);
      return strip({
        productId: pid(l.productId),
        code: String(l.productCode || scope(l.productId)),
        name: String(l.productName || `Legacy item ${l.productId}`),
        manufacturer: l.manufacturer || undefined,
        batchNo: String(l.batchNo || ""),
        expiry: dateOnly(l.expiry),
        unit: String(l.unit || "unit"),
        multiplier: mult,
        qty,
        cost,
        freeQty,
        discountPct: optNum(l.discountPct),
        lineSubtotal: gross,
        lineTotalBeforeTax: netBeforeTax,
        taxAmount,
        lineTotalAfterTax: lineTotal,
        lineTotal,
        salePrice: optNum(l.retailPrice),
        purchaseUnit: String(l.unit || "unit"),
        purchaseUnitMultiplier: mult,
        baseQtyReceived,
        baseCost: baseQtyReceived > 0 && isNum(lineTotal) ? r4(lineTotal / baseQtyReceived) : undefined,
        baseSalePrice: optNum(l.retailPrice),
        legacyPackQty: optNum(l.packQty),
        legacyPackUnits: optNum(l.packUnits),
        legacyPackCost: optNum(l.packCost),
        legacyDiscountAmount: optNum(l.discountAmount),
        legacyOriginalBonusQty: optNum(l.originalBonusQty),
        legacyNewAvgPrice: optNum(l.newAvgPrice),
      });
    });
    const notes = [
      d.invoiceReference ? `Supplier invoice: ${d.invoiceReference}` : "",
      d.paymentCategory ? `Source category: ${d.paymentCategory}` : "",
      isNum(d.roundingAdjustment) && d.roundingAdjustment !== 0 ? `Source total rounding ${d.roundingAdjustment > 0 ? "+" : ""}${d.roundingAdjustment.toFixed(2)}` : "",
      isNum(d.miscCharges) && d.miscCharges !== 0 ? `Misc charges ${d.miscCharges.toFixed(2)}` : "",
      isNum(d.legacyOutstandingAmount) ? `Legacy outstanding at posting: Rs ${d.legacyOutstandingAmount.toFixed(2)} (historical, excluded from live payable)` : "",
      d.notes || "",
    ].filter(Boolean).join(" · ");
    return strip({
      id: number,
      number,
      date: isoDate(d.date) as string,
      supplier: String(d.supplierName || "Legacy supplier"),
      supplierId: supId && supplierIdSet.has(supId) ? supId : undefined,
      lines,
      total: Number(d.grandTotal ?? d.total),
      subtotal: Number(d.subtotal),
      discount: Number(d.discount),
      taxAmount: optNum(d.tax),
      notes: notes || undefined,
      paidAmount: d.paidAmountKnown === false ? undefined : optNum(d.paidAmount),
      receivedByNameSnapshot: d.operatorName ? `Legacy user ${d.operatorName}` : undefined,
      migrationImported: true,
      ...meta,
      legacyId: scope(raw),
      legacyReference: d.invoiceReference || rec.legacyReference || undefined,
      excludeFromSupplierBalance: true,
      isHistoricalImport: true,
      legacyRoundingAdjustment: optNum(d.roundingAdjustment),
      legacyMiscCharges: optNum(d.miscCharges),
      legacyOutstandingAmount: optNum(d.legacyOutstandingAmount),
      createdAt: isoDate(d.date) || now,
      updatedAt: now,
    });
  });

  // ── Sales returns ────────────────────────────────────────────────────────
  const salesReturns = (canonical.salesReturns as any[]).map((rec) => {
    const d = nd(rec);
    const raw = String(d.legacyId ?? rec.legacyId);
    const invId = d.originalInvoiceId !== undefined ? `INV-${scope(d.originalInvoiceId)}` : undefined;
    const custId = d.customerId !== undefined && d.customerId !== null ? `CUST-${scope(d.customerId)}` : null;
    const items = (d.lines || []).map((l: any) => {
      const qty = Number(l.qty);
      const price = Number(l.price ?? l.unitPrice);
      const discount = isNum(l.discountDeducted) ? l.discountDeducted : 0;
      const lineTotal = isNum(l.lineTotal) ? l.lineTotal : isNum(qty) && isNum(price) ? r2(qty * price - discount) : NaN;
      return strip({
        productId: pid(l.productId),
        code: String(l.productCode || scope(l.productId)),
        name: String(l.productName || `Legacy item ${l.productId}`),
        unit: String(l.unit || "unit"),
        qty,
        price,
        cost: optNum(l.cost),
        multiplier: 1,
        discount,
        discountPct: optNum(l.discountPct),
        itemDiscount: discount || undefined,
        tax: optNum(l.taxAmt),
        lineTotal,
      });
    });
    return strip({
      id: `RTN-${scope(raw)}`,
      number: String(d.returnNo || `RTN-${scope(raw)}`),
      date: isoDate(d.date) as string,
      returnType: "INVOICE",
      invoiceId: invId && invoiceIdSet.has(invId) ? invId : null,
      invoiceNumber: d.originalInvoiceNo || undefined,
      customerId: custId && customerIdSet.has(custId) ? custId : null,
      customerName: d.customerName || "Walk-in Customer",
      items,
      subtotal: Number(d.subtotal),
      discount: optNum(d.discount),
      tax: optNum(d.tax),
      total: Number(d.total ?? d.grandTotal),
      refund: payMode(d.refundMethod),
      reason: [d.reason, isNum(d.roundingAdjustment) && d.roundingAdjustment !== 0 ? `Source total rounding ${d.roundingAdjustment > 0 ? "+" : ""}${d.roundingAdjustment.toFixed(2)}` : ""].filter(Boolean).join(" · ") || undefined,
      migrationImported: true,
      ...meta,
      legacyId: scope(raw),
      legacyReference: rec.legacyReference || undefined,
      isHistoricalImport: true,
      legacyRoundingAdjustment: optNum(d.roundingAdjustment),
      legacyMiscCharges: optNum(d.miscCharges),
      createdAt: isoDate(d.date) || now,
      updatedAt: now,
    });
  });

  // ── Lossless archive (actual rows, chunked) ─────────────────────────────
  const archive = canonical.losslessArchive || {};
  const archiveRecords: any[] = [];
  let archiveRows = 0;
  const tables: Record<string, { columns: string[]; rows: any[][]; redactedColumns?: string[] }> = archive.tables || {};
  for (const [table, t] of Object.entries(tables)) {
    const chunkCount = Math.max(1, Math.ceil(t.rows.length / ARCHIVE_CHUNK_ROWS));
    for (let c = 0; c < chunkCount; c++) {
      const rows = t.rows.slice(c * ARCHIVE_CHUNK_ROWS, (c + 1) * ARCHIVE_CHUNK_ROWS);
      archiveRecords.push({
        id: `${isAbuzar ? "ABZ" : "SRC"}-ARCH-${table}-${String(c + 1).padStart(4, "0")}`,
        kind: "source-table-chunk",
        sourceSystem,
        migrationBatchId: ctx.batchId,
        table,
        chunkIndex: c + 1,
        chunkCount,
        columns: t.columns,
        redactedColumns: t.redactedColumns || [],
        rowCount: rows.length,
        rows,
      });
      archiveRows += rows.length;
    }
  }
  if (archive.derived) {
    archiveRecords.push({ id: `${isAbuzar ? "ABZ" : "SRC"}-ARCH-DERIVED-EVIDENCE`, kind: "conversion-evidence", sourceSystem, migrationBatchId: ctx.batchId, ...archive.derived });
  }
  const sum = archive.summary || {};

  // ── Metrics & review summary ────────────────────────────────────────────
  const m: any = canonical.sourceMetrics || {};
  const stockUnits = r4(products.reduce((s, p: any) => s + (p.currentStock || 0), 0));
  const stockValue = r2(products.reduce((s, p: any) => s + (p.currentStock > 0 && isNum(p.cost) ? p.currentStock * p.cost : 0), 0));
  const reconciliation = {
    stock_total_units: stockUnits,
    stock_valuation_pkr: stockValue,
    sales_total_pkr: r2(invoices.reduce((s, i: any) => s + i.total, 0)),
    purchases_total_pkr: r2(purchases.reduce((s, p: any) => s + p.total, 0)),
    returns_total_pkr: r2(salesReturns.reduce((s, r: any) => s + r.total, 0)),
    customer_receivable_pkr: r2(customers.reduce((s, c: any) => s + (c.creditBalance || 0), 0)),
    supplier_payable_pkr: r2(suppliers.reduce((s, c: any) => s + (c.openingBalance || 0), 0)),
  };
  const review = {
    productsPriceUnavailable: products.filter((p: any) => p.legacyPriceStatus).length,
    stockedProductsCostUnavailable: products.filter((p: any) => p.currentStock > 0 && p.legacyCostStatus).length,
    productsStockReview: products.filter((p: any) => p.requiresStockReview).length,
    stockedProducts: products.filter((p: any) => p.currentStock > 0).length,
    unverifiedOpeningBatchUnits: m.unverifiedOpeningBatchUnits ?? null,
    allocatedBatchUnits: m.allocatedBatchUnits ?? null,
    salesPaymentVerified: m.salesPaymentVerified ?? null,
    salesHeadersWithoutLines: m.salesHeadersWithoutLines ?? null,
    purchaseHeadersWithoutLines: m.purchaseHeadersWithoutLines ?? null,
    returnHeadersWithoutLines: m.returnHeadersWithoutLines ?? null,
    purchaseReturnHeadersWithoutLines: m.purchaseReturnHeadersWithoutLines ?? null,
    receivablesVerified: false,
    payablesVerified: false,
    stockBaseSnapshot: m.stockBaseSnapshot ?? null,
  };

  const migrationHistory = [
    {
      id: `MIGHIST-${ctx.batchId}`,
      migrationBatchId: ctx.batchId,
      source: ctx.sourceSoftware,
      backupFileName: ctx.sourceFileName,
      backupHash: ctx.sourceSha256 || m.backupHash || "",
      sourceDatabaseName: ctx.sourceDatabaseName || m.databaseName,
      startedAt: now,
      completedAt: now,
      status: "completed",
      counts: {
        products: products.length,
        customers: customers.length,
        suppliers: suppliers.length,
        invoices: invoices.length,
        purchases: purchases.length,
        salesReturns: salesReturns.length,
        archiveRecords: archiveRecords.length,
        archiveSourceRows: archiveRows,
      },
      totals: reconciliation,
      warningsCount: Object.values(review).filter((v) => typeof v === "number" && v > 0).length,
      warnings: [
        `Mapping v${MAPPING_VERSION}`,
        `Sales headers without recoverable lines (archived): ${review.salesHeadersWithoutLines ?? 0}`,
        `Purchase headers without recoverable lines (archived): ${review.purchaseHeadersWithoutLines ?? 0}`,
        `Return headers without recoverable lines (archived): ${(review.returnHeadersWithoutLines ?? 0) as number}`,
        "Customer receivables and supplier payables are not verifiable from source; live balances start unset.",
      ],
      rollbackAvailable: false,
    },
  ];

  const collections: Record<string, unknown[]> = {
    products,
    customers,
    invoices,
    purchases,
    "sales-returns": salesReturns,
    "master-medicines": [],
    prescriptions: [],
    "cashbook-entries": [],
    suppliers,
    "supplier-payments": [],
    "purchase-returns": [],
    "khata-payments": [],
    "narcotics-register": [],
    quotations: [],
    // Never transplant legacy users/credentials or sessions; POS keeps its own.
    "pos-users": [],
    "operator-sessions": [],
    "migration-history": migrationHistory,
  };

  const normalizedCounts = {
    products: products.length,
    customers: customers.length,
    suppliers: suppliers.length,
    invoices: invoices.length,
    purchases: purchases.length,
    sales_returns: salesReturns.length,
    total: products.length + customers.length + suppliers.length + invoices.length + purchases.length + salesReturns.length,
  };
  const tableCount = Object.keys(tables).length;
  const archiveCounts = {
    tables: tableCount,
    source_rows: archiveRows,
    archive_records: archiveRecords.length,
    orphan_sales: Number(sum.orphanSaleDetails) || 0,
    orphan_purchases: Number(sum.orphanPurchaseDetails) || 0,
    header_only_returns: Number(sum.headerOnlyReturns) || 0,
    cmh_tables: Number(sum.cmhTables) || 0,
    unmapped_tables: Math.max(0, tableCount - 12),
    total: archiveRows,
  };

  return { collections, archiveRecords, normalizedCounts, archiveCounts, reconciliation, review };
}

/**
 * Strict pre-encryption validation. Throws (conversion → Failed/Needs Review)
 * instead of letting NaN/undefined amounts or broken relationships into a package.
 */
export function validatePosCollections(collections: Record<string, unknown[]>): void {
  const issues: string[] = [];
  const bad = (v: unknown, allowNeg = false) => !isNum(v) || (!allowNeg && (v as number) < 0);
  const productIds = new Set<string>();

  const scan = (val: unknown, path: string) => {
    if (typeof val === "number" && !Number.isFinite(val)) issues.push(`Non-finite number at ${path}`);
    else if (Array.isArray(val)) val.forEach((x, i) => scan(x, `${path}[${i}]`));
    else if (val && typeof val === "object") for (const [k, v] of Object.entries(val)) scan(v, `${path}.${k}`);
  };
  for (const [name, rows] of Object.entries(collections)) scan(rows, name);

  for (const p of collections.products as any[]) {
    if (!p.id || !p.name || !p.code || !p.unit) issues.push(`Product missing id/name/code/unit: ${p.id}`);
    productIds.add(p.id);
    if (bad(p.price)) issues.push(`Product ${p.id} invalid price ${p.price}`);
    if (p.cost !== undefined && bad(p.cost)) issues.push(`Product ${p.id} invalid cost ${p.cost}`);
    if (bad(p.currentStock)) issues.push(`Product ${p.id} invalid currentStock ${p.currentStock}`);
    const bsum = (p.batches || []).reduce((s: number, b: any) => s + (Number(b.qty) || 0), 0);
    if (Math.abs(bsum - (p.currentStock || 0)) > 0.0001) issues.push(`Product ${p.id} batch qty ${bsum} != stock ${p.currentStock}`);
  }
  const checkLines = (doc: any, lines: any[], kind: string, priceKey: string) => {
    if (!doc.id || !doc.number || !doc.date) issues.push(`${kind} missing id/number/date: ${doc.id}`);
    if (!lines.length) issues.push(`${kind} ${doc.id} has no lines`);
    if (bad(doc.total)) issues.push(`${kind} ${doc.id} invalid total ${doc.total}`);
    if (bad(doc.subtotal)) issues.push(`${kind} ${doc.id} invalid subtotal ${doc.subtotal}`);
    let lt = 0;
    for (const l of lines) {
      if (!productIds.has(l.productId)) issues.push(`${kind} ${doc.id} line references unknown product ${l.productId}`);
      if (bad(l.qty) || l.qty <= 0) issues.push(`${kind} ${doc.id} line ${l.productId} invalid qty ${l.qty}`);
      if (bad(l[priceKey])) issues.push(`${kind} ${doc.id} line ${l.productId} invalid ${priceKey} ${l[priceKey]}`);
      if (bad(l.lineTotal)) issues.push(`${kind} ${doc.id} line ${l.productId} invalid lineTotal ${l.lineTotal}`);
      lt += Number(l.lineTotal) || 0;
    }
    return lt;
  };
  for (const inv of collections.invoices as any[]) {
    const lt = checkLines(inv, inv.items || [], "Invoice", "price");
    const extras = (inv.extraCharges || []).reduce((s: number, e: any) => s + e.amount, 0);
    const lineDisc = (inv.items || []).reduce((s: number, l: any) => s + (l.discountAmt || 0), 0);
    const lineTax = (inv.items || []).reduce((s: number, l: any) => s + (l.legacyTaxAmt || 0), 0);
    const expect = lt - (inv.discount - lineDisc) + (inv.tax - lineTax) + extras;
    if (Math.abs(expect - inv.total) > 0.5) issues.push(`Invoice ${inv.id} lines ${lt.toFixed(2)} (expected ${expect.toFixed(2)}) do not reconcile to total ${inv.total}`);
    if (typeof inv.payment !== "string") issues.push(`Invoice ${inv.id} payment must be a string literal`);
    if (inv.migrationImported !== true || inv.billable !== false || inv.fbrStatus !== "not_applicable") issues.push(`Invoice ${inv.id} missing historical guards`);
  }
  for (const pur of collections.purchases as any[]) {
    const lt = checkLines(pur, pur.lines || [], "Purchase", "cost");
    const lineDisc = (pur.lines || []).reduce((s: number, l: any) => s + (l.legacyDiscountAmount || 0), 0);
    const lineTax = (pur.lines || []).reduce((s: number, l: any) => s + (l.taxAmount || 0), 0);
    const expect = lt - ((pur.discount || 0) - lineDisc) + ((pur.taxAmount || 0) - lineTax) + (pur.legacyMiscCharges || 0) + (pur.legacyRoundingAdjustment || 0);
    if (Math.abs(expect - pur.total) > 0.5) issues.push(`Purchase ${pur.id} lines ${lt.toFixed(2)} (expected ${expect.toFixed(2)}) do not reconcile to total ${pur.total}`);
    if (pur.excludeFromSupplierBalance !== true || pur.migrationImported !== true) issues.push(`Purchase ${pur.id} missing historical guards`);
  }
  for (const rtn of collections["sales-returns"] as any[]) {
    const lt = checkLines(rtn, rtn.items || [], "Return", "price");
    const lineDisc = (rtn.items || []).reduce((s: number, l: any) => s + (l.discount || 0), 0);
    const lineTax = (rtn.items || []).reduce((s: number, l: any) => s + (l.tax || 0), 0);
    const expect = lt - ((rtn.discount || 0) - lineDisc) + ((rtn.tax || 0) - lineTax) + (rtn.legacyMiscCharges || 0) + (rtn.legacyRoundingAdjustment || 0);
    if (Math.abs(expect - rtn.total) > 0.5) issues.push(`Return ${rtn.id} lines ${lt.toFixed(2)} (expected ${expect.toFixed(2)}) do not reconcile to total ${rtn.total}`);
    if (typeof rtn.refund !== "string") issues.push(`Return ${rtn.id} refund must be a string literal`);
  }
  if ((collections["pos-users"] || []).length) issues.push("Legacy pos-users must not be transplanted");

  if (issues.length) {
    throw new Error(
      `Pre-conversion integrity validation failed with ${issues.length} defect(s): ${issues.slice(0, 10).join("; ")}${issues.length > 10 ? ` (+${issues.length - 10} more)` : ""}`
    );
  }
}
