import subprocess
import json

def run_sql(query):
    cmd = [
        "docker", "exec", "-i", "keypos_sql_sandbox",
        "/opt/mssql-tools18/bin/sqlcmd",
        "-S", "localhost",
        "-U", "sa",
        "-P", "KeyPOS_Migr@tion2026!",
        "-C",
        "-d", "KeyPOS_Migration_Source",
        "-h", "-1",
        "-W",
        "-s", "|",
        "-Q", query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(f"SQL Error: {result.stderr}\nOutput: {result.stdout}")
    return result.stdout

def get_columns(table_name):
    query = f"""
    SET NOCOUNT ON;
    SELECT c.name, ty.name, c.max_length, c.is_nullable
    FROM sys.columns c
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    WHERE t.name = '{table_name}'
    ORDER BY c.column_id;
    """
    lines = run_sql(query).strip().splitlines()
    cols = []
    for line in lines:
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 4:
            cols.append({"name": parts[0], "type": parts[1], "length": parts[2], "nullable": parts[3] == "1"})
    return cols

def main():
    tables_to_check = [
        "POS_Products", "POS_Stocks", "POS_ProductImport", "POS_Categories",
        "POS_SaleInvoices", "POS_SIProducts", "POS_PurchaseOrders", "POS_POProducts",
        "POS_SaleReturns", "POS_SRProducts", "POS_PurchaseReturns", "POS_PRProducts",
        "POS_StockAdjustment", "POS_SAProduct", "POS_Customers", "POS_CustomerAccountLogs",
        "POS_Vendors", "POS_Shopes", "Sec_Users", "POS_Shift"
    ]
    
    print("=== Table Columns Detailed ===")
    for t in tables_to_check:
        cols = get_columns(t)
        print(f"\n--- {t} ({len(cols)} columns) ---")
        for c in cols:
            print(f"  {c['name']} ({c['type']}, len={c['length']}, null={c['nullable']})")

if __name__ == "__main__":
    main()
