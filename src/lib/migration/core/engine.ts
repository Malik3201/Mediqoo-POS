/**
 * AivraSol POS — Unified Migration Engine
 * 
 * Orchestrates analysis, dry-run, reconciliation, safety backups, final production import,
 * and rollback across any supported POS migration adapter.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";

function genId(len = 12): string {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}
import type {
  MigrationSourceAdapter,
  SourceAnalysisResult,
  CanonicalBundle,
  DryRunReconciliationReport,
  ReconciliationMetric,
  MigrationWarning
} from "./adapter";
import { KeyPosMigrationAdapter } from "../adapters/keypos/keypos_adapter";
import { AbuzarMigrationAdapter } from "../adapters/abuzar/abuzar_adapter";

export interface MigrationEngineConfig {
  liveStoreDir?: string;
  backupDir?: string;
  workDir?: string;
}

export interface ExistingDataProfile {
  isEmpty: boolean;
  productsCount: number;
  invoicesCount: number;
  customersCount: number;
  purchasesCount: number;
  suppliersCount: number;
  totalRecords: number;
}

export interface FinalImportResult {
  batchId: string;
  source: string;
  backupHash: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed";
  counts: Record<string, number>;
  totals: Record<string, number>;
  warningsCount: number;
  warnings: string[];
  safetyBackupPath: string;
  rollbackAvailable: boolean;
}

export class MigrationEngine {
  private adapters = new Map<string, MigrationSourceAdapter>();
  private liveStoreDir: string;
  private backupDir: string;
  private workDir: string;
  private dryRunCache = new Map<string, { analysis: SourceAnalysisResult; canonical: CanonicalBundle; dryRun: DryRunReconciliationReport }>();

  constructor(config: MigrationEngineConfig = {}) {
    // Determine live store directory (default AivraSol AppData)
    const appData = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
    this.liveStoreDir = config.liveStoreDir || path.join(appData, "AivraSolPOS", "store");
    this.backupDir = config.backupDir || path.join(appData, "AivraSolPOS", "backups");
    this.workDir = config.workDir || path.resolve(__dirname, "../output");

    // Register KeyPOS and Abuzar Legacy adapters
    this.registerAdapter(new KeyPosMigrationAdapter());
    this.registerAdapter(new AbuzarMigrationAdapter());
  }

  /**
   * Automatically detects which registered adapter handles the given backup file
   * by inspecting real schema/table signatures inside the backup.
   * Never treats an Abuzar Pharmacy Legacy Database backup as KeyPOS.
   */
  async resolveAdapterForFile(requestedAdapterId: string, filePath: string): Promise<MigrationSourceAdapter> {
    const abuzar = this.adapters.get("abuzar");
    if (abuzar && await abuzar.canHandle(filePath)) {
      return abuzar;
    }
    if (requestedAdapterId && requestedAdapterId !== "auto") {
      return this.getAdapter(requestedAdapterId);
    }
    for (const adapter of this.adapters.values()) {
      if (adapter.id === "abuzar") continue;
      if (await adapter.canHandle(filePath)) {
        return adapter;
      }
    }
    return this.getAdapter("keypos");
  }

  registerAdapter(adapter: MigrationSourceAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(adapterId: string): MigrationSourceAdapter {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Migration adapter '${adapterId}' not found. Available adapters: ${Array.from(this.adapters.keys()).join(", ")}`);
    }
    return adapter;
  }

  getRegisteredAdapters(): { id: string; name: string; description: string; supportedExtensions: string[] }[] {
    return Array.from(this.adapters.values()).map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      supportedExtensions: a.supportedExtensions
    }));
  }

  // --------------------------------------------------------------------------
  // Encryption helpers for AivraSol native store files (.enc)
  // --------------------------------------------------------------------------
  private machineId(): string {
    const parts = [
      os.hostname(),
      os.platform(),
      os.arch(),
      (os.cpus()[0] || {}).model || "cpu",
      String(os.totalmem()),
    ];
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  }

  private encWrap(buf: Buffer): Buffer {
    const machineKey = crypto.createHash("sha256").update(this.machineId()).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", machineKey, iv);
    const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([2]), iv, tag, ct]);
  }

  private encUnwrap(buf: Buffer): Buffer {
    const mode = buf[0];
    const rest = buf.subarray(1);
    if (mode === 2) {
      const machineKey = crypto.createHash("sha256").update(this.machineId()).digest();
      const iv = rest.subarray(0, 12);
      const tag = rest.subarray(12, 28);
      const ct = rest.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", machineKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    }
    throw new Error("Unsupported envelope mode in store file");
  }

  private readStoreCollection<T = any>(storeDir: string, name: string): T[] {
    const p = path.join(storeDir, `${name}.enc`);
    if (!fs.existsSync(p)) return [];
    try {
      const buf = fs.readFileSync(p);
      const jsonStr = this.encUnwrap(buf).toString("utf-8");
      return JSON.parse(jsonStr);
    } catch {
      return [];
    }
  }

  private writeStoreCollection<T = any>(storeDir: string, name: string, rows: T[]): void {
    fs.mkdirSync(storeDir, { recursive: true });
    const p = path.join(storeDir, `${name}.enc`);
    const payload = Buffer.from(JSON.stringify(rows));
    const wrapped = this.encWrap(payload);
    fs.writeFileSync(p + ".tmp", wrapped);
    fs.renameSync(p + ".tmp", p);
  }

  // --------------------------------------------------------------------------
  // Step 3: Analyze
  // --------------------------------------------------------------------------
  async analyzeBackup(adapterId: string, filePath: string): Promise<SourceAnalysisResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Selected backup file does not exist at: ${filePath}`);
    }
    const adapter = await this.resolveAdapterForFile(adapterId, filePath);

    const result = await adapter.analyze(filePath);
    return result;
  }

  // --------------------------------------------------------------------------
  // Step 5: Dry Run & Dynamic Reconciliation
  // --------------------------------------------------------------------------
  async executeDryRun(
    adapterId: string,
    filePath: string,
    options: {
      customBatchId?: string;
      isolatedStoreDir?: string;
      tempDbName?: string;
      existingAnalysis?: SourceAnalysisResult;
    } = {}
  ): Promise<{ canonical: CanonicalBundle; dryRun: DryRunReconciliationReport }> {
    const adapter = await this.resolveAdapterForFile(adapterId, filePath);
    const batchId = options.customBatchId || `KBATCH-${Date.now().toString(36).toUpperCase()}`;

    // 1. Run dynamic analysis if not already provided
    const analysis = options.existingAnalysis || await adapter.analyze(filePath, { tempDbName: options.tempDbName });
    if (analysis.hasBlockingIssues) {
      throw new Error("Cannot run dry run: Backup has blocking schema or compatibility conflicts.");
    }

    // 2. Extract canonical data dynamically
    const canonical = await adapter.extractCanonical(filePath, batchId, { tempDbName: analysis.tempDatabaseName });

    // 3. Setup isolated dry-run store
    const dryRunStoreDir = options.isolatedStoreDir || path.join(this.workDir, `AivraSol_DryRun_${batchId}`, "store");
    if (fs.existsSync(dryRunStoreDir)) {
      fs.rmSync(dryRunStoreDir, { recursive: true, force: true });
    }
    fs.mkdirSync(dryRunStoreDir, { recursive: true });

    // 4. Perform full dry import into isolated store
    await this.performImportLogic(canonical, dryRunStoreDir, { isDryRun: true });

    // 5. Independently reconcile target store against source metrics
    const dryRun = this.reconcileDryRun(canonical, dryRunStoreDir);

    // Cache dry run result so Final Import can verify it passed
    this.dryRunCache.set(canonical.sourceMetrics.backupHash, { analysis, canonical, dryRun });

    return { canonical, dryRun };
  }

  private reconcileDryRun(canonical: CanonicalBundle, storeDir: string): DryRunReconciliationReport {
    const sm = canonical.sourceMetrics;

    const importedProducts = this.readStoreCollection(storeDir, "products");
    const importedInvoices = this.readStoreCollection(storeDir, "invoices");
    const importedPurchases = this.readStoreCollection(storeDir, "purchases");
    const importedCustomers = this.readStoreCollection(storeDir, "customers");
    const importedSuppliers = this.readStoreCollection(storeDir, "suppliers");
    const importedReturns = this.readStoreCollection(storeDir, "sales-returns");

    // Reconcile Products
    const targetProdCount = importedProducts.length;
    const targetStockQty = importedProducts.reduce((acc, p) => acc + (p.currentStock || 0), 0);
    const targetStockCost = importedProducts.reduce((acc, p) => acc + ((p.currentStock || 0) * (p.cost || 0)), 0);
    const targetStockRetail = importedProducts.reduce((acc, p) => acc + ((p.currentStock || 0) * (p.price || 0)), 0);

    // Reconcile Sales
    const targetSalesCount = importedInvoices.length;
    const targetSalesLines = importedInvoices.reduce((acc, inv) => acc + (inv.items?.length || 0), 0);
    const targetSalesTotal = importedInvoices.reduce((acc, inv) => acc + (inv.total || 0), 0);
    const targetSalesPaid = importedInvoices.reduce((acc, inv) => acc + (inv.paid || 0), 0);

    // Reconcile Purchases
    const targetPurchasesCount = importedPurchases.length;
    const targetPurchasesLines = importedPurchases.reduce((acc, po) => acc + (po.lines?.length || 0), 0);
    const targetPurchasesTotal = importedPurchases.reduce((acc, po) => acc + (po.total || 0), 0);

    // Reconcile Balances
    const targetReceivables = importedCustomers.reduce((acc, c) => acc + (c.creditBalance || 0), 0);
    const targetPayables = importedSuppliers.reduce((acc, s) => acc + (s.openingBalance || 0), 0);

    const checkMetric = (
      name: string,
      category: ReconciliationMetric["category"],
      sourceVal: number,
      targetVal: number,
      unit: string,
      tolerance = 0.01
    ): ReconciliationMetric => {
      const diff = Math.abs(sourceVal - targetVal);
      const isExact = diff === 0;
      const isAcceptable = diff <= tolerance;
      return {
        metric: name,
        category,
        sourceValue: parseFloat(sourceVal.toFixed(4)),
        targetValue: parseFloat(targetVal.toFixed(4)),
        diff: parseFloat(diff.toFixed(4)),
        status: isExact ? "EXACT_MATCH" : (isAcceptable ? "ACCEPTABLE_DIFF" : "DISCREPANCY"),
        unit,
        notes: isExact ? "100% exact match" : (isAcceptable ? `Minor rounding diff within threshold (${diff})` : `Discrepancy of ${diff}`)
      };
    };

    const metrics: ReconciliationMetric[] = [
      checkMetric("Product Count", "inventory", sm.productsCount, targetProdCount, "items"),
      checkMetric("Current Stock Qty", "inventory", sm.currentStockQty, targetStockQty, "units"),
      checkMetric("Stock Valuation (Cost)", "inventory", sm.stockValuationCost, targetStockCost, "PKR", 1.0),
      checkMetric("Stock Valuation (Retail)", "inventory", sm.stockValuationRetail, targetStockRetail, "PKR", 1.0),
      checkMetric("Sales Invoices Count", "sales", sm.salesInvoicesCount, targetSalesCount, "invoices"),
      checkMetric("Sales Line Items", "sales", sm.salesLinesCount, targetSalesLines, "lines"),
      checkMetric("Sales Total Revenue", "sales", sm.salesTotalRevenue, targetSalesTotal, "PKR", 1.0),
      checkMetric("Sales Total Received", "sales", sm.salesTotalReceived, targetSalesPaid, "PKR", 1.0),
      checkMetric("Purchases Count", "purchases", sm.purchasesCount, targetPurchasesCount, "orders"),
      checkMetric("Purchases Line Items", "purchases", sm.purchasesLinesCount, targetPurchasesLines, "lines"),
      checkMetric("Purchases Total Cost", "purchases", sm.purchasesTotalCost, targetPurchasesTotal, "PKR", 1.0),
      checkMetric("Customer Balances (Khata)", "financials", sm.outstandingReceivables, targetReceivables, "PKR"),
      checkMetric("Supplier Balances (Payable)", "financials", sm.outstandingPayables, targetPayables, "PKR"),
      checkMetric("Sales Returns Count", "returns", sm.salesReturnsCount, importedReturns.length, "returns")
    ];

    const hasDiscrepancy = metrics.some(m => m.status === "DISCREPANCY");
    const overallStatus = hasDiscrepancy ? "FAILED" : "PASSED";

    return {
      batchId: canonical.batchId,
      sourceBackupHash: sm.backupHash,
      executedAt: new Date().toISOString(),
      overallStatus,
      metrics,
      conflicts: {
        blockingCount: 0,
        warningsCount: (sm.negativeStockCount > 0 ? 1 : 0) + (sm.zeroPriceProductsCount > 0 ? 1 : 0),
        details: []
      },
      sampleVerifications: {
        sampleProducts: importedProducts.slice(0, 3),
        sampleInvoices: importedInvoices.slice(0, 3),
        samplePurchases: importedPurchases.slice(0, 3)
      }
    };
  }

  // --------------------------------------------------------------------------
  // Check Existing Live Store Data
  // --------------------------------------------------------------------------
  checkExistingData(targetStoreDir: string = this.liveStoreDir): ExistingDataProfile {
    const products = this.readStoreCollection(targetStoreDir, "products");
    const invoices = this.readStoreCollection(targetStoreDir, "invoices");
    const customers = this.readStoreCollection(targetStoreDir, "customers");
    const purchases = this.readStoreCollection(targetStoreDir, "purchases");
    const suppliers = this.readStoreCollection(targetStoreDir, "suppliers");

    const totalRecords = products.length + invoices.length + customers.length + purchases.length + suppliers.length;

    return {
      isEmpty: totalRecords === 0,
      productsCount: products.length,
      invoicesCount: invoices.length,
      customersCount: customers.length,
      purchasesCount: purchases.length,
      suppliersCount: suppliers.length,
      totalRecords
    };
  }

  // --------------------------------------------------------------------------
  // Step 6: Safety Snapshot of Live Store
  // --------------------------------------------------------------------------
  createLiveSafetyBackup(targetStoreDir: string = this.liveStoreDir): { ok: boolean; path: string; error?: string } {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(this.backupDir, `AivraSol_PreMigration_${timestamp}.json`);

      const collections = [
        "products", "customers", "invoices", "purchases", "sales-returns",
        "suppliers", "supplier-payments", "purchase-returns", "khata-payments",
        "cashbook-entries", "pos-users", "operator-sessions", "migration-history"
      ];

      const snapshot: Record<string, any[]> = {};
      let totalRecords = 0;

      for (const col of collections) {
        const rows = this.readStoreCollection(targetStoreDir, col);
        snapshot[col] = rows;
        totalRecords += rows.length;
      }

      fs.writeFileSync(backupPath, JSON.stringify({
        format: "aivrasol-safety-backup",
        version: 2,
        createdAt: new Date().toISOString(),
        totalRecords,
        data: snapshot
      }, null, 2), "utf-8");

      return { ok: true, path: backupPath };
    } catch (err: any) {
      return { ok: false, path: "", error: err.message || String(err) };
    }
  }

  // --------------------------------------------------------------------------
  // Step 6: Final Production Import
  // --------------------------------------------------------------------------
  async executeFinalImport(
    adapterId: string,
    filePath: string,
    options: {
      targetStoreDir?: string;
      allowMergeWithExistingData?: boolean;
    } = {}
  ): Promise<FinalImportResult> {
    const targetStoreDir = options.targetStoreDir || this.liveStoreDir;
    const adapter = await this.resolveAdapterForFile(adapterId, filePath);

    // 1. Check existing target data
    const existing = this.checkExistingData(targetStoreDir);
    if (!existing.isEmpty && !options.allowMergeWithExistingData) {
      throw new Error(`Target AivraSol store contains ${existing.totalRecords} existing business records. Merge confirmation is required.`);
    }

    // 2. Extract canonical bundle
    const batchId = `MIGRATE-${Date.now().toString(36).toUpperCase()}`;
    const canonical = await adapter.extractCanonical(filePath, batchId);
    const backupHash = canonical.sourceMetrics.backupHash;

    // 3. Pre-condition: Dry Run must have been verified for this backup
    let dryRunReport = this.dryRunCache.get(backupHash)?.dryRun;
    if (!dryRunReport || dryRunReport.overallStatus !== "PASSED") {
      // Execute dry run verification immediately to validate
      const dryRes = await this.executeDryRun(adapter.id, filePath, { customBatchId: `VERIFY-${batchId}` });
      if (dryRes.dryRun.overallStatus !== "PASSED") {
        throw new Error("Final import aborted: Automated dry-run reconciliation failed. Review discrepancies before proceeding.");
      }
      dryRunReport = dryRes.dryRun;
    }

    // 4. MANDATORY PRE-IMPORT SAFETY BACKUP of active store
    const safetyRes = this.createLiveSafetyBackup(targetStoreDir);
    if (!safetyRes.ok || !safetyRes.path) {
      throw new Error(`CRITICAL: Pre-migration safety backup failed: ${safetyRes.error}. Final import aborted immediately with ZERO changes to production.`);
    }

    const startedAt = new Date().toISOString();

    // 5. Perform safe production import
    const counts = await this.performImportLogic(canonical, targetStoreDir, { isDryRun: false });

    const completedAt = new Date().toISOString();
    const sourceLabel = adapter.id === "abuzar" ? "Abuzar Pharmacy Legacy Database" : "KeyPOS";

    // 6. Record Migration History
    const historyRecord = {
      id: genId(12),
      migrationBatchId: batchId,
      source: sourceLabel,
      backupFileName: path.basename(filePath),
      backupHash,
      sourceDatabaseName: canonical.sourceMetrics.databaseName,
      startedAt,
      completedAt,
      status: "completed" as const,
      counts,
      totals: {
        revenue: canonical.sourceMetrics.salesTotalRevenue,
        stockValue: canonical.sourceMetrics.stockValuationCost,
        receivables: canonical.sourceMetrics.outstandingReceivables
      },
      warningsCount: canonical.sourceMetrics.negativeStockCount > 0 ? 1 : 0,
      warnings: canonical.sourceMetrics.negativeStockCount > 0 ? [`${canonical.sourceMetrics.negativeStockCount} products have negative stock.`] : [],
      safetyBackupPath: safetyRes.path,
      rollbackAvailable: true
    };

    const history = this.readStoreCollection(targetStoreDir, "migration-history");
    history.push(historyRecord);
    this.writeStoreCollection(targetStoreDir, "migration-history", history);

    // 7. Cleanup temp database in sandbox
    await adapter.cleanup({ tempDbName: canonical.sourceMetrics.databaseName });

    return {
      batchId,
      source: sourceLabel,
      backupHash,
      startedAt,
      completedAt,
      status: "completed",
      counts,
      totals: historyRecord.totals,
      warningsCount: historyRecord.warningsCount,
      warnings: historyRecord.warnings,
      safetyBackupPath: safetyRes.path,
      rollbackAvailable: true
    };
  }

  // --------------------------------------------------------------------------
  // Shared Production Importer Logic (Order of operations, Idempotency, Guards)
  // --------------------------------------------------------------------------
  private async performImportLogic(
    bundle: CanonicalBundle,
    storeDir: string,
    options: { isDryRun: boolean }
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const now = new Date().toISOString();
    const isAbuzar = bundle.sourceSystem === "ABUZAR_LEGACY";
    const sourceSystem = bundle.sourceSystem || "KEYPOS";
    const scopeId = (rawId: string | number) =>
      isAbuzar ? `ABZ-${rawId}` : String(rawId);

    // 1. Suppliers
    const existingSuppliers = this.readStoreCollection(storeDir, "suppliers");
    const supplierMap = new Map<string, string>(); // raw/scoped legacyId -> AivraSol ID
    for (const s of existingSuppliers) {
      if (s.legacyId) supplierMap.set(String(s.legacyId), s.id);
    }

    for (const sup of bundle.suppliers as any[]) {
      const rawId = String(sup.legacyId);
      const legId = scopeId(rawId);
      if (!supplierMap.has(legId)) {
        const id = genId(12);
        existingSuppliers.push({
          id,
          name: sup.name,
          phone: sup.phone,
          email: sup.email,
          address: sup.address,
          manufacturers: sup.manufacturers || undefined,
          openingBalance: sup.openingBalance || 0,
          notes: sup.notes || undefined,
          legacyId: legId,
          migrationSource: sourceSystem,
          migrationBatchId: bundle.batchId,
          excludeMigratedPurchasesFromBalance: sup.excludeMigratedPurchasesFromBalance || false,
          createdAt: now,
          updatedAt: now
        });
        supplierMap.set(legId, id);
        supplierMap.set(rawId, id);
      } else {
        supplierMap.set(rawId, supplierMap.get(legId)!);
      }
    }
    this.writeStoreCollection(storeDir, "suppliers", existingSuppliers);
    counts["suppliers"] = existingSuppliers.length;

    // 2. Customers
    const existingCustomers = this.readStoreCollection(storeDir, "customers");
    const customerMap = new Map<string, string>(); // legacyId/name -> AivraSol ID
    for (const c of existingCustomers) {
      if (c.legacyId) customerMap.set(String(c.legacyId), c.id);
      if (c.name) customerMap.set(c.name.trim().toUpperCase(), c.id);
    }

    for (const cust of bundle.customers as any[]) {
      const rawId = String(cust.legacyId);
      const legId = scopeId(rawId);
      const normName = cust.name.trim().toUpperCase();
      if (!customerMap.has(legId) && !customerMap.has(normName)) {
        const id = genId(12);
        existingCustomers.push({
          id,
          name: cust.name,
          phone: cust.phone,
          email: cust.email,
          address: cust.address,
          creditBalance: cust.creditBalance || 0,
          legacyId: legId,
          migrationSource: sourceSystem,
          migrationBatchId: bundle.batchId,
          isMigrationAccount: cust.isMigrationAccount || false,
          notes: cust.notes,
          createdAt: now,
          updatedAt: now
        });
        customerMap.set(legId, id);
        customerMap.set(rawId, id);
        customerMap.set(normName, id);
      } else {
        const existingId = customerMap.get(legId) || customerMap.get(normName)!;
        customerMap.set(rawId, existingId);
      }
    }
    this.writeStoreCollection(storeDir, "customers", existingCustomers);
    counts["customers"] = existingCustomers.length;

    // 3. Products
    const existingProducts = this.readStoreCollection(storeDir, "products");
    const productMap = new Map<string, any>(); // legacyId -> Product
    const barcodeMap = new Map<string, string>();

    for (const p of existingProducts) {
      if (p.legacyId) productMap.set(String(p.legacyId), p);
      if (p.code) barcodeMap.set(p.code.trim().toUpperCase(), p.id);
      if (p.barcode) barcodeMap.set(p.barcode.trim().toUpperCase(), p.id);
    }

    for (const prod of bundle.products as any[]) {
      const rawId = String(prod.legacyId);
      const legId = scopeId(rawId);
      if (productMap.has(legId)) {
        // Idempotency: skip re-inserting already migrated item
        productMap.set(rawId, productMap.get(legId));
        continue;
      }

      // Check barcode conflict
      let finalCode = prod.code;
      const codeUpper = (prod.code || "").trim().toUpperCase();
      if (barcodeMap.has(codeUpper)) {
        // Disambiguate duplicate barcode safely
        finalCode = isAbuzar ? `${prod.code}-ABZ${rawId}` : `${prod.code}-KP${legId}`;
      }

      const id = genId(12);
      const prodBatches = Array.isArray(prod.batches) && prod.batches.length > 0
        ? prod.batches.map((b: any) => ({
            id: genId(10),
            batchNo: b.batchNo || "LEGACY-OPENING",
            expiry: b.expiry || b.expiryDate || undefined,
            qty: b.qty,
            cost: b.cost ?? (prod.cost || 0),
            isLegacyOpeningBatch: true,
            requiresExpiryReview: Boolean(b.requiresExpiryReview),
          }))
        : (prod.currentStock !== 0 ? [{
            id: genId(10),
            batchNo: "LEGACY-OPENING",
            qty: prod.currentStock,
            cost: prod.cost || 0,
            isLegacyOpeningBatch: true
          }] : []);

      const newProd = {
        id,
        code: finalCode,
        barcode: prod.barcode || undefined,
        name: prod.name,
        generic: prod.generic || undefined,
        category: prod.category || "General",
        manufacturer: prod.manufacturer || undefined,
        unit: prod.unit || "unit",
        packings: Array.isArray(prod.packings) && prod.packings.length > 0 ? prod.packings : undefined,
        packingConfidence: prod.packingConfidence || undefined,
        packingDetails: prod.packingDetails || undefined,
        price: prod.price || 0,
        cost: prod.cost || 0,
        currentStock: prod.currentStock || 0,
        reorderLevel: prod.reorderLevel || 10,
        controlled: Boolean(prod.controlled),
        location: prod.location || undefined,
        archived: !!prod.archived,
        // Migration safety metadata
        migrationSource: sourceSystem,
        migrationBatchId: bundle.batchId,
        legacyId: legId,
        legacyReference: prod.legacyReference || undefined,
        requiresPricingReview: !!prod.requiresPricingReview,
        requiresExpiryReview: !!prod.requiresExpiryReview,
        isLegacyOpeningStock: true,
        batches: prodBatches,
        createdAt: now,
        updatedAt: now
      };

      existingProducts.push(newProd);
      productMap.set(legId, newProd);
      productMap.set(rawId, newProd);
      barcodeMap.set(finalCode.trim().toUpperCase(), id);
    }
    this.writeStoreCollection(storeDir, "products", existingProducts);
    counts["products"] = existingProducts.length;

    // 4. Historical Sales Invoices
    const existingInvoices = this.readStoreCollection(storeDir, "invoices");
    const invoiceLegacySet = new Set<string>();
    for (const inv of existingInvoices) {
      if (inv.legacyId) invoiceLegacySet.add(String(inv.legacyId));
    }

    for (const inv of bundle.salesInvoices as any[]) {
      const rawId = String(inv.legacyId);
      const legId = scopeId(rawId);
      if (invoiceLegacySet.has(legId)) {
        // Idempotent: already imported
        continue;
      }

      // Resolve items
      const items = (inv.lines || []).map((l: any) => {
        const prod = productMap.get(String(l.productId)) || productMap.get(scopeId(l.productId));
        const unitPrice = l.unitPrice ?? l.price ?? 0;
        const qty = l.qty || 0;
        return {
          productId: prod?.id || `${isAbuzar ? "ABZ" : "KP"}-PID-${l.productId}`,
          code: prod?.code || `${isAbuzar ? "ABZ" : "KP"}-${l.productId}`,
          name: prod?.name || l.productName || `Product ${l.productId}`,
          unit: prod?.unit || l.unit || "unit",
          multiplier: 1,
          qty,
          price: unitPrice,
          cost: l.cost || 0,
          discountPct: l.discountPct ?? l.discount ?? 0,
          discountAmt: l.discountAmt || 0,
          lineTotal: l.lineTotal ?? (qty * unitPrice)
        };
      });

      const customerId = inv.customerId ? (customerMap.get(String(inv.customerId)) || customerMap.get(scopeId(inv.customerId))) : undefined;

      existingInvoices.push({
        id: genId(12),
        number: inv.invoiceNo,
        date: inv.date,
        customerId: customerId || null,
        customerName: inv.customerName || undefined,
        items,
        subtotal: inv.subtotal,
        discount: inv.discount,
        tax: inv.tax,
        total: inv.grandTotal,
        paid: inv.paidAmount,
        change: Math.max(0, (inv.paidAmount || 0) - (inv.grandTotal || 0)),
        payment: (inv.paidAmount >= inv.grandTotal) ? "cash" : ((inv.paidAmount === 0) ? "credit" : "cash"),
        status: inv.isReturn ? "refunded" : "paid",
        // CRITICAL PRODUCTION SAFETY GUARDS:
        migrationImported: true,
        migrationSource: sourceSystem,
        migrationBatchId: bundle.batchId,
        legacyId: legId,
        legacyReference: inv.invoiceNo,
        legacyOperatorName: inv.operatorName || undefined,
        billable: false, // NEVER count toward SaaS billing quota
        fbrStatus: "not_applicable", // NEVER enter FBR Queue
        createdAt: inv.date,
        updatedAt: now
      });
      invoiceLegacySet.add(legId);
    }
    this.writeStoreCollection(storeDir, "invoices", existingInvoices);
    counts["invoices"] = existingInvoices.length;

    // 5. Historical Purchases
    const existingPurchases = this.readStoreCollection(storeDir, "purchases");
    const purchaseLegacySet = new Set<string>();
    for (const po of existingPurchases) {
      if (po.legacyId) purchaseLegacySet.add(String(po.legacyId));
    }

    for (const po of bundle.purchases as any[]) {
      const rawId = String(po.legacyId);
      const legId = scopeId(rawId);
      if (purchaseLegacySet.has(legId)) {
        continue;
      }

      const lines = (po.lines || []).map((l: any) => {
        const prod = productMap.get(String(l.productId)) || productMap.get(scopeId(l.productId));
        const unitCost = l.costPerUnit ?? l.cost ?? 0;
        const qty = l.qty || 0;
        return {
          productId: prod?.id || `${isAbuzar ? "ABZ" : "KP"}-PID-${l.productId}`,
          code: prod?.code || `${isAbuzar ? "ABZ" : "KP"}-${l.productId}`,
          name: prod?.name || l.productName || `Product ${l.productId}`,
          batchNo: l.batchNo || "LEGACY",
          expiry: l.expiry || undefined,
          unit: prod?.unit || l.unit || "unit",
          multiplier: 1,
          qty,
          cost: unitCost,
          freeQty: l.freeQty || 0,
          discountPct: l.discountPct ?? l.discount ?? 0,
          lineTotal: l.lineTotal ?? (qty * unitCost)
        };
      });

      const supplierId = po.supplierId ? (supplierMap.get(String(po.supplierId)) || supplierMap.get(scopeId(po.supplierId))) : undefined;

      existingPurchases.push({
        id: genId(12),
        number: po.purchaseNo,
        date: po.date,
        supplier: po.supplierName || "Migrated Supplier",
        supplierId,
        lines,
        total: po.grandTotal,
        subtotal: po.subtotal,
        discount: po.discount,
        taxAmount: po.tax,
        // CRITICAL PRODUCTION SAFETY GUARDS:
        migrationImported: true,
        migrationSource: sourceSystem,
        migrationBatchId: bundle.batchId,
        legacyId: legId,
        legacyReference: po.invoiceReference || po.purchaseNo,
        excludeFromSupplierBalance: Boolean(po.excludeFromSupplierBalance),
        createdAt: po.date,
        updatedAt: now
      });
      purchaseLegacySet.add(legId);
    }
    this.writeStoreCollection(storeDir, "purchases", existingPurchases);
    counts["purchases"] = existingPurchases.length;

    // 6. Sales Returns
    const existingReturns = this.readStoreCollection(storeDir, "sales-returns");
    const returnLegacySet = new Set<string>();
    for (const ret of existingReturns) {
      if (ret.legacyId) returnLegacySet.add(String(ret.legacyId));
    }

    for (const ret of (bundle.salesReturns || []) as any[]) {
      const rawId = String(ret.legacyId);
      const legId = scopeId(rawId);
      if (returnLegacySet.has(legId)) continue;

      const items = (ret.lines || []).map((l: any) => {
        const prod = productMap.get(String(l.productId)) || productMap.get(scopeId(l.productId));
        const price = l.price ?? prod?.price ?? 0;
        const qty = l.qty || 0;
        return {
          productId: prod?.id || `${isAbuzar ? "ABZ" : "KP"}-PID-${l.productId}`,
          code: prod?.code || `${isAbuzar ? "ABZ" : "KP"}-${l.productId}`,
          name: prod?.name || l.productName || `Product ${l.productId}`,
          unit: prod?.unit || "unit",
          qty,
          price,
          lineTotal: l.lineTotal ?? (qty * price)
        };
      });

      const retTotal = ret.total ?? ret.grandTotal ?? 0;
      existingReturns.push({
        id: genId(12),
        number: ret.returnNo || `RTN-${isAbuzar ? "ABZ" : "KP"}-${rawId}`,
        date: ret.date,
        invoiceNumber: ret.invoiceReference || ret.originalInvoiceNo || undefined,
        items,
        subtotal: ret.subtotal ?? retTotal,
        discount: ret.discount || 0,
        total: retTotal,
        refund: ret.refundMethod || "cash",
        migrationImported: true,
        migrationSource: sourceSystem,
        migrationBatchId: bundle.batchId,
        legacyId: legId,
        createdAt: ret.date,
        updatedAt: now
      });
      returnLegacySet.add(legId);
    }
    this.writeStoreCollection(storeDir, "sales-returns", existingReturns);
    counts["sales-returns"] = existingReturns.length;

    return counts;
  }

  // --------------------------------------------------------------------------
  // Rollback Last Migration
  // --------------------------------------------------------------------------
  async rollbackLastMigration(targetStoreDir: string = this.liveStoreDir): Promise<{ ok: boolean; message: string }> {
    const history = this.readStoreCollection(targetStoreDir, "migration-history");
    if (!history.length) {
      throw new Error("No migration history found to roll back.");
    }

    const lastEntry = history[history.length - 1];
    if (lastEntry.status === "rolled_back") {
      throw new Error(`The latest migration (batch ${lastEntry.migrationBatchId}) has already been rolled back.`);
    }

    if (!lastEntry.safetyBackupPath || !fs.existsSync(lastEntry.safetyBackupPath)) {
      throw new Error(`Safety backup file not found at: ${lastEntry.safetyBackupPath}. Cannot safely roll back.`);
    }

    // Read safety backup
    const backupContent = JSON.parse(fs.readFileSync(lastEntry.safetyBackupPath, "utf-8"));
    if (!backupContent.data) {
      throw new Error("Invalid safety backup format.");
    }

    // Restore each collection from the safety backup
    for (const [colName, rows] of Object.entries(backupContent.data)) {
      this.writeStoreCollection(targetStoreDir, colName, rows as any[]);
    }

    // Update status in history
    lastEntry.status = "rolled_back";
    lastEntry.rolledBackAt = new Date().toISOString();
    this.writeStoreCollection(targetStoreDir, "migration-history", history);

    return {
      ok: true,
      message: `Successfully rolled back migration batch ${lastEntry.migrationBatchId} from safety snapshot.`
    };
  }

  // --------------------------------------------------------------------------
  // Migration History
  // --------------------------------------------------------------------------
  getMigrationHistory(targetStoreDir: string = this.liveStoreDir): any[] {
    return this.readStoreCollection(targetStoreDir, "migration-history");
  }
}
