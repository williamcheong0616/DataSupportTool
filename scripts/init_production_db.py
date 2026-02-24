#!/usr/bin/env python3
"""
Initialize production database with required schemas.

Runs Alembic migrations and optionally creates auxiliary databases
for MLflow, Argilla, and Prefect.
"""
import os
import sys
import time

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from config import DATABASE_URL


def wait_for_database(max_retries: int = 30, delay: int = 2):
    """Wait for database to be available."""
    print("⏳ Waiting for database connection...")
    
    engine = create_engine(DATABASE_URL)
    
    for attempt in range(max_retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("✅ Database connection established!")
            return engine
        except OperationalError:
            print(f"   Attempt {attempt + 1}/{max_retries}...")
            time.sleep(delay)
    
    raise RuntimeError("Failed to connect to database")


def create_auxiliary_database(engine, db_name: str, label: str):
    """Create an auxiliary database if it doesn't exist (PostgreSQL only)."""
    print(f"📊 Creating {label} database...")
    
    with engine.connect() as conn:
        conn.execute(text("COMMIT"))
        result = conn.execute(
            text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'")
        )
        if not result.fetchone():
            conn.execute(text(f"CREATE DATABASE {db_name}"))
            print(f"   ✅ {label} database created")
        else:
            print(f"   ℹ️  {label} database already exists")


def run_migrations():
    """Run Alembic migrations to create/update tables."""
    print("📋 Running Alembic migrations...")
    
    from alembic.config import Config
    from alembic import command
    
    alembic_cfg = Config(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "alembic.ini"
    ))
    command.upgrade(alembic_cfg, "head")
    print("   ✅ Migrations applied successfully")


def main():
    """Main initialization function."""
    print("=" * 50)
    print("🚀 Production Database Initialization")
    print("=" * 50)
    print()
    
    # Wait for and connect to database
    engine = wait_for_database()
    
    # Create auxiliary databases (PostgreSQL only)
    if "postgresql" in DATABASE_URL:
        for db_name, label in [("mlflow", "MLflow"), ("argilla", "Argilla"), ("prefect", "Prefect")]:
            try:
                create_auxiliary_database(engine, db_name, label)
            except Exception as e:
                print(f"   ⚠️  {label} DB creation skipped: {e}")
    
    # Run migrations
    run_migrations()
    
    print()
    print("=" * 50)
    print("✅ Database initialization complete!")
    print("=" * 50)


if __name__ == "__main__":
    main()
