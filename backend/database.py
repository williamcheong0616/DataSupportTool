"""
Database setup and session management.

Configures SQLAlchemy engine and session factory for PostgreSQL.
Uses connection pooling for production-grade performance.

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

# Create database engine with connection pooling for PostgreSQL
engine = create_engine(
    DATABASE_URL,
    pool_size=10,          # Maintain 10 persistent connections
    max_overflow=20,       # Allow up to 20 additional connections under load
    pool_pre_ping=True,    # Verify connections before use (handles stale connections)
    pool_recycle=1800,     # Recycle connections after 30 minutes
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
        (won't drop existing tables or data). For production, prefer Alembic migrations.
    """
    from backend.models import Base  # Import Base to register all models
    Base.metadata.create_all(bind=engine)
