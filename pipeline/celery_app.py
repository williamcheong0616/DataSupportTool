"""Celery application configuration for distributed task processing."""
from celery import Celery

from config import REDIS_URL

# Create Celery app
celery_app = Celery(
    "data_pipeline",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["pipeline.tasks"]
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
    task_acks_late=True,  # Acknowledge after task completes
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # One task at a time per worker
    
    # Result backend settings
    result_expires=3600,  # Results expire after 1 hour
    
    # Task routing
    task_routes={
        "pipeline.tasks.run_pipeline_task": {"queue": "pipeline"},
        "pipeline.tasks.preprocess_task": {"queue": "preprocessing"},
        "pipeline.tasks.validate_task": {"queue": "validation"},
    },
    
    # Retry settings
    task_default_retry_delay=60,  # 1 minute
    task_max_retries=3,
    
    # Monitoring
    worker_send_task_events=True,
    task_send_sent_event=True,
)

# Beat schedule for periodic tasks (optional)
celery_app.conf.beat_schedule = {
    "cleanup-old-results": {
        "task": "pipeline.tasks.cleanup_old_results",
        "schedule": 3600.0,  # Every hour
    },
}
