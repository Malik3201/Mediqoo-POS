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
        "-Q", query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(f"SQL Error: {result.stderr}\nOutput: {result.stdout}")
    return result.stdout

def main():
    print("Extracting tables and row counts...")
    tables_sql = """
    SET NOCOUNT ON;
    SELECT 
        s.name AS [schema],
        t.name AS [table],
        p.rows AS [row_count],
        t.create_date,
        t.modify_date
    FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    INNER JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
    ORDER BY p.rows DESC, t.name ASC;
    """
    out = run_sql(tables_sql)
    tables = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3 and parts[0] and parts[1]:
            tables.append({
                "schema": parts[0],
                "table": parts[1],
                "row_count": int(parts[2]) if parts[2].isdigit() else 0,
                "create_date": parts[3] if len(parts) > 3 else "",
                "modify_date": parts[4] if len(parts) > 4 else "",
            })

    print(f"Total tables found: {len(tables)}")

    print("Extracting columns and data types...")
    columns_sql = """
    SET NOCOUNT ON;
    SELECT 
        s.name AS [schema],
        t.name AS [table],
        c.column_id,
        c.name AS [column],
        ty.name AS [type],
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        ISNULL(dc.definition, '') AS [default_val]
    FROM sys.columns c
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
    ORDER BY s.name, t.name, c.column_id;
    """
    col_out = run_sql(columns_sql)
    columns_map = {}
    for line in col_out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 10:
            key = f"{parts[0]}.{parts[1]}"
            if key not in columns_map:
                columns_map[key] = []
            columns_map[key].append({
                "column_id": int(parts[2]) if parts[2].isdigit() else 0,
                "name": parts[3],
                "type": parts[4],
                "max_length": int(parts[5]) if parts[5].isdigit() or (parts[5].startswith('-') and parts[5][1:].isdigit()) else 0,
                "precision": int(parts[6]) if parts[6].isdigit() else 0,
                "scale": int(parts[7]) if parts[7].isdigit() else 0,
                "is_nullable": parts[8] == "1",
                "is_identity": parts[9] == "1",
                "default": parts[10] if len(parts) > 10 else ""
            })

    print("Extracting primary keys...")
    pk_sql = """
    SET NOCOUNT ON;
    SELECT 
        s.name AS [schema],
        t.name AS [table],
        c.name AS [column],
        kc.name AS [pk_name]
    FROM sys.key_constraints kc
    INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    INNER JOIN sys.index_columns ic ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE kc.type = 'PK';
    """
    pk_out = run_sql(pk_sql)
    pk_map = {}
    for line in pk_out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 4:
            key = f"{parts[0]}.{parts[1]}"
            if key not in pk_map:
                pk_map[key] = []
            pk_map[key].append(parts[2])

    print("Extracting foreign keys...")
    fk_sql = """
    SET NOCOUNT ON;
    SELECT 
        fk.name AS [fk_name],
        s_from.name AS [from_schema],
        t_from.name AS [from_table],
        c_from.name AS [from_column],
        s_to.name AS [to_schema],
        t_to.name AS [to_table],
        c_to.name AS [to_column]
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.tables t_from ON fkc.parent_object_id = t_from.object_id
    INNER JOIN sys.schemas s_from ON t_from.schema_id = s_from.schema_id
    INNER JOIN sys.columns c_from ON fkc.parent_object_id = c_from.object_id AND fkc.parent_column_id = c_from.column_id
    INNER JOIN sys.tables t_to ON fkc.referenced_object_id = t_to.object_id
    INNER JOIN sys.schemas s_to ON t_to.schema_id = s_to.schema_id
    INNER JOIN sys.columns c_to ON fkc.referenced_object_id = c_to.object_id AND fkc.referenced_column_id = c_to.column_id;
    """
    fk_out = run_sql(fk_sql)
    fk_list = []
    for line in fk_out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 7:
            fk_list.append({
                "fk_name": parts[0],
                "from_table": f"{parts[1]}.{parts[2]}",
                "from_column": parts[3],
                "to_table": f"{parts[4]}.{parts[5]}",
                "to_column": parts[6]
            })

    print("Extracting stored procedures...")
    sp_sql = """
    SET NOCOUNT ON;
    SELECT 
        s.name AS [schema],
        p.name AS [procedure],
        p.create_date,
        p.modify_date
    FROM sys.procedures p
    INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
    ORDER BY s.name, p.name;
    """
    sp_out = run_sql(sp_sql)
    sp_list = []
    for line in sp_out.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            sp_list.append({
                "schema": parts[0],
                "name": parts[1],
                "create_date": parts[2] if len(parts) > 2 else "",
                "modify_date": parts[3] if len(parts) > 3 else "",
            })

    # Assemble complete schema report
    full_report = {
        "database": "KeyPOS_Migration_Source",
        "source_backup_file": "KEYPOS_20261026_15.0.2000.5.bak",
        "extracted_tables_count": len(tables),
        "tables": []
    }

    for t in tables:
        key = f"{t['schema']}.{t['table']}"
        full_report["tables"].append({
            "schema": t["schema"],
            "name": t["table"],
            "row_count": t["row_count"],
            "create_date": t["create_date"],
            "modify_date": t["modify_date"],
            "primary_keys": pk_map.get(key, []),
            "columns": columns_map.get(key, [])
        })

    full_report["foreign_keys"] = fk_list
    full_report["stored_procedures"] = sp_list

    out_file = r"D:\aivrasol Pharmacy POS\migration\output\keypos-schema-report.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2)

    print(f"Successfully generated complete schema report: {out_file}")

if __name__ == "__main__":
    main()
