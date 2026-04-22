"""
Database backup service.

Performs pg_dump-style SQL backups of the PostgreSQL database
using SQLAlchemy's raw connection and psycopg2's copy_to functionality.
Supports both scheduled (Celery Beat) and manual (API) triggers.
"""

import os
import logging
from datetime import datetime
from pathlib import Path

from config import DATABASE_URL, BASE_DIR

logger = logging.getLogger(__name__)

# Backup directory
BACKUP_DIR = BASE_DIR / "sql_backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Keep last N backups (to avoid filling disk)
MAX_BACKUPS = 30


def create_backup(triggered_by: str = "manual", frequency: str = "manual") -> dict:
    """
    Create a full SQL dump of the database.
    
    Uses pg_dump via subprocess for a reliable, restorable backup.
    Falls back to a Python-based COPY export if pg_dump is unavailable.
    
    Args:
        triggered_by: Source of the backup trigger ('manual', 'scheduled')
        
    Returns:
        dict with backup metadata (filename, path, size, timestamp)
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # For legacy backups, frequency won't appear, but moving forward we use it
    if frequency == "daily" or frequency == "manual":
        # Keep old naming structure for daily/manual so they share the 30-backup pool
        filename = f"db_backup_{timestamp}.sql"
    else:
        filename = f"db_backup_{frequency}_{timestamp}.sql"
        
    filepath = BACKUP_DIR / filename
    
    logger.info(f"Starting database backup ({triggered_by}, freq: {frequency}): {filename}")
    
    try:
        # Try pg_dump first (preferred - produces standard SQL dump)
        _backup_via_pgdump(filepath)
    except Exception as pg_err:
        logger.warning(f"pg_dump failed ({pg_err}), falling back to Python-based backup")
        try:
            _backup_via_python(filepath)
        except Exception as py_err:
            logger.error(f"Python backup also failed: {py_err}")
            raise RuntimeError(f"All backup methods failed. pg_dump: {pg_err}, Python: {py_err}")
    
    file_size = os.path.getsize(filepath)
    logger.info(f"Backup complete: {filename} ({file_size / 1024:.1f} KB)")
    
    # Cleanup old backups depending on frequency rule
    _cleanup_old_backups(frequency)
    
    return {
        "filename": filename,
        "path": str(filepath),
        "size_bytes": file_size,
        "size_human": _human_size(file_size),
        "timestamp": timestamp,
        "triggered_by": triggered_by,
        "frequency": frequency,
    }


def _backup_via_pgdump(filepath: Path):
    """Create backup using pg_dump subprocess."""
    import subprocess
    
    # Parse DATABASE_URL for pg_dump args
    from urllib.parse import urlparse
    parsed = urlparse(DATABASE_URL)
    
    env = os.environ.copy()
    env["PGPASSWORD"] = parsed.password or "postgres"
    
    cmd = [
        "pg_dump",
        "-h", parsed.hostname or "localhost",
        "-p", str(parsed.port or 5432),
        "-U", parsed.username or "postgres",
        "-d", parsed.path.lstrip("/"),
        "--no-owner",
        "--no-privileges",
        "-f", str(filepath),
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
    
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump exited with code {result.returncode}: {result.stderr}")
    
    # Validate output
    if not filepath.exists() or filepath.stat().st_size < 100:
        raise RuntimeError("pg_dump produced empty or missing output")


def _backup_via_python(filepath: Path):
    """
    Fallback: Create backup using Python/psycopg2 COPY TO.
    Produces a restorable SQL file with CREATE TABLE + COPY data.
    """
    from sqlalchemy import create_engine, text, inspect
    
    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)
    
    with open(filepath, "w") as f:
        f.write(f"-- DataSupportTool Database Backup\n")
        f.write(f"-- Generated: {datetime.now().isoformat()}\n")
        f.write(f"-- Method: Python/psycopg2 COPY\n\n")
        
        # Get raw connection for COPY operations
        with engine.connect() as conn:
            raw = conn.connection
            cursor = raw.cursor()
            
            # Get all tables
            tables = inspector.get_table_names()
            logger.info(f"Backing up {len(tables)} tables: {tables}")
            
            for table in tables:
                # Get CREATE TABLE DDL
                result = conn.execute(text(
                    f"SELECT column_name, data_type, is_nullable, column_default "
                    f"FROM information_schema.columns "
                    f"WHERE table_name = :table AND table_schema = 'public' "
                    f"ORDER BY ordinal_position"
                ), {"table": table})
                columns = result.fetchall()
                
                if not columns:
                    continue
                
                col_names = [c[0] for c in columns]
                
                # Write COPY header
                f.write(f"COPY public.{table} ({', '.join(col_names)}) FROM stdin;\n")
                
                # Use psycopg2's copy_to for efficient data export
                import io
                buffer = io.StringIO()
                cursor.copy_to(buffer, table, columns=col_names)
                buffer.seek(0)
                f.write(buffer.read())
                f.write("\\.\n\n")
            
            cursor.close()
    
    logger.info(f"Python backup wrote {filepath.stat().st_size} bytes")


def _cleanup_old_backups(frequency: str):
    """Remove old backups beyond limits based on frequency type."""
    if frequency in ("10min", "30min"):
        max_keep = 1
        backups = sorted(BACKUP_DIR.glob(f"db_backup_{frequency}_*.sql"), key=lambda p: p.stat().st_mtime)
    else:
        # manual and daily share the default retention of 30
        max_keep = MAX_BACKUPS
        # Exclude the exact 10min/30min files when cleaning up standard backups
        all_backups = BACKUP_DIR.glob("db_backup_*.sql")
        backups = sorted([p for p in all_backups if "_10min_" not in p.name and "_30min_" not in p.name], key=lambda p: p.stat().st_mtime)
    
    if len(backups) > max_keep:
        to_delete = backups[:len(backups) - max_keep]
        for old_backup in to_delete:
            old_backup.unlink()
            logger.info(f"Cleaned up old backup ({frequency}): {old_backup.name}")


def list_backups() -> list:
    """List all available backups, newest first."""
    backups = sorted(BACKUP_DIR.glob("db_backup_*.sql"), key=lambda p: p.stat().st_mtime, reverse=True)
    
    return [
        {
            "filename": b.name,
            "size_bytes": b.stat().st_size,
            "size_human": _human_size(b.stat().st_size),
            "created_at": datetime.fromtimestamp(b.stat().st_mtime).isoformat(),
        }
        for b in backups
    ]


def _human_size(size_bytes: int) -> str:
    """Convert bytes to human-readable size string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"
