"""
Application configuration.

Centralized configuration management for the DataSupportTool application.
Supports environment-based configuration through .env files.

Configuration sections:
- Base paths: Data directories for uploads, processing, and exports
- Database: SQLite for development, PostgreSQL for production
- Redis: Cache and Celery message broker
- API: FastAPI server settings
- External services: WhisperAPI, Model endpoints, MLflow, Argilla, Prefect
- Pipeline: Validation thresholds and iteration limits
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file if present
load_dotenv()

# ==================== BASE PATHS ====================
# Application root and data directories
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
PROCESSED_DIR = DATA_DIR / "processed"
EXPORTS_DIR = DATA_DIR / "exports"

# Create directories if they don't exist
for dir_path in [DATA_DIR, UPLOADS_DIR, PROCESSED_DIR, EXPORTS_DIR]:
    dir_path.mkdir(parents=True, exist_ok=True)

# ==================== DATABASE ====================
# PostgreSQL connection (provided by Docker Compose)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/data_pipeline")

# ==================== REDIS ====================
# Redis connection for Celery broker and caching
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
# Separate Redis DB for Celery result backend (avoids broker/result collisions)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

# ==================== API SETTINGS ====================
# FastAPI server host and port configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")  # 0.0.0.0 = all interfaces
API_PORT = int(os.getenv("API_PORT", 8000))

# ==================== EXTERNAL SERVICES ====================
# Whisper API URL for audio transcription
WHISPER_API_URL = os.getenv("WHISPER_API_URL", "http://localhost:9000")

# Model endpoint for LLM inference (Ollama, vLLM, etc.)
MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "http://localhost:8080/v1/completions")

# ==================== PROVIDER API (external integrations) ====================
# Shared secret required in the `X-API-Key` header for /api/provider/* routes.
# These routes let external systems (e.g. a training pipeline) pull finished
# datasets. Left unset by default so the endpoints stay closed until someone
# deliberately opts in.
PROVIDER_API_KEY = os.getenv("PROVIDER_API_KEY")


