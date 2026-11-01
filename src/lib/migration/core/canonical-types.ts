/**
 * Canonical Migration Model (Intermediate Layer)
 * 
 * Reusable intermediate structure ensuring that KeyPOS (and future legacy systems)
 * are never coupled directly to Pharmxe production schema.
 * Supports source auditing, mapping status, warnings, normalization, and reconciliation.
 */

export type MappingStatus = "mapped" | "partial" | "ambiguous" | "unmapped" | "conflict";

export interface CanonicalRecord<T = Record<string, unknown>> {
  sourceSystem: "KEYPOS" | string;
  sourceEntity: string;
  legacyId: string | number;
  legacyReference?: string;
  mappingStatus: MappingStatus;
  warnings: string[];
  sourceData: Record<string, unknown>;
  normalizedData: T;
  migrationBatchId?: string;
  createdAt?: string;
}

// ── Products & Inventory ──────────────────────────────────────────────────

export interface CanonicalProduct {
  legacyId: string | number;
  code: string;
  barcode?: string;
  name: string;
  genericName?: string;
  categoryName?: string;
  manufacturerName?: string;
  supplierName?: string;
  
  // Pricing & Cost
  salePrice: number;
  mrp?: number;
  costPrice: number;
  avgCost?: number;
  lastPurchaseRate?: number;
  taxPct: number;

  // Packing & Units
  baseUnit: string;
  packingSize?: number;
  packingType?: string;
  packingsConfidence: "exact" | "safe_single" | "ambiguous" | "none";
  packings: {
    name: string;
    multiplier: number;
    price?: number;
    barcode?: string;
  }[];

  // Stock & Reorder
  currentStock: number;
  reorderLevel?: number;
  isControlled?: boolean;
  isActive: boolean;
  location?: string;
}

export interface CanonicalBatch {
  legacyId?: string | number;
  productId: string | number;
  productCode: string;
  productName: string;
  batchNo: string;
  expiryDate?: string; // YYYY-MM-DD
  qty: number;
  cost?: number;
  salePrice?: number;
  isLegacyOpeningBatch?: boolean;
  requiresExpiryReview?: boolean;
}

// ── Stakeholders (Customers & Suppliers) ──────────────────────────────────

export interface CanonicalCustomer {
  legacyId: string | number;
  name: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  city?: string;
  cnic?: string;
  ntn?: string;
  openingBalance: number;
  currentBalance: number; // positive = customer owes pharmacy (receivable)
  creditLimit?: number;
  isActive: boolean;
}

export interface CanonicalSupplier {
  legacyId: string | number;
  name: string;
  contactPerson?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  city?: string;
  ntn?: string;
  strn?: string;
  openingBalance: number;
  currentBalance: number; // positive = pharmacy owes supplier (payable)
  isActive: boolean;
  providedManufacturers?: string[];
}

// ── Sales History ─────────────────────────────────────────────────────────

export interface CanonicalSaleLine {
  legacyLineId?: string | number;
  productId: string | number;
  productCode: string;
  productName: string;
  batchNo?: string;
  expiry?: string;
  unit: string;
  multiplier: number;
  qty: number;
  unitPrice: number;
  cost?: number;
  discountPct?: number;
  discountAmt?: number;
  taxPct?: number;
  lineTotal: number;
}

export interface CanonicalSale {
  legacyId: string | number;
  invoiceNo: string;
  date: string; // ISO
  customerId?: string | number;
  customerName?: string;
  customerPhone?: string;
  operatorId?: string | number;
  operatorName?: string;
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  paymentMethod: "cash" | "card" | "credit" | "wallet" | "split" | "other";
  status: "paid" | "partial" | "unpaid" | "returned" | "cancelled";
  lines: CanonicalSaleLine[];
  notes?: string;
}

// ── Purchases History ─────────────────────────────────────────────────────

export interface CanonicalPurchaseLine {
  legacyLineId?: string | number;
  productId: string | number;
  productCode: string;
  productName: string;
  batchNo: string;
  expiry?: string;
  unit: string;
  multiplier: number;
  qty: number;
  freeQty: number;
  costPerUnit: number;
  discountPct?: number;
  lineTotal: number;
  retailPrice?: number;
}

export interface CanonicalPurchase {
  legacyId: string | number;
  purchaseNo: string;
  invoiceReference?: string;
  date: string; // ISO
  supplierId?: string | number;
  supplierName: string;
  operatorId?: string | number;
  operatorName?: string;
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  lines: CanonicalPurchaseLine[];
  notes?: string;
  excludeFromSupplierBalance?: boolean;
}

// ── Returns History ───────────────────────────────────────────────────────

export interface CanonicalSaleReturnLine {
  legacyLineId?: string | number;
  productId: string | number;
  productCode: string;
  productName: string;
  qty: number;
  price: number;
  discountDeducted?: number;
  lineTotal: number;
}

export interface CanonicalSaleReturn {
  legacyId: string | number;
  returnNo: string;
  date: string; // ISO
  originalInvoiceNo?: string;
  originalInvoiceId?: string | number;
  customerId?: string | number;
  customerName?: string;
  operatorName?: string;
  subtotal: number;
  discount: number;
  total: number;
  refundMethod: "cash" | "card" | "credit" | "wallet";
  reason?: string;
  lines: CanonicalSaleReturnLine[];
}

export interface CanonicalPurchaseReturn {
  legacyId: string | number;
  returnNo: string;
  date: string; // ISO
  originalPurchaseNo?: string;
  supplierId?: string | number;
  supplierName: string;
  total: number;
  reason?: string;
  lines: {
    productId: string | number;
    productCode: string;
    productName: string;
    qty: number;
    cost: number;
    lineTotal: number;
  }[];
}

// ── Ledger, Cashbook & Expenses ───────────────────────────────────────────

export interface CanonicalLedgerEntry {
  legacyId: string | number;
  date: string; // ISO
  accountType: "customer" | "supplier" | "cash" | "bank" | "expense" | "income" | "other";
  entityId?: string | number;
  entityName?: string;
  transactionType: string; // Source transaction string
  mappedPharmxeKind: "sale_payment" | "customer_receipt" | "supplier_payment" | "expense" | "income" | "opening_balance" | "legacy_adjustment";
  referenceNo?: string;
  debit: number;
  credit: number;
  balanceAfter?: number;
  description?: string;
  operatorName?: string;
}

export interface CanonicalExpense {
  legacyId: string | number;
  date: string;
  category: string;
  amount: number;
  paymentMethod: string;
  note?: string;
  operatorName?: string;
}

export interface CanonicalIncome {
  legacyId: string | number;
  date: string;
  category: string;
  amount: number;
  paymentMethod: string;
  note?: string;
  operatorName?: string;
}

// ── Employee / Operator ───────────────────────────────────────────────────

export interface CanonicalEmployee {
  legacyId: string | number;
  name: string;
  username?: string;
  code?: string;
  role?: string;
  phone?: string;
  isActive: boolean;
}
