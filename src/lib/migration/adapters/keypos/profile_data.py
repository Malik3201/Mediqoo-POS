import subprocess
import json
import os

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
    profile = {}
    print("Starting comprehensive KeyPOS data profiling...")

    # 1. Shops
    print("Profiling Shops...")
    shops = sql_to_dicts(
        "SELECT ShopId, ShopName, Contract, Address, IsDefault, IsActive FROM POS_Shopes;",
        ["ShopId", "ShopName", "Contract", "Address", "IsDefault", "IsActive"]
    )
    profile["shops"] = shops

    # 2. Users / Operators
    print("Profiling Users...")
    users = sql_to_dicts(
        "SELECT UserId, FirstName, LastName, UserName, IsAdmin, IsActive FROM Sec_Users;",
        ["UserId", "FirstName", "LastName", "UserName", "IsAdmin", "IsActive"]
    )
    profile["users"] = users

    # 3. Categories
    print("Profiling Categories...")
    categories = sql_to_dicts(
        "SELECT CategoryId, CategoryName, SortOrder FROM POS_Categories ORDER BY SortOrder;",
        ["CategoryId", "CategoryName", "SortOrder"]
    )
    profile["categories"] = categories

    # 4. Products Analysis
    print("Profiling Products...")
    prod_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_products,
            COUNT(CASE WHEN IsActive = 1 THEN 1 END) AS active_products,
            COUNT(CASE WHEN Code IS NOT NULL AND LTRIM(RTRIM(Code)) != '' THEN 1 END) AS with_code,
            COUNT(CASE WHEN Code2 IS NOT NULL AND LTRIM(RTRIM(Code2)) != '' THEN 1 END) AS with_code2,
            COUNT(CASE WHEN Formula IS NOT NULL AND LTRIM(RTRIM(Formula)) != '' THEN 1 END) AS with_formula,
            COUNT(CASE WHEN Location IS NOT NULL AND LTRIM(RTRIM(Location)) != '' THEN 1 END) AS with_location,
            COUNT(CASE WHEN MenufacturerId IS NOT NULL THEN 1 END) AS with_mfg_id,
            MIN(SalePrice) AS min_sale_price,
            MAX(SalePrice) AS max_sale_price,
            AVG(SalePrice) AS avg_sale_price,
            MIN(PurchasePrice) AS min_purchase_price,
            MAX(PurchasePrice) AS max_purchase_price,
            AVG(PurchasePrice) AS avg_purchase_price
        FROM POS_Products;
    """, [
        "total_products", "active_products", "with_code", "with_code2", "with_formula",
        "with_location", "with_mfg_id", "min_sale_price", "max_sale_price", "avg_sale_price",
        "min_purchase_price", "max_purchase_price", "avg_purchase_price"
    ])
    profile["products_summary"] = prod_summary[0] if prod_summary else {}

    # Duplicate codes
    dup_codes = sql_to_dicts("""
        SELECT Code, COUNT(*) AS cnt
        FROM POS_Products
        WHERE Code IS NOT NULL AND LTRIM(RTRIM(Code)) != ''
        GROUP BY Code
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC;
    """, ["Code", "cnt"])
    profile["duplicate_barcodes_count"] = len(dup_codes)
    profile["duplicate_barcodes_sample"] = dup_codes[:10]

    # 5. Stocks Analysis
    print("Profiling Stocks...")
    stock_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_stock_rows,
            COUNT(DISTINCT ProductId) AS distinct_products_with_stock,
            SUM(Quantity) AS total_stock_quantity,
            COUNT(CASE WHEN Quantity > 0 THEN 1 END) AS positive_stock_rows,
            COUNT(CASE WHEN Quantity = 0 THEN 1 END) AS zero_stock_rows,
            COUNT(CASE WHEN Quantity < 0 THEN 1 END) AS negative_stock_rows,
            SUM(CASE WHEN Quantity > 0 THEN Quantity * PurchasePrice ELSE 0 END) AS total_stock_valuation_cost,
            SUM(CASE WHEN Quantity > 0 THEN Quantity * SalePrice ELSE 0 END) AS total_stock_valuation_retail,
            COUNT(CASE WHEN BatchNo IS NOT NULL AND LTRIM(RTRIM(BatchNo)) != '' THEN 1 END) AS rows_with_batch
        FROM POS_Stocks;
    """, [
        "total_stock_rows", "distinct_products_with_stock", "total_stock_quantity",
        "positive_stock_rows", "zero_stock_rows", "negative_stock_rows",
        "total_stock_valuation_cost", "total_stock_valuation_retail", "rows_with_batch"
    ])
    profile["stock_summary"] = stock_summary[0] if stock_summary else {}

    # 6. Sales Invoices Analysis
    print("Profiling Sales Invoices...")
    sales_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_invoices,
            COUNT(CASE WHEN IsReturn = 1 THEN 1 END) AS return_flagged_invoices,
            COUNT(CASE WHEN IsHold = 1 THEN 1 END) AS held_invoices,
            MIN(SaleTime) AS min_sale_time,
            MAX(SaleTime) AS max_sale_time,
            SUM(TotalAmount) AS sum_total_amount,
            SUM(SubTotal) AS sum_subtotal,
            SUM(ReceivedAmount) AS sum_received_amount,
            SUM(Balance) AS sum_balance,
            SUM(SaleCost) AS sum_sale_cost,
            SUM(Tax) AS sum_tax,
            COUNT(DISTINCT CustomerId) AS distinct_customer_ids,
            COUNT(DISTINCT CustomerName) AS distinct_customer_names
        FROM POS_SaleInvoices;
    """, [
        "total_invoices", "return_flagged_invoices", "held_invoices",
        "min_sale_time", "max_sale_time", "sum_total_amount", "sum_subtotal",
        "sum_received_amount", "sum_balance", "sum_sale_cost", "sum_tax",
        "distinct_customer_ids", "distinct_customer_names"
    ])
    profile["sales_summary"] = sales_summary[0] if sales_summary else {}

    # Sales Lines Analysis
    print("Profiling Sales Lines...")
    si_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_lines,
            COUNT(DISTINCT SaleId) AS distinct_sales,
            COUNT(DISTINCT ProductId) AS distinct_products_sold,
            SUM(Quantity) AS sum_qty_sold,
            SUM(Quantity * SalePrice) AS sum_gross_amount,
            SUM(Discount) AS sum_line_discount,
            SUM(Boxes) AS sum_boxes,
            SUM(BonusQuantities) AS sum_bonus_qty,
            COUNT(CASE WHEN BatchNo IS NOT NULL AND LTRIM(RTRIM(BatchNo)) != '' THEN 1 END) AS lines_with_batch
        FROM POS_SIProducts;
    """, [
        "total_lines", "distinct_sales", "distinct_products_sold", "sum_qty_sold",
        "sum_gross_amount", "sum_line_discount", "sum_boxes", "sum_bonus_qty", "lines_with_batch"
    ])
    profile["sale_lines_summary"] = si_summary[0] if si_summary else {}

    # Orphan sales lines check
    orphan_sales = sql_to_dicts("""
        SELECT COUNT(*) AS orphan_lines
        FROM POS_SIProducts si
        LEFT JOIN POS_SaleInvoices s ON si.SaleId = s.SaleId
        WHERE s.SaleId IS NULL;
    """, ["orphan_lines"])
    profile["orphan_sale_lines"] = orphan_sales[0]["orphan_lines"] if orphan_sales else "0"

    orphan_sale_products = sql_to_dicts("""
        SELECT COUNT(*) AS orphan_products
        FROM POS_SIProducts si
        LEFT JOIN POS_Products p ON si.ProductId = p.ProductId
        WHERE p.ProductId IS NULL;
    """, ["orphan_products"])
    profile["orphan_sale_products"] = orphan_sale_products[0]["orphan_products"] if orphan_sale_products else "0"

    # Payment types breakdown
    payment_types = sql_to_dicts("""
        SELECT 
            ISNULL(pt.Title, 'Type ' + CAST(s.PaymentTypeId AS varchar)) AS payment_type,
            COUNT(*) AS count_invoices,
            SUM(s.TotalAmount) AS total_revenue
        FROM POS_SaleInvoices s
        LEFT JOIN POS_PaymentTypes pt ON s.PaymentTypeId = pt.Id
        GROUP BY pt.Title, s.PaymentTypeId
        ORDER BY count_invoices DESC;
    """, ["payment_type", "count_invoices", "total_revenue"])
    profile["payment_types"] = payment_types

    # 7. Purchases Analysis
    print("Profiling Purchases...")
    purchases_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_purchases,
            MIN(PurchaseDate) AS min_purchase_date,
            MAX(PurchaseDate) AS max_purchase_date,
            SUM(TotalPurchase) AS sum_total_purchase,
            SUM(Paid) AS sum_paid,
            SUM(Balance) AS sum_balance,
            SUM(Subtotal) AS sum_subtotal,
            SUM(DiscountRs) AS sum_discount_rs,
            SUM(Tax) AS sum_tax,
            COUNT(DISTINCT VendorId) AS distinct_vendor_ids
        FROM POS_PurchaseOrders;
    """, [
        "total_purchases", "min_purchase_date", "max_purchase_date",
        "sum_total_purchase", "sum_paid", "sum_balance", "sum_subtotal",
        "sum_discount_rs", "sum_tax", "distinct_vendor_ids"
    ])
    profile["purchases_summary"] = purchases_summary[0] if purchases_summary else {}

    # Purchase Lines Analysis
    print("Profiling Purchase Lines...")
    po_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_po_lines,
            COUNT(DISTINCT PurchaseId) AS distinct_purchases,
            COUNT(DISTINCT ProductId) AS distinct_products_purchased,
            SUM(Quantity) AS sum_qty_purchased,
            SUM(BonusQuantities) AS sum_bonus_qty,
            COUNT(CASE WHEN ExpiryDate IS NOT NULL THEN 1 END) AS lines_with_expiry,
            COUNT(CASE WHEN BatchNo IS NOT NULL AND LTRIM(RTRIM(BatchNo)) != '' THEN 1 END) AS lines_with_batch,
            COUNT(CASE WHEN BoxQuantity > 0 THEN 1 END) AS lines_with_box_qty,
            MIN(ExpiryDate) AS min_expiry,
            MAX(ExpiryDate) AS max_expiry
        FROM POS_POProducts;
    """, [
        "total_po_lines", "distinct_purchases", "distinct_products_purchased",
        "sum_qty_purchased", "sum_bonus_qty", "lines_with_expiry", "lines_with_batch",
        "lines_with_box_qty", "min_expiry", "max_expiry"
    ])
    profile["purchase_lines_summary"] = po_summary[0] if po_summary else {}

    # Box quantity distribution in purchases
    box_dist = sql_to_dicts("""
        SELECT TOP 10 BoxQuantity, COUNT(*) AS cnt
        FROM POS_POProducts
        GROUP BY BoxQuantity
        ORDER BY cnt DESC;
    """, ["BoxQuantity", "cnt"])
    profile["purchase_box_multipliers"] = box_dist

    # 8. Returns
    print("Profiling Returns...")
    sale_returns = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_sale_returns,
            SUM(ReturnAmount) AS sum_return_amount,
            SUM(ReturnPurchaseCost) AS sum_return_cost,
            SUM(TotalSaleDiscount) AS sum_return_discount
        FROM POS_SaleReturns;
    """, ["total_sale_returns", "sum_return_amount", "sum_return_cost", "sum_return_discount"])
    profile["sale_returns_summary"] = sale_returns[0] if sale_returns else {}

    purchase_returns = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_purchase_returns,
            SUM(ReturnAmount) AS sum_return_amount
        FROM POS_PurchaseReturns;
    """, ["total_purchase_returns", "sum_return_amount"])
    profile["purchase_returns_summary"] = purchase_returns[0] if purchase_returns else {}

    # 9. Stock Adjustments
    print("Profiling Stock Adjustments...")
    sa_summary = sql_to_dicts("""
        SELECT 
            COUNT(DISTINCT sa.Id) AS total_adjustment_events,
            COUNT(*) AS total_adjustment_items,
            SUM(sap.Quantity) AS net_adjusted_quantity,
            SUM(CASE WHEN sap.Quantity > 0 THEN sap.Quantity ELSE 0 END) AS positive_adjustments,
            SUM(CASE WHEN sap.Quantity < 0 THEN sap.Quantity ELSE 0 END) AS negative_adjustments
        FROM POS_StockAdjustment sa
        INNER JOIN POS_SAProduct sap ON sa.Id = sap.StockAdjustmentId;
    """, [
        "total_adjustment_events", "total_adjustment_items", "net_adjusted_quantity",
        "positive_adjustments", "negative_adjustments"
    ])
    profile["stock_adjustment_summary"] = sa_summary[0] if sa_summary else {}

    # 10. Customers & Vendors
    print("Profiling Customers and Vendors...")
    cust_table = sql_to_dicts("""
        SELECT CustomerId, FirstName, LastName, PhoneNo, Account, IsActive FROM POS_Customers;
    """, ["CustomerId", "FirstName", "LastName", "PhoneNo", "Account", "IsActive"])
    profile["customers_table"] = cust_table

    vendor_table = sql_to_dicts("""
        SELECT VendorId, FullName, PhoneNo, Account, IsActive FROM POS_Vendors;
    """, ["VendorId", "FullName", "PhoneNo", "Account", "IsActive"])
    profile["vendors_table"] = vendor_table

    # Customers with balance in Sales Invoices
    credit_sales_customers = sql_to_dicts("""
        SELECT 
            COUNT(DISTINCT CustomerName) AS customers_with_balance,
            SUM(Balance) AS total_receivable_from_invoices
        FROM POS_SaleInvoices
        WHERE Balance > 0;
    """, ["customers_with_balance", "total_receivable_from_invoices"])
    profile["sales_receivables"] = credit_sales_customers[0] if credit_sales_customers else {}

    # 11. POS_ProductImport Investigation
    print("Profiling POS_ProductImport...")
    pi_summary = sql_to_dicts("""
        SELECT 
            COUNT(*) AS total_import_rows,
            COUNT(DISTINCT ProductName) AS distinct_names,
            COUNT(DISTINCT Code) AS distinct_codes,
            COUNT(DISTINCT Category) AS distinct_categories,
            COUNT(DISTINCT Menufacturer) AS distinct_manufacturers
        FROM POS_ProductImport;
    """, ["total_import_rows", "distinct_names", "distinct_codes", "distinct_categories", "distinct_manufacturers"])
    profile["product_import_summary"] = pi_summary[0] if pi_summary else {}

    # Save to JSON
    out_file = r"D:\aivrasol Pharmacy POS\migration\output\keypos-data-profile.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)

    print(f"\nProfiling completed! Output written to {out_file}")

if __name__ == "__main__":
    main()
