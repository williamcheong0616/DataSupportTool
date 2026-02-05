"""Pipeline orchestrator - coordinates the full data pipeline flow."""
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session

from backend.models import (
    PipelineRun, DataRecord, ModelResponse as ModelResponseDB,
    ValidationRecord, PipelineStatus, ValidationResult as ValidationResultEnum
)
from pipeline.preprocessor import DataPreprocessor, create_preprocessor
from pipeline.validator import ResponseValidator, create_validator
from pipeline.model_client import ModelClient, create_model_client, MockModelClient
from config import VALIDATION_THRESHOLD, MAX_ITERATIONS


class PipelineOrchestrator:
    """
    Orchestrates the complete data pipeline:
    1. Data Collection (handled by API endpoints)
    2. Preprocessing
    3. Model Inference
    4. Validation (automated + human)
    5. Iteration (if validation fails)
    """
    
    def __init__(self, db: Session, use_mock_model: bool = True):
        """
        Initialize orchestrator.
        
        Args:
            db: Database session
            use_mock_model: Use mock model client for testing
        """
        self.db = db
        self.use_mock_model = use_mock_model
    
    def execute(self, run_id: int) -> PipelineRun:
        """
        Execute the pipeline for a given run.
        
        Args:
            run_id: ID of the pipeline run to execute
        
        Returns:
            Updated PipelineRun object
        """
        run = self.db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if not run:
            raise ValueError(f"Pipeline run {run_id} not found")
        
        config = run.config or {}
        
        try:
            # Step 1: Update status to collecting (data already collected via API)
            self._update_status(run, PipelineStatus.COLLECTING)
            records = self._get_records(run.dataset_id)
            
            if not records:
                raise ValueError("No records found in dataset")
            
            # Step 2: Preprocessing
            self._update_status(run, PipelineStatus.PREPROCESSING)
            preprocessor = create_preprocessor(config)
            preprocessed_records = self._preprocess_records(records, preprocessor)
            
            # Step 3: Model inference
            model_client = create_model_client(config, use_mock=self.use_mock_model)
            model_responses = self._run_inference(run, preprocessed_records, model_client, config)
            
            # Step 4: Validation
            self._update_status(run, PipelineStatus.VALIDATING)
            validator = create_validator(config)
            validation_results = self._validate_responses(run, model_responses, records, validator)
            
            # Step 5: Determine outcome
            outcome = self._evaluate_outcome(validation_results, config)
            
            if outcome["passed"]:
                self._update_status(run, PipelineStatus.COMPLETED)
            elif outcome["needs_human_review"]:
                self._update_status(run, PipelineStatus.HUMAN_REVIEW)
            else:
                # Check iteration limit
                if run.iteration >= MAX_ITERATIONS:
                    run.error_message = f"Max iterations ({MAX_ITERATIONS}) reached. Manual review required."
                    self._update_status(run, PipelineStatus.HUMAN_REVIEW)
                else:
                    run.error_message = f"Validation failed. Pass rate: {outcome['pass_rate']:.2%}"
                    self._update_status(run, PipelineStatus.FAILED)
            
            run.completed_at = datetime.utcnow()
            self.db.commit()
            
            return run
        
        except Exception as e:
            run.status = PipelineStatus.FAILED
            run.error_message = str(e)
            run.completed_at = datetime.utcnow()
            self.db.commit()
            raise
    
    def _update_status(self, run: PipelineRun, status: PipelineStatus):
        """Update pipeline run status."""
        run.status = status
        self.db.commit()
    
    def _get_records(self, dataset_id: int) -> List[DataRecord]:
        """Get all records for a dataset."""
        return self.db.query(DataRecord).filter(
            DataRecord.dataset_id == dataset_id
        ).all()
    
    def _preprocess_records(
        self,
        records: List[DataRecord],
        preprocessor: DataPreprocessor
    ) -> Dict[int, str]:
        """
        Preprocess all records.
        
        Returns:
            Dict mapping record ID to preprocessed text
        """
        preprocessed = {}
        
        for record in records:
            result = preprocessor.process(record.input_text)
            preprocessed[record.id] = result.processed_text
            
            # Mark as preprocessed
            record.is_preprocessed = True
        
        self.db.commit()
        return preprocessed
    
    def _run_inference(
        self,
        run: PipelineRun,
        preprocessed_records: Dict[int, str],
        model_client: ModelClient,
        config: Dict[str, Any]
    ) -> List[ModelResponseDB]:
        """
        Run model inference on preprocessed records.
        
        Returns:
            List of ModelResponse database objects
        """
        model_responses = []
        model_name = config.get("model_name", "default-model")
        
        for record_id, processed_text in preprocessed_records.items():
            # Get model response
            response = model_client.generate(
                prompt=processed_text,
                max_tokens=config.get("max_tokens", 512),
                temperature=config.get("temperature", 0.7)
            )
            
            # Store in database
            db_response = ModelResponseDB(
                data_record_id=record_id,
                pipeline_run_id=run.id,
                model_name=model_name,
                response_text=response.text,
                latency_ms=response.latency_ms,
                tokens_used=response.tokens_used
            )
            self.db.add(db_response)
            model_responses.append(db_response)
        
        self.db.commit()
        
        # Refresh to get IDs
        for resp in model_responses:
            self.db.refresh(resp)
        
        return model_responses
    
    def _validate_responses(
        self,
        run: PipelineRun,
        model_responses: List[ModelResponseDB],
        records: List[DataRecord],
        validator: ResponseValidator
    ) -> List[ValidationRecord]:
        """
        Validate all model responses.
        
        Returns:
            List of ValidationRecord objects
        """
        # Create lookup for expected outputs
        record_lookup = {r.id: r for r in records}
        validation_records = []
        
        for model_response in model_responses:
            record = record_lookup.get(model_response.data_record_id)
            expected = record.expected_output if record else None
            
            # Run validation
            result = validator.validate(
                response=model_response.response_text,
                expected=expected,
                input_text=record.input_text if record else None
            )
            
            # Determine validation result enum
            if result.passed:
                result_enum = ValidationResultEnum.PASSED
            elif result.needs_human_review:
                result_enum = ValidationResultEnum.NEEDS_REVIEW
            else:
                result_enum = ValidationResultEnum.FAILED
            
            # Store validation record
            validation_record = ValidationRecord(
                model_response_id=model_response.id,
                pipeline_run_id=run.id,
                result=result_enum,
                accuracy_score=result.metrics.accuracy_score,
                bleu_score=result.metrics.bleu_score,
                rouge_score=result.metrics.rouge_score,
                custom_metrics=result.metrics.custom_metrics
            )
            self.db.add(validation_record)
            validation_records.append(validation_record)
        
        self.db.commit()
        return validation_records
    
    def _evaluate_outcome(
        self,
        validation_records: List[ValidationRecord],
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Evaluate overall pipeline outcome based on validation results.
        
        Returns:
            Dict with outcome details
        """
        threshold = config.get("validation_threshold", VALIDATION_THRESHOLD)
        
        total = len(validation_records)
        passed = sum(1 for v in validation_records if v.result == ValidationResultEnum.PASSED)
        needs_review = sum(1 for v in validation_records if v.result == ValidationResultEnum.NEEDS_REVIEW)
        failed = total - passed - needs_review
        
        pass_rate = passed / total if total > 0 else 0
        
        # Calculate average scores
        accuracy_scores = [v.accuracy_score for v in validation_records if v.accuracy_score]
        avg_accuracy = sum(accuracy_scores) / len(accuracy_scores) if accuracy_scores else 0
        
        return {
            "passed": pass_rate >= threshold,
            "needs_human_review": needs_review > 0 and pass_rate < threshold,
            "pass_rate": pass_rate,
            "total": total,
            "passed_count": passed,
            "failed_count": failed,
            "needs_review_count": needs_review,
            "avg_accuracy": avg_accuracy
        }


def run_iteration(db: Session, failed_run_id: int) -> PipelineRun:
    """
    Start a new iteration based on a failed run.
    
    This would typically involve:
    1. Analyzing what went wrong
    2. Potentially adjusting preprocessing
    3. Re-running the pipeline
    
    Returns:
        New PipelineRun object
    """
    failed_run = db.query(PipelineRun).filter(PipelineRun.id == failed_run_id).first()
    if not failed_run:
        raise ValueError(f"Run {failed_run_id} not found")
    
    # Create new run with incremented iteration
    new_run = PipelineRun(
        dataset_id=failed_run.dataset_id,
        status=PipelineStatus.ITERATING,
        iteration=failed_run.iteration + 1,
        config=failed_run.config
    )
    db.add(new_run)
    db.commit()
    db.refresh(new_run)
    
    # Execute the new run
    orchestrator = PipelineOrchestrator(db)
    return orchestrator.execute(new_run.id)
