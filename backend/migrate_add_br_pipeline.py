"""
Database migration: Add BR Pipeline tables
Creates tables for automated Bahasa Rojak detection and question generation pipeline
"""
import sqlite3
import os

DB_PATH = "data_pipeline.db"

def migrate_add_br_pipeline_tables():
    """Add BR pipeline tables to the database."""
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        print("Adding BR Pipeline tables...")
        
        # 1. BR Pipeline Runs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS br_pipeline_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id INTEGER NOT NULL,
                total_records INTEGER DEFAULT 0,
                processed_records INTEGER DEFAULT 0,
                pending_validation INTEGER DEFAULT 0,
                current_stage VARCHAR(50),
                status VARCHAR(50) DEFAULT 'pending',
                error_message TEXT,
                started_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME,
                FOREIGN KEY(dataset_id) REFERENCES text_datasets(id)
            )
        """)
        print("✓ Created br_pipeline_runs table")
        
        # 2. BR Record Stages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS br_record_stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_run_id INTEGER NOT NULL,
                text_record_id INTEGER NOT NULL,
                current_stage VARCHAR(50),
                
                -- Stage 1: BR Detection
                is_bahasa_rojak BOOLEAN,
                br_confidence FLOAT,
                br_detected_at DATETIME,
                
                -- Stage 2: Text Restructuring
                restructured_text TEXT,
                restructure_metadata TEXT,
                restructured_at DATETIME,
                
                -- Stage 3: Question Generation
                generated_questions TEXT,
                questions_generated_at DATETIME,
                
                -- Stage 4: Human Validation
                selected_question_index INTEGER,
                selected_question TEXT,
                validated_by VARCHAR(255),
                validated_at DATETIME,
                
                -- Stage 5: Model Responses
                model_responses TEXT,
                responses_generated_at DATETIME,
                
                -- Overall status
                completed BOOLEAN DEFAULT 0,
                error_message TEXT,
                created_at DATETIME,
                updated_at DATETIME,
                
                FOREIGN KEY(pipeline_run_id) REFERENCES br_pipeline_runs(id),
                FOREIGN KEY(text_record_id) REFERENCES text_records(id)
            )
        """)
        print("✓ Created br_record_stages table")
        
        # 3. Model Configs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS br_model_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(255) NOT NULL UNIQUE,
                model_type VARCHAR(100) NOT NULL,
                model_id VARCHAR(255) NOT NULL,
                api_endpoint VARCHAR(512),
                api_key_env_var VARCHAR(100),
                parameters TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME,
                updated_at DATETIME
            )
        """)
        print("✓ Created br_model_configs table")
        
        # Add indexes for performance
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_br_record_stages_pipeline_run 
            ON br_record_stages(pipeline_run_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_br_record_stages_text_record 
            ON br_record_stages(text_record_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_br_record_stages_current_stage 
            ON br_record_stages(current_stage)
        """)
        print("✓ Created indexes")
        
        conn.commit()
        print("\n✓ Successfully added BR Pipeline tables")
        print("\nNext steps:")
        print("1. Configure base models using POST /api/br-pipeline/models")
        print("2. Start a pipeline using POST /api/br-pipeline/start")
        print("3. Monitor progress with GET /api/br-pipeline/status/{id}")
        
    except Exception as e:
        conn.rollback()
        print(f"\n✗ Migration failed: {e}")
        raise
    finally:
        conn.close()


def migrate_add_detected_language():
    """Add detected_language column to br_record_stages table."""
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        print("Adding detected_language column to br_record_stages...")
        
        # Check if column already exists
        cursor.execute("PRAGMA table_info(br_record_stages)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'detected_language' in columns:
            print("✓ detected_language column already exists")
        else:
            cursor.execute("""
                ALTER TABLE br_record_stages 
                ADD COLUMN detected_language VARCHAR(100)
            """)
            print("✓ Added detected_language column")
        
        conn.commit()
        print("\n✓ Migration complete")
        
    except Exception as e:
        conn.rollback()
        print(f"\n✗ Migration failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    print("=" * 60)
    print("BR Pipeline Database Migration")
    print("=" * 60)
    migrate_add_br_pipeline_tables()
    print("\n" + "=" * 60)
    print("Adding detected_language column")
    print("=" * 60)
    migrate_add_detected_language()
