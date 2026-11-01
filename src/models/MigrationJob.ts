import mongoose, { Schema, Document } from "mongoose";
import crypto from "crypto";

export type MigrationJobStatus =
  | "uploaded"
  | "analyzing"
  | "needs_review"
  | "ready_to_convert"
  | "converting"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";

export interface IMigrationWarning {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  count?: number;
  details?: any;
}

export interface IBlockingIssue {
  code: string;
  title: string;
  count: number;
  resolution_strategy: string;
  resolved: boolean;
  resolved_at?: Date;
  resolved_by?: string;
  notes?: string;
}

export interface IMigrationAuditEvent {
  timestamp: Date;
  actor: string;
  action: string;
  details?: string;
}

export interface IMigrationJob extends Document {
  id: string;
  job_number: string;
  source_software: string;
  source_format: string;
  source_database?: string;
  source_filename: string;
  source_file_size: number;
  source_file_hash: string;
  source_object_key: string;

  // Target Pharmacy Binding (Optional for Portable Migration)
  client_id?: string;
  project_id?: string;
  license_id?: string;
  license_key?: string;
  pharmacy_name?: string;

  // Portability & Package Classification
  is_portable?: boolean;
  package_type?: "portable-legacy-migration" | "license-bound-legacy-migration" | string;

  created_by: {
    id: string;
    email: string;
  };

  status: MigrationJobStatus;
  stage: string;
  progress: number; // 0 to 100

  mapping_version: string;
  converter_version: string;

  // Extracted Source Metrics
  source_metrics: {
    total_tables?: number;
    populated_tables?: number;
    empty_tables?: number;
    torn_pages_restored?: number;
    data_pages?: number;
    raw_records?: Record<string, number>;
  };

  // Normalized Canonical Counts
  normalized_counts: {
    products: number;
    customers: number;
    suppliers: number;
    invoices: number;
    purchases: number;
    sales_returns: number;
    total: number;
  };

  // Lossless Source Archive Counts
  archive_counts: {
    cmh_tables: number;
    orphan_sales: number;
    orphan_purchases: number;
    header_only_returns: number;
    unmapped_tables: number;
    total: number;
  };

  // Reconciled Financials
  reconciliation: {
    stock_total_units: number;
    stock_valuation_pkr: number;
    sales_total_pkr: number;
    purchases_total_pkr: number;
    returns_total_pkr: number;
    customer_receivable_pkr: number;
    supplier_payable_pkr: number;
  };

  warnings: IMigrationWarning[];
  blocking_issues: IBlockingIssue[];

  // Output .aivrabak package metadata
  output_backup?: {
    object_key: string;
    filename: string;
    size_bytes: number;
    checksum_sha256: string;
    format: "aivrasol-backup";
    version: number;
    package_type?: string;
    is_portable?: boolean;
    created_at: Date;
  };

  // Unique Restore Key (Stored securely encrypted with server master secret)
  restore_key?: {
    encrypted_key: string;
    iv: string;
    tag: string;
    key_preview: string; // e.g. "MIG-ABZ-••••-••••-8A2F"
    issued_at?: Date;
  };

  error_category?: string;
  error_message?: string;

  audit_events: IMigrationAuditEvent[];

  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const MigrationJobSchema = new Schema<IMigrationJob>(
  {
    id: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
    job_number: { type: String, required: true, unique: true, index: true },
    source_software: { type: String, required: true },
    source_format: { type: String, required: true },
    source_database: { type: String },
    source_filename: { type: String, required: true },
    source_file_size: { type: Number, required: true },
    source_file_hash: { type: String, required: true },
    source_object_key: { type: String, required: true },

    client_id: { type: String, index: true },
    project_id: { type: String, index: true },
    license_id: { type: String, index: true },
    license_key: { type: String },
    pharmacy_name: { type: String },

    is_portable: { type: Boolean, default: true, index: true },
    package_type: { type: String, default: "portable-legacy-migration" },

    created_by: {
      id: { type: String, required: true },
      email: { type: String, required: true },
    },

    status: {
      type: String,
      enum: [
        "uploaded",
        "analyzing",
        "needs_review",
        "ready_to_convert",
        "converting",
        "validating",
        "completed",
        "failed",
        "cancelled",
      ],
      default: "uploaded",
      index: true,
    },
    stage: { type: String, default: "Backup Uploaded" },
    progress: { type: Number, default: 0 },

    mapping_version: { type: String, default: "1.0.0" },
    converter_version: { type: String, default: "2.0.0-cloud" },

    source_metrics: {
      total_tables: { type: Number, default: 0 },
      populated_tables: { type: Number, default: 0 },
      empty_tables: { type: Number, default: 0 },
      torn_pages_restored: { type: Number, default: 0 },
      data_pages: { type: Number, default: 0 },
      raw_records: { type: Schema.Types.Mixed, default: {} },
    },

    normalized_counts: {
      products: { type: Number, default: 0 },
      customers: { type: Number, default: 0 },
      suppliers: { type: Number, default: 0 },
      invoices: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      sales_returns: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    archive_counts: {
      cmh_tables: { type: Number, default: 0 },
      orphan_sales: { type: Number, default: 0 },
      orphan_purchases: { type: Number, default: 0 },
      header_only_returns: { type: Number, default: 0 },
      unmapped_tables: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    reconciliation: {
      stock_total_units: { type: Number, default: 0 },
      stock_valuation_pkr: { type: Number, default: 0 },
      sales_total_pkr: { type: Number, default: 0 },
      purchases_total_pkr: { type: Number, default: 0 },
      returns_total_pkr: { type: Number, default: 0 },
      customer_receivable_pkr: { type: Number, default: 0 },
      supplier_payable_pkr: { type: Number, default: 0 },
    },

    warnings: [
      {
        code: { type: String },
        severity: { type: String, enum: ["info", "warning", "blocking"] },
        message: { type: String },
        count: { type: Number },
        details: { type: Schema.Types.Mixed },
      },
    ],
    blocking_issues: [
      {
        code: { type: String },
        title: { type: String },
        count: { type: Number },
        resolution_strategy: { type: String },
        resolved: { type: Boolean, default: false },
        resolved_at: { type: Date },
        resolved_by: { type: String },
        notes: { type: String },
      },
    ],

    output_backup: {
      object_key: { type: String },
      filename: { type: String },
      size_bytes: { type: Number },
      checksum_sha256: { type: String },
      format: { type: String, default: "aivrasol-backup" },
      version: { type: Number, default: 2 },
      package_type: { type: String, default: "portable-legacy-migration" },
      is_portable: { type: Boolean, default: true },
      created_at: { type: Date },
    },

    restore_key: {
      encrypted_key: { type: String },
      iv: { type: String },
      tag: { type: String },
      key_preview: { type: String },
      issued_at: { type: Date },
    },

    error_category: { type: String },
    error_message: { type: String },

    audit_events: {
      type: [
        {
          timestamp: { type: Date, default: Date.now },
          actor: { type: String, required: true },
          action: { type: String, required: true },
          details: { type: String },
        },
      ],
      default: [],
    },

    started_at: { type: Date },
    completed_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret: any) {
        delete ret._id;
        delete ret.__v;
        if (ret.restore_key) {
          // Never expose encrypted_key, iv, tag in standard JSON responses
          delete ret.restore_key.encrypted_key;
          delete ret.restore_key.iv;
          delete ret.restore_key.tag;
        }
        return ret;
      },
    },
  }
);

MigrationJobSchema.index({ client_id: 1, created_at: -1 });
MigrationJobSchema.index({ license_id: 1, created_at: -1 });
MigrationJobSchema.index({ status: 1, created_at: -1 });

export default mongoose.models.MigrationJob ||
  mongoose.model<IMigrationJob>("MigrationJob", MigrationJobSchema);
