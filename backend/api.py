"""
FastAPI application for DataSupportTool.

Main application entry point that assembles all route modules:
- Health check and statistics
- Text annotation workflows
- ASR (Automatic Speech Recognition) annotation workflows
- BR (Bahasa Rojak) pipeline (if available)

Architecture:
- Routes are modularized in backend/routes/ directory
- Database models in backend/models.py
- Pydantic schemas in backend/schemas.py
- Background tasks via Celery in backend/tasks.py
- Utility functions in backend/utils/ directory
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging

from backend.database import init_db
from backend.utils.logger import setup_logging
from backend.middleware.logging_middleware import RequestLoggingMiddleware

# ==================== LOGGING SETUP ====================
# Configure application logging before anything else
logger = setup_logging(log_level="INFO", log_file="logs/api.log")
logger.info("=" * 80)
logger.info("DataSupportTool API Starting Up...")
logger.info("=" * 80)

# Create FastAPI application
app = FastAPI(
    title="DataSupportTool API",
    description="API for Text and ASR Annotation workflows with BR Pipeline support",
    version="3.0.0",
    docs_url="/api/docs",  # Swagger UI at /api/docs
    redoc_url="/api/redoc"  # ReDoc at /api/redoc
)

# ==================== MIDDLEWARE ====================
# Request logging middleware (must be before CORS)
app.add_middleware(RequestLoggingMiddleware)

# CORS middleware - Allow all origins for development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== DATABASE INITIALIZATION ====================
@app.on_event("startup")
def startup():
    """Initialize database and log startup info."""
    logger.info("Initializing database...")
    init_db()
    logger.info("✓ Database initialized successfully")
    logger.info("✓ API ready to accept requests")


# ==================== ROUTE REGISTRATION ====================
# Import and register all route modules

# Health check routes
from backend.routes.health import router as health_router
app.include_router(health_router)
logger.info("✓ Health check routes registered")

# Text annotation routes
from backend.routes.text import router as text_router
app.include_router(text_router)
logger.info("✓ Text annotation routes registered")

# ASR annotation routes
from backend.routes.asr import router as asr_router
app.include_router(asr_router)
logger.info("✓ ASR annotation routes registered")

# BR Pipeline routes (optional - may not be installed)
try:
    from backend.br_pipeline_routes import router as br_pipeline_router
    app.include_router(br_pipeline_router)
    logger.info("✓ BR Pipeline routes registered")
except ImportError:
    logger.warning("⚠ BR Pipeline routes not available (module not installed)")


# ==================== ROOT ENDPOINT ====================
@app.get("/")
def root():
    """
    Root endpoint with API information.
    
    Returns:
        API metadata and available endpoints
    """
    return {
        "name": "DataSupportTool API",
        "version": "3.0.0",
        "description": "Annotation tool for text and ASR datasets",
        "endpoints": {
            "docs": "/api/docs",
            "health": "/api/health",
            "stats": "/api/stats",
            "text": "/api/text",
            "asr": "/api/asr",
            "br_pipeline": "/api/br-pipeline"
        }
    }


if __name__ == "__main__":
    # This block is only executed when running the file directly
    # For production, use: uvicorn backend.api:app --host 0.0.0.0 --port 8000
    import uvicorn
    from config import API_HOST, API_PORT
    
    uvicorn.run(
        "backend.api:app",
        host=API_HOST,
        port=API_PORT,
        reload=True
    )
