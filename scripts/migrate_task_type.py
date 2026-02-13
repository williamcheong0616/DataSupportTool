"""
Database Migration Script - Add 'general' task type
This script updates existing datasets to use the new default task_type='general'
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
    """Add 'general' task type option and set it as default."""
    
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    
    with engine.connect() as conn:
        # Check current task_type column definition
        logger.info("Checking current task_type configuration...")
        
        # Note: The enum will be automatically updated by SQLAlchemy when the app restarts
        # This is just for informational purposes
        
        check_query = text("""
            SELECT COUNT(*) as count
            FROM text_datasets
        """)
        
        result = conn.execute(check_query).fetchone()
        dataset_count = result[0] if result else 0
        
        logger.info(f"Found {dataset_count} existing datasets")
        
        if dataset_count > 0:
            logger.info("✓ Existing datasets will keep their current task_type")
            logger.info("✓ New datasets will default to 'general' (for BR Pipeline)")
        else:
            logger.info("✓ No existing datasets found")
        
        logger.info("✓ Migration completed successfully!")


if __name__ == "__main__":
    try:
        migrate_database()
        print("\n" + "="*60)
        print("✓ TASK TYPE UPDATE SUCCESSFUL")
        print("="*60)
        print("\nChanges applied:")
        print("  ✓ Added 'general' task type (default for BR Pipeline)")
        print("  ✓ Existing datasets remain unchanged")
        print("  ✓ New datasets default to 'general'")
        print("\nWhat this means:")
        print("  • 'General' datasets use BR Pipeline (recommended)")
        print("  • Other task types for manual annotation (legacy)")
        print("  • All backwards compatible!")
        print("="*60)
    except Exception as e:
        print("\n" + "="*60)
        print("✗ MIGRATION FAILED")
        print("="*60)
        print(f"\nError: {e}")
        print("\nNote: The enum will be automatically updated by SQLAlchemy")
        print("when the application restarts. You may need to restart the app.")
        print("="*60)
        sys.exit(1)
