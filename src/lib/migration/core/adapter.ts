/**
 * AivraSol POS — Migration Source Adapter Interface
 * 
 * Future-ready architectural abstraction allowing different source POS systems
 * (KeyPOS, Pharmix, QuickPOS, etc.) to plug into the shared Canonical Migration Model
 * and AivraSol Importer without rewriting core application logic.
 */

export type FieldClassification = "REQUIRED" | "OPTIONAL" | "IGNORED" | "UNKNOWN";

export interface ColumnFingerprint {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  classification: FieldClassification;
  mappedTargetField?: string;
}

export interface TableFingerprint {
  tableName: string;
  exists: boolean;
  classification: FieldClassification;
  rowCount: number;
  columns: ColumnFingerprint[];
}

export type SchemaCompatibilityStatus = "COMPATIBLE" | "PARTIALLY_COMPATIBLE" | "UNSUPPORTED";

export interface SchemaCompatibilityReport {
  sourceSoftware: string;
  sourceDatabaseName: string;
  databaseVersion?: string;
  serverCollation?: string;
  status: SchemaCompatibilityStatus;
  compatibilityScore: number; // 0 - 100 percentage
  requiredTablesPresent: string[];
  requiredTablesMissing: string[];
  optionalTablesPresent: string[];
  optionalTablesMissing: string[];
  unknownTables: string[];
  tableDetails: Record<string, TableFingerprint>;
  summaryNotes: string[];
}

export type WarningSeverity = "BLOCKING" | "WARNING" | "INFO";

export interface MigrationWarning {
  id: string;
  severity: WarningSeverity;
  category: string;
  title: string;
  description: string;
  impactedCount?: number;
  samples?: unknown[];
  recommendedAction?: string;
  acknowledged?: boolean;
}

export interface DynamicSourceMetrics {
  databaseName: string;
  serverName?: string;
  backupCreatedAt?: string;
  backupHash: string;
  productsCount: number;
  categoriesCount: number;
  manufacturersCount: number;
  customersCount: number;
  suppliersCount: number;
  currentStockQty: number;
  stockValuationCost: number;
  stockValuationRetail: number;
  salesInvoicesCount: number;
  salesLinesCount: number;
  salesTotalRevenue: number;
  salesTotalReceived: number;
  purchasesCount: number;
  purchasesLinesCount: number;
  purchasesTotalCost: number;
  salesReturnsCount: number;
  salesReturnsTotal: number;
  purchaseReturnsCount: number;
  purchaseReturnsTotal: number;
  outstandingReceivables: number;
  outstandingPayables: number;
  negativeStockCount: number;
  zeroPriceProductsCount: number;
  duplicateBarcodeCount: number;
  unassignedCreditInvoicesCount: number;
  expensesCount: number;
  incomesCount: number;
  ledgerEntriesCount: number;
}

export interface FieldMappingDefinition {
  sourceTable: string;
  sourceColumn: string;
  targetCollection: string;
  targetField: string;
  transformationRule: string;
  unitNormalization: string;
  defaultBehavior: string;
  confidence: "EXACT" | "HIGH" | "MEDIUM" | "EXCLUDED";
  validationRequirement: string;
}

export interface CategoryPreviewCount {
  category: string;
  found: number;
  valid: number;
  warnings: number;
}

export interface RepresentativeMappingExample {
  category: string;
  sourceSummary: string;
  targetSummary: string;
}

export interface SourceAnalysisResult {
  adapterId: string;
  adapterName: string;
  backupFilePath: string;
  backupFileName: string;
  backupHash: string;
  sourceDatabaseName: string;
  compatibility: SchemaCompatibilityReport;
  metrics: DynamicSourceMetrics;
  warnings: MigrationWarning[];
  hasBlockingIssues: boolean;
  tempDatabaseName?: string;
  categoryPreviewCounts?: CategoryPreviewCount[];
  fieldMappings?: FieldMappingDefinition[];
  mappingExamples?: RepresentativeMappingExample[];
}

export interface CanonicalBundle {
  batchId: string;
  sourceSystem: string;
  extractedAt: string;
  sourceMetrics: DynamicSourceMetrics;
  categories: { id: string | number; name: string }[];
  operators: unknown[];
  suppliers: unknown[];
  customers: unknown[];
  products: unknown[];
  stockBatches: unknown[];
  salesInvoices: unknown[];
  purchases: unknown[];
  salesReturns: unknown[];
  purchaseReturns: unknown[];
  ledgerEntries: unknown[];
}

export interface ReconciliationMetric {
  metric: string;
  category: "inventory" | "sales" | "purchases" | "returns" | "financials";
  sourceValue: number;
  targetValue: number;
  diff: number;
  status: "EXACT_MATCH" | "ACCEPTABLE_DIFF" | "DISCREPANCY";
  unit: string;
  notes?: string;
}

export interface DryRunReconciliationReport {
  batchId: string;
  sourceBackupHash: string;
  executedAt: string;
  overallStatus: "PASSED" | "FAILED";
  metrics: ReconciliationMetric[];
  conflicts: {
    blockingCount: number;
    warningsCount: number;
    details: MigrationWarning[];
  };
  sampleVerifications: {
    sampleProducts: unknown[];
    sampleInvoices: unknown[];
    samplePurchases: unknown[];
  };
}

export interface MigrationSourceAdapter {
  id: string;
  name: string;
  description: string;
  supportedExtensions: string[];

  /** Quick validation to check if the file can be inspected by this adapter */
  canHandle(filePath: string): Promise<boolean>;

  /** Full schema analysis and dynamic count derivation */
  analyze(filePath: string, options?: { tempDbName?: string }): Promise<SourceAnalysisResult>;

  /** Extracts all data into the shared Canonical Migration Model */
  extractCanonical(filePath: string, batchId: string, options?: { tempDbName?: string }): Promise<CanonicalBundle>;

  /** Cleans up temporary resources (e.g. dropped SQL database, temp files) */
  cleanup(context: { tempDbName?: string; tempFiles?: string[] }): Promise<void>;
}
