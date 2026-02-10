"""
BR Pipeline API Endpoints
Handles automated Bahasa Rojak detection and question generation pipeline
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from backend.database import get_db
from backend.br_pipeline_orchestrator import BRPipelineOrchestrator
from backend.br_pipeline_models import BRPipelineRun, BRRecordStage, BRPipelineStage, ModelConfig


router = APIRouter(prefix="/api/br-pipeline", tags=["BR Pipeline"])


# ===== Pydantic Schemas =====

class PipelineStartRequest(BaseModel):
    dataset_id: int


class PipelineRunResponse(BaseModel):
    id: int
    dataset_id: int
    total_records: int
    processed_records: int
    pending_validation: int
    current_stage: str
    status: str
    error_message: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]


class RecordStageResponse(BaseModel):
    id: int
    text_record_id: int
    current_stage: str
    is_bahasa_rojak: Optional[bool]
    br_confidence: Optional[float]
    restructured_text: Optional[str]
    generated_questions: Optional[List[str]]
    selected_question_index: Optional[int]
    selected_question: Optional[str]
    model_responses: Optional[dict]
    completed: bool


class QuestionSelectionRequest(BaseModel):
    question_index: int  # 0, 1, or 2
    validated_by: str


class ModelConfigCreate(BaseModel):
    name: str
    model_type: str
    model_id: str
    api_endpoint: Optional[str] = None
    api_key_env_var: Optional[str] = None
    parameters: Optional[dict] = None
    is_active: bool = True


# ===== API Endpoints =====

@router.post("/start", response_model=PipelineRunResponse)
async def start_pipeline(
    request: PipelineStartRequest,
    db: Session = Depends(get_db)
):
    """
    Start the automated BR pipeline for a text dataset.
    
    Pipeline stages:
    1. BR Detection (automated)
    2. Text Restructuring (automated)
    3. Question Generation (automated) - generates 3 questions per record
    4. Human Validation (manual) - human picks 1 of 3 questions
    5. Model Response Generation (automated) - 3 models respond to selected question
    """
    orchestrator = BRPipelineOrchestrator(db)
    
    try:
        pipeline_run = await orchestrator.start_pipeline(request.dataset_id)
        
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
