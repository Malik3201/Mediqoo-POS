import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export interface IOwnerAlertResolution {
  alert_id: string;
  status: "open" | "acknowledged" | "resolved";
  note?: string;
  updated_by: string;
  updated_at: string;
}

export interface IOwnerReorderWatchItem {
  product_id: string;
  code?: string;
  name: string;
  category?: string;
  supplier_name?: string;
  current_stock?: number;
  reorder_level?: number;
  target_order_qty: number;
  last_cost?: number;
  note?: string;
  status: "watch" | "ordered" | "received";
  added_by: string;
  added_at: string;
}

export interface IOwnerCashDiscrepancyReview {
  session_id: string;
  business_date?: string;
  status: "reviewed" | "flagged_for_audit";
  note?: string;
  reviewed_by: string;
  reviewed_at: string;
}

export interface IOwnerReviewTask {
  task_id: string;
  title: string;
  category: string;
  ref_id?: string;
  ref_href?: string;
  status: "open" | "completed";
  note?: string;
  updated_by: string;
  updated_at: string;
}

export interface IOwnerSavedReportPrefs {
  default_category?: "sales" | "purchases" | "customers" | "inventory" | "financial";
  default_period?: "today" | "7d" | "30d" | "90d";
  pinned_subreports?: string[];
  updated_at?: string;
}

export interface IOwnerActionState extends Document {
  id: string;
  client_id: string;
  alert_states: IOwnerAlertResolution[];
  reorder_watchlist: IOwnerReorderWatchItem[];
  cash_reviews: IOwnerCashDiscrepancyReview[];
  review_tasks: IOwnerReviewTask[];
  saved_report_prefs?: IOwnerSavedReportPrefs;
  created_at: Date;
  updated_at: Date;
}

const OwnerActionStateSchema = new Schema<IOwnerActionState>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    client_id: { type: String, required: true, unique: true, index: true },
    alert_states: { type: [Schema.Types.Mixed] as any, default: [] },
    reorder_watchlist: { type: [Schema.Types.Mixed] as any, default: [] },
    cash_reviews: { type: [Schema.Types.Mixed] as any, default: [] },
    review_tasks: { type: [Schema.Types.Mixed] as any, default: [] },
    saved_report_prefs: { type: Schema.Types.Mixed, default: {} },
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

if (mongoose.models.OwnerActionState) {
  delete mongoose.models.OwnerActionState;
}

export default mongoose.model<IOwnerActionState>("OwnerActionState", OwnerActionStateSchema);

