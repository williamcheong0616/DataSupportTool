"""
Database setup and session management.

Configures SQLAlchemy engine and session factory for database access.
Supports both SQLite (development) and PostgreSQL (production) via DATABASE_URL.

Usage:
    from backend.database import get_db, init_db
    
    # Initialize tables
    init_db()
    
    # Get database session in route handlers
    @app.get("/example")
    def example_route(db: Session = Depends(get_db)):
        records = db.query(Model).all()
        return records
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from config import DATABASE_URL

# Create database engine
# For SQLite: add check_same_thread=False to allow multi-threaded access
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

# Session factory for creating database sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    FastAPI dependency to get database session.
    
    Yields a database session and ensures it's properly closed after use.
    Use with Depends() in route parameters.
    
    Yields:
        Session: SQLAlchemy database session
        
    Example:
        @router.get("/items")
        def list_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Initialize database tables.
    
    Creates all tables defined in models.py if they don't exist.
    Should be called once on application startup.
    
    Note:
        This uses SQLAlchemy's create_all() which is safe to call multiple times
        (won't drop existing tables or data).
    """
    from backend.models import Base  # Import Base to register all models
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations():
    """Run lightweight schema migrations for new columns."""
    from sqlalchemy import text, inspect
    
    inspector = inspect(engine)
    migrations = [
        ("text_datasets", "created_by", "VARCHAR(255)"),
        ("asr_datasets", "created_by", "VARCHAR(255)"),
        ("datasets", "created_by", "VARCHAR(255)"),
    ]
    
    with engine.connect() as conn:
        for table, column, col_type in migrations:
            if table not in inspector.get_table_names():
                continue
            existing_cols = [c["name"] for c in inspector.get_columns(table)]
            if column not in existing_cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                conn.commit()

