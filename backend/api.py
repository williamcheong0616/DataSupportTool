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

import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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


# ==================== LIFESPAN ====================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    # Ensure database tables exist (migrations are run separately)
    logger.info("Initializing database...")
    init_db()
    logger.info("✓ Database initialized")
    logger.info("✓ API ready to accept requests")
    yield
    logger.info("DataSupportTool API shutting down...")


# Create FastAPI application
app = FastAPI(
    title="DataSupportTool API",
    description="API for Text and ASR Annotation workflows with BR Pipeline support",
    version="3.0.0",
    docs_url="/api/docs",  # Swagger UI at /api/docs
    redoc_url="/api/redoc",  # ReDoc at /api/redoc
    lifespan=lifespan,
)

# ==================== MIDDLEWARE ====================
# Request logging middleware (must be before CORS)
app.add_middleware(RequestLoggingMiddleware)

# CORS middleware - configurable origins (restrict in production)
# Set CORS_ORIGINS env var to comma-separated origins, e.g. "http://localhost:5173,https://myapp.com"
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
if CORS_ORIGINS == "*":
    logger.warning(
        "CORS is configured to allow ALL origins ('*'). "
        "Set the CORS_ORIGINS environment variable to restrict access in production."
    )
cors_origins = ["*"] if CORS_ORIGINS == "*" else [o.strip() for o in CORS_ORIGINS.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

# Error Analysis routes
from backend.routes.error_analysis import router as error_analysis_router
app.include_router(error_analysis_router)
logger.info("✓ Error Analysis routes registered")

# BR Pipeline routes (optional - may not be installed)
try:
    from backend.br_pipeline_routes import router as br_pipeline_router
    app.include_router(br_pipeline_router)
    logger.info("✓ BR Pipeline routes registered")
except ImportError:
    logger.warning("⚠ BR Pipeline routes not available (module not installed)")

# Settings routes
from backend.routes.settings import router as settings_router
app.include_router(settings_router)
logger.info("✓ Settings routes registered")

# Provider API routes (external integrations, e.g. training pipeline)
from backend.routes.provider import router as provider_router
app.include_router(provider_router)
if os.getenv("PROVIDER_API_KEY"):
    logger.info("✓ Provider API routes registered (external access ENABLED)")
else:
    logger.info("✓ Provider API routes registered (external access disabled — set PROVIDER_API_KEY to enable)")


# ==================== STATIC FRONTEND (SPA) ====================
_DIST_DIR = Path(__file__).parent.parent / "frontend-react" / "dist"

if _DIST_DIR.is_dir():
    # Serve actual build artifacts (JS, CSS, images) from /assets directly.
    # This mount is checked after all /api/* routes so it never conflicts.
    _assets_dir = _DIST_DIR / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    # Catch-all: serve the real file if it exists, otherwise hand index.html
    # to React Router so it can handle client-side navigation on refresh.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serveSpa(full_path: str):
        candidate = _DIST_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_DIST_DIR / "index.html"))

    logger.info(f"✓ Frontend SPA mounted from {_DIST_DIR}")
else:
    logger.warning(
        f"⚠ Frontend dist not found at {_DIST_DIR}. "
        "Run 'npm run build' in frontend-react/ to enable SPA serving."
    )


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
