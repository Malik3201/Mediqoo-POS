import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

/**
 * HistoricalRecentSale — last N sales records from bootstrap, for portal display only.
 *
 * NOT used for financial totals. Financial totals come from HistoricalDailyAnalytics
 * (historical period) + AnalyticsEvent/CloudExpense (live period).
 *
 * Purpose: populate the "Recent Sales" table on portal dashboard with pre-bootstrap data
 * so the owner doesn't see an empty list immediately after portal activation.
 *
 * Maximum: 100 records per license (enforced at bootstrap endpoint level).
 * Stored in descending occurred_at order.
 *
 * These records are combined with live AnalyticsEvent sale.completed records in
 * the /api/portal/dashboard/top endpoint (recent_sales list).
 */
export interface IHistoricalRecentSale extends Document {
  id: string;
  client_id: string;
  license_id: string;
  occurred_at: Date;          // absolute UTC timestamp
  invoice_number?: string;
  gross_sales: number;
  net_sales: number;
  payment_method?: string;
  customer_name?: string;
  created_at: Date;
}

const HistoricalRecentSaleSchema = new Schema<IHistoricalRecentSale>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    license_id: { type: String, required: true },
    occurred_at: { type: Date, required: true },
    invoice_number: { type: String },
    gross_sales: { type: Number, default: 0 },
    net_sales: { type: Number, default: 0 },
    payment_method: { type: String },
    customer_name: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc: any, ret: Record<string, any>) {
        delete (ret as any)._id;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Performance index for portal recent-sales list
HistoricalRecentSaleSchema.index({ client_id: 1, license_id: 1, occurred_at: -1 });

export default mongoose.models.HistoricalRecentSale ||
  mongoose.model<IHistoricalRecentSale>("HistoricalRecentSale", HistoricalRecentSaleSchema);
