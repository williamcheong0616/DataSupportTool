"""
BR Pipeline Orchestrator
Manages the automated Bahasa Rojak detection and question generation pipeline
"""
import os
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from backend.br_pipeline_models import (
    BRPipelineStage,
    BRPipelineRun,
    BRRecordStage,
    ModelConfig
)
from backend.models import TextDataset, TextRecord
from backend.ollama_service import get_ollama_service

logger = logging.getLogger(__name__)


class BRPipelineOrchestrator:
    """Orchestrates the BR automation pipeline."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create_pipeline(self, dataset_id: int) -> BRPipelineRun:
        """Create a pipeline run (sync) - returns immediately."""
        # Get dataset and records
        dataset = self.db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
        if not dataset:
            raise ValueError(f"Dataset {dataset_id} not found")
        
        records = self.db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id).all()
        
        # Create pipeline run
        pipeline_run = BRPipelineRun(
            dataset_id=dataset_id,
            total_records=len(records),
            processed_records=0,
            pending_validation=0,
            current_stage=BRPipelineStage.BR_DETECTION,
            status="pending",  # Will be set to running by background task
            started_at=datetime.utcnow()
        )
        self.db.add(pipeline_run)
        self.db.commit()
        self.db.refresh(pipeline_run)
        
        # Create record stages for each text record
        for record in records:
            record_stage = BRRecordStage(
                pipeline_run_id=pipeline_run.id,
                text_record_id=record.id,
                current_stage=BRPipelineStage.PENDING
            )
            self.db.add(record_stage)
        
        self.db.commit()
        
        logger.info(f"Created pipeline {pipeline_run.id} for dataset {dataset_id} with {len(records)} records")
        
        return pipeline_run
    
    async def start_pipeline(self, dataset_id: int) -> BRPipelineRun:
        """Start the automated pipeline for a dataset (legacy - blocks until done)."""
        pipeline_run = self.create_pipeline(dataset_id)
        await self._execute_pipeline(pipeline_run.id)
        return pipeline_run
    
    async def _execute_pipeline(self, pipeline_run_id: int):
        """Execute Stage 1 (BR Detection) only. Stages 2 & 3 must be run manually."""
        try:
            # Check if Ollama is available before starting
            if not await self._check_ollama_available():
                error_msg = "Ollama service is not available. Please start Ollama (ollama serve) before running the pipeline."
                logger.error(f"Pipeline {pipeline_run_id}: {error_msg}")
                self._mark_pipeline_failed(pipeline_run_id, error_msg)
                return
            
            # Stage 1: BR Detection (automated)
            await self._run_br_detection(pipeline_run_id)
            
            # Stage 2: Text Restructuring (MANUAL - use "Rerun Stage 2" button)
            # await self._run_text_restructure(pipeline_run_id)
            
            # Stage 3: Question Generation (MANUAL - use "Rerun Stage 3" button)
            # await self._run_question_generation(pipeline_run_id)
            
            # Stage 4: Human Validation (manual step)
            # await self._move_to_human_validation(pipeline_run_id)
            
        except Exception as e:
            logger.error(f"Pipeline {pipeline_run_id} failed: {e}")
            self._mark_pipeline_failed(pipeline_run_id, str(e))
    
    async def _run_br_detection(self, pipeline_run_id: int):
        """Stage 1: Detect Bahasa Rojak in all records."""
        logger.info(f"Pipeline {pipeline_run_id}: Running BR detection")
        
        record_stages = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id
        ).all()
        
        for record_stage in record_stages:
            text_record = self.db.query(TextRecord).filter(
                TextRecord.id == record_stage.text_record_id
            ).first()
            
            # Run BR detection (placeholder - replace with actual model)
            is_br, confidence, languages = await self._detect_bahasa_rojak(text_record.original_text)
            
            # Update record stage
            record_stage.is_bahasa_rojak = is_br
            record_stage.br_confidence = confidence
            record_stage.detected_language = languages
            record_stage.br_detected_at = datetime.utcnow()
            record_stage.current_stage = BRPipelineStage.BR_DETECTION
            
            self.db.commit()
        
        # Update pipeline run
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        pipeline_run.current_stage = BRPipelineStage.TEXT_RESTRUCTURE
        self.db.commit()
    
    async def _run_text_restructure(self, pipeline_run_id: int):
        """Stage 2: Restructure MCQ text into consolidated format."""
        logger.info(f"Pipeline {pipeline_run_id}: Running text restructuring")
        
        record_stages = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.current_stage == BRPipelineStage.BR_DETECTION
        ).all()
        
        for record_stage in record_stages:
            text_record = self.db.query(TextRecord).filter(
                TextRecord.id == record_stage.text_record_id
            ).first()
            
            # Restructure text (placeholder - replace with actual model)
            restructured, metadata = await self._restructure_mcq_text(
                text_record.original_text,
                skip_restructure=record_stage.skip_restructure
            )
            
            # Update record stage
            record_stage.restructured_text = restructured
            record_stage.restructure_metadata = metadata
            record_stage.restructured_at = datetime.utcnow()
            record_stage.current_stage = BRPipelineStage.TEXT_RESTRUCTURE
            
            self.db.commit()
        
        # Update pipeline run
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        pipeline_run.current_stage = BRPipelineStage.QUESTION_GENERATION
        self.db.commit()
    
    async def _run_question_generation(self, pipeline_run_id: int):
        """Stage 3: Generate 3 questions per record."""
        logger.info(f"Pipeline {pipeline_run_id}: Generating questions")
        
        record_stages = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.current_stage == BRPipelineStage.TEXT_RESTRUCTURE
        ).all()
        
        consecutive_failures = 0
        max_failures = 3  # Stop after 3 consecutive failures
        
        for record_stage in record_stages:
            try:
                # Generate 3 questions
                questions = await self._generate_questions(record_stage.restructured_text, count=3)
                
                # Check if we got fallback questions (indicates failure)
                if questions[0].startswith("What is the main topic"):
                    consecutive_failures += 1
                    logger.warning(f"Got fallback questions for record {record_stage.id} (failure {consecutive_failures}/{max_failures})")
                    if consecutive_failures >= max_failures:
                        raise Exception("Ollama service appears to be unavailable (too many consecutive failures)")
                else:
                    consecutive_failures = 0  # Reset on success
                
                # Update record stage
                record_stage.generated_questions = questions
                record_stage.questions_generated_at = datetime.utcnow()
                record_stage.current_stage = BRPipelineStage.QUESTION_GENERATION
                
                self.db.commit()
                
            except Exception as e:
                logger.error(f"Failed to generate questions for record {record_stage.id}: {e}")
                record_stage.error_message = str(e)
                self.db.commit()
                raise  # Stop processing
        
        # Update pipeline run
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        pipeline_run.current_stage = BRPipelineStage.HUMAN_VALIDATION
        self.db.commit()
    
    async def _move_to_human_validation(self, pipeline_run_id: int):
        """Stage 4: Mark records ready for human validation."""
        logger.info(f"Pipeline {pipeline_run_id}: Awaiting human validation")
        
        # Count records pending validation
        pending_count = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.current_stage == BRPipelineStage.QUESTION_GENERATION,
            BRRecordStage.selected_question_index == None
        ).count()
        
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        pipeline_run.pending_validation = pending_count
        pipeline_run.status = "awaiting_validation"
        self.db.commit()
    
    async def select_question(
        self, 
        record_stage_id: int, 
        question_index: int, 
        validated_by: str
    ):
        """Human selects one of the 3 generated questions."""
        record_stage = self.db.query(BRRecordStage).filter(
            BRRecordStage.id == record_stage_id
        ).first()
        
        if not record_stage or not record_stage.generated_questions:
            raise ValueError("Record stage or questions not found")
        
        if question_index not in [0, 1, 2]:
            raise ValueError("Question index must be 0, 1, or 2")
        
        # Update record stage
        record_stage.selected_question_index = question_index
        record_stage.selected_question = record_stage.generated_questions[question_index]
        record_stage.validated_by = validated_by
        record_stage.validated_at = datetime.utcnow()
        record_stage.current_stage = BRPipelineStage.HUMAN_VALIDATION
        
        self.db.commit()
        
        # Run model response generation for this record
        await self._run_model_responses(record_stage.id)
        
        # Check if all records are validated
        await self._check_pipeline_completion(record_stage.pipeline_run_id)
    
    async def _run_model_responses(self, record_stage_id: int):
        """Stage 5: Generate responses from 3 base models."""
        record_stage = self.db.query(BRRecordStage).filter(
            BRRecordStage.id == record_stage_id
        ).first()
        
        if not record_stage or not record_stage.selected_question:
            return
        
        # Get active models
        models = self.db.query(ModelConfig).filter(ModelConfig.is_active == True).limit(3).all()
        
        responses = {}
        for model in models:
            # Generate response (placeholder - replace with actual model calls)
            response, problems = await self._generate_model_response(
                model,
                record_stage.restructured_text,
                record_stage.selected_question
            )
            
            responses[model.name] = {
                "response": response,
                "problems": problems,
                "model_id": model.model_id
            }
        
        # Update record stage
        record_stage.model_responses = responses
        record_stage.responses_generated_at = datetime.utcnow()
        record_stage.current_stage = BRPipelineStage.MODEL_RESPONSE
        record_stage.completed = True
        
        self.db.commit()
    
    async def _check_pipeline_completion(self, pipeline_run_id: int):
        """Check if all records are completed and mark pipeline as done."""
        completed_count = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.completed == True
        ).count()
        
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        
        pipeline_run.processed_records = completed_count
        
        # Update pending validation count
        pending_count = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.current_stage.in_([
                BRPipelineStage.QUESTION_GENERATION,
                BRPipelineStage.HUMAN_VALIDATION
            ]),
            BRRecordStage.selected_question_index == None
        ).count()
        pipeline_run.pending_validation = pending_count
        
        if completed_count == pipeline_run.total_records:
            pipeline_run.status = "completed"
            pipeline_run.current_stage = BRPipelineStage.COMPLETED
            pipeline_run.completed_at = datetime.utcnow()
        
        self.db.commit()
    
    def _mark_pipeline_failed(self, pipeline_run_id: int, error: str):
        """Mark pipeline as failed."""
        pipeline_run = self.db.query(BRPipelineRun).filter(
            BRPipelineRun.id == pipeline_run_id
        ).first()
        
        if pipeline_run:
            pipeline_run.status = "failed"
            pipeline_run.current_stage = BRPipelineStage.FAILED
            pipeline_run.error_message = error
            self.db.commit()
    
    # ===== AI Functions using Ollama =====
    
    async def _check_ollama_available(self) -> bool:
        """Check if Ollama service is available."""
        try:
            import requests
            response = requests.get("http://localhost:11434/api/tags", timeout=5)
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Ollama availability check failed: {e}")
            return False
    
    async def _detect_bahasa_rojak(self, text: str) -> tuple[bool, float, str]:
        """Detect if text contains Bahasa Rojak (code-mixing) and identify languages using Ollama."""
        ollama = get_ollama_service()
        return ollama.detect_bahasa_rojak(text)
    
    async def _restructure_mcq_text(self, text: str, skip_restructure: bool = False) -> tuple[str, dict]:
        """Restructure MCQ text into consolidated format using Ollama."""
        ollama = get_ollama_service()
        return ollama.restructure_mcq_text(text, skip_restructure=skip_restructure)
    
    async def _generate_questions(self, text: str, count: int = 3) -> List[str]:
        """Generate questions from text using Ollama."""
        ollama = get_ollama_service()
        return ollama.generate_questions(text, count)
    
    async def _generate_model_response(
        self, 
        model: ModelConfig, 
        context: str, 
        question: str
    ) -> tuple[str, List[str]]:
        """Generate response from a base model and identify problems."""
        # If model type is 'ollama', use Ollama service
        if model.model_type == "ollama":
            ollama = get_ollama_service(model_name=model.model_id)
            return ollama.generate_model_response(context, question, detect_problems=True)
        
        # For other model types (openai, anthropic, etc.), implement here
        # TODO: Add OpenAI, Anthropic, etc. implementations
        
        # Fallback placeholder
        response = f"[{model.name}] Response to: {question[:50]}..."
        problems = []
        
        return response, problems
    
    # ===== Individual Stage Execution Methods =====
    
    async def run_stage_1(self, pipeline_run_id: int, record_ids: Optional[List[int]] = None, force_rerun: bool = False):
        """
        Run Stage 1 (BR Detection + Language Detection) individually.
        If record_ids provided, only run for those records, else run for all pending.
        If force_rerun=True, rerun even if already processed.
        """
        rerun_text = " (RERUN)" if force_rerun else ""
        logger.info(f"Pipeline {pipeline_run_id}: Running Stage 1 (BR Detection + Language Detection){rerun_text}")
        
        # Check if Ollama is available
        if not await self._check_ollama_available():
            raise Exception("Ollama service is not available. Please start Ollama (ollama serve).")
        
        query = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id
        )
        
        if record_ids:
            query = query.filter(BRRecordStage.id.in_(record_ids))
        else:
            # Only run for records that haven't completed Stage 1 (unless force_rerun)
            if not force_rerun:
                query = query.filter(
                    BRRecordStage.current_stage.in_([BRPipelineStage.PENDING])
                )
        
        record_stages = query.all()
        
        for record_stage in record_stages:
            text_record = self.db.query(TextRecord).filter(
                TextRecord.id == record_stage.text_record_id
            ).first()
            
            # Run BR detection with language detection
            is_br, confidence, languages = await self._detect_bahasa_rojak(text_record.original_text)
            
            # Update record stage
            record_stage.is_bahasa_rojak = is_br
            record_stage.br_confidence = confidence
            record_stage.detected_language = languages
            record_stage.br_detected_at = datetime.utcnow()
            record_stage.current_stage = BRPipelineStage.BR_DETECTION
            
            self.db.commit()
        
        logger.info(f"Stage 1 completed for {len(record_stages)} records")
        return len(record_stages)
    
    async def run_stage_2(
        self, 
        pipeline_run_id: int, 
        record_ids: Optional[List[int]] = None,
        skip_restructure: bool = False,
        force_rerun: bool = False
    ):
        """
        Run Stage 2 (Text Restructuring) individually.
        ONLY processes records classified as Bahasa Rojak (is_bahasa_rojak=True).
        If skip_restructure=True, keeps original text without restructuring.
        If force_rerun=True, rerun even if already processed.
        """
        rerun_text = " (RERUN)" if force_rerun else ""
        logger.info(f"Pipeline {pipeline_run_id}: Running Stage 2 (Text Restructuring, skip={skip_restructure}){rerun_text}")
        
        if not await self._check_ollama_available():
            raise Exception("Ollama service is not available. Please start Ollama (ollama serve).")
        
        query = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.is_bahasa_rojak == True  # Only process BR records
        )
        
        if record_ids:
            query = query.filter(BRRecordStage.id.in_(record_ids))
        else:
            # Only run for records that completed Stage 1 (unless force_rerun)
            if not force_rerun:
                query = query.filter(
                    BRRecordStage.current_stage == BRPipelineStage.BR_DETECTION
                )
            else:
                # For rerun, include all records that have at least completed Stage 1
                query = query.filter(
                    BRRecordStage.current_stage.in_([
                        BRPipelineStage.BR_DETECTION,
                        BRPipelineStage.TEXT_RESTRUCTURE,
                        BRPipelineStage.QUESTION_GENERATION,
                        BRPipelineStage.HUMAN_VALIDATION,
                        BRPipelineStage.MODEL_RESPONSE,
                        BRPipelineStage.COMPLETED
                    ])
                )
        
        record_stages = query.all()
        
        for record_stage in record_stages:
            text_record = self.db.query(TextRecord).filter(
                TextRecord.id == record_stage.text_record_id
            ).first()
            
            # Set skip_restructure flag
            record_stage.skip_restructure = skip_restructure
            
            # Restructure text (or skip if requested)
            restructured, metadata = await self._restructure_mcq_text(
                text_record.original_text,
                skip_restructure=skip_restructure
            )
            
            # Update record stage
            record_stage.restructured_text = restructured
            record_stage.restructure_metadata = metadata
            record_stage.restructured_at = datetime.utcnow()
            record_stage.current_stage = BRPipelineStage.TEXT_RESTRUCTURE
            
            self.db.commit()
        
        logger.info(f"Stage 2 completed for {len(record_stages)} records")
        return len(record_stages)
    
    async def run_stage_3(self, pipeline_run_id: int, record_ids: Optional[List[int]] = None, force_rerun: bool = False):
        """
        Run Stage 3 (Question Generation in Bahasa Rojak) individually.
        If force_rerun=True, rerun even if already processed.
        """
        rerun_text = " (RERUN)" if force_rerun else ""
        logger.info(f"Pipeline {pipeline_run_id}: Running Stage 3 (Question Generation in Bahasa Rojak){rerun_text}")
        
        if not await self._check_ollama_available():
            raise Exception("Ollama service is not available. Please start Ollama (ollama serve).")
        
        query = self.db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id
        )
        
        if record_ids:
            query = query.filter(BRRecordStage.id.in_(record_ids))
        else:
            # Only run for records that completed Stage 2 (unless force_rerun)
            if not force_rerun:
                query = query.filter(
                    BRRecordStage.current_stage == BRPipelineStage.TEXT_RESTRUCTURE
                )
            else:
                # For rerun, include all records that have at least completed Stage 2
                query = query.filter(
                    BRRecordStage.current_stage.in_([
                        BRPipelineStage.TEXT_RESTRUCTURE,
                        BRPipelineStage.QUESTION_GENERATION,
                        BRPipelineStage.HUMAN_VALIDATION,
                        BRPipelineStage.MODEL_RESPONSE,
                        BRPipelineStage.COMPLETED
                    ])
                )
        
        record_stages = query.all()
        
        consecutive_failures = 0
        max_failures = 3
        
        for record_stage in record_stages:
            try:
                # Generate 3 questions in Bahasa Rojak style
                questions = await self._generate_questions(record_stage.restructured_text, count=3)
                
                # Check if we got fallback questions (indicates failure)
                if questions[0].startswith("What is the main topic"):
                    consecutive_failures += 1
                    logger.warning(f"Got fallback questions for record {record_stage.id} (failure {consecutive_failures}/{max_failures})")
                    if consecutive_failures >= max_failures:
                        raise Exception("Ollama service appears to be unavailable (too many consecutive failures)")
                else:
                    consecutive_failures = 0
                
                # Update record stage
                record_stage.generated_questions = questions
                record_stage.questions_generated_at = datetime.utcnow()
                record_stage.current_stage = BRPipelineStage.QUESTION_GENERATION
                
                self.db.commit()
                
            except Exception as e:
                logger.error(f"Failed to generate questions for record {record_stage.id}: {e}")
                record_stage.error_message = str(e)
                self.db.commit()
                raise
        
        logger.info(f"Stage 3 completed for {len(record_stages)} records")
        return len(record_stages)
