/**
 * AivraSol POS — KeyPOS Migration Source Adapter
 * 
 * Production-ready, generalized adapter for ANY compatible KeyPOS Microsoft SQL Server backup.
 * Supports:
 * - Direct .bak files
 * - .zip files containing .bak
 * - Dynamic file names
 * - Dynamic schema detection & fingerprinting (REQUIRED, OPTIONAL, IGNORED, UNKNOWN)
 * - Dynamic counts and financial metrics derived directly from the source SQL Server
 * - Dynamic warnings (negative stock, zero-price items, duplicate barcodes, unassigned credit)
 * - Dynamic canonical extraction into Canonical Migration Model
 * - Temporary database restoration and isolated cleanup
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import type {
  MigrationSourceAdapter,
  SourceAnalysisResult,
  SchemaCompatibilityReport,
  TableFingerprint,
  ColumnFingerprint,
  FieldClassification,
  DynamicSourceMetrics,
  MigrationWarning,
  CanonicalBundle
} from "../../core/adapter";

const execFileAsync = promisify(execFile);

export interface KeyPosAdapterConfig {
  containerName?: string;
  sqlUser?: string;
  sqlPassword?: string;
  tempMountDir?: string;
}

export class KeyPosMigrationAdapter implements MigrationSourceAdapter {
  id = "keypos";
  name = "KeyPOS";
  description = "Microsoft SQL Server Backup (.bak, .zip)";
  supportedExtensions = [".bak", ".zip"];

  private containerName: string;
  private sqlUser: string;
  private sqlPassword: string;
  private tempMountDir: string;

  constructor(config: KeyPosAdapterConfig = {}) {
    this.containerName = config.containerName || "keypos_sql_sandbox";
    this.sqlUser = config.sqlUser || "sa";
    this.sqlPassword = config.sqlPassword || "KeyPOS_Migr@tion2026!";
    this.tempMountDir = config.tempMountDir || path.resolve(__dirname, "../../backup");
  }

  async canHandle(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".bak" || ext === ".zip";
  }

  /**
   * Run SQL command in the isolated Docker container
   */
  private async runSql(query: string, database?: string): Promise<string> {
    const args = [
      "exec", this.containerName,
      "/opt/mssql-tools18/bin/sqlcmd",
      "-S", "localhost",
      "-U", this.sqlUser,
      "-P", this.sqlPassword,
      "-C",
      "-h", "-1",
      "-W",
      "-s", "\x1f" // ASCII 31 Unit Separator to prevent delimiter collision
    ];

    if (database) {
      args.push("-d", database);
    }

    args.push("-Q", `SET NOCOUNT ON; ${query}`);

    try {
      const { stdout } = await execFileAsync("docker", args, {
        maxBuffer: 100 * 1024 * 1024,
        encoding: "utf-8"
      });
      return stdout.trim();
    } catch (err: any) {
      throw new Error(`SQL Execution Error: ${err.message || String(err)}`);
    }
  }

  /**
   * Helper to parse SQL output into array of dicts
   */
  private async sqlToDicts(query: string, colNames: string[], database?: string): Promise<Record<string, string | null>[]> {
    const out = await this.runSql(query, database);
    const rows: Record<string, string | null>[] = [];
    if (!out) return rows;

    for (const rawLine of out.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split("\x1f").map(p => p.trim());
      if (parts.length >= colNames.length) {
        const row: Record<string, string | null> = {};
        for (let i = 0; i < colNames.length; i++) {
          const val = parts[i];
          row[colNames[i]] = val === "NULL" ? null : val;
        }
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Calculate SHA-256 hash of the input file
   */
  private getFileHash(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return crypto.createHash("sha256").update(filePath).digest("hex");
    }
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Ensures Docker container is running
   */
  async ensureSandboxReady(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("docker", ["ps", "--filter", `name=${this.containerName}`, "--format", "{{.Names}}"]);
      if (stdout.trim().includes(this.containerName)) {
        return true;
      }
      // Attempt to start if it exists but is stopped
      try {
        await execFileAsync("docker", ["start", this.containerName]);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Extracts .bak from .zip if needed, or copies/prepares .bak in the sandbox mount
   */
  private async prepareBakFile(filePath: string): Promise<{ bakPathInContainer: string; tempFiles: string[] }> {
    const ext = path.extname(filePath).toLowerCase();
    const tempFiles: string[] = [];

    fs.mkdirSync(this.tempMountDir, { recursive: true });

    let localBakPath = filePath;

    if (ext === ".zip") {
      // Unzip using PowerShell Extract-Archive for reliable Windows execution
      const extractDir = path.join(this.tempMountDir, `unzip_${Date.now()}`);
      fs.mkdirSync(extractDir, { recursive: true });
      tempFiles.push(extractDir);

      try {
        execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${filePath}' -DestinationPath '${extractDir}' -Force"`);
      } catch (e: any) {
        throw new Error(`Failed to extract .zip archive: ${e.message}`);
      }

      // Find .bak inside extractDir
      const files = fs.readdirSync(extractDir);
      const bakFile = files.find(f => f.toLowerCase().endsWith(".bak"));
      if (!bakFile) {
        throw new Error("No .bak Microsoft SQL Server backup file found inside the supplied .zip archive.");
      }
      localBakPath = path.join(extractDir, bakFile);
    }

    // Copy or stage into the mounted backup folder so SQL Server can read it
    const fileName = path.basename(localBakPath);
    const destinationPath = path.join(this.tempMountDir, fileName);

    if (path.resolve(localBakPath) !== path.resolve(destinationPath)) {
      fs.copyFileSync(localBakPath, destinationPath);
      tempFiles.push(destinationPath);
    }

    // Inside the container, this directory is mounted at /var/opt/mssql/backup
    const bakPathInContainer = `/var/opt/mssql/backup/${fileName}`;
    return { bakPathInContainer, tempFiles };
  }

  /**
   * Restore the backup into an isolated temporary SQL Server database
   */
  private async restoreTempDatabase(bakPathInContainer: string, tempDbName: string): Promise<{ logicalData: string; logicalLog: string; originalDbName: string }> {
    // 1. Get logical file names dynamically
    const fileListQuery = `RESTORE FILELISTONLY FROM DISK = '${bakPathInContainer}';`;
    const fileList = await this.sqlToDicts(fileListQuery, ["LogicalName", "PhysicalName", "Type"]);

    const dataFile = fileList.find(f => f.Type === "D");
    const logFile = fileList.find(f => f.Type === "L");

    if (!dataFile || !logFile) {
      throw new Error("Invalid backup file: unable to determine SQL Server data and log files.");
    }

    const logicalData = dataFile.LogicalName!;
    const logicalLog = logFile.LogicalName!;

    // 2. Get original database header metadata
    let originalDbName = "KeyPOS";
    try {
      const headerQuery = `RESTORE HEADERONLY FROM DISK = '${bakPathInContainer}';`;
      const header = await this.sqlToDicts(headerQuery, [
        "BackupName", "BackupDescription", "BackupType", "ExpirationDate", "Compressed", "Position", "DeviceType", "UserName", "ServerName", "DatabaseName"
      ]);
      if (header.length > 0 && header[0].DatabaseName) {
        originalDbName = header[0].DatabaseName;
      }
    } catch {
      // Ignore header inspect failure, use fallback
    }

    // 3. Drop existing temp DB if already exists
    try {
      await this.runSql(`IF DB_ID('${tempDbName}') IS NOT NULL BEGIN ALTER DATABASE [${tempDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${tempDbName}]; END`);
    } catch {
      // Ignore
    }

    // 4. Restore into isolated temporary database
    const restoreSql = `
      RESTORE DATABASE [${tempDbName}]
      FROM DISK = '${bakPathInContainer}'
      WITH MOVE '${logicalData}' TO '/var/opt/mssql/data/${tempDbName}.mdf',
      MOVE '${logicalLog}' TO '/var/opt/mssql/data/${tempDbName}_log.ldf',
      REPLACE;
    `;

    await this.runSql(restoreSql);
    return { logicalData, logicalLog, originalDbName };
  }

  /**
   * Inspect schema and validate KeyPOS fingerprint
   */
  private async validateSchemaFingerprint(tempDbName: string, originalDbName: string): Promise<SchemaCompatibilityReport> {
    // Get all tables in temp DB
    const tablesQuery = `
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME;
    `;
    const tableRows = await this.sqlToDicts(tablesQuery, ["TABLE_NAME"], tempDbName);
    const existingTableSet = new Set(tableRows.map(r => r.TABLE_NAME!));

    // Required KeyPOS tables
    const requiredTables = [
      "POS_Products",
      "POS_Stocks",
      "POS_SaleInvoices",
      "POS_SIProducts",
      "POS_PurchaseOrders",
      "POS_POProducts"
    ];

    // Optional KeyPOS tables
    const optionalTables = [
      "POS_Categories",
      "POS_Vendors",
      "POS_Customers",
      "Sec_Users",
      "POS_SaleReturns",
      "POS_PurchaseReturns",
      "POS_Expenses",
      "POS_Incomes",
      "POS_Ledgers",
      "POS_CustomerAccountLogs",
      "POS_StockAdjustment"
    ];

    const requiredTablesPresent = requiredTables.filter(t => existingTableSet.has(t));
    const requiredTablesMissing = requiredTables.filter(t => !existingTableSet.has(t));
    const optionalTablesPresent = optionalTables.filter(t => existingTableSet.has(t));
    const optionalTablesMissing = optionalTables.filter(t => !existingTableSet.has(t));
    const knownSet = new Set([...requiredTables, ...optionalTables]);
    const unknownTables = Array.from(existingTableSet).filter(t => !knownSet.has(t));

    // Inspect columns for required tables
    const tableDetails: Record<string, TableFingerprint> = {};

    for (const tbl of [...requiredTablesPresent, ...optionalTablesPresent]) {
      const colsQuery = `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tbl}'
        ORDER BY ORDINAL_POSITION;
      `;
      const colRows = await this.sqlToDicts(colsQuery, ["COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE"], tempDbName);
      
      let count = 0;
      try {
        const countQuery = `SELECT COUNT(*) AS cnt FROM [${tbl}];`;
        const countRows = await this.sqlToDicts(countQuery, ["cnt"], tempDbName);
        count = parseInt(countRows[0]?.cnt || "0", 10);
      } catch {
        count = 0;
      }

      const columns: ColumnFingerprint[] = colRows.map(c => {
        let classification: FieldClassification = "OPTIONAL";
        const cname = c.COLUMN_NAME!;

        // Classify standard KeyPOS fields
        if (
          (tbl === "POS_Products" && ["ProductId", "ProductName", "Code"].includes(cname)) ||
          (tbl === "POS_Stocks" && ["StockId", "ProductId", "Quantity"].includes(cname)) ||
          (tbl === "POS_SaleInvoices" && ["SaleId", "TotalAmount"].includes(cname)) ||
          (tbl === "POS_SIProducts" && ["SIProductId", "SaleId", "ProductId", "Quantity"].includes(cname)) ||
          (tbl === "POS_PurchaseOrders" && ["PurchaseOrderId", "TotalAmount"].includes(cname)) ||
          (tbl === "POS_POProducts" && ["POProductId", "PurchaseOrderId", "ProductId", "Quantity"].includes(cname))
        ) {
          classification = "REQUIRED";
        }

        return {
          columnName: cname,
          dataType: c.DATA_TYPE || "unknown",
          isNullable: c.IS_NULLABLE === "YES",
          classification
        };
      });

      tableDetails[tbl] = {
        tableName: tbl,
        exists: true,
        classification: requiredTables.includes(tbl) ? "REQUIRED" : "OPTIONAL",
        rowCount: count,
        columns
      };
    }

    // Determine status & score
    let status: "COMPATIBLE" | "PARTIALLY_COMPATIBLE" | "UNSUPPORTED" = "COMPATIBLE";
    let score = 100;

    if (requiredTablesMissing.length > 0) {
      status = "UNSUPPORTED";
      score = Math.max(0, 100 - (requiredTablesMissing.length * 20));
    } else if (optionalTablesMissing.length > 3) {
      status = "PARTIALLY_COMPATIBLE";
      score = Math.max(70, 100 - (optionalTablesMissing.length * 4));
    }

    const summaryNotes: string[] = [
      `Source database detected: ${originalDbName}`,
      `Total tables in backup: ${existingTableSet.size}`,
      `Required tables matched: ${requiredTablesPresent.length}/${requiredTables.length}`
    ];

    if (requiredTablesMissing.length > 0) {
      summaryNotes.push(`CRITICAL: Missing required tables: ${requiredTablesMissing.join(", ")}`);
    } else {
      summaryNotes.push("All required core tables verified successfully.");
    }

    return {
      sourceSoftware: "KeyPOS",
      sourceDatabaseName: originalDbName,
      status,
      compatibilityScore: score,
      requiredTablesPresent,
      requiredTablesMissing,
      optionalTablesPresent,
      optionalTablesMissing,
      unknownTables,
      tableDetails,
      summaryNotes
    };
  }

  /**
   * Derives all metrics dynamically from the restored SQL Server database
   */
  private async deriveDynamicMetrics(tempDbName: string, backupHash: string): Promise<DynamicSourceMetrics> {
    const qSingle = async (sql: string): Promise<number> => {
      try {
        const rows = await this.sqlToDicts(sql, ["val"], tempDbName);
        if (!rows.length || rows[0].val === null) return 0;
        const n = parseFloat(rows[0].val);
        return isNaN(n) ? 0 : n;
      } catch {
        return 0;
      }
    };

    // 1. Products & Categories
    const productsCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Products;");
    const categoriesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Categories;");
    const manufacturersCount = await qSingle("SELECT COUNT(DISTINCT ManufacturerId) AS val FROM POS_Products WHERE ManufacturerId IS NOT NULL;");

    // 2. Customers & Suppliers
    let customersCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Customers;");
    if (customersCount <= 1) {
      // Dynamic count: customers with distinct credit balance in sales invoices
      const activeDebtors = await qSingle("SELECT COUNT(DISTINCT CustomerName) AS val FROM POS_SaleInvoices WHERE Balance > 0 AND CustomerName IS NOT NULL AND LTRIM(RTRIM(CustomerName)) <> '';");
      customersCount = Math.max(customersCount, activeDebtors + 1); // +1 for unassigned counter
    }
    const suppliersCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Vendors;");

    // 3. Stock & Valuation
    const currentStockQty = await qSingle("SELECT ISNULL(SUM(Quantity), 0) AS val FROM POS_Stocks;");
    const stockValuationCost = await qSingle("SELECT ISNULL(SUM(Quantity * PurchasePrice), 0) AS val FROM POS_Stocks;");
    const stockValuationRetail = await qSingle("SELECT ISNULL(SUM(Quantity * SalePrice), 0) AS val FROM POS_Stocks;");

    // 4. Sales Invoices
    const salesInvoicesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_SaleInvoices;");
    const salesLinesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_SIProducts;");
    const salesTotalRevenue = await qSingle("SELECT ISNULL(SUM(TotalAmount), 0) AS val FROM POS_SaleInvoices;");
    const salesTotalReceived = await qSingle("SELECT ISNULL(SUM(ReceivedAmount), 0) AS val FROM POS_SaleInvoices;");

    // 5. Purchases
    const purchasesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_PurchaseOrders;");
    const purchasesLinesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_POProducts;");
    let purchasesTotalCost = await qSingle("SELECT ISNULL(SUM(TotalPurchase), 0) AS val FROM POS_PurchaseOrders;");
    if (purchasesTotalCost === 0) {
      purchasesTotalCost = await qSingle("SELECT ISNULL(SUM(TotalAmount), 0) AS val FROM POS_PurchaseOrders;");
    }

    // 6. Returns
    let salesReturnsCount = await qSingle("SELECT COUNT(*) AS val FROM POS_SaleReturns;");
    let salesReturnsTotal = await qSingle("SELECT ISNULL(SUM(ReturnAmount), 0) AS val FROM POS_SaleReturns;");
    if (salesReturnsCount === 0) {
      // Check POS_SaleInvoices IsReturn flag
      salesReturnsCount = await qSingle("SELECT COUNT(*) AS val FROM POS_SaleInvoices WHERE IsReturn = 1;");
      salesReturnsTotal = await qSingle("SELECT ISNULL(SUM(TotalAmount), 0) AS val FROM POS_SaleInvoices WHERE IsReturn = 1;");
    }

    const purchaseReturnsCount = await qSingle("SELECT COUNT(*) AS val FROM POS_PurchaseReturns;");
    const purchaseReturnsTotal = await qSingle("SELECT ISNULL(SUM(TotalAmount), 0) AS val FROM POS_PurchaseReturns;");

    // 7. Balances
    const outstandingReceivables = await qSingle("SELECT ISNULL(SUM(Balance), 0) AS val FROM POS_SaleInvoices WHERE Balance > 0;");
    let outstandingPayables = await qSingle("SELECT ISNULL(SUM(Balance), 0) AS val FROM POS_PurchaseOrders WHERE Balance > 0;");
    if (outstandingPayables === 0) {
      outstandingPayables = await qSingle("SELECT ISNULL(SUM(Account), 0) AS val FROM POS_Vendors WHERE Account > 0;");
    }

    // 8. Quality & Diagnostics Checks
    const negativeStockCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Stocks WHERE Quantity < 0;");
    const zeroPriceProductsCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Products WHERE (SalePrice = 0 OR SalePrice IS NULL) AND (PurchasePrice = 0 OR PurchasePrice IS NULL);");
    const duplicateBarcodeCount = await qSingle("SELECT COUNT(*) AS val FROM (SELECT Code FROM POS_Products WHERE Code IS NOT NULL AND LTRIM(RTRIM(Code)) <> '' GROUP BY Code HAVING COUNT(*) > 1) t;");
    const unassignedCreditInvoicesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_SaleInvoices WHERE Balance > 0 AND (CustomerName IS NULL OR LTRIM(RTRIM(CustomerName)) = '');");

    const expensesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Expenses;");
    const incomesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Incomes;");
    const ledgerEntriesCount = await qSingle("SELECT COUNT(*) AS val FROM POS_Ledgers;");

    return {
      databaseName: tempDbName,
      backupHash,
      productsCount,
      categoriesCount,
      manufacturersCount,
      customersCount,
      suppliersCount,
      currentStockQty,
      stockValuationCost,
      stockValuationRetail,
      salesInvoicesCount,
      salesLinesCount,
      salesTotalRevenue,
      salesTotalReceived,
      purchasesCount,
      purchasesLinesCount,
      purchasesTotalCost,
      salesReturnsCount,
      salesReturnsTotal,
      purchaseReturnsCount,
      purchaseReturnsTotal,
      outstandingReceivables,
      outstandingPayables,
      negativeStockCount,
      zeroPriceProductsCount,
      duplicateBarcodeCount,
      unassignedCreditInvoicesCount,
      expensesCount,
      incomesCount,
      ledgerEntriesCount
    };
  }

  /**
   * Derive dynamic warnings from the source database
   */
  private async deriveWarnings(tempDbName: string, metrics: DynamicSourceMetrics, compatibility: SchemaCompatibilityReport): Promise<MigrationWarning[]> {
    const warnings: MigrationWarning[] = [];

    // 1. Blocking: Missing required tables
    if (compatibility.requiredTablesMissing.length > 0) {
      warnings.push({
        id: "MISSING_REQUIRED_TABLES",
        severity: "BLOCKING",
        category: "Schema",
        title: "Missing Required KeyPOS Tables",
        description: `The selected backup is missing required tables: ${compatibility.requiredTablesMissing.join(", ")}. Cannot proceed with import.`,
        recommendedAction: "Verify that this is a complete Microsoft SQL Server backup from a supported KeyPOS version."
      });
    }

    // 2. Negative stock items
    if (metrics.negativeStockCount > 0) {
      warnings.push({
        id: "NEGATIVE_STOCK",
        severity: "WARNING",
        category: "Inventory",
        title: "Negative Stock Detected in KeyPOS",
        description: `Found ${metrics.negativeStockCount} products with negative stock balances. Their original negative values will be preserved and flagged for physical stock audit.`,
        impactedCount: metrics.negativeStockCount,
        recommendedAction: "Perform a physical stock count and adjustment after migration."
      });
    }

    // 3. Zero price products
    if (metrics.zeroPriceProductsCount > 0) {
      warnings.push({
        id: "ZERO_PRICE_PRODUCTS",
        severity: "WARNING",
        category: "Pricing",
        title: "Zero-Price Products Detected",
        description: `Found ${metrics.zeroPriceProductsCount} products with 0.00 sale price and cost. They will be imported with requiresPricingReview = true.`,
        impactedCount: metrics.zeroPriceProductsCount,
        recommendedAction: "Review and update prices in Inventory before selling these items."
      });
    }

    // 4. Duplicate barcodes
    if (metrics.duplicateBarcodeCount > 0) {
      warnings.push({
        id: "DUPLICATE_BARCODES",
        severity: "WARNING",
        category: "Catalog",
        title: "Duplicate Barcodes / Item Codes",
        description: `Found ${metrics.duplicateBarcodeCount} duplicate barcodes across products. AivraSol POS preserves individual items with SKU suffixes to prevent overwrite.`,
        impactedCount: metrics.duplicateBarcodeCount,
        recommendedAction: "Verify barcode uniqueness after import."
      });
    }

    // 5. Unassigned counter receivables
    if (metrics.unassignedCreditInvoicesCount > 0) {
      warnings.push({
        id: "UNASSIGNED_RECEIVABLES",
        severity: "INFO",
        category: "Khata",
        title: "Counter Invoices with Outstanding Balance",
        description: `Found ${metrics.unassignedCreditInvoicesCount} invoices with unpaid balances without explicit customer master accounts. Grouped into 'Legacy Counter Credit'.`,
        impactedCount: metrics.unassignedCreditInvoicesCount,
        recommendedAction: "Customer credit entries are safely preserved in Khata."
      });
    }

    // 6. Ledger/Financial table notes
    if (metrics.expensesCount === 0 && metrics.incomesCount === 0 && metrics.ledgerEntriesCount === 0) {
      warnings.push({
        id: "EMPTY_EXPENSES_TABLE",
        severity: "INFO",
        category: "Financials",
        title: "No Historical Expense/Income Entries",
        description: "The source KeyPOS database does not contain recorded expenses or cashbook logs. Cashbook will start clean.",
        recommendedAction: "No action needed."
      });
    }

    return warnings;
  }

  /**
   * Complete Step 3: Analyze Backup
   */
  async analyze(filePath: string, options: { tempDbName?: string } = {}): Promise<SourceAnalysisResult> {
    const sandboxReady = await this.ensureSandboxReady();
    if (!sandboxReady) {
      throw new Error(`Temporary SQL Server sandbox container '${this.containerName}' is not running. Please ensure Docker is started.`);
    }

    const backupHash = this.getFileHash(filePath);
    const fileName = path.basename(filePath);
    const tempDbName = options.tempDbName || `KeyPOS_Analysis_${Date.now()}`;

    // 1. Prepare backup in sandbox
    const { bakPathInContainer, tempFiles } = await this.prepareBakFile(filePath);

    // 2. Restore into temporary isolated DB
    const { originalDbName } = await this.restoreTempDatabase(bakPathInContainer, tempDbName);

    // 3. Inspect Schema & Compatibility
    const compatibility = await this.validateSchemaFingerprint(tempDbName, originalDbName);

    // 4. Derive Dynamic Counts & Financial Totals
    const metrics = await this.deriveDynamicMetrics(tempDbName, backupHash);

    // 5. Check Warnings
    const warnings = await this.deriveWarnings(tempDbName, metrics, compatibility);
    const hasBlockingIssues = warnings.some(w => w.severity === "BLOCKING");

    return {
      adapterId: this.id,
      adapterName: this.name,
      backupFilePath: filePath,
      backupFileName: fileName,
      backupHash,
      sourceDatabaseName: originalDbName,
      compatibility,
      metrics,
      warnings,
      hasBlockingIssues,
      tempDatabaseName: tempDbName
    };
  }

  /**
   * Helper to infer units safely
   */
  private inferUnit(name: string): string {
    const u = name.toUpperCase();
    if (/\b(TAB|TABLET|CAP|CAPSULE)\b/.test(u)) return "tab";
    if (/\b(SYP|SYRUP|SUSP|SUSPEN|SOLUTION|DROPS|LOTION)\b/.test(u)) return "bottle";
    if (/\b(INJ|INJECTION|VIAL|INFUSION|DRIP|AMPOULE)\b/.test(u)) return "vial";
    if (/\b(CREAM|OINT|OINTMENT|GEL)\b/.test(u)) return "tube";
    if (/\b(SACHET|POWDER)\b/.test(u)) return "sachet";
    return "unit";
  }

  /**
   * Extracts data from the temporary SQL Server database into CanonicalBundle
   */
  async extractCanonical(filePath: string, batchId: string, options: { tempDbName?: string } = {}): Promise<CanonicalBundle> {
    const tempDbName = options.tempDbName || `KeyPOS_Canonical_${Date.now()}`;
    const backupHash = this.getFileHash(filePath);

    // If DB not already restored, restore it
    let dbExists = false;
    try {
      const chk = await this.runSql(`SELECT DB_ID('${tempDbName}');`);
      dbExists = chk.length > 0 && chk !== "NULL";
    } catch {
      dbExists = false;
    }

    if (!dbExists) {
      const { bakPathInContainer } = await this.prepareBakFile(filePath);
      await this.restoreTempDatabase(bakPathInContainer, tempDbName);
    }

    // 1. Categories
    const catRows = await this.sqlToDicts("SELECT CategoryId, CategoryName FROM POS_Categories;", ["CategoryId", "CategoryName"], tempDbName);
    const catMap = new Map<string, string>();
    const categories: { id: string | number; name: string }[] = [];
    for (const c of catRows) {
      if (c.CategoryId && c.CategoryName) {
        catMap.set(c.CategoryId, c.CategoryName);
        categories.push({ id: c.CategoryId, name: c.CategoryName });
      }
    }

    // 2. Operators / Users
    const userRows = await this.sqlToDicts(
      "SELECT UserId, FirstName, LastName, UserName, IsAdmin, IsActive FROM Sec_Users;",
      ["UserId", "FirstName", "LastName", "UserName", "IsAdmin", "IsActive"],
      tempDbName
    );
    const operators: unknown[] = [];
    for (const u of userRows) {
      const fullName = `${u.FirstName || ""} ${u.LastName || ""}`.trim();
      operators.push({
        legacyId: u.UserId,
        sourceSystem: "KEYPOS",
        legacyEntity: "Sec_Users",
        migrationBatchId: batchId,
        name: fullName || u.UserName || `User-${u.UserId}`,
        username: u.UserName,
        role: u.IsAdmin === "1" ? "admin" : "cashier",
        active: u.IsActive === "1"
      });
    }

    // 3. Stock Records
    const stockRows = await this.sqlToDicts(
      "SELECT StockId, ProductId, Quantity, PurchasePrice, SalePrice, ShopId, BatchNo FROM POS_Stocks;",
      ["StockId", "ProductId", "Quantity", "PurchasePrice", "SalePrice", "ShopId", "BatchNo"],
      tempDbName
    );
    const stockByProduct = new Map<string, { quantity: number; purchasePrice: number; salePrice: number; batchNo?: string }>();
    for (const s of stockRows) {
      if (!s.ProductId) continue;
      stockByProduct.set(s.ProductId, {
        quantity: parseFloat(s.Quantity || "0") || 0,
        purchasePrice: parseFloat(s.PurchasePrice || "0") || 0,
        salePrice: parseFloat(s.SalePrice || "0") || 0,
        batchNo: s.BatchNo || undefined
      });
    }

    // 4. Products
    const prodRows = await this.sqlToDicts(
      `SELECT ProductId, CategoryId, ProductName, Code, Formula, PurchasePrice, SalePrice, 
              IsActive, MinStockLow, Location, ShopId 
       FROM POS_Products ORDER BY ProductId;`,
      ["ProductId", "CategoryId", "ProductName", "Code", "Formula", "PurchasePrice", "SalePrice", "IsActive", "MinStockLow", "Location", "ShopId"],
      tempDbName
    );

    const products: unknown[] = [];
    const stockBatches: unknown[] = [];

    for (const p of prodRows) {
      const pid = p.ProductId!;
      const st = stockByProduct.get(pid) || {
        quantity: 0,
        purchasePrice: parseFloat(p.PurchasePrice || "0") || 0,
        salePrice: parseFloat(p.SalePrice || "0") || 0
      };

      const costVal = st.purchasePrice;
      const priceVal = st.salePrice;
      const reorderVal = parseInt(p.MinStockLow || "10", 10) || 10;
      const unitVal = this.inferUnit(p.ProductName || "");
      const categoryName = (p.CategoryId ? catMap.get(p.CategoryId) : null) || "General";
      const isZeroPrice = priceVal === 0 && costVal === 0;

      products.push({
        legacyId: pid,
        legacyReference: p.Code,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_Products",
        migrationBatchId: batchId,
        code: p.Code || `KP-PROD-${pid}`,
        barcode: p.Code || undefined,
        name: (p.ProductName || `Product ${pid}`).trim(),
        generic: p.Formula ? p.Formula.trim() : undefined,
        category: categoryName,
        unit: unitVal,
        price: priceVal,
        cost: costVal,
        currentStock: st.quantity,
        originalSourceStock: st.quantity,
        isNegativeStock: st.quantity < 0,
        reorderLevel: reorderVal,
        location: p.Location ? p.Location.trim() : undefined,
        archived: p.IsActive !== "1",
        requiresPricingReview: isZeroPrice,
        shopId: p.ShopId
      });

      if (st.quantity !== 0) {
        stockBatches.push({
          productId: pid,
          productCode: p.Code || `KP-PROD-${pid}`,
          productName: (p.ProductName || `Product ${pid}`).trim(),
          batchNo: st.batchNo || "LEGACY-OPENING",
          qty: st.quantity,
          cost: costVal,
          salePrice: priceVal,
          isLegacyOpeningBatch: true
        });
      }
    }

    // 5. Dynamic Suppliers
    const vendorRows = await this.sqlToDicts(
      "SELECT VendorId, FullName, PhoneNo, Email, Address, Account, IsActive FROM POS_Vendors;",
      ["VendorId", "FullName", "PhoneNo", "Email", "Address", "Account", "IsActive"],
      tempDbName
    );
    const suppliers: unknown[] = [];
    for (const v of vendorRows) {
      if (!v.VendorId) continue;
      suppliers.push({
        legacyId: v.VendorId,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_Vendors",
        migrationBatchId: batchId,
        name: (v.FullName || `Supplier ${v.VendorId}`).trim(),
        phone: v.PhoneNo ? v.PhoneNo.trim() : undefined,
        email: v.Email ? v.Email.trim() : undefined,
        address: v.Address ? v.Address.trim() : undefined,
        openingBalance: parseFloat(v.Account || "0") || 0,
        isActive: v.IsActive !== "0"
      });
    }

    // 6. Dynamic Customers & Receivables
    const customerRows = await this.sqlToDicts(
      "SELECT CustomerId, CustomerName, PhoneNo, Email, Address, Account, IsActive FROM POS_Customers;",
      ["CustomerId", "CustomerName", "PhoneNo", "Email", "Address", "Account", "IsActive"],
      tempDbName
    );
    const customerMap = new Map<string, any>();
    for (const c of customerRows) {
      if (!c.CustomerId) continue;
      customerMap.set(c.CustomerId, {
        legacyId: c.CustomerId,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_Customers",
        migrationBatchId: batchId,
        name: (c.CustomerName || `Customer ${c.CustomerId}`).trim(),
        phone: c.PhoneNo ? c.PhoneNo.trim() : undefined,
        email: c.Email ? c.Email.trim() : undefined,
        address: c.Address ? c.Address.trim() : undefined,
        creditBalance: parseFloat(c.Account || "0") || 0,
        isActive: c.IsActive !== "0"
      });
    }

    // Check unpaid invoices to dynamically associate receivables
    const unpaidInvoices = await this.sqlToDicts(
      "SELECT SaleId, CustomerId, CustomerName, Balance FROM POS_SaleInvoices WHERE Balance > 0;",
      ["SaleId", "CustomerId", "CustomerName", "Balance"],
      tempDbName
    );

    let unassignedCreditTotal = 0;
    const namedCustomerCredit = new Map<string, { total: number; invoiceIds: string[] }>();

    for (const inv of unpaidInvoices) {
      const bal = parseFloat(inv.Balance || "0") || 0;
      const cname = inv.CustomerName ? inv.CustomerName.trim().toUpperCase() : "";
      const cid = inv.CustomerId;

      if (cid && customerMap.has(cid)) {
        const cust = customerMap.get(cid);
        cust.creditBalance = (cust.creditBalance || 0) + bal;
      } else if (cname) {
        if (!namedCustomerCredit.has(cname)) {
          namedCustomerCredit.set(cname, { total: 0, invoiceIds: [] });
        }
        const entry = namedCustomerCredit.get(cname)!;
        entry.total += bal;
        entry.invoiceIds.push(inv.SaleId || "");
      } else {
        unassignedCreditTotal += bal;
      }
    }

    // Add named customer debtors
    for (const [name, data] of namedCustomerCredit.entries()) {
      customerMap.set(`kp-cust-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`, {
        legacyId: `kp-cust-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_SaleInvoices",
        migrationBatchId: batchId,
        name,
        creditBalance: data.total,
        notes: `Migrated from KeyPOS. Unpaid bills: ${data.invoiceIds.slice(0, 3).join(", ")}`
      });
    }

    // Add unassigned counter credit if any
    if (unassignedCreditTotal > 0) {
      customerMap.set("kp-cust-unassigned-credit", {
        legacyId: "kp-cust-unassigned-credit",
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_SaleInvoices",
        migrationBatchId: batchId,
        name: "Legacy Counter Credit",
        creditBalance: unassignedCreditTotal,
        isMigrationAccount: true,
        notes: "Migrated from KeyPOS unassigned counter receivables."
      });
    }

    const customers = Array.from(customerMap.values());

    // 7. Historical Sales & Lines
    const salesRows = await this.sqlToDicts(
      `SELECT SaleId, UserId, TotalAmount, SubTotal, ReceivedAmount, Balance, 
              DiscountPers, CustomerName, CustomerId, SaleTime, IsReturn, IsHold, Tax
       FROM POS_SaleInvoices ORDER BY SaleId;`,
      ["SaleId", "UserId", "TotalAmount", "SubTotal", "ReceivedAmount", "Balance", "DiscountPers", "CustomerName", "CustomerId", "SaleTime", "IsReturn", "IsHold", "Tax"],
      tempDbName
    );

    const saleLinesRows = await this.sqlToDicts(
      `SELECT SIProductId, SaleId, ProductId, SalePrice, PurchasePrice, Quantity, Discount, Tax, Boxes, BatchNo
       FROM POS_SIProducts ORDER BY SaleId, SIProductId;`,
      ["SIProductId", "SaleId", "ProductId", "SalePrice", "PurchasePrice", "Quantity", "Discount", "Tax", "Boxes", "BatchNo"],
      tempDbName
    );

    const linesBySale = new Map<string, any[]>();
    for (const l of saleLinesRows) {
      const sid = l.SaleId!;
      if (!linesBySale.has(sid)) {
        linesBySale.set(sid, []);
      }
      linesBySale.get(sid)!.push({
        legacyLineId: l.SIProductId,
        productId: l.ProductId,
        qty: parseFloat(l.Quantity || "0") || 0,
        price: parseFloat(l.SalePrice || "0") || 0,
        cost: parseFloat(l.PurchasePrice || "0") || 0,
        discount: parseFloat(l.Discount || "0") || 0,
        tax: parseFloat(l.Tax || "0") || 0,
        batchNo: l.BatchNo || undefined
      });
    }

    const salesInvoices: unknown[] = [];
    for (const s of salesRows) {
      const sid = s.SaleId!;
      salesInvoices.push({
        legacyId: sid,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_SaleInvoices",
        migrationBatchId: batchId,
        invoiceNo: `INV-KP-${sid}`,
        date: s.SaleTime ? s.SaleTime.replace(" ", "T") : new Date().toISOString(),
        customerId: s.CustomerId,
        customerName: s.CustomerName ? s.CustomerName.trim() : undefined,
        operatorId: s.UserId,
        subtotal: parseFloat(s.SubTotal || "0") || 0,
        discount: parseFloat(s.DiscountPers || "0") || 0,
        tax: parseFloat(s.Tax || "0") || 0,
        grandTotal: parseFloat(s.TotalAmount || "0") || 0,
        paidAmount: parseFloat(s.ReceivedAmount || "0") || 0,
        balance: parseFloat(s.Balance || "0") || 0,
        isReturn: s.IsReturn === "1",
        isHold: s.IsHold === "1",
        lines: linesBySale.get(sid) || []
      });
    }

    // 8. Historical Purchases & Lines (Adaptive Column Mapping)
    const poCols = new Set((await this.sqlToDicts("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'POS_PurchaseOrders';", ["COLUMN_NAME"], tempDbName)).map(c => c.COLUMN_NAME!.toUpperCase()));
    const poidCol = poCols.has("PURCHASEID") ? "PurchaseId" : "PurchaseOrderId";
    const totalCol = poCols.has("TOTALPURCHASE") ? "TotalPurchase" : "TotalAmount";
    const paidCol = poCols.has("PAID") ? "Paid" : "ReceivedAmount";
    const dateCol = poCols.has("PURCHASEDATE") ? "PurchaseDate" : "Date";
    const refCol = poCols.has("REFRENCEINVOICENO") ? "RefrenceInvoiceNo" : (poCols.has("BILLNO") ? "BillNo" : poidCol);
    const discCol = poCols.has("DISCOUNTRS") ? "DiscountRs" : "DiscountPers";

    const poRows = await this.sqlToDicts(
      `SELECT ${poidCol} AS PurchaseOrderId, VendorId, ${refCol} AS BillNo, ${dateCol} AS Date, 
              SubTotal, ${totalCol} AS TotalAmount, ${paidCol} AS ReceivedAmount, Balance, 
              ${discCol} AS DiscountPers, Tax, UserId
       FROM POS_PurchaseOrders ORDER BY ${poidCol};`,
      ["PurchaseOrderId", "VendorId", "BillNo", "Date", "SubTotal", "TotalAmount", "ReceivedAmount", "Balance", "DiscountPers", "Tax", "UserId"],
      tempDbName
    );

    const poProdCols = new Set((await this.sqlToDicts("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'POS_POProducts';", ["COLUMN_NAME"], tempDbName)).map(c => c.COLUMN_NAME!.toUpperCase()));
    const poLineFkCol = poProdCols.has("PURCHASEID") ? "PurchaseId" : "PurchaseOrderId";
    const bonusCol = poProdCols.has("BONUSQUANTITIES") ? "BonusQuantities" : (poProdCols.has("BONUSQUANTITY") ? "BonusQuantity" : "Quantity");

    const poLinesRows = await this.sqlToDicts(
      `SELECT POProductId, ${poLineFkCol} AS PurchaseOrderId, ProductId, PurchasePrice, SalePrice, Quantity, Discount, Tax, ${bonusCol} AS BonusQuantity, BatchNo
       FROM POS_POProducts ORDER BY ${poLineFkCol}, POProductId;`,
      ["POProductId", "PurchaseOrderId", "ProductId", "PurchasePrice", "SalePrice", "Quantity", "Discount", "Tax", "BonusQuantity", "BatchNo"],
      tempDbName
    );

    const linesByPo = new Map<string, any[]>();
    for (const l of poLinesRows) {
      const poid = l.PurchaseOrderId!;
      if (!linesByPo.has(poid)) {
        linesByPo.set(poid, []);
      }
      linesByPo.get(poid)!.push({
        legacyLineId: l.POProductId,
        productId: l.ProductId,
        qty: parseFloat(l.Quantity || "0") || 0,
        cost: parseFloat(l.PurchasePrice || "0") || 0,
        salePrice: parseFloat(l.SalePrice || "0") || 0,
        discount: parseFloat(l.Discount || "0") || 0,
        freeQty: parseFloat(l.BonusQuantity || "0") || 0,
        batchNo: l.BatchNo || undefined
      });
    }

    const purchases: unknown[] = [];
    for (const po of poRows) {
      const poid = po.PurchaseOrderId!;
      purchases.push({
        legacyId: poid,
        sourceSystem: "KEYPOS",
        legacyEntity: "POS_PurchaseOrders",
        migrationBatchId: batchId,
        purchaseNo: `PO-KP-${poid}`,
        invoiceReference: po.BillNo || undefined,
        date: po.Date ? po.Date.replace(" ", "T") : new Date().toISOString(),
        supplierId: po.VendorId,
        operatorId: po.UserId,
        subtotal: parseFloat(po.SubTotal || "0") || 0,
        discount: parseFloat(po.DiscountPers || "0") || 0,
        tax: parseFloat(po.Tax || "0") || 0,
        grandTotal: parseFloat(po.TotalAmount || "0") || 0,
        paidAmount: parseFloat(po.ReceivedAmount || "0") || 0,
        balance: parseFloat(po.Balance || "0") || 0,
        lines: linesByPo.get(poid) || []
      });
    }

    // 9. Returns & Ledgers
    const salesReturns: unknown[] = [];
    try {
      const srCols = new Set((await this.sqlToDicts("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'POS_SaleReturns';", ["COLUMN_NAME"], tempDbName)).map(c => c.COLUMN_NAME!.toUpperCase()));
      if (srCols.has("SALERETURNID")) {
        const srRows = await this.sqlToDicts(
          "SELECT SaleReturnId, InvoiceId, ReturnAmount, UserId, TimeReturn FROM POS_SaleReturns ORDER BY SaleReturnId;",
          ["SaleReturnId", "InvoiceId", "ReturnAmount", "UserId", "TimeReturn"],
          tempDbName
        );

        const srProdRows = await this.sqlToDicts(
          "SELECT SRProductId, ReturnId, ProductId, Quantity, BatchNo FROM POS_SRProducts ORDER BY ReturnId, SRProductId;",
          ["SRProductId", "ReturnId", "ProductId", "Quantity", "BatchNo"],
          tempDbName
        );

        const linesByReturn = new Map<string, any[]>();
        for (const l of srProdRows) {
          const rid = l.ReturnId!;
          if (!linesByReturn.has(rid)) linesByReturn.set(rid, []);
          linesByReturn.get(rid)!.push({
            legacyLineId: l.SRProductId,
            productId: l.ProductId,
            qty: parseFloat(l.Quantity || "0") || 0,
            batchNo: l.BatchNo || undefined
          });
        }

        for (const sr of srRows) {
          const srid = sr.SaleReturnId!;
          salesReturns.push({
            legacyId: srid,
            sourceSystem: "KEYPOS",
            legacyEntity: "POS_SaleReturns",
            migrationBatchId: batchId,
            returnNo: `RTN-KP-${srid}`,
            invoiceReference: sr.InvoiceId ? `INV-KP-${sr.InvoiceId}` : undefined,
            date: sr.TimeReturn ? sr.TimeReturn.replace(" ", "T") : new Date().toISOString(),
            operatorId: sr.UserId,
            grandTotal: parseFloat(sr.ReturnAmount || "0") || 0,
            lines: linesByReturn.get(srid) || []
          });
        }
      }
    } catch {
      // Returns table optional fallback
    }

    const purchaseReturns: unknown[] = [];
    const ledgerEntries: unknown[] = [];

    // Derive metrics for bundle header
    const sourceMetrics = await this.deriveDynamicMetrics(tempDbName, backupHash);

    return {
      batchId,
      sourceSystem: "KEYPOS",
      extractedAt: new Date().toISOString(),
      sourceMetrics,
      categories,
      operators,
      suppliers,
      customers,
      products,
      stockBatches,
      salesInvoices,
      purchases,
      salesReturns,
      purchaseReturns,
      ledgerEntries
    };
  }

  /**
   * Cleans up temporary resources
   */
  async cleanup(context: { tempDbName?: string; tempFiles?: string[] }): Promise<void> {
    if (context.tempDbName) {
      try {
        await this.runSql(`
          IF DB_ID('${context.tempDbName}') IS NOT NULL 
          BEGIN 
            ALTER DATABASE [${context.tempDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; 
            DROP DATABASE [${context.tempDbName}]; 
          END
        `);
      } catch {
        // Ignore drop failure
      }
    }

    if (context.tempFiles) {
      for (const p of context.tempFiles) {
        try {
          if (fs.existsSync(p)) {
            if (fs.lstatSync(p).isDirectory()) {
              fs.rmSync(p, { recursive: true, force: true });
            } else {
              fs.unlinkSync(p);
            }
          }
        } catch {
          // Ignore file cleanup error
        }
      }
    }
  }
}
