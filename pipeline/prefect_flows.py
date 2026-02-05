"""Prefect flows for workflow orchestration."""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from prefect import flow, task, get_run_logger
from prefect.tasks import task_input_hash
from prefect.deployments import Deployment
from prefect.server.schemas.schedules import CronSchedule

from backend.database import SessionLocal
from backend.models import (
    PipelineRun, Dataset, DataRecord, ModelResponse as ModelResponseDB,
    ValidationRecord, PipelineStatus, ValidationResult as ValidationResultEnum
)
from pipeline.preprocessor import create_preprocessor
from pipeline.validator import create_validator
from pipeline.model_client import create_model_client
from pipeline.mlflow_tracker import track_pipeline_run, get_mlflow_tracker
from pipeline.argilla_client import get_argilla_client
from config import VALIDATION_THRESHOLD, MAX_ITERATIONS


# --- Prefect Tasks ---

@task(
    name="load_dataset",
    description="Load dataset records from database",
    retries=2,
    retry_delay_seconds=30,
    cache_key_fn=task_input_hash,
    cache_expiration=timedelta(hours=1)
)
def load_dataset_task(dataset_id: int) -> List[Dict[str, Any]]:
    """Load dataset records."""
    logger = get_run_logger()
    logger.info(f"Loading dataset {dataset_id}")
    
    db = SessionLocal()
    try:
        records = db.query(DataRecord).filter(
            DataRecord.dataset_id == dataset_id
        ).all()
        
        return [
            {
                "id": r.id,
                "input_text": r.input_text,
                "expected_output": r.expected_output,
                "is_preprocessed": r.is_preprocessed
            }
            for r in records
        ]
    finally:
        db.close()


@task(
    name="preprocess_records",
    description="Preprocess data records",
    retries=2,
    retry_delay_seconds=30
)
def preprocess_records_task(
    records: List[Dict[str, Any]],
    config: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Preprocess records."""
    logger = get_run_logger()
    logger.info(f"Preprocessing {len(records)} records")
    
    preprocessor = create_preprocessor(config)
    
    processed = []
    for record in records:
        result = preprocessor.process(record["input_text"])
        processed.append({
            **record,
            "processed_text": result.processed_text,
            "transformations": result.transformations_applied
        })
    
    return processed


@task(
    name="run_inference",
    description="Run model inference on records",
    retries=3,
    retry_delay_seconds=60
)
def run_inference_task(
    records: List[Dict[str, Any]],
    config: Dict[str, Any],
    pipeline_run_id: int,
    use_mock: bool = True
) -> List[Dict[str, Any]]:
    """Run model inference."""
    logger = get_run_logger()
    logger.info(f"Running inference on {len(records)} records")
    
    model_client = create_model_client(config, use_mock=use_mock)
    
    db = SessionLocal()
    try:
        responses = []
        for record in records:
            prompt = record.get("processed_text", record["input_text"])
            response = model_client.generate(
                prompt=prompt,
                max_tokens=config.get("max_tokens", 512),
                temperature=config.get("temperature", 0.7)
            )
            
            # Store in database
            db_response = ModelResponseDB(
                data_record_id=record["id"],
                pipeline_run_id=pipeline_run_id,
                model_name=config.get("model_name", "default-model"),
                response_text=response.text,
                latency_ms=response.latency_ms,
                tokens_used=response.tokens_used
            )
            db.add(db_response)
            db.flush()
            
            responses.append({
                **record,
                "model_response_id": db_response.id,
                "response_text": response.text,
                "latency_ms": response.latency_ms
            })
        
        db.commit()
        return responses
    finally:
        db.close()


@task(
    name="validate_responses",
    description="Validate model responses",
    retries=2,
    retry_delay_seconds=30
)
def validate_responses_task(
    responses: List[Dict[str, Any]],
    config: Dict[str, Any],
    pipeline_run_id: int
) -> Dict[str, Any]:
    """Validate model responses."""
    logger = get_run_logger()
    logger.info(f"Validating {len(responses)} responses")
    
    validator = create_validator(config)
    
    db = SessionLocal()
    try:
        results = {
            "total": 0,
            "passed": 0,
            "failed": 0,
            "needs_review": 0,
            "accuracy_scores": [],
            "bleu_scores": [],
            "rouge_scores": [],
            "validation_records": []
        }
        
        for response in responses:
            result = validator.validate(
                response=response["response_text"],
                expected=response.get("expected_output"),
                input_text=response["input_text"]
            )
            
            # Determine result enum
            if result.passed:
                result_enum = ValidationResultEnum.PASSED
                results["passed"] += 1
            elif result.needs_human_review:
                result_enum = ValidationResultEnum.NEEDS_REVIEW
                results["needs_review"] += 1
            else:
                result_enum = ValidationResultEnum.FAILED
                results["failed"] += 1
            
            results["total"] += 1
            
            if result.metrics.accuracy_score:
                results["accuracy_scores"].append(result.metrics.accuracy_score)
            if result.metrics.bleu_score:
                results["bleu_scores"].append(result.metrics.bleu_score)
            if result.metrics.rouge_score:
                results["rouge_scores"].append(result.metrics.rouge_score)
            
            # Store validation record
            validation_record = ValidationRecord(
                model_response_id=response["model_response_id"],
                pipeline_run_id=pipeline_run_id,
                result=result_enum,
                accuracy_score=result.metrics.accuracy_score,
                bleu_score=result.metrics.bleu_score,
                rouge_score=result.metrics.rouge_score,
                custom_metrics=result.metrics.custom_metrics
            )
            db.add(validation_record)
            
            results["validation_records"].append({
                "record_id": response["id"],
                "model_response_id": response["model_response_id"],
                "result": result_enum.value,
                "accuracy": result.metrics.accuracy_score,
                "needs_human_review": result.needs_human_review
            })
        
        db.commit()
        
        # Calculate averages
        results["avg_accuracy"] = (
            sum(results["accuracy_scores"]) / len(results["accuracy_scores"])
            if results["accuracy_scores"] else None
        )
        results["avg_bleu"] = (
            sum(results["bleu_scores"]) / len(results["bleu_scores"])
            if results["bleu_scores"] else None
        )
        results["avg_rouge"] = (
            sum(results["rouge_scores"]) / len(results["rouge_scores"])
            if results["rouge_scores"] else None
        )
        results["pass_rate"] = results["passed"] / results["total"] if results["total"] > 0 else 0
        
        return results
    finally:
        db.close()


@task(
    name="create_argilla_review",
    description="Create Argilla review task for human annotation",
    retries=2,
    retry_delay_seconds=30
)
def create_argilla_review_task(
    responses: List[Dict[str, Any]],
    validation_results: Dict[str, Any],
    pipeline_run_id: int,
    dataset_name: str
) -> Optional[str]:
    """Create Argilla review task for responses needing human review."""
    logger = get_run_logger()
    
    # Filter records needing review
    needs_review = [
        vr for vr in validation_results["validation_records"]
        if vr["needs_human_review"]
    ]
    
    if not needs_review:
        logger.info("No records need human review")
        return None
    
    logger.info(f"Creating Argilla review for {len(needs_review)} records")
    
    # Prepare records for Argilla
    review_records = []
    for vr in needs_review:
        response = next(
            (r for r in responses if r["model_response_id"] == vr["model_response_id"]),
            None
        )
        if response:
            review_records.append({
                "record_id": vr["record_id"],
                "model_response_id": vr["model_response_id"],
                "pipeline_run_id": pipeline_run_id,
                "input_text": response["input_text"],
                "expected_output": response.get("expected_output", ""),
                "model_response": response["response_text"],
                "accuracy_score": vr["accuracy"],
                "automated_result": vr["result"]
            })
    
    try:
        client = get_argilla_client()
        argilla_dataset = client.create_validation_dataset(
            name=dataset_name,
            pipeline_run_id=pipeline_run_id
        )
        client.add_records_for_review(argilla_dataset, review_records)
        return argilla_dataset
    except Exception as e:
        logger.warning(f"Failed to create Argilla review: {str(e)}")
        return None


@task(
    name="track_with_mlflow",
    description="Log metrics to MLflow"
)
def track_with_mlflow_task(
    pipeline_run_id: int,
    dataset_name: str,
    config: Dict[str, Any],
    results: Dict[str, Any],
    iteration: int
):
    """Track pipeline run with MLflow."""
    logger = get_run_logger()
    logger.info(f"Tracking run {pipeline_run_id} with MLflow")
    
    try:
        results_with_iteration = {**results, "iteration": iteration}
        track_pipeline_run(pipeline_run_id, dataset_name, config, results_with_iteration)
    except Exception as e:
        logger.warning(f"MLflow tracking failed: {str(e)}")


@task(
    name="update_pipeline_status",
    description="Update pipeline run status in database"
)
def update_pipeline_status_task(
    pipeline_run_id: int,
    status: str,
    error_message: Optional[str] = None
):
    """Update pipeline run status."""
    db = SessionLocal()
    try:
        run = db.query(PipelineRun).filter(PipelineRun.id == pipeline_run_id).first()
        if run:
            run.status = PipelineStatus(status)
            if error_message:
                run.error_message = error_message
            if status in ["completed", "failed", "human_review"]:
                run.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


# --- Prefect Flows ---

@flow(
    name="data_pipeline",
    description="Main data pipeline flow: collect → preprocess → validate → iterate",
    retries=1,
    retry_delay_seconds=120
)
def data_pipeline_flow(
    pipeline_run_id: int,
    dataset_id: int,
    dataset_name: str,
    config: Optional[Dict[str, Any]] = None,
    use_mock_model: bool = True
) -> Dict[str, Any]:
    """
    Main data pipeline flow.
    
    Args:
        pipeline_run_id: ID of the pipeline run
        dataset_id: ID of the dataset to process
        dataset_name: Name of the dataset
        config: Pipeline configuration
        use_mock_model: Whether to use mock model client
    
    Returns:
        Dict with pipeline results
    """
    logger = get_run_logger()
    logger.info(f"Starting pipeline flow for run {pipeline_run_id}")
    
    config = config or {}
    threshold = config.get("validation_threshold", VALIDATION_THRESHOLD)
    
    # Get current iteration
    db = SessionLocal()
    try:
        run = db.query(PipelineRun).filter(PipelineRun.id == pipeline_run_id).first()
        iteration = run.iteration if run else 1
    finally:
        db.close()
    
    try:
        # Step 1: Load data
        update_pipeline_status_task(pipeline_run_id, "collecting")
        records = load_dataset_task(dataset_id)
        
        if not records:
            raise ValueError("No records found in dataset")
        
        # Step 2: Preprocess
        update_pipeline_status_task(pipeline_run_id, "preprocessing")
        processed_records = preprocess_records_task(records, config)
        
        # Step 3: Model inference
        responses = run_inference_task(
            processed_records,
            config,
            pipeline_run_id,
            use_mock=use_mock_model
        )
        
        # Step 4: Validation
        update_pipeline_status_task(pipeline_run_id, "validating")
        validation_results = validate_responses_task(
            responses,
            config,
            pipeline_run_id
        )
        
        # Step 5: Track with MLflow
        track_with_mlflow_task(
            pipeline_run_id,
            dataset_name,
            config,
            validation_results,
            iteration
        )
        
        # Step 6: Determine outcome
        pass_rate = validation_results["pass_rate"]
        needs_review = validation_results["needs_review"]
        
        if pass_rate >= threshold:
            status = "completed"
            logger.info(f"Pipeline completed successfully. Pass rate: {pass_rate:.2%}")
        elif needs_review > 0:
            status = "human_review"
            # Create Argilla review task
            create_argilla_review_task(
                responses,
                validation_results,
                pipeline_run_id,
                dataset_name
            )
            logger.info(f"Pipeline needs human review. {needs_review} records to review.")
        else:
            status = "failed"
            logger.warning(f"Pipeline failed validation. Pass rate: {pass_rate:.2%}")
        
        update_pipeline_status_task(pipeline_run_id, status)
        
        return {
            "pipeline_run_id": pipeline_run_id,
            "status": status,
            "iteration": iteration,
            "pass_rate": pass_rate,
            "total": validation_results["total"],
            "passed": validation_results["passed"],
            "failed": validation_results["failed"],
            "needs_review": validation_results["needs_review"],
            "avg_accuracy": validation_results["avg_accuracy"]
        }
    
    except Exception as e:
        logger.error(f"Pipeline failed: {str(e)}")
        update_pipeline_status_task(pipeline_run_id, "failed", str(e))
        raise


@flow(
    name="iterate_pipeline",
    description="Iterate on a failed pipeline run"
)
def iterate_pipeline_flow(
    failed_run_id: int,
    use_mock_model: bool = True
) -> Dict[str, Any]:
    """
    Start a new iteration based on a failed pipeline run.
    
    Args:
        failed_run_id: ID of the failed pipeline run
        use_mock_model: Whether to use mock model client
    
    Returns:
        Dict with new run results
    """
    logger = get_run_logger()
    logger.info(f"Starting iteration for failed run {failed_run_id}")
    
    db = SessionLocal()
    try:
        failed_run = db.query(PipelineRun).filter(PipelineRun.id == failed_run_id).first()
        if not failed_run:
            raise ValueError(f"Run {failed_run_id} not found")
        
        if failed_run.iteration >= MAX_ITERATIONS:
            logger.warning(f"Max iterations ({MAX_ITERATIONS}) reached")
            failed_run.status = PipelineStatus.HUMAN_REVIEW
            failed_run.error_message = f"Max iterations reached. Manual review required."
            db.commit()
            return {
                "status": "max_iterations_reached",
                "original_run_id": failed_run_id,
                "iteration": failed_run.iteration
            }
        
        # Get dataset info
        dataset = db.query(Dataset).filter(Dataset.id == failed_run.dataset_id).first()
        
        # Create new run
        new_run = PipelineRun(
            dataset_id=failed_run.dataset_id,
            status=PipelineStatus.ITERATING,
            iteration=failed_run.iteration + 1,
            config=failed_run.config
        )
        db.add(new_run)
        db.commit()
        db.refresh(new_run)
        
        new_run_id = new_run.id
        dataset_id = failed_run.dataset_id
        dataset_name = dataset.name if dataset else f"dataset_{dataset_id}"
        config = failed_run.config or {}
    finally:
        db.close()
    
    # Run the pipeline
    return data_pipeline_flow(
        pipeline_run_id=new_run_id,
        dataset_id=dataset_id,
        dataset_name=dataset_name,
        config=config,
        use_mock_model=use_mock_model
    )


@flow(
    name="sync_argilla_annotations",
    description="Sync human annotations from Argilla back to database"
)
def sync_argilla_annotations_flow(
    pipeline_run_id: int,
    dataset_name: str
) -> Dict[str, Any]:
    """
    Sync Argilla annotations back to the database.
    
    Args:
        pipeline_run_id: Pipeline run ID
        dataset_name: Argilla dataset name
    
    Returns:
        Dict with sync results
    """
    logger = get_run_logger()
    logger.info(f"Syncing Argilla annotations for run {pipeline_run_id}")
    
    try:
        client = get_argilla_client()
        argilla_dataset = f"{dataset_name}_run_{pipeline_run_id}"
        
        # Get annotation stats
        stats = client.get_annotation_stats(argilla_dataset)
        
        # Sync to database
        db = SessionLocal()
        try:
            updated = client.sync_annotations_to_db(argilla_dataset, db)
            
            return {
                "pipeline_run_id": pipeline_run_id,
                "synced_count": updated,
                "annotation_stats": stats
            }
        finally:
            db.close()
    
    except Exception as e:
        logger.error(f"Failed to sync annotations: {str(e)}")
        return {
            "pipeline_run_id": pipeline_run_id,
            "error": str(e)
        }


# --- Deployment helpers ---

def create_pipeline_deployment():
    """Create Prefect deployment for the data pipeline."""
    return Deployment.build_from_flow(
        flow=data_pipeline_flow,
        name="data-pipeline-deployment",
        work_queue_name="pipeline-queue",
        tags=["data-pipeline", "validation"]
    )


def run_pipeline_with_prefect(
    pipeline_run_id: int,
    dataset_id: int,
    dataset_name: str,
    config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Convenience function to run pipeline with Prefect.
    
    Args:
        pipeline_run_id: Pipeline run ID
        dataset_id: Dataset ID
        dataset_name: Dataset name
        config: Pipeline configuration
    
    Returns:
        Pipeline results
    """
    return data_pipeline_flow(
        pipeline_run_id=pipeline_run_id,
        dataset_id=dataset_id,
        dataset_name=dataset_name,
        config=config
    )
