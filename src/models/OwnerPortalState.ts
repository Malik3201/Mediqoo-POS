import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IPortalCustomerSnapshot {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  opening_balance: number;
  credit_balance: number;
  total_credit_sales: number;
  total_returns_deducted: number;
  total_payments: number;
  last_purchase_at?: string;
  last_payment_at?: string;
  credit_status: "clear" | "due" | "overdue" | "advance";
  is_migrated?: boolean;
}

export interface IPortalKhataPaymentSnapshot {
  id: string;
  customer_id: string;
  customer_name?: string;
  date: string;
  amount: number;
  method: "cash" | "bank" | "cheque" | "other";
  reference?: string;
  note?: string;
  operator_name?: string;
}

export interface IPortalSupplierSnapshot {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  opening_balance: number;
  verified_payable: number;
  total_purchases_amount: number;
  total_purchases_count: number;
  unverified_historical_purchases_count: number;
  unverified_historical_purchases_amount: number;
  legacy_balance_status: "verified" | "historical_unverified";
  last_purchase_at?: string;
  is_migrated?: boolean;
}

export interface IPortalSupplierPaymentSnapshot {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  amount: number;
  method: "cash" | "bank" | "cheque" | "other";
  reference?: string;
  note?: string;
  operator_name?: string;
}

export interface IPortalPurchaseReturnSnapshot {
  id: string;
  number: string;
  date: string;
  supplier_id?: string | null;
  supplier_name?: string;
  purchase_id?: string | null;
  purchase_number?: string;
  total: number;
  reason?: string;
  operator_name?: string;
  items: Array<{
    product_id: string;
    code?: string;
    name: string;
    qty: number;
    cost: number;
    line_total: number;
  }>;
}

export interface IPortalCurrentDrawerSnapshot {
  status: "open" | "closed";
  session_id?: string;
  drawer_id?: string;
  drawer_name?: string;
  terminal_number?: number;
  business_date?: string;
  opened_by?: string;
  opened_at?: string;
  closed_by?: string;
  closed_at?: string;
  opening_float: number;
  cash_sales: number;
  cash_receipts: number;
  cash_refunds: number;
  cash_expenses: number;
  cash_supplier_payments: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash?: number;
  variance?: number;
  variance_reason?: string;
  notes?: string;
  last_reconciled_at?: string;
}

export interface IPortalDrawerSessionSnapshot {
  id: string;
  business_date: string;
  drawer_name?: string;
  terminal_number?: number;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  closed_by?: string;
  closed_at?: string;
  opening_cash: number;
  expected_cash?: number;
  counted_cash?: number;
  variance?: number;
  variance_reason?: string;
  opening_note?: string;
  closing_note?: string;
  movements: Array<{
    id: string;
    timestamp: string;
    type: "cash_in" | "cash_out";
    category: string;
    amount: number;
    reason: string;
    reference?: string;
    operator_name?: string;
  }>;
}

export interface IPortalDailyClosingSnapshot {
  id: string;
  business_date: string;
  scope: "store" | "terminal";
  terminal_number?: number;
  status: "closed" | "amended" | "superseded";
  revision: number;
  closed_at: string;
  closed_by: string;
  verified_by?: string;
  notes?: string;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  wallet_sales: number;
  credit_sales: number;
  verified_collections: number;
  returns_total: number;
  expenses_total: number;
  expected_cash: number;
  counted_cash?: number;
  variance?: number;
}

export interface IPortalInventoryAlertsSnapshot {
  expiring_items: Array<{
    product_id: string;
    code?: string;
    name: string;
    category?: string;
    batch_no?: string;
    expiry: string;
    qty: number;
    days_left: number;
    cost: number;
    value: number;
    requires_expiry_review?: boolean;
  }>;
  low_stock_items: Array<{
    product_id: string;
    code?: string;
    name: string;
    category?: string;
    current_stock: number;
    reorder_level: number;
    cost: number;
    supplier_name?: string;
  }>;
  unverified_expiry_items?: Array<{
    product_id: string;
    code?: string;
    name: string;
    category?: string;
    batch_no?: string;
    qty: number;
    cost: number;
    value: number;
  }>;
}

export interface IPortalProductIntelligenceItem {
  product_id: string;
  code?: string;
  name: string;
  generic_name?: string;
  category?: string;
  manufacturer?: string;
  pack_size?: number;
  unit_type?: string;
  current_stock: number;
  reorder_level: number;
  sale_price: number;
  cost_wac: number;
  stock_value: number;
  margin_pct: number;
  sold_qty_30d: number;
  sold_qty_90d: number;
  sold_revenue_30d: number;
  gross_profit_30d: number;
  last_sold_at?: string;
  last_purchased_at?: string;
  last_purchase_cost?: number;
  prev_purchase_cost?: number;
  cost_change_pct?: number;
  last_supplier_name?: string;
  nearest_expiry?: string;
  nearest_batch?: string;
  days_to_expiry?: number | null;
  has_unverified_expiry?: boolean;
  movement_status: "fast_moving" | "normal" | "slow_moving" | "dead_stock" | "out_of_stock";
  is_overstock?: boolean;
  is_negative_margin?: boolean;
}

export interface IPortalSupplierPriceChange {
  id: string;
  product_id: string;
  product_code?: string;
  product_name: string;
  supplier_id?: string;
  supplier_name: string;
  purchase_id?: string;
  grn_number: string;
  date: string;
  old_cost: number;
  new_cost: number;
  change_amount: number;
  change_pct: number;
  qty: number;
  unit_type?: string;
}

export interface IPortalCategorySummary {
  category: string;
  sku_count: number;
  stock_qty: number;
  stock_value: number;
  sold_qty_30d: number;
  revenue_30d: number;
  cogs_30d: number;
  gross_profit_30d: number;
}

export interface IPortalManufacturerSummary {
  manufacturer: string;
  sku_count: number;
  stock_qty: number;
  stock_value: number;
  sold_qty_30d: number;
  revenue_30d: number;
  gross_profit_30d: number;
}

export interface IPortalCashierPerformance {
  cashier_name: string;
  invoices_count_30d: number;
  gross_sales_30d: number;
  discounts_given_30d: number;
  net_sales_30d: number;
  returns_count_30d: number;
  returns_amount_30d: number;
  high_discount_count_30d: number;
}

export interface IOwnerPortalState extends Document {
  id: string;
  client_id: string;
  license_id: string;
  reported_by_terminal?: number;
  reported_by_seat_id?: string;
  captured_at: Date;
  pos_version?: string;
  movement_coverage_days?: number;
  last_retention_compaction_at?: Date;
  last_data_reset_at?: Date;
  last_data_reset_id?: string;
  pharmacy_name?: string;
  pharmacy_phone?: string;
  pharmacy_address?: string;
  customers: IPortalCustomerSnapshot[];
  khata_payments: IPortalKhataPaymentSnapshot[];
  suppliers: IPortalSupplierSnapshot[];
  supplier_payments: IPortalSupplierPaymentSnapshot[];
  purchase_returns: IPortalPurchaseReturnSnapshot[];
  current_drawer?: IPortalCurrentDrawerSnapshot;
  drawer_sessions: IPortalDrawerSessionSnapshot[];
  daily_closings: IPortalDailyClosingSnapshot[];
  inventory_alerts?: IPortalInventoryAlertsSnapshot;
  products_intelligence?: IPortalProductIntelligenceItem[];
  supplier_price_changes?: IPortalSupplierPriceChange[];
  category_breakdown_30d?: IPortalCategorySummary[];
  manufacturer_breakdown_30d?: IPortalManufacturerSummary[];
  cashier_performance_30d?: IPortalCashierPerformance[];
  created_at: Date;
  updated_at: Date;
}

const OwnerPortalStateSchema = new Schema<IOwnerPortalState>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    reported_by_terminal: { type: Number },
    reported_by_seat_id: { type: String },
    captured_at: { type: Date, required: true, default: Date.now },
    pos_version: { type: String },
    movement_coverage_days: { type: Number, default: 90 },
    last_retention_compaction_at: { type: Date },
    last_data_reset_at: { type: Date },
    last_data_reset_id: { type: String },
    pharmacy_name: { type: String },
    pharmacy_phone: { type: String },
    pharmacy_address: { type: String },
    customers: { type: [Schema.Types.Mixed] as any, default: [] },
    khata_payments: { type: [Schema.Types.Mixed] as any, default: [] },
    suppliers: { type: [Schema.Types.Mixed] as any, default: [] },
    supplier_payments: { type: [Schema.Types.Mixed] as any, default: [] },
    purchase_returns: { type: [Schema.Types.Mixed] as any, default: [] },
    current_drawer: { type: Schema.Types.Mixed },
    drawer_sessions: { type: [Schema.Types.Mixed] as any, default: [] },
    daily_closings: { type: [Schema.Types.Mixed] as any, default: [] },
    inventory_alerts: { type: Schema.Types.Mixed },
    products_intelligence: { type: [Schema.Types.Mixed] as any, default: [] },
    supplier_price_changes: { type: [Schema.Types.Mixed] as any, default: [] },
    category_breakdown_30d: { type: [Schema.Types.Mixed] as any, default: [] },
    manufacturer_breakdown_30d: { type: [Schema.Types.Mixed] as any, default: [] },
    cashier_performance_30d: { type: [Schema.Types.Mixed] as any, default: [] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// One canonical state document per license
OwnerPortalStateSchema.index({ client_id: 1, license_id: 1 }, { unique: true });

if (mongoose.models.OwnerPortalState) {
  delete mongoose.models.OwnerPortalState;
}

export default mongoose.model<IOwnerPortalState>("OwnerPortalState", OwnerPortalStateSchema);
