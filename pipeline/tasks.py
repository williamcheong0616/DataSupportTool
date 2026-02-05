"""Celery tasks for distributed pipeline execution."""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from celery import shared_task
from celery.utils.log import get_task_logger

from pipeline.celery_app import celery_app
from backend.database import SessionLocal
from backend.models import PipelineRun, PipelineStatus

logger = get_task_logger(__name__)


@celery_app.task(bind=True, max_retries=3)
def run_pipeline_task(self, run_id: int) -> Dict[str, Any]:
    """
    Execute the full pipeline as a Celery task.
    
    Args:
        run_id: ID of the pipeline run to execute
    
    Returns:
        Dict with execution results
    """
    logger.info(f"Starting pipeline task for run_id={run_id}")
    
    db = SessionLocal()
    try:
        from pipeline.orchestrator import PipelineOrchestrator
        
        orchestrator = PipelineOrchestrator(db, use_mock_model=True)
        run = orchestrator.execute(run_id)
        
        return {
            "run_id": run.id,
            "status": run.status.value,
            "iteration": run.iteration,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None
        }
    
    except Exception as e:
        logger.error(f"Pipeline task failed: {str(e)}")
        
        # Update run status to failed
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if run:
            run.status = PipelineStatus.FAILED
            run.error_message = str(e)
            run.completed_at = datetime.utcnow()
            db.commit()
        
        # Retry the task
        raise self.retry(exc=e, countdown=60)
    
    finally:
        db.close()


@celery_app.task(bind=True)
def preprocess_task(self, dataset_id: int, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Preprocess a dataset as a standalone task.
    
    Args:
        dataset_id: ID of the dataset to preprocess
        config: Preprocessing configuration
    
    Returns:
        Dict with preprocessing results
    """
    logger.info(f"Starting preprocessing task for dataset_id={dataset_id}")
    
    db = SessionLocal()
    try:
        from pipeline.preprocessor import create_preprocessor
        from backend.models import DataRecord
        
        preprocessor = create_preprocessor(config)
        records = db.query(DataRecord).filter(
            DataRecord.dataset_id == dataset_id
        ).all()
        
        processed_count = 0
        for record in records:
            if not record.is_preprocessed:
                result = preprocessor.process(record.input_text)
                record.input_text = result.processed_text
                record.is_preprocessed = True
                processed_count += 1
        
        db.commit()
        
        return {
            "dataset_id": dataset_id,
            "total_records": len(records),
            "processed_count": processed_count
        }
    
    finally:
        db.close()


@celery_app.task(bind=True)
def validate_task(
    self, 
    run_id: int, 
    response_ids: list, 
    config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Validate model responses as a standalone task.
    
    Args:
        run_id: Pipeline run ID
        response_ids: List of model response IDs to validate
        config: Validation configuration
    
    Returns:
        Dict with validation results
    """
    logger.info(f"Starting validation task for run_id={run_id}")
    
    db = SessionLocal()
    try:
        from pipeline.validator import create_validator
        from backend.models import ModelResponse, DataRecord, ValidationRecord, ValidationResult
        
        validator = create_validator(config)
        
        results = []
        for response_id in response_ids:
            response = db.query(ModelResponse).filter(
                ModelResponse.id == response_id
            ).first()
            
            if not response:
                continue
            
            record = db.query(DataRecord).filter(
                DataRecord.id == response.data_record_id
            ).first()
            
            validation_result = validator.validate(
                response=response.response_text,
                expected=record.expected_output if record else None,
                input_text=record.input_text if record else None
            )
            
            # Determine result enum
            if validation_result.passed:
                result_enum = ValidationResult.PASSED
            elif validation_result.needs_human_review:
                result_enum = ValidationResult.NEEDS_REVIEW
            else:
                result_enum = ValidationResult.FAILED
            
            # Store validation record
            validation_record = ValidationRecord(
                model_response_id=response.id,
                pipeline_run_id=run_id,
                result=result_enum,
                accuracy_score=validation_result.metrics.accuracy_score,
                bleu_score=validation_result.metrics.bleu_score,
                rouge_score=validation_result.metrics.rouge_score,
                custom_metrics=validation_result.metrics.custom_metrics
            )
            db.add(validation_record)
            results.append(result_enum.value)
        
        db.commit()
        
        return {
            "run_id": run_id,
            "validated_count": len(results),
            "results": results
        }
    
    finally:
        db.close()


@celery_app.task
def cleanup_old_results() -> Dict[str, int]:
    """
    Periodic task to clean up old pipeline results.
    
    Returns:
        Dict with cleanup statistics
    """
    logger.info("Running cleanup task")
    
    db = SessionLocal()
    try:
        from backend.models import PipelineRun
        
        # Delete completed runs older than 30 days
        cutoff = datetime.utcnow() - timedelta(days=30)
        
        deleted = db.query(PipelineRun).filter(
            PipelineRun.status == PipelineStatus.COMPLETED,
            PipelineRun.completed_at < cutoff
        ).delete()
        
        db.commit()
        
        return {"deleted_runs": deleted}
    
    finally:
        db.close()


@celery_app.task(bind=True)
def iterate_pipeline_task(self, failed_run_id: int) -> Dict[str, Any]:
    """
    Start a new iteration based on a failed run.
    
    Args:
        failed_run_id: ID of the failed pipeline run
    
    Returns:
        Dict with new run details
    """
    logger.info(f"Starting iteration task for failed_run_id={failed_run_id}")
    
    db = SessionLocal()
    try:
        from pipeline.orchestrator import run_iteration
        
        new_run = run_iteration(db, failed_run_id)
        
        return {
            "original_run_id": failed_run_id,
            "new_run_id": new_run.id,
            "iteration": new_run.iteration,
            "status": new_run.status.value
        }
    
    finally:
        db.close()
