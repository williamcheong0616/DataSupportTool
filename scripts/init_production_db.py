#!/usr/bin/env python3
"""Initialize production database with required schemas."""
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


def create_mlflow_database(engine):
    """Create MLflow database if not exists."""
    print("📊 Creating MLflow database...")
    
    with engine.connect() as conn:
        conn.execute(text("COMMIT"))
        result = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname='mlflow'")
        )
        if not result.fetchone():
            conn.execute(text("CREATE DATABASE mlflow"))
            print("   ✅ MLflow database created")
        else:
            print("   ℹ️ MLflow database already exists")


def create_argilla_database(engine):
    """Create Argilla database if not exists."""
    print("🏷️ Creating Argilla database...")
    
    with engine.connect() as conn:
        conn.execute(text("COMMIT"))
        result = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname='argilla'")
        )
        if not result.fetchone():
            conn.execute(text("CREATE DATABASE argilla"))
            print("   ✅ Argilla database created")
        else:
            print("   ℹ️ Argilla database already exists")


def create_prefect_database(engine):
    """Create Prefect database if not exists."""
    print("🔄 Creating Prefect database...")
    
    with engine.connect() as conn:
        conn.execute(text("COMMIT"))
        result = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname='prefect'")
        )
        if not result.fetchone():
            conn.execute(text("CREATE DATABASE prefect"))
            print("   ✅ Prefect database created")
        else:
            print("   ℹ️ Prefect database already exists")


def init_application_tables():
    """Initialize application tables."""
    print("📋 Initializing application tables...")
    
    from backend.database import init_db
    init_db()
    print("   ✅ Application tables created")


def main():
    """Main initialization function."""
    print("=" * 50)
    print("🚀 Production Database Initialization")
    print("=" * 50)
    print()
    
    # Wait for and connect to database
    engine = wait_for_database()
    
    # Create auxiliary databases (for PostgreSQL)
    if "postgresql" in DATABASE_URL:
        try:
            create_mlflow_database(engine)
        except Exception as e:
            print(f"   ⚠️ MLflow DB creation skipped: {e}")
        
        try:
            create_argilla_database(engine)
        except Exception as e:
            print(f"   ⚠️ Argilla DB creation skipped: {e}")
        
        try:
            create_prefect_database(engine)
        except Exception as e:
            print(f"   ⚠️ Prefect DB creation skipped: {e}")
    
    # Initialize application tables
    init_application_tables()
    
    print()
    print("=" * 50)
    print("✅ Database initialization complete!")
    print("=" * 50)


if __name__ == "__main__":
    main()
