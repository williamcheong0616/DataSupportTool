"""
Celery application configuration for distributed task processing.
"""
import os
from celery import Celery

# Redis URL - use environment variable or default to localhost
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Create Celery app
celery_app = Celery(
    "data_pipeline",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["backend.tasks"]
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    
    # Task execution settings
    task_acks_late=True,  # Acknowledge task after completion
    task_reject_on_worker_lost=True,  # Requeue if worker dies
    worker_prefetch_multiplier=1,  # One task at a time per worker
    
    # Result settings
    result_expires=3600,  # Results expire after 1 hour
    
    # Task routing
    task_routes={
        "backend.tasks.transcribe_audio_task": {"queue": "transcription"},
        "backend.tasks.batch_transcribe_task": {"queue": "transcription"},
    },
    
    # Task rate limiting (to avoid overwhelming Whisper API)
    task_annotations={
        "backend.tasks.transcribe_audio_task": {
            "rate_limit": "10/m"  # Max 10 transcriptions per minute
        }
    },
    
    # Retry settings
    task_default_retry_delay=30,  # Wait 30 seconds before retry
    task_max_retries=3,
)

# Optional: Beat schedule for periodic tasks
celery_app.conf.beat_schedule = {
    "check-stale-transcriptions": {
        "task": "backend.tasks.check_stale_transcriptions",
        "schedule": 300.0,  # Every 5 minutes
    },
}
