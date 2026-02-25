#!/usr/bin/env python3
"""
Migrate data from SQLite to PostgreSQL.

Reads all rows from the SQLite database and inserts them into the
PostgreSQL database. Assumes PostgreSQL tables already exist (via Alembic).

Usage:
    # 1. Ensure PostgreSQL is running (docker-compose up -d)
    # 2. Run Alembic migrations first (alembic upgrade head)
    # 3. Run this script:
    python scripts/migrate_sqlite_to_postgres.py
    
    # Optional: specify a custom SQLite path:
    SQLITE_PATH=./data_pipeline.db python scripts/migrate_sqlite_to_postgres.py
"""
import os
import sys
import sqlite3
import json
import re

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker
from config import DATABASE_URL

# SQLite source path
SQLITE_PATH = os.getenv("SQLITE_PATH", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data_pipeline.db"
))

# Tables to migrate, in dependency order (parents before children)
# Legacy SQLite tables are mapped to their PostgreSQL equivalents
TABLES_IN_ORDER = [
    # Text Annotation
    "text_datasets",
    "text_records",
    # ASR Annotation
    "asr_datasets",
    "audio_files",
    # Pipeline — migrate legacy "datasets" into "pipeline_datasets" FIRST
    ("datasets", "pipeline_datasets"),       # legacy → renamed
    ("data_records", "pipeline_records"),     # legacy → renamed
    "pipeline_datasets",
    "pipeline_records",
    "pipeline_runs",
    "model_responses",
    "validation_records",
    # BR Pipeline
    "br_pipeline_runs",
    "br_record_stages",
    "br_model_configs",
]

# Column renames: {pg_table: {sqlite_col: pg_col}}
# Handles cases where SQLite uses different column names than PostgreSQL
COLUMN_RENAMES = {
    "model_responses": {"data_record_id": "record_id"},
    "validation_records": {"data_record_id": "record_id"},
}


def get_sqlite_tables(sqlite_conn) -> list[str]:
    """Get list of tables in SQLite database."""
    cursor = sqlite_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    return [row[0] for row in cursor.fetchall()]


def get_sqlite_columns(sqlite_conn, table: str) -> list[str]:
    """Get column names for a SQLite table."""
    cursor = sqlite_conn.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cursor.fetchall()]


def get_pg_column_info(pg_engine, table: str) -> tuple[dict[str, str], set[str]]:
    """Get column types and NOT NULL columns for a PostgreSQL table.
    
    Returns:
        Tuple of (column_name -> type_string, set of NOT NULL column names)
    """
    inspector = inspect(pg_engine)
    try:
        columns = inspector.get_columns(table)
        types = {col["name"]: str(col["type"]) for col in columns}
        not_null = {col["name"] for col in columns if not col.get("nullable", True) and not col.get("autoincrement", False)}
        # Exclude 'id' from not_null since it's auto-generated
        not_null.discard("id")
        return types, not_null
    except Exception:
        return {}, set()


def sanitize_json(value):
    """Fix JSON strings containing NaN/Infinity which PostgreSQL rejects."""
    if value is None or not isinstance(value, str):
        return value
    # Replace NaN, Infinity, -Infinity with null (case-sensitive, outside quotes)
    sanitized = re.sub(r'\bNaN\b', 'null', value)
    sanitized = re.sub(r'\b-?Infinity\b', 'null', sanitized)
    # Validate it's parseable JSON, otherwise return null
    try:
        json.loads(sanitized)
        return sanitized
    except (json.JSONDecodeError, ValueError):
        return None


def coerce_row(row_dict: dict, bool_columns: set, json_columns: set) -> dict:
    """Convert SQLite types to PostgreSQL-compatible types."""
    for col in bool_columns:
        if col in row_dict and row_dict[col] is not None:
            row_dict[col] = bool(row_dict[col])
    for col in json_columns:
        if col in row_dict and row_dict[col] is not None:
            row_dict[col] = sanitize_json(row_dict[col])
    return row_dict


def migrate_table(sqlite_conn, pg_engine, sqlite_table: str, pg_table: str, pg_tables: list[str]):
    """Migrate a single table from SQLite to PostgreSQL.
    
    Args:
        sqlite_table: Source table name in SQLite
        pg_table: Target table name in PostgreSQL (may differ for legacy tables)
    """
    
    # Skip if target table doesn't exist in PostgreSQL
    if pg_table not in pg_tables:
        print(f"  ⏭  {sqlite_table} → {pg_table}: skipped (not in PostgreSQL)")
        return 0
    
    # Skip if source table doesn't exist in SQLite
    sqlite_tables = get_sqlite_tables(sqlite_conn)
    if sqlite_table not in sqlite_tables:
        return 0
    
    # Get columns that exist in BOTH databases (applying renames)
    sqlite_cols = get_sqlite_columns(sqlite_conn, sqlite_table)
    pg_col_types, pg_not_null = get_pg_column_info(pg_engine, pg_table)
    pg_cols = list(pg_col_types.keys())
    
    # Apply column renames: sqlite_col_name → pg_col_name
    renames = COLUMN_RENAMES.get(pg_table, {})
    # Build mapping: sqlite_col → pg_col (renamed or same)
    col_mapping = {}  # {sqlite_col: pg_col}
    for sc in sqlite_cols:
        pg_name = renames.get(sc, sc)  # rename if mapped, else keep same
        if pg_name in pg_cols:
            col_mapping[sc] = pg_name
    
    if not col_mapping:
        print(f"  ⏭  {sqlite_table}: skipped (no matching columns)")
        return 0
    
    sqlite_select_cols = list(col_mapping.keys())   # columns to SELECT from SQLite
    pg_insert_cols = list(col_mapping.values())      # columns to INSERT into PG
    
    # Check for required PG columns missing from our mapping
    missing_required = pg_not_null - set(pg_insert_cols)
    if missing_required:
        label = f"{sqlite_table} → {pg_table}" if sqlite_table != pg_table else sqlite_table
        print(f"  ⚠️  {label}: skipped (missing required columns: {missing_required})")
        return 0
    
    # Identify columns that need type conversion (using PG column names)
    bool_columns = {c for c in pg_insert_cols if "BOOLEAN" in pg_col_types.get(c, "").upper()}
    json_columns = {c for c in pg_insert_cols if "JSON" in pg_col_types.get(c, "").upper()}
    
    # Read all rows from SQLite
    cols_str = ", ".join(sqlite_select_cols)
    cursor = sqlite_conn.execute(f"SELECT {cols_str} FROM {sqlite_table}")
    rows = cursor.fetchall()
    
    if not rows:
        label = f"{sqlite_table} → {pg_table}" if sqlite_table != pg_table else sqlite_table
        print(f"  ℹ️  {label}: empty (0 rows)")
        return 0
    
    # Insert into PostgreSQL with FK checks temporarily disabled
    pg_cols_str = ", ".join(pg_insert_cols)
    placeholders = ", ".join([f":{c}" for c in pg_insert_cols])
    insert_sql = f"INSERT INTO {pg_table} ({pg_cols_str}) VALUES ({placeholders})"
    
    label = f"{sqlite_table} → {pg_table}" if sqlite_table != pg_table else pg_table
    
    with pg_engine.begin() as conn:
        # Disable FK triggers for this transaction
        conn.execute(text("SET session_replication_role = 'replica'"))
        
        # Check if table already has data
        existing = conn.execute(text(f"SELECT COUNT(*) FROM {pg_table}")).scalar()
        if existing > 0:
            print(f"  ⚠️  {label}: already has {existing} rows, skipping")
            conn.execute(text("SET session_replication_role = 'origin'"))
            return 0
        
        # Build batch with type coercion (bool + JSON sanitization)
        # Map sqlite column values to PG column names
        batch = [coerce_row(dict(zip(pg_insert_cols, row)), bool_columns, json_columns) for row in rows]
        conn.execute(text(insert_sql), batch)
        
        # Reset the auto-increment sequence to max(id) + 1
        if "id" in pg_insert_cols:
            max_id = conn.execute(text(f"SELECT COALESCE(MAX(id), 0) FROM {pg_table}")).scalar()
            seq_name = f"{pg_table}_id_seq"
            try:
                conn.execute(text(f"SELECT setval('{seq_name}', {max_id}, true)"))
            except Exception:
                pass
        
        # Re-enable FK triggers
        conn.execute(text("SET session_replication_role = 'origin'"))
    
    print(f"  ✅ {label}: migrated {len(rows)} rows")
    return len(rows)


def main():
    force = "--force" in sys.argv
    
    print("=" * 60)
    print("🔄 SQLite → PostgreSQL Data Migration")
    print("=" * 60)
    print(f"  Source:  {SQLITE_PATH}")
    print(f"  Target:  {DATABASE_URL}")
    print()
    
    # Validate SQLite file exists
    if not os.path.exists(SQLITE_PATH):
        print(f"❌ SQLite file not found: {SQLITE_PATH}")
        sys.exit(1)
    
    # Connect to SQLite
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_tables = get_sqlite_tables(sqlite_conn)
    print(f"📊 SQLite tables found: {len(sqlite_tables)}")
    for t in sqlite_tables:
        count = sqlite_conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"    {t}: {count} rows")
    print()
    
    # Connect to PostgreSQL
    pg_engine = create_engine(DATABASE_URL)
    pg_inspector = inspect(pg_engine)
    pg_tables = pg_inspector.get_table_names()
    print(f"📊 PostgreSQL tables found: {len(pg_tables)}")
    print()
    
    # Migrate each table
    print("🔄 Migrating data...")
    total_rows = 0
    handled_sqlite_tables = set()
    
    for entry in TABLES_IN_ORDER:
        if isinstance(entry, tuple):
            sqlite_table, pg_table = entry
        else:
            sqlite_table = pg_table = entry
        
        handled_sqlite_tables.add(sqlite_table)
        if sqlite_table in sqlite_tables:
            try:
                total_rows += migrate_table(sqlite_conn, pg_engine, sqlite_table, pg_table, pg_tables)
            except Exception as e:
                print(f"  ❌ {sqlite_table}: FAILED ({e})")
    
    # Also migrate any SQLite tables not in our predefined list
    extra_tables = [t for t in sqlite_tables if t not in handled_sqlite_tables]
    if extra_tables:
        print()
        print(f"📋 Extra SQLite tables not in migration list: {extra_tables}")
        for table in extra_tables:
            if table in pg_tables:
                try:
                    total_rows += migrate_table(sqlite_conn, pg_engine, table, table, pg_tables)
                except Exception as e:
                    print(f"  ❌ {table}: FAILED ({e})")
            else:
                print(f"  ⏭  {table}: skipped (no matching PostgreSQL table)")
    
    sqlite_conn.close()
    
    print()
    print("=" * 60)
    print(f"✅ Migration complete! {total_rows} total rows migrated.")
    print("=" * 60)


if __name__ == "__main__":
    main()

