"""
BR Pipeline API Endpoints
Handles automated Bahasa Rojak detection and question generation pipeline
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import asyncio
import logging

from backend.database import get_db, SessionLocal
from backend.br_pipeline_orchestrator import BRPipelineOrchestrator

logger = logging.getLogger(__name__)
from backend.br_pipeline_models import BRPipelineRun, BRRecordStage, BRPipelineStage, ModelConfig
from backend.models import TextRecord
from backend.br_pipeline_schemas import (
    PipelineStartRequest, PipelineRunResponse, RecordStageResponse,
    QuestionSelectionRequest, ModelConfigCreate,
    ClassificationUpdateRequest, ClassificationRecordResponse, ClassificationListResponse,
    RestructureRecordResponse, RestructureListResponse, RestructureUpdateRequest,
    QuestionRecordResponse, QuestionListResponse, QuestionSelectRequest,
    ResponseRecordResponse, ModelResponseEditRequest, ModelProblemsEditRequest,
    ResponseListResponse,
    StageExecutionRequest, Stage2ExecutionRequest, StageExecutionResponse,
    MergeRecordsRequest,
    BatchGenerateRequest, SingleGenerateRequest,
    SystemPromptUpdate, SystemPromptResponse,
    SimilarityPair, SimilarityResponse,
)


router = APIRouter(prefix="/api/br-pipeline", tags=["BR Pipeline"])


# ===== API Endpoints =====

def run_pipeline_in_background_thread(pipeline_run_id: int):
    """Background task to execute pipeline stages in a separate thread."""
    import asyncio
    # Create a new database session for the background task
    db = SessionLocal()
    try:
        # Update status to running
        from backend.br_pipeline_models import BRPipelineRun
        pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
        if pipeline_run:
            pipeline_run.status = "running"
            db.commit()
        
        # Create new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        orchestrator = BRPipelineOrchestrator(db)
        loop.run_until_complete(orchestrator._execute_pipeline(pipeline_run_id))
        
        logger.info(f"Pipeline {pipeline_run_id} background execution completed")
    except Exception as e:
        logger.error(f"Pipeline {pipeline_run_id} background execution failed: {e}")
        # Mark as failed
        from backend.br_pipeline_models import BRPipelineRun
        pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
        if pipeline_run:
            pipeline_run.status = "failed"
            pipeline_run.error_message = str(e)
            db.commit()
    finally:
        loop.close()
        db.close()


def start_background_pipeline(pipeline_run_id: int):
    """Start pipeline in a completely separate thread (non-blocking)."""
    import threading
    thread = threading.Thread(
        target=run_pipeline_in_background_thread,
        args=(pipeline_run_id,),
        daemon=True
    )
    thread.start()
    logger.info(f"Pipeline {pipeline_run_id} started in background thread {thread.name}")


# Background thread runners for individual stages
def run_stage_in_background_thread(stage_func, pipeline_run_id: int, **kwargs):
    """Generic background thread runner for stage execution."""
    import asyncio
    db = SessionLocal()
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Update pipeline status to running
        pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
        if pipeline_run:
            pipeline_run.status = "running"
            pipeline_run.error_message = None
            db.commit()
        
        orchestrator = BRPipelineOrchestrator(db)
        count = loop.run_until_complete(stage_func(orchestrator, pipeline_run_id, **kwargs))
        
        # Update pipeline status to completed
        pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
        if pipeline_run:
            pipeline_run.status = "completed"
            pipeline_run.error_message = None
            db.commit()
        
        logger.info(f"Stage execution completed: {count} records processed for pipeline {pipeline_run_id}")
    except Exception as e:
        logger.error(f"Stage execution failed for pipeline {pipeline_run_id}: {e}", exc_info=True)
        # Mark pipeline as failed with error message
        try:
            pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
            if pipeline_run:
                pipeline_run.status = "failed"
                pipeline_run.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        loop.close()
        db.close()


def start_stage_in_background(stage_func, pipeline_run_id: int, **kwargs):
    """Start stage execution in a completely separate thread (non-blocking)."""
    import threading
    thread = threading.Thread(
        target=run_stage_in_background_thread,
        args=(stage_func, pipeline_run_id),
        kwargs=kwargs,
        daemon=True
    )
    thread.start()
    logger.info(f"Stage for pipeline {pipeline_run_id} started in background thread {thread.name}")


@router.post("/start", response_model=PipelineRunResponse)
def start_pipeline(
    request: PipelineStartRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start the BR pipeline - ONLY runs Stage 1 (BR Detection + Language Detection).
    Returns immediately - pipeline runs in background.
    
    Pipeline stages:
    1. BR Detection (automated on start) - Detects Bahasa Rojak and identifies languages
    2. Text Restructuring (MANUAL) - Use "Rerun Stage 2" button in UI
    3. Question Generation (MANUAL) - Use "Rerun Stage 3" button in UI
    4. Human Validation (manual) - Human picks 1 of 3 questions
    5. Model Response Generation (automated) - 3 models respond to selected question
    
    After Stage 1 completes, navigate to the BR Classification page and use the 
    stage-specific rerun buttons to manually trigger Stages 2 and 3 when ready.
    """
    orchestrator = BRPipelineOrchestrator(db)
    
    try:
        # Create pipeline (sync, fast)
        pipeline_run = orchestrator.create_pipeline(request.dataset_id)
        
        # Schedule background execution (non-blocking)
        background_tasks.add_task(start_background_pipeline, pipeline_run.id)
        
        return PipelineRunResponse(
            id=pipeline_run.id,
            dataset_id=pipeline_run.dataset_id,
            total_records=pipeline_run.total_records,
            processed_records=pipeline_run.processed_records,
            pending_validation=pipeline_run.pending_validation,
            current_stage=pipeline_run.current_stage.value,
            status="pending",  # Will change to running in background
            error_message=pipeline_run.error_message,
            started_at=pipeline_run.started_at.isoformat() if pipeline_run.started_at else None,
            completed_at=pipeline_run.completed_at.isoformat() if pipeline_run.completed_at else None
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start pipeline: {str(e)}")


@router.get("/status/{pipeline_run_id}", response_model=PipelineRunResponse)
def get_pipeline_status(
    pipeline_run_id: int,
    db: Session = Depends(get_db)
):
    """Get the current status of a pipeline run."""
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    return PipelineRunResponse(
        id=pipeline_run.id,
        dataset_id=pipeline_run.dataset_id,
        total_records=pipeline_run.total_records,
        processed_records=pipeline_run.processed_records,
        pending_validation=pipeline_run.pending_validation,
        current_stage=pipeline_run.current_stage.value,
        status=pipeline_run.status,
        error_message=pipeline_run.error_message,
        started_at=pipeline_run.started_at.isoformat() if pipeline_run.started_at else None,
        completed_at=pipeline_run.completed_at.isoformat() if pipeline_run.completed_at else None
    )


# ===== Individual Stage Execution Endpoints =====

@router.post("/run-stage1", response_model=StageExecutionResponse)
def run_stage_1_individually(
    request: StageExecutionRequest,
    db: Session = Depends(get_db)
):
    """
    Run Stage 1 (BR Detection + Language Detection) individually.
    Returns immediately - processing runs in background.
    
    This stage:
    - Detects if text is Bahasa Rojak (code-mixed)
    - Automatically identifies the languages used in the text
    - Provides confidence score
    
    Parameters:
    - record_ids: If provided, only runs for those specific records
    - force_rerun: If True, reruns even for records already processed in Stage 1
    
    Default behavior (no record_ids, force_rerun=False): Runs only for PENDING records.
    """
    try:
        # Get record count for response
        if request.record_ids:
            count = len(request.record_ids)
        else:
            from backend.br_pipeline_models import BRRecordStage, BRPipelineStage
            query = db.query(BRRecordStage).filter(
                BRRecordStage.pipeline_run_id == request.pipeline_run_id
            )
            if not request.force_rerun:
                query = query.filter(BRRecordStage.current_stage == BRPipelineStage.PENDING)
            count = query.count()
        
        # Start in background thread
        start_stage_in_background(
            lambda orch, pid, **kw: orch.run_stage_1(pid, **kw),
            request.pipeline_run_id,
            record_ids=request.record_ids,
            force_rerun=request.force_rerun
        )
        
        rerun_text = " (rerun)" if request.force_rerun else ""
        return StageExecutionResponse(
            pipeline_run_id=request.pipeline_run_id,
            stage="Stage 1: BR Detection + Language Detection",
            records_processed=count,
            message=f"Started{rerun_text} processing ~{count} records in background"
        )
    except Exception as e:
        logger.error(f"Stage 1 execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Stage 1 failed: {str(e)}")


@router.post("/run-stage2", response_model=StageExecutionResponse)
def run_stage_2_individually(
    request: Stage2ExecutionRequest,
    db: Session = Depends(get_db)
):
    """
    Run Stage 2 (Text Restructuring) individually with user choice.
    Returns immediately - processing runs in background.
    
    This stage can either:
    - Restructure text: Consolidates MCQ text into clean format (skip_restructure=False)
    - Keep original: Skips restructuring if text is already contextualized (skip_restructure=True)
    
    IMPORTANT: Original language is ALWAYS preserved - no translation occurs.
    
    Parameters:
    - skip_restructure: Choose whether to restructure or keep original
    - record_ids: If provided, only runs for those specific records
    - force_rerun: If True, reruns even for records already processed in Stage 2
    
    Default behavior (no record_ids, force_rerun=False): Runs only for records that completed Stage 1.
    """
    try:
        # Get record count for response
        if request.record_ids:
            count = len(request.record_ids)
        else:
            from backend.br_pipeline_models import BRRecordStage, BRPipelineStage
            query = db.query(BRRecordStage).filter(
                BRRecordStage.pipeline_run_id == request.pipeline_run_id
            )
            if not request.force_rerun:
                query = query.filter(BRRecordStage.current_stage == BRPipelineStage.BR_DETECTION)
            count = query.count()
        
        # Start in background thread
        start_stage_in_background(
            lambda orch, pid, **kw: orch.run_stage_2(pid, **kw),
            request.pipeline_run_id,
            record_ids=request.record_ids,
            skip_restructure=request.skip_restructure,
            force_rerun=request.force_rerun
        )
        
        action = "Skipping restructure" if request.skip_restructure else "Restructuring text"
        rerun_text = " (rerun)" if request.force_rerun else ""
        
        return StageExecutionResponse(
            pipeline_run_id=request.pipeline_run_id,
            stage="Stage 2: Text Restructuring",
            records_processed=count,
            message=f"Started{rerun_text} {action} for ~{count} records in background"
        )
    except Exception as e:
        logger.error(f"Stage 2 execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Stage 2 failed: {str(e)}")


@router.post("/run-stage3")
def run_stage_3_individually(
    request: StageExecutionRequest,
    db: Session = Depends(get_db)
):
    """
    Run Stage 3 (Question Generation in Bahasa Rojak) individually.
    Returns immediately - processing runs in background via Celery.
    
    This stage generates 3 questions in BAHASA ROJAK style:
    - Questions are generated in reverse (from the text/responses)
    - Uses Malay-English code-mixing
    - Includes slang and shortforms
    
    Parameters:
    - record_ids: Optional specific records (currently not strictly supported by the batch Celery task but included for API signature compatibility)
    - force_rerun: Optional
    """
    try:
        from backend.br_pipeline_tasks import batch_generate_questions_task
        task = batch_generate_questions_task.delay(request.pipeline_run_id)
        
        return {
            "pipeline_run_id": request.pipeline_run_id,
            "stage": "Stage 3: Question Generation (Bahasa Rojak)",
            "task_id": task.id,
            "message": f"Started generating Bahasa Rojak questions in background task {task.id}"
        }
    except Exception as e:
        logger.error(f"Stage 3 execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Stage 3 failed: {str(e)}")


@router.get("/pending-validation", response_model=List[RecordStageResponse])
def get_pending_validation_records(
    pipeline_run_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db)
):
    """
    Get records awaiting human validation (need to pick 1 of 3 questions).
    """
    query = db.query(BRRecordStage).filter(
        BRRecordStage.current_stage == BRPipelineStage.QUESTION_GENERATION,
        BRRecordStage.selected_question_index == None
    )
    
    if pipeline_run_id:
        query = query.filter(BRRecordStage.pipeline_run_id == pipeline_run_id)
    
    record_stages = query.limit(limit).all()
    
    return [
        RecordStageResponse(
            id=rs.id,
            text_record_id=rs.text_record_id,
            current_stage=rs.current_stage.value,
            is_bahasa_rojak=rs.is_bahasa_rojak,
            br_confidence=rs.br_confidence,
            detected_language=rs.detected_language,
            restructured_text=rs.restructured_text,
            generated_questions=rs.generated_questions,
            selected_question_index=rs.selected_question_index,
            selected_question=rs.selected_question,
            model_responses=rs.model_responses,
            completed=rs.completed
        )
        for rs in record_stages
    ]


@router.post("/validate/{record_stage_id}")
async def validate_question_selection(
    record_stage_id: int,
    request: QuestionSelectionRequest,
    db: Session = Depends(get_db)
):
    """
    Human selects one of the 3 generated questions.
    This triggers model response generation for the selected question.
    """
    orchestrator = BRPipelineOrchestrator(db)
    
    try:
        await orchestrator.select_question(
            record_stage_id,
            request.question_index,
            request.validated_by
        )
        
        return {"status": "success", "message": "Question selected and model responses generated"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to validate: {str(e)}")


@router.get("/record/{record_stage_id}", response_model=RecordStageResponse)
def get_record_stage(
    record_stage_id: int,
    db: Session = Depends(get_db)
):
    """Get detailed information about a specific record's pipeline stage."""
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    return RecordStageResponse(
        id=record_stage.id,
        text_record_id=record_stage.text_record_id,
        current_stage=record_stage.current_stage.value,
        is_bahasa_rojak=record_stage.is_bahasa_rojak,
        br_confidence=record_stage.br_confidence,
        detected_language=record_stage.detected_language,
        restructured_text=record_stage.restructured_text,
        generated_questions=record_stage.generated_questions,
        selected_question_index=record_stage.selected_question_index,
        selected_question=record_stage.selected_question,
        model_responses=record_stage.model_responses,
        completed=record_stage.completed
    )


@router.get("/results/{pipeline_run_id}")
def get_pipeline_results(
    pipeline_run_id: int,
    db: Session = Depends(get_db)
):
    """
    Get all completed results for a pipeline run.
    Returns: Question | Restructured Text | Model Responses | Problems
    """
    record_stages = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.completed == True
    ).all()
    
    results = []
    for rs in record_stages:
        result = {
            "record_id": rs.text_record_id,
            "is_bahasa_rojak": rs.is_bahasa_rojak,
            "restructured_text": rs.restructured_text,
            "selected_question": rs.selected_question,
            "model_responses": []
        }
        
        if rs.model_responses:
            for model_name, data in rs.model_responses.items():
                result["model_responses"].append({
                    "model": model_name,
                    "model_id": data.get("model_id"),
                    "response": data.get("response"),
                    "problems": data.get("problems", [])
                })
        
        results.append(result)
    
    return {
        "pipeline_run_id": pipeline_run_id,
        "total_results": len(results),
        "results": results
    }


# ===== Model Configuration Endpoints =====

@router.post("/models", response_model=dict)
def create_model_config(
    config: ModelConfigCreate,
    db: Session = Depends(get_db)
):
    """Add a new base model configuration for response generation."""
    model_config = ModelConfig(
        name=config.name,
        model_type=config.model_type,
        model_id=config.model_id,
        api_endpoint=config.api_endpoint,
        api_key_env_var=config.api_key_env_var,
        parameters=config.parameters,
        is_active=config.is_active
    )
    
    db.add(model_config)
    db.commit()
    db.refresh(model_config)
    
    return {"id": model_config.id, "name": model_config.name, "message": "Model config created"}


@router.get("/models")
def list_model_configs(db: Session = Depends(get_db)):
    """List all configured base models."""
    models = db.query(ModelConfig).all()
    
    return {
        "models": [
            {
                "id": m.id,
                "name": m.name,
                "model_type": m.model_type,
                "model_id": m.model_id,
                "is_active": m.is_active
            }
            for m in models
        ]
    }


@router.patch("/models/{model_id}/toggle")
def toggle_model_active(
    model_id: int,
    db: Session = Depends(get_db)
):
    """Enable/disable a model."""
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    model.is_active = not model.is_active
    db.commit()
    
    return {"id": model.id, "name": model.name, "is_active": model.is_active}


# ===== BR Classification Endpoints =====

@router.get("/classification/{pipeline_run_id}", response_model=ClassificationListResponse)
def get_classification_records(
    pipeline_run_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(15, ge=1, le=100),
    is_bahasa_rojak: Optional[str] = Query(None, description="Filter: 'true', 'false', or 'unclassified'"),
    db: Session = Depends(get_db)
):
    """
    Get BR classification records with pagination for review/editing.
    Returns 15 records per page by default.
    Optionally filter by is_bahasa_rojak status.
    """
    # Check pipeline exists
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Base query with optional filter
    base_query = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id
    )
    
    if is_bahasa_rojak == 'true':
        base_query = base_query.filter(BRRecordStage.is_bahasa_rojak == True)
    elif is_bahasa_rojak == 'false':
        base_query = base_query.filter(BRRecordStage.is_bahasa_rojak == False)
    elif is_bahasa_rojak == 'unclassified':
        base_query = base_query.filter(BRRecordStage.is_bahasa_rojak == None)
    
    # Get total count (filtered)
    total = base_query.count()
    
    # Count classified (those with is_bahasa_rojak set) - always unfiltered for stats
    classified_count = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak != None
    ).count()
    
    # Get paginated records with text
    offset = (page - 1) * per_page
    record_stages = base_query.offset(offset).limit(per_page).all()
    
    # Get original texts for these records
    text_record_ids = [rs.text_record_id for rs in record_stages]
    text_records = db.query(TextRecord).filter(TextRecord.id.in_(text_record_ids)).all()
    text_map = {tr.id: tr.original_text for tr in text_records}
    
    records = [
        ClassificationRecordResponse(
            id=rs.id,
            text_record_id=rs.text_record_id,
            original_text=text_map.get(rs.text_record_id, ""),
            is_bahasa_rojak=rs.is_bahasa_rojak,
            detected_language=rs.detected_language,
            br_confidence=rs.br_confidence,
            current_stage=rs.current_stage.value
        )
        for rs in record_stages
    ]
    
    total_pages = (total + per_page - 1) // per_page
    
    return ClassificationListResponse(
        records=records,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
        classified_count=classified_count
    )


@router.patch("/classification/{record_stage_id}")
def update_classification(
    record_stage_id: int,
    request: ClassificationUpdateRequest,
    db: Session = Depends(get_db)
):
    """
    Update BR classification and/or detected language for a record.
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if request.is_bahasa_rojak is not None:
        record_stage.is_bahasa_rojak = request.is_bahasa_rojak
    
    if request.detected_language is not None:
        record_stage.detected_language = request.detected_language
    
    db.commit()
    db.refresh(record_stage)
    
    return {
        "id": record_stage.id,
        "is_bahasa_rojak": record_stage.is_bahasa_rojak,
        "detected_language": record_stage.detected_language,
        "message": "Classification updated"
    }


@router.delete("/classification/{record_stage_id}")
def delete_classification_record(
    record_stage_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete a BR classification record (and its underlying text record).
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    text_record_id = record_stage.text_record_id
    
    # Delete the record stage
    db.delete(record_stage)
    
    # Also delete the underlying text record
    text_record = db.query(TextRecord).filter(TextRecord.id == text_record_id).first()
    if text_record:
        db.delete(text_record)
    
    # Update pipeline total
    pipeline_run = db.query(BRPipelineRun).filter(
        BRPipelineRun.id == record_stage.pipeline_run_id
    ).first()
    if pipeline_run and pipeline_run.total_records > 0:
        pipeline_run.total_records -= 1
    
    db.commit()
    
    return {"message": "Record deleted", "deleted_id": record_stage_id}


@router.get("/pipelines")
def list_pipeline_runs(
    dataset_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """List all pipeline runs, optionally filtered by dataset."""
    from backend.models import TextDataset
    
    query = db.query(BRPipelineRun)
    
    if dataset_id:
        query = query.filter(BRPipelineRun.dataset_id == dataset_id)
    
    pipeline_runs = query.order_by(BRPipelineRun.created_at.desc()).all()
    
    result = []
    for pr in pipeline_runs:
        # Get dataset name
        dataset = db.query(TextDataset).filter(TextDataset.id == pr.dataset_id).first()
        dataset_name = dataset.name if dataset else f"Dataset #{pr.dataset_id}"
        
        # Calculate stage progress
        records = db.query(BRRecordStage).filter(BRRecordStage.pipeline_run_id == pr.id).all()
        
        # Count records at each stage
        stage_1_done = sum(1 for r in records if r.is_bahasa_rojak is not None)  # Classification done
        stage_2_done = sum(1 for r in records if r.restructured_text is not None)  # Restructure done
        stage_3_done = sum(1 for r in records if r.selected_question is not None)  # Question selected
        stage_4_done = sum(1 for r in records if r.model_responses is not None)  # Responses generated
        
        # Determine current stage (1-4) based on progress
        total = pr.total_records or len(records) or 1
        if stage_4_done == total:
            current_stage_num = 4  # All done
        elif stage_3_done > 0 or stage_2_done == total:
            current_stage_num = 3 if stage_2_done == total else 2
        elif stage_2_done > 0 or stage_1_done == total:
            current_stage_num = 2 if stage_1_done == total else 1
        else:
            current_stage_num = 1
        
        result.append({
            "id": pr.id,
            "dataset_id": pr.dataset_id,
            "dataset_name": dataset_name,
            "total_records": pr.total_records,
            "processed_records": pr.processed_records,
            "pending_validation": pr.pending_validation,
            "current_stage": pr.current_stage.value,
            "current_stage_num": current_stage_num,
            "status": pr.status,
            "created_at": pr.created_at.isoformat() if pr.created_at else None,
            "stage_progress": {
                "stage_1": {"done": stage_1_done, "total": total, "label": "Classification"},
                "stage_2": {"done": stage_2_done, "total": total, "label": "Restructure"},
                "stage_3": {"done": stage_3_done, "total": total, "label": "Questions"},
                "stage_4": {"done": stage_4_done, "total": total, "label": "Responses"}
            }
        })
    
    return {"pipelines": result}


# ===== Stage 2: Restructure Endpoints =====

@router.get("/restructure/{pipeline_run_id}", response_model=RestructureListResponse)
def get_restructure_records(
    pipeline_run_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    status: str = Query("all", description="Filter: all, pending, completed"),
    db: Session = Depends(get_db)
):
    """Get records for text restructuring with pagination. Only shows Bahasa Rojak records."""
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Only count/show records classified as Bahasa Rojak
    if status == "discarded":
        base_filter = db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.is_bahasa_rojak == True,
            BRRecordStage.is_discarded == True
        )
    else:
        base_filter = db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.is_bahasa_rojak == True,
            BRRecordStage.is_discarded == False
        )
    
    total = base_filter.count()
    
    restructured_count = base_filter.filter(
        BRRecordStage.restructured_text != None
    ).count()
    
    # Apply status filter for pagination query
    page_filter = base_filter
    if status == "pending":
        page_filter = base_filter.filter(BRRecordStage.restructured_text == None)
    elif status == "completed":
        page_filter = base_filter.filter(BRRecordStage.restructured_text != None)
    
    filtered_total = page_filter.count()
    offset = (page - 1) * per_page
    record_stages = page_filter.order_by(BRRecordStage.id).offset(offset).limit(per_page).all()
    
    text_record_ids = [rs.text_record_id for rs in record_stages]
    text_records = db.query(TextRecord).filter(TextRecord.id.in_(text_record_ids)).all()
    text_map = {tr.id: tr.original_text for tr in text_records}
    
    records = [
        RestructureRecordResponse(
            id=rs.id,
            text_record_id=rs.text_record_id,
            original_text=text_map.get(rs.text_record_id, ""),
            restructured_text=rs.restructured_text,
            was_restructured=rs.restructured_text is not None,
            is_bahasa_rojak=rs.is_bahasa_rojak,
            detected_language=rs.detected_language,
            is_discarded=rs.is_discarded
        )
        for rs in record_stages
    ]
    
    total_pages = max(1, (filtered_total + per_page - 1) // per_page)
    
    return RestructureListResponse(
        records=records,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
        restructured_count=restructured_count
    )


@router.get("/restructure/{pipeline_run_id}/export-csv")
def export_restructure_csv(
    pipeline_run_id: int,
    db: Session = Depends(get_db)
):
    """
    Export restructured text records as CSV.
    Only includes non-discarded records classified as Bahasa Rojak.
    """
    import csv
    import io
    from fastapi.responses import StreamingResponse

    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Get relevant records
    record_stages = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True,
        BRRecordStage.is_discarded == False
    ).order_by(BRRecordStage.id).all()
    
    # Fetch original text
    text_record_ids = [rs.text_record_id for rs in record_stages]
    text_records = db.query(TextRecord).filter(TextRecord.id.in_(text_record_ids)).all()
    text_map = {tr.id: tr.original_text for tr in text_records}
    
    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['record_id', 'original_text', 'restructured_text'])
    
    for rs in record_stages:
        orig = text_map.get(rs.text_record_id, "")
        rest = rs.restructured_text if rs.restructured_text else ""
        writer.writerow([rs.id, orig, rest])
    
    # Create streaming response
    buffer = io.BytesIO(output.getvalue().encode('utf-8'))
    
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=pipeline_{pipeline_run_id}_restructure.csv"
        }
    )


@router.get("/restructure/{pipeline_run_id}/search")
def search_restructure_records(
    pipeline_run_id: int,
    q: str = Query(..., min_length=1, description="Text to search for in original or restructured text"),
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Full-text search across original_text and restructured_text for a pipeline run.
    Returns matching records with their global position (for page-jump navigation).
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    search_term = f"%{q}%"

    # All active BR records for position calculation (ordered same as main listing)
    all_active = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True,
        BRRecordStage.is_discarded == False,
    ).order_by(BRRecordStage.id).all()

    id_to_position = {rs.id: idx + 1 for idx, rs in enumerate(all_active)}  # 1-based

    # Search query (join with TextRecord for original_text)
    matching_stages = db.query(BRRecordStage).join(
        TextRecord, TextRecord.id == BRRecordStage.text_record_id
    ).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True,
        BRRecordStage.is_discarded == False,
    ).filter(
        TextRecord.original_text.ilike(search_term) |
        BRRecordStage.restructured_text.ilike(search_term)
    ).order_by(BRRecordStage.id).all()

    total = len(matching_stages)
    offset = (page - 1) * per_page
    page_results = matching_stages[offset: offset + per_page]

    text_record_ids = [rs.text_record_id for rs in page_results]
    text_records = db.query(TextRecord).filter(TextRecord.id.in_(text_record_ids)).all()
    text_map = {tr.id: tr.original_text for tr in text_records}

    perPage = 10  # must match frontend perPage so page/card index are accurate
    results = []
    for rs in page_results:
        position = id_to_position.get(rs.id, 0)  # global 1-based position
        target_page = max(1, (position - 1) // perPage + 1)
        card_index = (position - 1) % perPage
        results.append({
            "id": rs.id,
            "text_record_id": rs.text_record_id,
            "original_text": text_map.get(rs.text_record_id, ""),
            "restructured_text": rs.restructured_text,
            "was_restructured": rs.restructured_text is not None,
            "detected_language": rs.detected_language,
            "is_discarded": rs.is_discarded,
            "global_position": position,
            "target_page": target_page,
            "card_index": card_index,
        })

    total_pages = max(1, (total + per_page - 1) // per_page)

    return {
        "results": results,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "query": q,
    }


@router.patch("/restructure/{record_stage_id}")
def update_restructured_text(
    record_stage_id: int,
    request: RestructureUpdateRequest,
    db: Session = Depends(get_db)
):
    """Update the restructured text for a record."""
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    from datetime import datetime
    if request.restructured_text is not None:
        record_stage.restructured_text = request.restructured_text
        record_stage.restructured_at = datetime.utcnow()
    
    if request.is_discarded is not None:
        record_stage.is_discarded = request.is_discarded
    
    db.commit()
    
    return {"id": record_stage.id, "message": "Record updated successfully"}


@router.post("/restructure/{record_stage_id}/auto")
async def auto_restructure_text(
    record_stage_id: int,
    db: Session = Depends(get_db)
):
    """Auto-restructure text using LLM (placeholder - returns mock data)."""
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    # Get original text
    text_record = db.query(TextRecord).filter(TextRecord.id == record_stage.text_record_id).first()
    if not text_record:
        raise HTTPException(status_code=404, detail="Text record not found")
    
    # TODO: Call LLM to restructure text
    # For now, return a placeholder
    restructured = f"[Restructured] {text_record.original_text}"
    
    from datetime import datetime
    record_stage.restructured_text = restructured
    record_stage.restructured_at = datetime.utcnow()
    
    db.commit()
    
    return {"id": record_stage.id, "restructured_text": restructured}




@router.post("/restructure/merge")
def merge_restructure_records(
    request: MergeRecordsRequest,
    db: Session = Depends(get_db)
):
    """
    Merge/concatenate multiple BR record texts into the first record.
    The first record_id becomes the merged record, others are marked as merged.
    Preserves original text in all records - only updates restructured_text.
    """
    if len(request.record_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 records to merge")
    
    # Fetch all records in order
    records = []
    for rid in request.record_ids:
        rs = db.query(BRRecordStage).filter(BRRecordStage.id == rid).first()
        if not rs:
            raise HTTPException(status_code=404, detail=f"Record {rid} not found")
        records.append(rs)
    
    # Get original texts in order
    texts = []
    for rs in records:
        text_record = db.query(TextRecord).filter(TextRecord.id == rs.text_record_id).first()
        if text_record:
            texts.append(text_record.original_text)
    
    # Merge texts into the first record's restructured_text
    merged_text = request.separator.join(texts)
    
    from datetime import datetime
    target = records[0]
    target.restructured_text = merged_text
    target.restructured_at = datetime.utcnow()
    target.skip_restructure = True
    target.restructure_metadata = {
        "action": "manual_merge",
        "merged_from": request.record_ids,
        "record_count": len(request.record_ids)
    }
    target.current_stage = BRPipelineStage.TEXT_RESTRUCTURE
    
    # Mark other records as merged (set restructured_text to indicate they're merged into the target)
    for rs in records[1:]:
        rs.restructured_text = f"[MERGED into record #{target.id}]"
        rs.restructured_at = datetime.utcnow()
        rs.skip_restructure = True
        rs.restructure_metadata = {
            "action": "merged_into",
            "target_record_id": target.id
        }
        rs.current_stage = BRPipelineStage.TEXT_RESTRUCTURE
    
    db.commit()
    
    return {
        "message": f"Merged {len(records)} records into record #{target.id}",
        "target_id": target.id,
        "merged_text": merged_text,
        "merged_count": len(records)
    }


# ===== Stage Progress Endpoint =====

@router.get("/stage-progress/{pipeline_run_id}")
def get_stage_progress(
    pipeline_run_id: int,
    db: Session = Depends(get_db)
):
    """
    Get detailed progress for each stage of a pipeline run.
    Useful for polling while background processing is running.
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    total = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id
    ).count()
    
    br_count = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True
    ).count()
    
    stage1_done = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak != None
    ).count()
    
    lang_detected = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.detected_language != None
    ).count()
    
    stage2_done = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.restructured_text != None
    ).count()
    
    stage3_done = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.generated_questions != None
    ).count()
    
    return {
        "pipeline_id": pipeline_run_id,
        "status": pipeline_run.status,
        "error_message": pipeline_run.error_message,
        "total_records": total,
        "bahasa_rojak_count": br_count,
        "stage1_classified": stage1_done,
        "stage1_language_detected": lang_detected,
        "stage2_restructured": stage2_done,
        "stage3_questions_generated": stage3_done
    }


# ===== Stage 3: Question Generation Endpoints =====

@router.get("/questions/{pipeline_run_id}", response_model=QuestionListResponse)
def get_question_records(
    pipeline_run_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    status: str = Query("all", description="Filter: all, pending, completed"),
    db: Session = Depends(get_db)
):
    """Get records for question validation with pagination.
    Only returns Bahasa Rojak records that have restructured text from Stage 2.
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Only count BR records with restructured text (from Stage 2), excluding merged and discarded records
    base_filter = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True,
        BRRecordStage.is_discarded == False,
        BRRecordStage.restructured_text != None,
        ~BRRecordStage.restructured_text.like("[MERGED into record #%]")
    )
    
    total = base_filter.count()
    
    validated_count = base_filter.filter(
        BRRecordStage.selected_question_index != None
    ).count()
    
    # Apply status filter for pagination query
    page_filter = base_filter
    if status == "pending":
        page_filter = base_filter.filter(BRRecordStage.selected_question_index == None)
    elif status == "completed":
        page_filter = base_filter.filter(BRRecordStage.selected_question_index != None)
    
    filtered_total = page_filter.count()
    offset = (page - 1) * per_page
    record_stages = page_filter.order_by(BRRecordStage.id).offset(offset).limit(per_page).all()
    
    # Fetch original text from TextRecord for each record
    records = []
    for rs in record_stages:
        text_record = db.query(TextRecord).filter(TextRecord.id == rs.text_record_id).first()
        records.append(
            QuestionRecordResponse(
                id=rs.id,
                text_record_id=rs.text_record_id,
                original_text=text_record.original_text if text_record else None,
                restructured_text=rs.restructured_text,
                detected_language=rs.detected_language,
                is_bahasa_rojak=rs.is_bahasa_rojak,
                generated_questions=rs.generated_questions,
                selected_question_index=rs.selected_question_index,
                selected_question=rs.selected_question
            )
        )
    
    total_pages = max(1, (filtered_total + per_page - 1) // per_page)
    
    return QuestionListResponse(
        records=records,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
        validated_count=validated_count
    )


@router.post("/questions/{record_stage_id}/generate")
def generate_questions(
    record_stage_id: int,
    db: Session = Depends(get_db)
):
    """
    Dispatch question generation to Celery worker.
    Returns task_id immediately — poll /task-status/{task_id} for results.
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if not record_stage.restructured_text:
        raise HTTPException(status_code=400, detail="Text must be restructured first")
    
    from backend.br_pipeline_tasks import generate_questions_task
    task = generate_questions_task.delay(record_stage_id)
    
    return {"id": record_stage_id, "task_id": task.id, "status": "queued"}


@router.post("/questions/{record_stage_id}/select")
def select_question(
    record_stage_id: int,
    request: QuestionSelectRequest,
    db: Session = Depends(get_db)
):
    """Human selects one of the 3 generated questions."""
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if not record_stage.generated_questions or len(record_stage.generated_questions) == 0:
        raise HTTPException(status_code=400, detail="No questions generated yet")
    
    if request.question_index < 0 or request.question_index >= len(record_stage.generated_questions):
        raise HTTPException(status_code=400, detail="Invalid question index")
    
    from datetime import datetime
    record_stage.selected_question_index = request.question_index
    record_stage.selected_question = record_stage.generated_questions[request.question_index]
    record_stage.validated_by = request.validated_by
    record_stage.validated_at = datetime.utcnow()
    
    db.commit()
    
    return {
        "id": record_stage.id,
        "selected_question_index": record_stage.selected_question_index,
        "selected_question": record_stage.selected_question,
        "message": "Question selected"
    }


# ===== Stage 4: Model Response Endpoints =====

@router.get("/responses/{pipeline_run_id}", response_model=ResponseListResponse)
def get_response_records(
    pipeline_run_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    status: str = Query("all", description="Filter: all, pending, completed"),
    db: Session = Depends(get_db)
):
    """Get records with selected questions for response generation."""
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Only show records with selected questions
    base_query = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.selected_question != None
    )
    
    total = base_query.count()
    
    completed_count = base_query.filter(
        BRRecordStage.completed == True
    ).count()
    
    # Apply status filter for pagination query
    page_filter = base_query
    if status == "pending":
        page_filter = base_query.filter(BRRecordStage.completed == False)
    elif status == "completed":
        page_filter = base_query.filter(BRRecordStage.completed == True)
    
    filtered_total = page_filter.count()
    offset = (page - 1) * per_page
    record_stages = page_filter.order_by(BRRecordStage.id).offset(offset).limit(per_page).all()
    
    records = [
        ResponseRecordResponse(
            id=rs.id,
            text_record_id=rs.text_record_id,
            restructured_text=rs.restructured_text,
            selected_question=rs.selected_question,
            model_responses=rs.model_responses,
            completed=rs.completed
        )
        for rs in record_stages
    ]
    
    total_pages = max(1, (filtered_total + per_page - 1) // per_page)
    
    # Get dataset info
    from backend.models import TextDataset
    dataset = db.query(TextDataset).filter(TextDataset.id == pipeline_run.dataset_id).first()
    dataset_name = dataset.name if dataset else "unknown"
    
    return ResponseListResponse(
        records=records,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
        completed_count=completed_count,
        pipeline_id=pipeline_run_id,
        dataset_id=pipeline_run.dataset_id,
        dataset_name=dataset_name
    )


@router.post("/responses/{record_stage_id}/generate")
def generate_model_responses(
    record_stage_id: int,
    body: SingleGenerateRequest = None,
    db: Session = Depends(get_db)
):
    """
    Dispatch model response generation to Celery worker.
    Returns task_id immediately — poll /task-status/{task_id} for results.
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if not record_stage.selected_question:
        raise HTTPException(status_code=400, detail="No question selected yet")
    
    context = record_stage.restructured_text or ""
    if not context:
        raise HTTPException(status_code=400, detail="No context available for response generation")
    
    # Build model configs
    if body and body.models:
        model_configs = [[m.name, m.model_id] for m in body.models]
    else:
        model_configs = [
            ["Model-A (Gemma3:4b)", "gemma3:4b"],
            ["Model-B (Gemma3:4b)", "gemma3:4b"],
            ["Model-C (Gemma3:4b)", "gemma3:4b"],
        ]
    
    from backend.br_pipeline_tasks import generate_responses_task
    task = generate_responses_task.delay(record_stage_id, model_configs)
    
    return {"id": record_stage_id, "task_id": task.id, "status": "queued"}


@router.post("/responses/{pipeline_run_id}/generate-all")
def batch_generate_model_responses(
    pipeline_run_id: int,
    body: BatchGenerateRequest,
    db: Session = Depends(get_db)
):
    """
    Dispatch batch response generation to Celery worker.
    Returns task_id immediately — poll /task-status/{task_id} for results.
    """
    if len(body.models) != 3:
        raise HTTPException(status_code=400, detail="Exactly 3 models must be provided")
    
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Check there are pending records
    pending_count = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.selected_question != None,
        BRRecordStage.completed == False,
    ).count()
    
    if pending_count == 0:
        return {"pipeline_id": pipeline_run_id, "processed": 0, "message": "No pending records"}
    
    model_configs = [[m.name, m.model_id] for m in body.models]
    
    from backend.br_pipeline_tasks import batch_generate_responses_task
    task = batch_generate_responses_task.delay(pipeline_run_id, model_configs)
    
    return {
        "pipeline_id": pipeline_run_id,
        "task_id": task.id,
        "status": "queued",
        "total_pending": pending_count,
        "models_used": [m.name for m in body.models],
        "message": f"Queued batch generation for {pending_count} records using {len(model_configs)} models",
    }


# ===== Task Status Polling Endpoint =====

@router.get("/task-status/{task_id}")
def get_task_status(task_id: str):
    """
    Poll Celery task status by task_id.
    Returns state and result when complete.
    States: PENDING, STARTED, SUCCESS, FAILURE, RETRY
    """
    from backend.celery_app import celery_app as app
    result = app.AsyncResult(task_id)
    
    response = {"task_id": task_id, "state": result.state}
    
    if result.state == "SUCCESS":
        response["result"] = result.result
    elif result.state == "FAILURE":
        response["error"] = str(result.result)
    
    return response


@router.post("/responses/{record_stage_id}/edit")
def edit_model_response(
    record_stage_id: int,
    edit_request: ModelResponseEditRequest,
    db: Session = Depends(get_db)
):
    """
    Save edited/corrected model response for problematic outputs.
    
    This allows users to edit model responses that have problems,
    storing the corrected version for future fine-tuning analysis.
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if not record_stage.model_responses:
        raise HTTPException(status_code=400, detail="No model responses available")
    
    # Get current responses
    responses = record_stage.model_responses.copy()
    
    # Check if model exists
    if edit_request.model_name not in responses:
        raise HTTPException(status_code=404, detail=f"Model '{edit_request.model_name}' not found")
    
    # Add corrected response and metadata
    from datetime import datetime
    responses[edit_request.model_name]["corrected_response"] = edit_request.corrected_response
    responses[edit_request.model_name]["edited_by"] = edit_request.edited_by
    responses[edit_request.model_name]["edited_at"] = datetime.utcnow().isoformat()
    
    # Update the record
    record_stage.model_responses = responses
    db.commit()
    
    return {
        "message": "Response edited successfully",
        "record_id": record_stage_id,
        "model_name": edit_request.model_name,
        "updated_response": responses[edit_request.model_name]
    }


@router.post("/responses/{record_stage_id}/edit-problems")
def edit_model_problems(
    record_stage_id: int,
    edit_request: ModelProblemsEditRequest,
    db: Session = Depends(get_db)
):
    """
    Edit the problems identified in a model response.
    
    This allows users to manually define or update the problems for any model response,
    which will be used for fine-tuning analysis.
    """
    record_stage = db.query(BRRecordStage).filter(BRRecordStage.id == record_stage_id).first()
    
    if not record_stage:
        raise HTTPException(status_code=404, detail="Record stage not found")
    
    if not record_stage.model_responses:
        raise HTTPException(status_code=400, detail="No model responses available")
    
    # Get current responses
    responses = record_stage.model_responses.copy()
    
    # Check if model exists
    if edit_request.model_name not in responses:
        raise HTTPException(status_code=404, detail=f"Model '{edit_request.model_name}' not found")
    
    # Update problems and metadata
    from datetime import datetime
    responses[edit_request.model_name]["problems"] = edit_request.problems
    responses[edit_request.model_name]["edited_by"] = edit_request.edited_by
    responses[edit_request.model_name]["edited_at"] = datetime.utcnow().isoformat()
    
    # Update the record
    record_stage.model_responses = responses
    db.commit()
    
    return {
        "message": "Problems updated successfully",
        "record_id": record_stage_id,
        "model_name": edit_request.model_name,
        "updated_response": responses[edit_request.model_name]
    }


@router.post("/questions/{pipeline_run_id}/generate-all")
def batch_generate_questions(
    pipeline_run_id: int,
    db: Session = Depends(get_db)
):
    """
    Dispatch batch question generation to Celery worker.
    Generates questions for all records in the pipeline run that:
    - are Bahasa Rojak
    - have restructured_text
    - are not discarded
    - have no generated questions yet
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
        
    from backend.br_pipeline_tasks import batch_generate_questions_task
    task = batch_generate_questions_task.delay(pipeline_run_id)
    
    return {
        "pipeline_id": pipeline_run_id,
        "task_id": task.id,
        "status": "queued",
        "message": "Batch question generation queued"
    }


@router.get("/questions/{pipeline_run_id}/export-jsonl")
def export_questions_jsonl(
    pipeline_run_id: int,
    limit: int = Query(None, ge=1, description="Max number of records to export (all if omitted)"),
    db: Session = Depends(get_db)
):
    """
    Export validated question records as JSONL for fine-tuning.
    
    Only includes records where a question has been selected (validated).
    Each line is a JSON object:
    {"id": 1, "conversations": [{"role": "user", "content": "<question>"}, {"role": "assistant", "content": "<restructured_text>"}]}
    """
    import json
    from fastapi.responses import StreamingResponse
    import io

    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    # Get validated, non-discarded records (those with a selected question)
    query = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.is_bahasa_rojak == True,
        BRRecordStage.is_discarded == False,
        BRRecordStage.selected_question != None,
        BRRecordStage.restructured_text != None,
    ).order_by(BRRecordStage.id)
    if limit is not None:
        query = query.limit(limit)
    records = query.all()
    
    # Build JSONL content
    lines = []
    for idx, record in enumerate(records, start=1):
        entry = {
            "id": idx,
            "conversations": [
                {"role": "user", "content": record.selected_question},
                {"role": "assistant", "content": record.restructured_text},
            ]
        }
        lines.append(json.dumps(entry, ensure_ascii=False))
    
    content = "\n".join(lines)
    if content:
        content += "\n"
    
    buffer = io.BytesIO(content.encode("utf-8"))
    
    return StreamingResponse(
        buffer,
        media_type="application/x-ndjson",
        headers={
            "Content-Disposition": f"attachment; filename=pipeline_{pipeline_run_id}_questions.jsonl"
        }
    )


# ===== System Prompt Endpoints =====

@router.get("/system-prompt/{pipeline_run_id}", response_model=SystemPromptResponse)
def get_system_prompt(pipeline_run_id: int, db: Session = Depends(get_db)):
    """
    Get the effective system prompt for a pipeline run.
    Returns the per-pipeline override if set, otherwise the global default.
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    from backend.routes.settings import load_settings
    if pipeline_run.system_prompt:
        return SystemPromptResponse(
            pipeline_run_id=pipeline_run_id,
            system_prompt=pipeline_run.system_prompt,
            source="pipeline_override",
        )
    settings = load_settings()
    return SystemPromptResponse(
        pipeline_run_id=pipeline_run_id,
        system_prompt=settings["response_system_prompt"],
        source="global_default",
    )


@router.put("/system-prompt/{pipeline_run_id}", response_model=SystemPromptResponse)
def update_system_prompt(
    pipeline_run_id: int,
    body: SystemPromptUpdate,
    db: Session = Depends(get_db),
):
    """
    Update (or reset) the per-pipeline system prompt.
    Pass system_prompt=null/None to reset to the global default.
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    pipeline_run.system_prompt = body.system_prompt  # None = reset to global
    db.commit()

    from backend.routes.settings import load_settings
    if pipeline_run.system_prompt:
        return SystemPromptResponse(
            pipeline_run_id=pipeline_run_id,
            system_prompt=pipeline_run.system_prompt,
            source="pipeline_override",
        )
    settings = load_settings()
    return SystemPromptResponse(
        pipeline_run_id=pipeline_run_id,
        system_prompt=settings["response_system_prompt"],
        source="global_default",
    )


# ===== Search Endpoint =====

@router.get("/responses/{pipeline_run_id}/search")
def search_br_responses(
    pipeline_run_id: int,
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    Full-text search across selected_question and model_responses for a pipeline run.
    """
    from sqlalchemy import cast, String

    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    query = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
    ).filter(
        BRRecordStage.selected_question.ilike(f"%{q}%") |
        cast(BRRecordStage.model_responses, String).ilike(f"%{q}%")
    )

    total = query.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    offset = (page - 1) * per_page
    records = query.offset(offset).limit(per_page).all()

    from backend.models import TextDataset
    dataset = db.query(TextDataset).filter(TextDataset.id == pipeline_run.dataset_id).first()

    completed_count = sum(1 for r in records if r.completed)
    return {
        "records": [
            {
                "id": r.id,
                "text_record_id": r.text_record_id,
                "restructured_text": r.restructured_text,
                "selected_question": r.selected_question,
                "model_responses": r.model_responses,
                "completed": r.completed,
            }
            for r in records
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "completed_count": completed_count,
        "pipeline_id": pipeline_run_id,
        "dataset_id": pipeline_run.dataset_id,
        "dataset_name": dataset.name if dataset else "",
    }


# ===== Similarity Detection Endpoint =====

@router.get("/responses/{pipeline_run_id}/similarity")
def detect_response_similarity(
    pipeline_run_id: int,
    threshold_high: float = Query(0.85, ge=0.0, le=1.0),
    threshold_low: float = Query(0.15, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """
    Detect overtrained (too similar) and undertrained (too dissimilar) response pairs.
    Uses Jaccard word-level similarity.
    """
    pipeline_run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not pipeline_run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    completed_records = db.query(BRRecordStage).filter(
        BRRecordStage.pipeline_run_id == pipeline_run_id,
        BRRecordStage.model_responses != None,
        BRRecordStage.completed == True,
    ).all()

    if len(completed_records) < 2:
        return SimilarityResponse(
            overtrain_candidates=[], undertrain_candidates=[], total_comparisons=0
        )

    from backend.similarity import jaccard_similarity

    # Collect (record_id, model_name, response_text) tuples
    entries = []
    for rs in completed_records:
        if not rs.model_responses:
            continue
        for model_name, data in rs.model_responses.items():
            text = data.get("response", "") if isinstance(data, dict) else ""
            if text and not text.startswith("Error:"):
                entries.append((rs.id, model_name, text))

    overtrain = []
    undertrain = []
    total_comparisons = 0

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            id_a, model_a, text_a = entries[i]
            id_b, model_b, text_b = entries[j]
            if model_a != model_b:
                continue
            sim = jaccard_similarity(text_a, text_b)
            total_comparisons += 1
            pair = SimilarityPair(
                record_id_a=id_a,
                record_id_b=id_b,
                model_name=model_a,
                similarity=round(sim, 4),
                response_a=text_a[:300],
                response_b=text_b[:300],
            )
            if sim >= threshold_high:
                overtrain.append(pair)
            elif sim <= threshold_low:
                undertrain.append(pair)

    # Sort by similarity descending for overtrain, ascending for undertrain
    overtrain.sort(key=lambda x: x.similarity, reverse=True)
    undertrain.sort(key=lambda x: x.similarity)

    return SimilarityResponse(
        overtrain_candidates=overtrain[:50],
        undertrain_candidates=undertrain[:50],
        total_comparisons=total_comparisons,
    )
