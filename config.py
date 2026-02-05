"""Application configuration."""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Base paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
PROCESSED_DIR = DATA_DIR / "processed"
EXPORTS_DIR = DATA_DIR / "exports"

# Create directories
for dir_path in [DATA_DIR, UPLOADS_DIR, PROCESSED_DIR, EXPORTS_DIR]:
    dir_path.mkdir(parents=True, exist_ok=True)

# Database (PostgreSQL for production, SQLite for dev)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data_pipeline.db")

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# API
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", 8000))

# Model endpoint
MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "http://localhost:8080/v1/completions")

# Pipeline settings
VALIDATION_THRESHOLD = 0.8  # Minimum quality score to pass validation
MAX_ITERATIONS = 5  # Maximum retry iterations before manual review

# MLflow settings
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
MLFLOW_EXPERIMENT_NAME = os.getenv("MLFLOW_EXPERIMENT_NAME", "data_pipeline_validation")

# Argilla settings
ARGILLA_API_URL = os.getenv("ARGILLA_API_URL", "http://localhost:6900")
ARGILLA_API_KEY = os.getenv("ARGILLA_API_KEY", "admin.apikey")
ARGILLA_WORKSPACE = os.getenv("ARGILLA_WORKSPACE", "data_pipeline")

# Prefect settings
PREFECT_API_URL = os.getenv("PREFECT_API_URL", "http://localhost:4200/api")
