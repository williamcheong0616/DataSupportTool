"""
Celery application configuration for distributed task processing.

Uses Redis as both broker and result backend (separate DBs).
Includes task routing, rate limiting, and periodic tasks.
"""
from celery import Celery
from config import REDIS_URL, CELERY_RESULT_BACKEND

# Create Celery app with separate broker and result backend
celery_app = Celery(
    "data_pipeline",
    broker=REDIS_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["backend.tasks", "backend.br_pipeline_tasks"]
)

# Celery configuration
celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    
    # Task execution
    task_acks_late=True,              # Acknowledge task after completion
    task_reject_on_worker_lost=True,  # Requeue if worker dies
    worker_prefetch_multiplier=1,     # One task at a time per worker
    
    # Connection reliability
    broker_connection_retry_on_startup=True,  # Retry broker connection at start
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    
    # Result settings
    result_expires=3600,  # Results expire after 1 hour
    
    # Task routing - separate queues for different workloads
    task_routes={
        "backend.tasks.transcribe_audio_task": {"queue": "transcription"},
        "backend.tasks.batch_transcribe_task": {"queue": "transcription"},
        "backend.tasks.segment_audio_task": {"queue": "transcription"},
        "backend.tasks.batch_segment_task": {"queue": "transcription"},
        "backend.br_pipeline_tasks.generate_questions_task": {"queue": "br_pipeline"},
        "backend.br_pipeline_tasks.generate_responses_task": {"queue": "br_pipeline"},
        "backend.br_pipeline_tasks.batch_generate_responses_task": {"queue": "br_pipeline"},
    },
    
    # Task rate limiting (to avoid overwhelming Whisper API)
    task_annotations={
        "backend.tasks.transcribe_audio_task": {
            "rate_limit": "10/m"  # Max 10 transcriptions per minute
        }
    },
    
    # Retry defaults
    task_default_retry_delay=30,  # Wait 30 seconds before retry
    task_max_retries=3,
)

# Periodic tasks (Celery Beat schedule)
celery_app.conf.beat_schedule = {
    "check-stale-transcriptions": {
        "task": "backend.tasks.check_stale_transcriptions",
        "schedule": 300.0,  # Every 5 minutes
    },
}


# Health check task — lightweight ping for connectivity tests
@celery_app.task(name="backend.celery_app.ping")
def ping():
    """Simple health check task. Returns 'pong' if Celery is working."""
    return "pong"
