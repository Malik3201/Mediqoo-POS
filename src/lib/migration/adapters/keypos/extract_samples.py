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
    samples = {}

    # 3 Products: 1 tablet, 1 syrup, 1 injection/cream
    p_cols = ["ProductId", "CategoryId", "ProductName", "Code", "Formula", "PurchasePrice", "SalePrice", "IsActive", "Location", "MinStockLow"]
    prod1 = sql_to_dicts("SELECT ProductId, CategoryId, ProductName, Code, Formula, PurchasePrice, SalePrice, IsActive, Location, MinStockLow FROM POS_Products WHERE ProductName LIKE '%PANADOL%TAB%' OR ProductName LIKE '%DAONIL%TAB%';", p_cols)
    prod2 = sql_to_dicts("SELECT ProductId, CategoryId, ProductName, Code, Formula, PurchasePrice, SalePrice, IsActive, Location, MinStockLow FROM POS_Products WHERE ProductName LIKE '%BRUFEN%SYP%' OR ProductName LIKE '%TRIMETABOL%';", p_cols)
    prod3 = sql_to_dicts("SELECT ProductId, CategoryId, ProductName, Code, Formula, PurchasePrice, SalePrice, IsActive, Location, MinStockLow FROM POS_Products WHERE ProductName LIKE '%INJ%' OR ProductName LIKE '%CREAM%';", p_cols)

    samples["products"] = [prod1[0] if prod1 else {}, prod2[0] if prod2 else {}, prod3[0] if prod3 else {}]

    # Stocks for these 3 products
    p_ids = [p["ProductId"] for p in samples["products"] if p.get("ProductId")]
    if p_ids:
        st_cols = ["StockId", "ProductId", "Quantity", "PurchasePrice", "SalePrice", "BatchNo"]
        stocks = sql_to_dicts(f"SELECT StockId, ProductId, Quantity, PurchasePrice, SalePrice, BatchNo FROM POS_Stocks WHERE ProductId IN ({','.join(p_ids)});", st_cols)
        samples["product_stocks"] = stocks

    # 2 Customers: DR ANSAR (frequent) and DR ASLAM (with balance)
    cust1 = sql_to_dicts("SELECT TOP 1 CustomerId, CustomerName, TotalAmount, Balance, SaleTime FROM POS_SaleInvoices WHERE CustomerName = 'DR ANSAR';", ["CustomerId", "CustomerName", "TotalAmount", "Balance", "SaleTime"])
    cust2 = sql_to_dicts("SELECT CustomerId, CustomerName, TotalAmount, Balance, SaleTime FROM POS_SaleInvoices WHERE Balance = 340.0;", ["CustomerId", "CustomerName", "TotalAmount", "Balance", "SaleTime"])
    samples["customers"] = [cust1[0] if cust1 else {}, cust2[0] if cust2 else {}]

    # 2 Suppliers: VendorId 1 ("WASEEM") and purchase spend
    v_cols = ["VendorId", "FullName", "PhoneNo", "Address", "Account", "IsActive"]
    vendor1 = sql_to_dicts("SELECT VendorId, FullName, PhoneNo, Address, Account, IsActive FROM POS_Vendors WHERE VendorId = 1;", v_cols)
    samples["suppliers"] = vendor1

    # 3 Sales:
    # Sale 1: Simple cash counter sale
    sale1 = sql_to_dicts("SELECT TOP 1 SaleId, TotalAmount, SubTotal, ReceivedAmount, Balance, DiscountPers, CustomerName, SaleTime, PaymentTypeId, Tax FROM POS_SaleInvoices WHERE CustomerName IS NULL AND DiscountPers = 0 AND Balance = 0 AND TotalAmount > 100;", ["SaleId", "TotalAmount", "SubTotal", "ReceivedAmount", "Balance", "DiscountPers", "CustomerName", "SaleTime", "PaymentTypeId", "Tax"])
    # Sale 2: Sale with discount
    sale2 = sql_to_dicts("SELECT TOP 1 SaleId, TotalAmount, SubTotal, ReceivedAmount, Balance, DiscountPers, CustomerName, SaleTime, PaymentTypeId, Tax FROM POS_SaleInvoices WHERE DiscountPers > 0 AND TotalAmount > 200;", ["SaleId", "TotalAmount", "SubTotal", "ReceivedAmount", "Balance", "DiscountPers", "CustomerName", "SaleTime", "PaymentTypeId", "Tax"])
    # Sale 3: Credit sale with balance (receivable)
    sale3 = sql_to_dicts("SELECT SaleId, TotalAmount, SubTotal, ReceivedAmount, Balance, DiscountPers, CustomerName, SaleTime, PaymentTypeId, Tax FROM POS_SaleInvoices WHERE Balance = 340.0;", ["SaleId", "TotalAmount", "SubTotal", "ReceivedAmount", "Balance", "DiscountPers", "CustomerName", "SaleTime", "PaymentTypeId", "Tax"])

    samples["sales"] = [sale1[0] if sale1 else {}, sale2[0] if sale2 else {}, sale3[0] if sale3 else {}]

    # Get lines for these 3 sales
    s_ids = [s["SaleId"] for s in samples["sales"] if s.get("SaleId")]
    if s_ids:
        si_cols = ["SIProductId", "SaleId", "ProductId", "SalePrice", "PurchasePrice", "Quantity", "Discount", "Tax", "Boxes", "BatchNo"]
        lines = sql_to_dicts(f"SELECT SIProductId, SaleId, ProductId, SalePrice, PurchasePrice, Quantity, Discount, Tax, Boxes, BatchNo FROM POS_SIProducts WHERE SaleId IN ({','.join(s_ids)});", si_cols)
        samples["sale_lines"] = lines

    # 2 Purchases:
    # Purchase 1: Regular purchase
    p1 = sql_to_dicts("SELECT TOP 1 PurchaseId, TotalPurchase, Paid, Balance, PurchaseDate, VendorId, Subtotal, DiscountRs FROM POS_PurchaseOrders WHERE TotalPurchase > 1000 ORDER BY PurchaseId DESC;", ["PurchaseId", "TotalPurchase", "Paid", "Balance", "PurchaseDate", "VendorId", "Subtotal", "DiscountRs"])
    # Purchase 2: Purchase with expiry date on line
    p2 = sql_to_dicts("SELECT TOP 1 po.PurchaseId, p.TotalPurchase, p.Paid, p.Balance, p.PurchaseDate, p.VendorId, p.Subtotal, p.DiscountRs FROM POS_POProducts po INNER JOIN POS_PurchaseOrders p ON po.PurchaseId = p.PurchaseId WHERE po.ExpiryDate IS NOT NULL ORDER BY po.ExpiryDate ASC;", ["PurchaseId", "TotalPurchase", "Paid", "Balance", "PurchaseDate", "VendorId", "Subtotal", "DiscountRs"])

    samples["purchases"] = [p1[0] if p1 else {}, p2[0] if p2 else {}]

    # Lines for these 2 purchases
    po_ids = [p["PurchaseId"] for p in samples["purchases"] if p.get("PurchaseId")]
    if po_ids:
        po_cols = ["POProductId", "PurchaseId", "ProductId", "PurchasePrice", "SalePrice", "Quantity", "ExpiryDate", "Discount", "Tax", "BoxQuantity", "BonusQuantities"]
        po_lines = sql_to_dicts(f"SELECT POProductId, PurchaseId, ProductId, PurchasePrice, SalePrice, Quantity, ExpiryDate, Discount, Tax, BoxQuantity, BonusQuantities FROM POS_POProducts WHERE PurchaseId IN ({','.join(po_ids)});", po_cols)
        samples["purchase_lines"] = po_lines

    # 1 Sale Return: ReturnId 1 or 2
    sr = sql_to_dicts("SELECT SaleReturnId, InvoiceId, ReturnAmount, ReturnPurchaseCost, TotalSaleDiscount, TimeReturn FROM POS_SaleReturns WHERE SaleReturnId = 1;", ["SaleReturnId", "InvoiceId", "ReturnAmount", "ReturnPurchaseCost", "TotalSaleDiscount", "TimeReturn"])
    samples["sale_return"] = sr[0] if sr else {}
    sr_lines = sql_to_dicts("SELECT SRProductId, SIProductId, ReturnId, ProductId, Quantity, BatchNo FROM POS_SRProducts WHERE ReturnId = 1;", ["SRProductId", "SIProductId", "ReturnId", "ProductId", "Quantity", "BatchNo"])
    samples["sale_return_lines"] = sr_lines

    # Save to JSON
    out_file = r"D:\aivrasol Pharmacy POS\migration\output\keypos-samples.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(samples, f, indent=2)

    print(f"Sample extraction complete! Written to {out_file}")

if __name__ == "__main__":
    main()
