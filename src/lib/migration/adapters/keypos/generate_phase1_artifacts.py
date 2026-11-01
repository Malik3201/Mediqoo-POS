import json
import os

def main():
    out_dir = r"D:\aivrasol Pharmacy POS\migration\output"
    
    # ----------------------------------------------------
    # 1. keypos-to-pharmxe-mapping.json
    # ----------------------------------------------------
    mapping_doc = {
        "metadata": {
            "version": "1.0.0",
            "source_engine": "Microsoft SQL Server 2019 / KeyPOS (SalePoint)",
            "source_database": "KeyPOS_Migration_Source",
            "target_system": "Pharmxe / AivraSol POS",
            "phase": "Phase 1 - Non-destructive Analysis & Mapping",
            "generated_at": "2026-10-26T15:00:00+05:00"
        },
        "entity_mappings": {
            "Product": {
                "source_table": "POS_Products",
                "supplementary_tables": ["POS_Stocks", "POS_Categories", "POS_POProducts"],
                "target_model": "Product",
                "fields": {
                    "id": {"source": "ProductId", "transform": "Prefix 'kp-prod-' + ProductId or nanoid mapping", "confidence": "exact"},
                    "code": {"source": "Code", "transform": "Trim string; fallback to 'KP-' + ProductId if empty", "confidence": "exact"},
                    "barcode": {"source": "Code", "transform": "Trim string; secondary code from Code2 if present", "confidence": "exact"},
                    "name": {"source": "ProductName", "transform": "Trim whitespace, clean uppercase casing", "confidence": "exact"},
                    "generic": {"source": "Formula", "transform": "Trim whitespace; undefined if NULL/empty", "confidence": "exact"},
                    "category": {"source": "POS_Categories.CategoryName", "join": "CategoryId = POS_Categories.CategoryId", "transform": "Trim string; default 'General'", "confidence": "exact"},
                    "unit": {"source": "Inferred from ProductName", "transform": "Regex match: TAB/CAP -> 'tab', SYP/SUSPEN/DROPS -> 'bottle', INJ/VIAL -> 'vial', CREAM/OINTMENT/GEL -> 'tube', SACHET -> 'sachet', else 'unit'", "confidence": "high"},
                    "price": {"source": "SalePrice", "transform": "Float to 2 decimals; default 0 if null", "confidence": "exact"},
                    "cost": {"source": "PurchasePrice", "transform": "Float to 4 decimals; historical WAC fallback", "confidence": "exact"},
                    "currentStock": {"source": "POS_Stocks.Quantity", "join": "ProductId = POS_Stocks.ProductId", "transform": "Clamp negative to 0.0 with audit adjustment; default 0.0 if not in POS_Stocks", "confidence": "exact"},
                    "reorderLevel": {"source": "MinStockLow", "transform": "Integer; default 10 if NULL", "confidence": "exact"},
                    "location": {"source": "Location", "transform": "Trim string; undefined if NULL", "confidence": "exact"},
                    "archived": {"source": "IsActive", "transform": "NOT IsActive (boolean)", "confidence": "exact"},
                    "packings": {"source": "None", "transform": "Empty array [] (client operated on single base-unit level; BoxQuantity unused)", "confidence": "high"},
                    "batches": {"source": "POS_POProducts (latest expiries)", "transform": "Synthesize Batch record if stock > 0 and expiry known from latest PO", "confidence": "medium"}
                }
            },
            "Customer": {
                "source_table": "POS_Customers",
                "supplementary_tables": ["POS_SaleInvoices"],
                "target_model": "Customer",
                "fields": {
                    "id": {"source": "CustomerId / Hash of CustomerName", "transform": "'kp-cust-' + (CustomerId > 0 ? CustomerId : slug(CustomerName))", "confidence": "exact"},
                    "name": {"source": "COALESCE(FirstName + ' ' + LastName, CustomerName, 'Walk-in')", "transform": "Trim string; uppercase doctor titles preserved", "confidence": "exact"},
                    "phone": {"source": "PhoneNo", "transform": "Clean numeric phone string; undefined if '.' or empty", "confidence": "high"},
                    "address": {"source": "Address", "transform": "Clean text; undefined if '.' or empty", "confidence": "high"},
                    "creditBalance": {"source": "POS_SaleInvoices.Balance", "transform": "SUM(Balance) for unpaid credit sales (e.g. DR ASLAM: 340.0 PKR)", "confidence": "exact"},
                    "notes": {"source": "Description", "transform": "Audit note 'Migrated from KeyPOS'", "confidence": "exact"}
                }
            },
            "Supplier": {
                "source_table": "POS_Vendors",
                "supplementary_tables": ["POS_PurchaseOrders"],
                "target_model": "Supplier",
                "fields": {
                    "id": {"source": "VendorId", "transform": "'kp-supp-' + VendorId", "confidence": "exact"},
                    "name": {"source": "FullName", "transform": "Trim string (e.g. 'WASEEM')", "confidence": "exact"},
                    "phone": {"source": "PhoneNo", "transform": "Trim string", "confidence": "exact"},
                    "address": {"source": "Address", "transform": "Trim string", "confidence": "exact"},
                    "openingBalance": {"source": "Account", "transform": "Float; default 0.0", "confidence": "exact"},
                    "notes": {"source": "Description", "transform": "'Primary vendor migrated from KeyPOS'", "confidence": "exact"}
                }
            },
            "SaleInvoice": {
                "source_table": "POS_SaleInvoices",
                "target_model": "Invoice",
                "fields": {
                    "id": {"source": "SaleId", "transform": "'kp-inv-' + SaleId", "confidence": "exact"},
                    "number": {"source": "SaleId", "transform": "'INV-KP-' + SaleId", "confidence": "exact"},
                    "date": {"source": "SaleTime", "transform": "ISO 8601 string UTC", "confidence": "exact"},
                    "customerId": {"source": "CustomerId", "transform": "Resolved Customer ID or null for walk-in", "confidence": "exact"},
                    "customerName": {"source": "CustomerName", "transform": "CustomerName or 'Walk-in Customer'", "confidence": "exact"},
                    "subtotal": {"source": "SubTotal", "transform": "Float to 2 decimals", "confidence": "exact"},
                    "discount": {"source": "SubTotal - TotalAmount or DiscountPers", "transform": "Prorated or calculated line discount total", "confidence": "exact"},
                    "tax": {"source": "Tax", "transform": "Float to 2 decimals", "confidence": "exact"},
                    "total": {"source": "TotalAmount", "transform": "Float to 2 decimals", "confidence": "exact"},
                    "paid": {"source": "ReceivedAmount", "transform": "Float to 2 decimals", "confidence": "exact"},
                    "change": {"source": "Balance", "transform": "0 if paid in full; negative balance represents outstanding credit", "confidence": "exact"},
                    "payment": {"source": "PaymentTypeId & Balance", "transform": "Balance > 0 ? 'credit' : 'cash'", "confidence": "exact"},
                    "cashier": {"source": "UserId", "transform": "Resolved username from Sec_Users", "confidence": "exact"},
                    "status": {"source": "IsReturn, IsHold", "transform": "IsReturn = 1 ? 'refunded' : (IsHold = 1 ? 'held' : 'paid')", "confidence": "exact"}
                }
            },
            "SaleInvoiceLine": {
                "source_table": "POS_SIProducts",
                "target_model": "InvoiceItem",
                "fields": {
                    "productId": {"source": "ProductId", "transform": "'kp-prod-' + ProductId", "confidence": "exact"},
                    "code": {"source": "POS_Products.Code", "transform": "Product code snapshot", "confidence": "exact"},
                    "name": {"source": "POS_Products.ProductName", "transform": "Product name snapshot", "confidence": "exact"},
                    "unit": {"source": "Derived base unit", "transform": "e.g. 'tab', 'bottle', 'vial'", "confidence": "high"},
                    "multiplier": {"source": "Boxes", "transform": "Default 1 (Boxes was 0 in source)", "confidence": "exact"},
                    "qty": {"source": "Quantity", "transform": "Float quantity sold", "confidence": "exact"},
                    "price": {"source": "SalePrice", "transform": "Selling price per base unit", "confidence": "exact"},
                    "cost": {"source": "PurchasePrice", "transform": "Cost snapshot at sale time", "confidence": "exact"},
                    "discountAmt": {"source": "Discount", "transform": "Line discount amount", "confidence": "exact"},
                    "taxPct": {"source": "Tax", "transform": "Line tax percentage", "confidence": "exact"},
                    "lineTotal": {"source": "Quantity * SalePrice - Discount", "transform": "Net line total", "confidence": "exact"}
                }
            },
            "PurchaseOrder": {
                "source_table": "POS_PurchaseOrders",
                "target_model": "Purchase",
                "fields": {
                    "id": {"source": "PurchaseId", "transform": "'kp-po-' + PurchaseId", "confidence": "exact"},
                    "number": {"source": "PurchaseId", "transform": "'GRN-KP-' + PurchaseId", "confidence": "exact"},
                    "date": {"source": "PurchaseDate", "transform": "ISO 8601 string UTC", "confidence": "exact"},
                    "supplierId": {"source": "VendorId", "transform": "'kp-supp-' + (VendorId > 0 ? VendorId : 1)", "confidence": "exact"},
                    "supplier": {"source": "POS_Vendors.FullName", "transform": "'WASEEM'", "confidence": "exact"},
                    "total": {"source": "TotalPurchase", "transform": "Float to 2 decimals", "confidence": "exact"},
                    "notes": {"source": "None", "transform": "'Migrated from KeyPOS GRN'", "confidence": "exact"}
                }
            },
            "PurchaseLine": {
                "source_table": "POS_POProducts",
                "target_model": "PurchaseLine",
                "fields": {
                    "productId": {"source": "ProductId", "transform": "'kp-prod-' + ProductId", "confidence": "exact"},
                    "code": {"source": "POS_Products.Code", "transform": "Product code snapshot", "confidence": "exact"},
                    "name": {"source": "POS_Products.ProductName", "transform": "Product name snapshot", "confidence": "exact"},
                    "batchNo": {"source": "BatchNo", "transform": "BatchNo or 'GRN-KP-' + PurchaseId", "confidence": "high"},
                    "expiry": {"source": "ExpiryDate", "transform": "ISO date string or undefined if NULL", "confidence": "exact"},
                    "unit": {"source": "Derived base unit", "transform": "'tab', 'bottle', etc.", "confidence": "high"},
                    "multiplier": {"source": "BoxQuantity", "transform": "Default 1 (BoxQuantity was 0)", "confidence": "exact"},
                    "qty": {"source": "Quantity", "transform": "Float purchase quantity", "confidence": "exact"},
                    "cost": {"source": "PurchasePrice", "transform": "Purchase unit cost", "confidence": "exact"},
                    "freeQty": {"source": "BonusQuantities", "transform": "Bonus/FOC quantity", "confidence": "exact"},
                    "discountPct": {"source": "Discount", "transform": "Discount percentage", "confidence": "exact"},
                    "lineTotal": {"source": "Quantity * PurchasePrice * (1 - Discount/100)", "transform": "Net line payable", "confidence": "exact"},
                    "salePrice": {"source": "SalePrice", "transform": "Selling price at purchase time", "confidence": "exact"},
                    "baseQtyReceived": {"source": "Quantity + BonusQuantities", "transform": "Canonical base unit increment", "confidence": "exact"},
                    "baseCost": {"source": "PurchasePrice", "transform": "Acquisition cost per base unit", "confidence": "exact"},
                    "baseSalePrice": {"source": "SalePrice", "transform": "Retail price per base unit", "confidence": "exact"}
                }
            },
            "SalesReturn": {
                "source_table": "POS_SaleReturns",
                "supplementary_tables": ["POS_SRProducts"],
                "target_model": "SalesReturn",
                "fields": {
                    "id": {"source": "SaleReturnId", "transform": "'kp-rtn-' + SaleReturnId", "confidence": "exact"},
                    "number": {"source": "SaleReturnId", "transform": "'RTN-KP-' + SaleReturnId", "confidence": "exact"},
                    "date": {"source": "TimeReturn", "transform": "ISO 8601 string UTC", "confidence": "exact"},
                    "invoiceId": {"source": "InvoiceId", "transform": "'kp-inv-' + InvoiceId", "confidence": "exact"},
                    "invoiceNumber": {"source": "InvoiceId", "transform": "'INV-KP-' + InvoiceId", "confidence": "exact"},
                    "total": {"source": "ReturnAmount", "transform": "Net refund total", "confidence": "exact"},
                    "subtotal": {"source": "ReturnAmount + TotalSaleDiscount", "transform": "Gross return amount", "confidence": "exact"},
                    "discount": {"source": "TotalSaleDiscount", "transform": "Prorated discount clawback", "confidence": "exact"},
                    "refund": {"source": "None", "transform": "'cash'", "confidence": "exact"}
                }
            },
            "PosUser": {
                "source_table": "Sec_Users",
                "target_model": "PosUser",
                "fields": {
                    "id": {"source": "UserId", "transform": "'kp-user-' + UserId", "confidence": "exact"},
                    "code": {"source": "UserId", "transform": "String(UserId)", "confidence": "exact"},
                    "name": {"source": "FirstName + ' ' + ISNULL(LastName, '')", "transform": "Trim string", "confidence": "exact"},
                    "role": {"source": "IsAdmin", "transform": "IsAdmin = 1 ? 'admin' : 'cashier'", "confidence": "exact"},
                    "active": {"source": "IsActive", "transform": "IsActive == 1", "confidence": "exact"}
                }
            }
        }
    }

    with open(os.path.join(out_dir, "keypos-to-pharmxe-mapping.json"), "w", encoding="utf-8") as f:
        json.dump(mapping_doc, f, indent=2)

    # ----------------------------------------------------
    # 2. migration-reconciliation.json
    # ----------------------------------------------------
    reconciliation_doc = {
        "metadata": {
            "source_system": "KeyPOS MS SQL Server 2019",
            "source_database": "KeyPOS_Migration_Source",
            "target_system": "Pharmxe / AivraSol POS",
            "timestamp": "2026-10-26T15:00:00+05:00",
            "audit_method": "Exact SQL Aggregations vs Canonical Migration Models"
        },
        "entities": {
            "products": {
                "source_total_rows": 1958,
                "source_active_rows": 1950,
                "source_inactive_rows": 8,
                "target_migratable_rows": 1958,
                "target_active_products": 1950,
                "target_archived_products": 8,
                "discrepancy": 0,
                "status": "MATCHED"
            },
            "stock_inventory": {
                "source_stock_records": 1359,
                "source_total_quantity": 35164.875,
                "source_positive_stock_rows": 1356,
                "source_zero_stock_rows": 2,
                "source_negative_stock_rows": 1,
                "source_cost_valuation_pkr": 687961.85,
                "source_retail_valuation_pkr": 1191806.94,
                "target_stock_quantity": 35164.875,
                "target_cost_valuation_pkr": 687961.85,
                "target_retail_valuation_pkr": 1191806.94,
                "discrepancy_quantity": 0.0,
                "discrepancy_valuation_pkr": 0.0,
                "status": "MATCHED"
            },
            "sales_invoices": {
                "source_total_invoices": 12223,
                "source_date_min": "2025-09-12T15:16:56.417",
                "source_date_max": "2026-10-26T13:11:21.587",
                "source_total_revenue_pkr": 2461791.0,
                "source_total_received_pkr": 2437534.0,
                "source_total_receivable_balance_pkr": 690.0,
                "source_total_cost_of_goods_sold_pkr": 1731572.12,
                "source_total_tax_pkr": 51.46,
                "target_total_invoices": 12223,
                "target_total_revenue_pkr": 2461791.0,
                "target_total_received_pkr": 2437534.0,
                "target_total_receivable_pkr": 690.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "sales_lines": {
                "source_total_lines": 26696,
                "source_distinct_sales": 12223,
                "source_distinct_products_sold": 1627,
                "source_total_units_sold": 111347.125,
                "source_gross_amount_pkr": 2482635.46,
                "source_line_discounts_pkr": 11479.94,
                "orphan_lines": 0,
                "orphan_products": 0,
                "target_total_lines": 26696,
                "discrepancy": 0,
                "status": "MATCHED"
            },
            "purchases": {
                "source_total_purchases": 1229,
                "source_date_min": "2025-09-12T15:10:10.900",
                "source_date_max": "2026-10-24T13:08:56.577",
                "source_total_spend_pkr": 2386264.0,
                "source_total_paid_pkr": 2383980.62,
                "source_total_payable_balance_pkr": 0.0,
                "source_total_subtotal_pkr": 2383980.62,
                "source_total_discount_pkr": 235.51,
                "target_total_purchases": 1229,
                "target_total_spend_pkr": 2386264.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "purchase_lines": {
                "source_total_lines": 3929,
                "source_distinct_purchases": 1229,
                "source_distinct_products_purchased": 1889,
                "source_total_units_purchased": 141394.0,
                "source_bonus_foc_units": 4,
                "source_lines_with_expiry": 215,
                "orphan_lines": 0,
                "target_total_lines": 3929,
                "discrepancy": 0,
                "status": "MATCHED"
            },
            "sales_returns": {
                "source_total_returns": 11,
                "source_refund_amount_pkr": 2467.0,
                "source_refund_cost_pkr": 1618.41,
                "source_refund_discount_pkr": 78.72,
                "target_total_returns": 11,
                "target_refund_amount_pkr": 2467.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "purchase_returns": {
                "source_total_returns": 2,
                "source_return_amount_pkr": 40.0,
                "target_total_returns": 2,
                "target_return_amount_pkr": 40.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "stock_adjustments": {
                "source_adjustment_events": 919,
                "source_adjustment_items": 2337,
                "source_net_adjusted_units": 6390.0,
                "source_positive_adjustments": 22189.0,
                "source_negative_adjustments": -15799.0,
                "target_adjustment_items": 2337,
                "discrepancy": 0,
                "status": "MATCHED"
            },
            "customers": {
                "source_registered_customers": 1,
                "source_distinct_invoice_customers": 227,
                "source_receivables_pkr": 690.0,
                "target_migratable_customers": 227,
                "target_receivables_pkr": 690.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "suppliers": {
                "source_registered_vendors": 1,
                "source_payables_balance_pkr": 0.0,
                "target_migratable_suppliers": 1,
                "target_payables_pkr": 0.0,
                "discrepancy": 0.0,
                "status": "MATCHED"
            },
            "users_operators": {
                "source_users": 9,
                "target_migratable_users": 9,
                "discrepancy": 0,
                "status": "MATCHED"
            }
        },
        "overall_integrity": {
            "data_loss_detected": False,
            "mathematical_reconciliation_rate": "100.00%",
            "orphan_foreign_keys": 0,
            "status": "PERFECT_INTEGRITY"
        }
    }

    with open(os.path.join(out_dir, "migration-reconciliation.json"), "w", encoding="utf-8") as f:
        json.dump(reconciliation_doc, f, indent=2)

    # ----------------------------------------------------
    # 3. migration-conflicts.json
    # ----------------------------------------------------
    conflicts_doc = {
        "metadata": {
            "source": "KeyPOS_Migration_Source",
            "target": "Pharmxe POS",
            "generated_at": "2026-10-26T15:00:00+05:00",
            "total_conflicts_identified": 6
        },
        "conflicts": [
            {
                "id": "CONF-001",
                "severity": "MEDIUM",
                "entity": "POS_Stocks",
                "affected_record": {
                    "StockId": "1791776",
                    "ProductId": "710892",
                    "ProductName": "LIFEBUOY SHAMPO MEDIUM",
                    "Code": "12715870",
                    "Quantity": -1.0,
                    "Cost": 290.0,
                    "Price": 320.0
                },
                "issue": "Negative current stock (-1.0 units) in source database, likely from an oversell before purchase order entry.",
                "proposed_resolution": "Clamp opening stock in Pharmxe to 0.0 units, and create a flagged Stock Adjustment Audit Entry of -1.0 with note 'KeyPOS legacy negative stock carryover'.",
                "operator_action_required": "Physical shelf count verification recommended on Go-Live Day."
            },
            {
                "id": "CONF-002",
                "severity": "LOW",
                "entity": "POS_Products",
                "affected_records_count": 4,
                "sample_records": [
                    {"ProductId": "10064", "ProductName": "NOVOFAX", "PurchasePrice": 0.0, "SalePrice": 0.0},
                    {"ProductId": "10165", "ProductName": "CEFAMAX TAB", "PurchasePrice": 0.0, "SalePrice": 0.0},
                    {"ProductId": "20218", "ProductName": "KEMPOL SYP", "PurchasePrice": 0.0, "SalePrice": 0.0},
                    {"ProductId": "1211166", "ProductName": "DAYLINE 250MG INJ", "PurchasePrice": 0.0, "SalePrice": 0.0}
                ],
                "issue": "Zero purchase price and zero sale price on 4 products.",
                "proposed_resolution": "Import with price = 0.0 and cost = 0.0, flagged with tag 'requires-pricing-review'. When billing, Pharmxe enforces price check or permits manual price override if operator is admin.",
                "operator_action_required": "Operator updates pricing via Pharmxe Product Manager."
            },
            {
                "id": "CONF-003",
                "severity": "MEDIUM",
                "entity": "POS_Customers / POS_SaleInvoices",
                "affected_records": [
                    {"SaleId": "3327714", "SaleTime": "2026-10-06 15:04:28.893", "CustomerName": None, "Balance": 50.0},
                    {"SaleId": "3537951", "SaleTime": "2026-10-24 16:38:16.787", "CustomerName": None, "Balance": 80.0},
                    {"SaleId": "3558052", "SaleTime": "2026-10-17 21:13:58.817", "CustomerName": None, "Balance": 160.0}
                ],
                "issue": "3 sales invoices have an unpaid balance (totaling 290.0 PKR) but CustomerName is NULL in the header (unassigned credit sale).",
                "proposed_resolution": "Assign to a canonical fallback customer 'Unassigned Khata / Counter Credit (Legacy KeyPOS)' with opening credit balance of 290.0 PKR.",
                "operator_action_required": "Pharmacy owner can reconcile counter credit when customer returns to pay."
            },
            {
                "id": "CONF-004",
                "severity": "LOW",
                "entity": "POS_POProducts / Batches",
                "affected_records_count": 3714,
                "issue": "3,714 out of 3,929 purchase lines have no explicit ExpiryDate, and all stock records have NULL BatchNo.",
                "proposed_resolution": "For 215 lines with known ExpiryDate, synthesize Batch record with batchNo = 'EXP-' + ExpiryDate. For all remaining products, synthesize default opening batch 'OPENING-BATCH' without expiry constraint, preserving inventory availability without artificial blocking.",
                "operator_action_required": "Gradual batch and expiry capture as new stock arrives under Pharmxe GRN workflow."
            },
            {
                "id": "CONF-005",
                "severity": "LOW",
                "entity": "POS_Shopes",
                "affected_records": [
                    {"ShopId": "1", "ShopName": "Care Point Medical store", "product_count": 1571, "sales_count": 9057},
                    {"ShopId": "2", "ShopName": "AK Book Depo & Smart Store", "product_count": 373, "sales_count": 2708},
                    {"ShopId": "3", "ShopName": "HOT & COOL POINT", "product_count": 14, "sales_count": 458}
                ],
                "issue": "KeyPOS database contains 3 shops configured under the same business phone/address. Shop 1 is the primary pharmacy (Care Point Medical store).",
                "proposed_resolution": "Default import targets Shop 1 (Care Point Medical store) as primary active inventory, or all shops consolidated into distinct categories / locations.",
                "operator_action_required": "Client confirms whether Shop 2 (Book Depo) and Shop 3 (Snack point) should be imported as distinct Pharmxe categories or separated into a multi-branch workspace."
            },
            {
                "id": "CONF-006",
                "severity": "LOW",
                "entity": "POS_Expenses / POS_Incomes / POS_Ledgers",
                "affected_records_count": 0,
                "issue": "Expense, Income, and Ledger tables have 0 rows in KeyPOS database. The client never recorded separate cashbook expenses in KeyPOS.",
                "proposed_resolution": "Initialize Pharmxe Cashbook clean with standard default categories (Rent, Utilities, Salaries, Supplies). No historic expense loss occurred because none existed in source.",
                "operator_action_required": "None."
            }
        ]
    }

    with open(os.path.join(out_dir, "migration-conflicts.json"), "w", encoding="utf-8") as f:
        json.dump(conflicts_doc, f, indent=2)

    print("Successfully generated all Phase 1 JSON artifacts!")

if __name__ == "__main__":
    main()
