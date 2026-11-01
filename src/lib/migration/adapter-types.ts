/**
 * Unified Migration Platform Adapter Types (Mediqoo Server & AivraSol POS)
 */

export interface SourceAnalysisResult {
  adapterId: string;
  adapterName: string;
  sourceFormat: string;
  sourceDatabase?: string;
  sourceSize: number;
  sourceHash: string;
  metadata: {
    serverVersion?: string;
    internalDbVersion?: number;
    tornPagesRestored?: number;
    allocatedPages?: number;
    totalUserTables?: number;
    populatedTables?: number;
    emptyTables?: number;
  };
  metrics: {
    rawTablesCount: number;
    rawRowsCount: number;
    tableDetails: {
      name: string;
      rowCount: number;
      columnsCount: number;
      allocatedPages: number;
      status: "FULLY_RECOVERED" | "PARTIALLY_RECOVERED" | "EMPTY" | "UNSUPPORTED";
    }[];
  };
  recoverableCounts: {
    products: number;
    customers: number;
    suppliers: number;
    invoices: number;
    purchases: number;
    salesReturns: number;
  };
  warnings: {
    code: string;
    severity: "info" | "warning" | "blocking";
    message: string;
    count?: number;
    details?: any;
  }[];
  blockingIssues: {
    code: string;
    title: string;
    count: number;
    resolutionStrategy: string;
    resolved: boolean;
  }[];
}

export interface CanonicalBundle {
  products: any[];
  customers: any[];
  suppliers: any[];
  invoices: any[];
  purchases: any[];
  salesReturns: any[];
  cashbookEntries: any[];
  archiveRecords: {
    type: string;
    legacyTable: string;
    count: number;
    records: any[];
  }[];
  reconciliation: {
    stockTotalUnits: number;
    stockValuationPkr: number;
    salesTotalPkr: number;
    purchasesTotalPkr: number;
    returnsTotalPkr: number;
    customerReceivablePkr: number;
    supplierPayablePkr: number;
  };
}

export interface MigrationSourceAdapter {
  id: string;
  name: string;
  description: string;
  supportedExtensions: string[];

  canHandle(filePath: string, buffer?: Buffer): Promise<boolean>;
  analyze(filePath: string, buffer?: Buffer): Promise<SourceAnalysisResult>;
  extractCanonical(filePath: string, buffer?: Buffer): Promise<CanonicalBundle>;
}
