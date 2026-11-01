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
        "-Q", "SET NOCOUNT ON; " + query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(f"SQL Error: {result.stderr}\nOutput: {result.stdout}")
    return result.stdout.strip()

def sql_to_dicts(query, col_names):
    out = run_sql(query)
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= len(col_names):
            row = {}
            for i, col in enumerate(col_names):
                row[col] = parts[i]
            rows.append(row)
    return rows

def main():
    checks = {}

    # 1. Shop distribution across key tables
    print("Checking shop distribution...")
    shops_dist = {}
    for tbl in ["POS_Products", "POS_Stocks", "POS_SaleInvoices", "POS_PurchaseOrders", "POS_StockAdjustment"]:
        rows = sql_to_dicts(f"SELECT ShopId, COUNT(*) AS cnt FROM {tbl} GROUP BY ShopId;", ["ShopId", "cnt"])
        shops_dist[tbl] = rows
    checks["shop_distribution"] = shops_dist

    # 2. Negative stock inspection
    print("Checking negative stock...")
    neg_stock = sql_to_dicts("""
        SELECT s.StockId, s.ProductId, p.ProductName, p.Code, s.Quantity, s.PurchasePrice, s.SalePrice
        FROM POS_Stocks s
        INNER JOIN POS_Products p ON s.ProductId = p.ProductId
        WHERE s.Quantity < 0;
    """, ["StockId", "ProductId", "ProductName", "Code", "Quantity", "PurchasePrice", "SalePrice"])
    checks["negative_stock"] = neg_stock

    # 3. Zero price / cost products
    print("Checking zero price / cost products...")
    zero_prices = sql_to_dicts("""
        SELECT 
            COUNT(CASE WHEN SalePrice = 0 THEN 1 END) AS zero_sale_price,
            COUNT(CASE WHEN PurchasePrice = 0 THEN 1 END) AS zero_cost,
            COUNT(CASE WHEN SalePrice = 0 AND PurchasePrice = 0 THEN 1 END) AS zero_both
        FROM POS_Products;
    """, ["zero_sale_price", "zero_cost", "zero_both"])
    checks["zero_prices"] = zero_prices[0]

    # Sample zero price products
    sample_zero = sql_to_dicts("""
        SELECT TOP 5 ProductId, ProductName, Code, PurchasePrice, SalePrice
        FROM POS_Products
        WHERE SalePrice = 0 OR PurchasePrice = 0;
    """, ["ProductId", "ProductName", "Code", "PurchasePrice", "SalePrice"])
    checks["sample_zero_price_products"] = sample_zero

    # 4. Invoices with balance (receivables)
    print("Checking receivables...")
    receivables = sql_to_dicts("""
        SELECT SaleId, SaleTime, CustomerName, TotalAmount, ReceivedAmount, Balance
        FROM POS_SaleInvoices
        WHERE Balance > 0;
    """, ["SaleId", "SaleTime", "CustomerName", "TotalAmount", "ReceivedAmount", "Balance"])
    checks["receivables_detail"] = receivables

    # 5. Customer Account Logs
    print("Checking customer account logs...")
    cust_logs = sql_to_dicts("""
        SELECT LogId, CustomerId, Amount, Description, SystemDesc, LogTime, UserId
        FROM POS_CustomerAccountLogs;
    """, ["LogId", "CustomerId", "Amount", "Description", "SystemDesc", "LogTime", "UserId"])
    checks["customer_account_logs"] = cust_logs

    # 6. Distinct customer names count and top customers
    print("Checking top customers...")
    top_customers = sql_to_dicts("""
        SELECT TOP 10 ISNULL(CustomerName, 'Walk-in') AS name, COUNT(*) AS invoice_count, SUM(TotalAmount) AS total_spent
        FROM POS_SaleInvoices
        GROUP BY CustomerName
        ORDER BY total_spent DESC;
    """, ["name", "invoice_count", "total_spent"])
    checks["top_customers"] = top_customers

    # 7. Categories mapping
    print("Checking category mapping...")
    cat_mapping = sql_to_dicts("""
        SELECT c.CategoryId, c.CategoryName, COUNT(p.ProductId) AS product_count
        FROM POS_Categories c
        LEFT JOIN POS_Products p ON c.CategoryId = p.CategoryId
        GROUP BY c.CategoryId, c.CategoryName
        ORDER BY product_count DESC;
    """, ["CategoryId", "CategoryName", "product_count"])
    checks["category_mapping"] = cat_mapping

    # 8. Purchase Expiries
    print("Checking purchase expiries...")
    expiries = sql_to_dicts("""
        SELECT TOP 10 
            po.POProductId, po.PurchaseId, p.ProductName, po.Quantity, po.ExpiryDate, po.PurchasePrice
        FROM POS_POProducts po
        INNER JOIN POS_Products p ON po.ProductId = p.ProductId
        WHERE po.ExpiryDate IS NOT NULL
        ORDER BY po.ExpiryDate ASC;
    """, ["POProductId", "PurchaseId", "ProductName", "Quantity", "ExpiryDate", "PurchasePrice"])
    checks["sample_expiries"] = expiries

    # 9. Returns detail
    print("Checking returns detail...")
    sr_detail = sql_to_dicts("""
        SELECT sr.SaleReturnId, sr.InvoiceId, sr.ReturnAmount, sr.TimeReturn, p.ProductName, srp.Quantity
        FROM POS_SaleReturns sr
        LEFT JOIN POS_SRProducts srp ON sr.SaleReturnId = srp.ReturnId
        LEFT JOIN POS_Products p ON srp.ProductId = p.ProductId;
    """, ["SaleReturnId", "InvoiceId", "ReturnAmount", "TimeReturn", "ProductName", "Quantity"])
    checks["sales_returns_detail"] = sr_detail

    # 10. Discount and Tax details in Sales Invoices
    print("Checking discounts...")
    disc_summary = sql_to_dicts("""
        SELECT 
            COUNT(CASE WHEN DiscountPers > 0 THEN 1 END) AS invoices_with_header_discount,
            COUNT(CASE WHEN s.TotalAmount < s.SubTotal THEN 1 END) AS invoices_where_total_less_subtotal,
            SUM(s.SubTotal - s.TotalAmount) AS total_calculated_discount,
            COUNT(CASE WHEN s.Tax > 0 THEN 1 END) AS invoices_with_tax,
            SUM(s.Tax) AS total_tax_invoices
        FROM POS_SaleInvoices s;
    """, ["invoices_with_header_discount", "invoices_where_total_less_subtotal", "total_calculated_discount", "invoices_with_tax", "total_tax_invoices"])
    checks["sales_discount_summary"] = disc_summary[0]

    # Save to JSON
    out_file = r"D:\aivrasol Pharmacy POS\migration\output\keypos-deep-checks.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(checks, f, indent=2)

    print(f"Deep checks completed! Output written to {out_file}")

if __name__ == "__main__":
    main()
