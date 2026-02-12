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
# SQLite for development (default), PostgreSQL for production
# Example PostgreSQL: postgresql://user:password@localhost/dbname
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data_pipeline.db")

# ==================== REDIS ====================
# Redis connection string for Celery and caching
# Default: local Redis instance on port 6379
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# ==================== API SETTINGS ====================
# FastAPI server host and port configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")  # 0.0.0.0 = all interfaces
API_PORT = int(os.getenv("API_PORT", 8000))

# ==================== EXTERNAL SERVICES ====================
# Whisper API URL for audio transcription
WHISPER_API_URL = os.getenv("WHISPER_API_URL", "http://localhost:9000")

# Model endpoint for LLM inference (Ollama, vLLM, etc.)
MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "http://localhost:8080/v1/completions")

# ==================== PIPELINE SETTINGS ====================
# BR Pipeline validation and iteration configuration
VALIDATION_THRESHOLD = 0.8  # Minimum quality score (0-1) to pass validation
MAX_ITERATIONS = 5  # Maximum retry iterations before requiring manual review

# ==================== MLFLOW SETTINGS ====================
# MLflow tracking server for experiment logging and model versioning
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
MLFLOW_EXPERIMENT_NAME = os.getenv("MLFLOW_EXPERIMENT_NAME", "data_pipeline_validation")

# ==================== ARGILLA SETTINGS ====================
# Argilla annotation platform configuration (optional)
ARGILLA_API_URL = os.getenv("ARGILLA_API_URL", "http://localhost:6900")
ARGILLA_API_KEY = os.getenv("ARGILLA_API_KEY", "admin.apikey")
ARGILLA_WORKSPACE = os.getenv("ARGILLA_WORKSPACE", "data_pipeline")

# ==================== PREFECT SETTINGS ====================
# Prefect workflow orchestration (optional)
PREFECT_API_URL = os.getenv("PREFECT_API_URL", "http://localhost:4200/api")

