import json
import os

report_file = r"D:\aivrasol Pharmacy POS\migration\output\keypos-schema-report.json"
with open(report_file, "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"Total tables: {len(data['tables'])}")
print(f"Total foreign keys: {len(data.get('foreign_keys', []))}")
print(f"Total stored procedures: {len(data.get('stored_procedures', []))}")

non_empty = [t for t in data['tables'] if t['row_count'] > 0]
print(f"\nNon-empty tables ({len(non_empty)}):")
for t in non_empty:
    cols = [c['name'] for c in t['columns']]
    print(f"  {t['schema']}.{t['name']} ({t['row_count']} rows) - PK: {t['primary_keys']}")
    print(f"    Columns: {', '.join(cols[:10])}{' ...' if len(cols) > 10 else ''}")

print("\nEmpty tables:")
empty = [t['name'] for t in data['tables'] if t['row_count'] == 0]
print(f"  Count: {len(empty)}")
print(f"  List: {', '.join(empty)}")
