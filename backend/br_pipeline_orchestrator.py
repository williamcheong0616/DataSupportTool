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
        """Execute all automated stages of the pipeline."""
        try:
            # Stage 1: BR Detection
            await self._run_br_detection(pipeline_run_id)
            
            # Stage 2: Text Restructuring
            await self._run_text_restructure(pipeline_run_id)
            
            # Stage 3: Question Generation
            await self._run_question_generation(pipeline_run_id)
            
            # Stage 4: Human Validation (blocks here - manual step)
            await self._move_to_human_validation(pipeline_run_id)
            
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
            is_br, confidence = await self._detect_bahasa_rojak(text_record.original_text)
            
            # Update record stage
            record_stage.is_bahasa_rojak = is_br
            record_stage.br_confidence = confidence
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
            restructured = await self._restructure_mcq_text(text_record.original_text)
            
            # Update record stage
            record_stage.restructured_text = restructured
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
        
        for record_stage in record_stages:
            # Generate 3 questions (placeholder - replace with actual model)
            questions = await self._generate_questions(record_stage.restructured_text, count=3)
            
            # Update record stage
            record_stage.generated_questions = questions
            record_stage.questions_generated_at = datetime.utcnow()
            record_stage.current_stage = BRPipelineStage.QUESTION_GENERATION
            
            self.db.commit()
        
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
    
    async def _detect_bahasa_rojak(self, text: str) -> tuple[bool, float]:
        """Detect if text contains Bahasa Rojak (code-mixing) using Ollama."""
        ollama = get_ollama_service(model_name="gemma3:4b")
        return ollama.detect_bahasa_rojak(text)
    
    async def _restructure_mcq_text(self, text: str) -> str:
        """Restructure MCQ text into consolidated format using Ollama."""
        ollama = get_ollama_service(model_name="gemma3:4b")
        return ollama.restructure_mcq_text(text)
    
    async def _generate_questions(self, text: str, count: int = 3) -> List[str]:
        """Generate questions from text using Ollama."""
        ollama = get_ollama_service(model_name="gemma3:4b")
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
