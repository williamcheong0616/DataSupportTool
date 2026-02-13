"""
Database Migration Script for BR Pipeline Improvements
This script adds the new skip_restructure column to br_record_stages table.

Run this script if SQLAlchemy doesn't automatically add the column.
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from backend.database import SQLALCHEMY_DATABASE_URL
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate_database():
    """Add skip_restructure column to br_record_stages table."""
    
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    
    with engine.connect() as conn:
        # Check if column already exists
        check_query = text("""
            SELECT COUNT(*) 
            FROM information_schema.columns 
            WHERE table_name = 'br_record_stages' 
            AND column_name = 'skip_restructure'
        """)
        
        result = conn.execute(check_query).scalar()
        
        if result > 0:
            logger.info("✓ Column 'skip_restructure' already exists. No migration needed.")
            return
        
        # Add the new column
        logger.info("Adding 'skip_restructure' column to br_record_stages table...")
        
        alter_query = text("""
            ALTER TABLE br_record_stages 
            ADD COLUMN skip_restructure BOOLEAN DEFAULT FALSE
        """)
        
        conn.execute(alter_query)
        conn.commit()
        
        logger.info("✓ Migration completed successfully!")
        logger.info("✓ Column 'skip_restructure' added to br_record_stages table")


if __name__ == "__main__":
    try:
        migrate_database()
        print("\n" + "="*60)
        print("✓ DATABASE MIGRATION SUCCESSFUL")
        print("="*60)
        print("\nThe BR Pipeline improvements are now ready to use!")
        print("\nNew features available:")
        print("  1. Individual stage execution")
        print("  2. Automatic language detection")
        print("  3. User choice for text restructuring")
        print("  4. Bahasa Rojak question generation")
        print("\nSee BR_PIPELINE_IMPROVEMENTS.md for usage details.")
        print("="*60)
    except Exception as e:
        print("\n" + "="*60)
        print("✗ MIGRATION FAILED")
        print("="*60)
        print(f"\nError: {e}")
        print("\nTroubleshooting:")
        print("  1. Make sure the database is running")
        print("  2. Check database connection in config.py")
        print("  3. Verify you have ALTER TABLE permissions")
        print("  4. Try restarting the application (SQLAlchemy may auto-migrate)")
        print("="*60)
        sys.exit(1)
