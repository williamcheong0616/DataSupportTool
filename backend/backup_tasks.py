"""
Celery tasks for database backup.

Contains the scheduled backup task triggered by Celery Beat daily at 6 PM.
"""

import logging
from backend.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="backend.backup_tasks.scheduled_backup", bind=True)
def scheduled_backup(self, frequency: str = "daily"):
    """
    Celery task for scheduled database backups.
    
    Triggered by Celery Beat at intervals defined in celery_app.py.
    Creates a SQL dump in the sql_backups/ directory.
    """
    from backend.services.backup_service import create_backup
    
    logger.info(f"Starting scheduled {frequency} backup...")
    try:
        result = create_backup(triggered_by="scheduled", frequency=frequency)
        logger.info(f"Scheduled {frequency} backup complete: {result['filename']} ({result['size_human']})")
        return {
            "status": "success",
            "filename": result["filename"],
            "size": result["size_human"],
            "frequency": frequency,
        }
    except Exception as e:
        logger.error(f"Scheduled {frequency} backup failed: {e}")
        raise self.retry(exc=e, countdown=120, max_retries=2)  # Retry after 2 min, max 2 retries
