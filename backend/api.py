"""FastAPI application and routes."""
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
import pandas as pd
import json

from backend.database import get_db, init_db
from backend.models import (
    Dataset, DataRecord, PipelineRun, ModelResponse, 
    ValidationRecord, PipelineStatus, ValidationResult
)
from backend.schemas import (
    DatasetCreate, DatasetResponse, DataRecordCreate, DataRecordBulkCreate,
    DataRecordResponse, PipelineRunCreate, PipelineRunResponse,
    HumanReviewSubmit, ValidationResponse, PipelineStats, ValidationSummary
)
from pipeline.orchestrator import PipelineOrchestrator

app = FastAPI(
    title="Data Pipeline API",
    description="API for data collection, preprocessing, and validation pipeline",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    init_db()


# --- Dataset Endpoints ---
@app.post("/api/datasets", response_model=DatasetResponse)
def create_dataset(dataset: DatasetCreate, db: Session = Depends(get_db)):
    """Create a new dataset."""
    db_dataset = Dataset(**dataset.model_dump())
    db.add(db_dataset)
    db.commit()
    db.refresh(db_dataset)
    return db_dataset


@app.get("/api/datasets", response_model=List[DatasetResponse])
def list_datasets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """List all datasets."""
    return db.query(Dataset).offset(skip).limit(limit).all()


@app.get("/api/datasets/{dataset_id}", response_model=DatasetResponse)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Get a specific dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Delete a dataset and all its records."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Delete all related records first
    db.query(DataRecord).filter(DataRecord.dataset_id == dataset_id).delete()
    
    # Delete all related pipeline runs and their validations
    runs = db.query(PipelineRun).filter(PipelineRun.dataset_id == dataset_id).all()
    for run in runs:
        db.query(ValidationRecord).filter(ValidationRecord.pipeline_run_id == run.id).delete()
        db.query(ModelResponse).filter(ModelResponse.pipeline_run_id == run.id).delete()
    db.query(PipelineRun).filter(PipelineRun.dataset_id == dataset_id).delete()
    
    # Delete the dataset
    db.delete(dataset)
    db.commit()
    
    return {"message": f"Dataset '{dataset.name}' and all related data deleted successfully"}


@app.post("/api/datasets/{dataset_id}/upload")
async def upload_data_file(
    dataset_id: int,
    file: UploadFile = File(...),
    input_column: Optional[str] = Query(None, description="Column to use as input_text"),
    output_column: Optional[str] = Query(None, description="Column to use as expected_output"),
    auto_convert: bool = Query(True, description="Auto-convert all columns to input_text if no input_column specified"),
    db: Session = Depends(get_db)
):
    """Upload a CSV/JSON file to add records to a dataset.
    
    If input_column is not specified and auto_convert is True, 
    all columns will be combined into input_text as JSON.
    """
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    content = await file.read()
    
    print(f"Received file: {file.filename}, size: {len(content)} bytes")
    
    try:
        if file.filename and file.filename.endswith('.csv'):
            # Try parsing with different options to handle malformed CSVs
            try:
                df = pd.read_csv(pd.io.common.BytesIO(content))
            except Exception:
                # Try with error handling for bad lines
                try:
                    df = pd.read_csv(pd.io.common.BytesIO(content), on_bad_lines='skip')
                except Exception:
                    # Try with different separator detection
                    try:
                        df = pd.read_csv(pd.io.common.BytesIO(content), sep=None, engine='python', on_bad_lines='skip')
                    except Exception as e:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Could not parse CSV file. Error: {str(e)}. Please check the file format."
                        )
        elif file.filename and file.filename.endswith('.json'):
            data = json.loads(content)
            if isinstance(data, list):
                df = pd.DataFrame(data)
            elif isinstance(data, dict) and 'data' in data:
                df = pd.DataFrame(data['data'])
            else:
                df = pd.DataFrame([data])
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported file format: {file.filename}. Use CSV or JSON."
            )
        
        print(f"Parsed DataFrame with columns: {list(df.columns)}")
        
        records_added = 0
        for _, row in df.iterrows():
            # Determine input_text
            if input_column and input_column in df.columns:
                input_text = str(row[input_column])
            elif 'input_text' in df.columns:
                input_text = str(row['input_text'])
            elif auto_convert:
                # Convert entire row to a formatted string
                input_text = json.dumps(row.to_dict(), default=str, ensure_ascii=False)
            else:
                raise HTTPException(
                    status_code=400, 
                    detail=f"No input_column specified. Found columns: {list(df.columns)}"
                )
            
            # Determine expected_output
            expected_output = None
            if output_column and output_column in df.columns:
                expected_output = str(row[output_column])
            elif 'expected_output' in df.columns:
                expected_output = str(row['expected_output'])
            
            record = DataRecord(
                dataset_id=dataset_id,
                input_text=input_text,
                expected_output=expected_output,
                record_metadata=row.to_dict()
            )
            db.add(record)
            records_added += 1
        
        dataset.record_count += records_added
        db.commit()
        
        return {
            "message": f"Successfully added {records_added} records", 
            "total_records": dataset.record_count,
            "columns_found": list(df.columns)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing file: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Error processing file: {str(e)}")


# --- Data Record Endpoints ---
@app.post("/api/datasets/{dataset_id}/records", response_model=DataRecordResponse)
def add_record(dataset_id: int, record: DataRecordCreate, db: Session = Depends(get_db)):
    """Add a single record to a dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    db_record = DataRecord(dataset_id=dataset_id, **record.model_dump())
    db.add(db_record)
    dataset.record_count += 1
    db.commit()
    db.refresh(db_record)
    return db_record


@app.post("/api/datasets/{dataset_id}/records/bulk")
def add_records_bulk(dataset_id: int, data: DataRecordBulkCreate, db: Session = Depends(get_db)):
    """Add multiple records to a dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    records_added = 0
    for record in data.records:
        db_record = DataRecord(dataset_id=dataset_id, **record.model_dump())
        db.add(db_record)
        records_added += 1
    
    dataset.record_count += records_added
    db.commit()
    
    return {"message": f"Successfully added {records_added} records"}


@app.get("/api/datasets/{dataset_id}/records", response_model=List[DataRecordResponse])
def list_records(dataset_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """List records in a dataset."""
    return db.query(DataRecord).filter(DataRecord.dataset_id == dataset_id).offset(skip).limit(limit).all()


@app.get("/api/records/{record_id}", response_model=DataRecordResponse)
def get_record(record_id: int, db: Session = Depends(get_db)):
    """Get a specific record."""
    record = db.query(DataRecord).filter(DataRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@app.put("/api/records/{record_id}", response_model=DataRecordResponse)
def update_record(record_id: int, record_update: DataRecordCreate, db: Session = Depends(get_db)):
    """Update a record."""
    record = db.query(DataRecord).filter(DataRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.input_text = record_update.input_text
    record.expected_output = record_update.expected_output
    record.record_metadata = record_update.record_metadata
    record.is_preprocessed = False  # Reset preprocessing flag on edit
    
    db.commit()
    db.refresh(record)
    return record


@app.delete("/api/records/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    """Delete a record."""
    record = db.query(DataRecord).filter(DataRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    # Update dataset record count
    dataset = db.query(Dataset).filter(Dataset.id == record.dataset_id).first()
    if dataset:
        dataset.record_count = max(0, dataset.record_count - 1)
    
    db.delete(record)
    db.commit()
    
    return {"message": "Record deleted successfully"}


# --- Pipeline Endpoints ---
@app.post("/api/pipeline/run", response_model=PipelineRunResponse)
def start_pipeline(
    run_config: PipelineRunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Start a new pipeline run."""
    dataset = db.query(Dataset).filter(Dataset.id == run_config.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    if dataset.record_count == 0:
        raise HTTPException(status_code=400, detail="Dataset has no records")
    
    # Create pipeline run
    pipeline_run = PipelineRun(
        dataset_id=run_config.dataset_id,
        status=PipelineStatus.PENDING,
        config=run_config.config.model_dump() if run_config.config else None
    )
    db.add(pipeline_run)
    db.commit()
    db.refresh(pipeline_run)
    
    # Run pipeline in background
    background_tasks.add_task(run_pipeline_async, pipeline_run.id)
    
    return pipeline_run


@app.get("/api/pipeline/runs", response_model=List[PipelineRunResponse])
def list_pipeline_runs(
    dataset_id: Optional[int] = None,
    status: Optional[PipelineStatus] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """List pipeline runs with optional filters."""
    query = db.query(PipelineRun)
    if dataset_id:
        query = query.filter(PipelineRun.dataset_id == dataset_id)
    if status:
        query = query.filter(PipelineRun.status == status)
    return query.order_by(PipelineRun.started_at.desc()).offset(skip).limit(limit).all()


@app.get("/api/pipeline/runs/{run_id}", response_model=PipelineRunResponse)
def get_pipeline_run(run_id: int, db: Session = Depends(get_db)):
    """Get details of a specific pipeline run."""
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    return run


@app.post("/api/pipeline/runs/{run_id}/iterate")
def iterate_pipeline(run_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger a new iteration for a failed pipeline run."""
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    
    if run.status not in [PipelineStatus.FAILED, PipelineStatus.HUMAN_REVIEW]:
        raise HTTPException(status_code=400, detail="Can only iterate on failed or reviewed runs")
    
    # Create new iteration
    new_run = PipelineRun(
        dataset_id=run.dataset_id,
        status=PipelineStatus.ITERATING,
        iteration=run.iteration + 1,
        config=run.config
    )
    db.add(new_run)
    db.commit()
    db.refresh(new_run)
    
    background_tasks.add_task(run_pipeline_async, new_run.id)
    
    return {"message": f"Started iteration {new_run.iteration}", "run_id": new_run.id}


# --- Validation Endpoints ---
@app.get("/api/pipeline/runs/{run_id}/validations", response_model=List[ValidationResponse])
def get_validations(run_id: int, needs_review: bool = False, db: Session = Depends(get_db)):
    """Get validation records for a pipeline run."""
    query = db.query(ValidationRecord).filter(ValidationRecord.pipeline_run_id == run_id)
    if needs_review:
        query = query.filter(ValidationRecord.result == ValidationResult.NEEDS_REVIEW)
    return query.all()


@app.post("/api/validations/{validation_id}/review", response_model=ValidationResponse)
def submit_human_review(
    validation_id: int,
    review: HumanReviewSubmit,
    db: Session = Depends(get_db)
):
    """Submit human review for a validation record."""
    validation = db.query(ValidationRecord).filter(ValidationRecord.id == validation_id).first()
    if not validation:
        raise HTTPException(status_code=404, detail="Validation record not found")
    
    validation.human_reviewed = True
    validation.human_score = review.human_score
    validation.human_feedback = review.human_feedback
    validation.reviewer_id = review.reviewer_id
    validation.reviewed_at = datetime.utcnow()
    
    # Update result based on human score
    threshold = 0.8  # Could be from config
    if review.human_score >= threshold:
        validation.result = ValidationResult.PASSED
    else:
        validation.result = ValidationResult.FAILED
    
    db.commit()
    db.refresh(validation)
    return validation


# --- Stats Endpoints ---
@app.get("/api/stats", response_model=PipelineStats)
def get_stats(db: Session = Depends(get_db)):
    """Get overall pipeline statistics."""
    total_datasets = db.query(Dataset).count()
    total_records = db.query(DataRecord).count()
    total_runs = db.query(PipelineRun).count()
    
    # Runs by status
    status_counts = db.query(
        PipelineRun.status, func.count(PipelineRun.id)
    ).group_by(PipelineRun.status).all()
    runs_by_status = {str(status.value): count for status, count in status_counts}
    
    # Average scores
    avg_accuracy = db.query(func.avg(ValidationRecord.accuracy_score)).scalar()
    
    # Pass rate
    total_validations = db.query(ValidationRecord).count()
    passed_validations = db.query(ValidationRecord).filter(
        ValidationRecord.result == ValidationResult.PASSED
    ).count()
    pass_rate = (passed_validations / total_validations) if total_validations > 0 else None
    
    return PipelineStats(
        total_datasets=total_datasets,
        total_records=total_records,
        total_runs=total_runs,
        runs_by_status=runs_by_status,
        avg_validation_score=avg_accuracy,
        pass_rate=pass_rate
    )


@app.get("/api/pipeline/runs/{run_id}/summary", response_model=ValidationSummary)
def get_run_summary(run_id: int, db: Session = Depends(get_db)):
    """Get validation summary for a pipeline run."""
    validations = db.query(ValidationRecord).filter(ValidationRecord.pipeline_run_id == run_id).all()
    
    if not validations:
        raise HTTPException(status_code=404, detail="No validations found for this run")
    
    passed = sum(1 for v in validations if v.result == ValidationResult.PASSED)
    failed = sum(1 for v in validations if v.result == ValidationResult.FAILED)
    needs_review = sum(1 for v in validations if v.result == ValidationResult.NEEDS_REVIEW)
    
    accuracy_scores = [v.accuracy_score for v in validations if v.accuracy_score is not None]
    human_scores = [v.human_score for v in validations if v.human_score is not None]
    
    return ValidationSummary(
        pipeline_run_id=run_id,
        total_validations=len(validations),
        passed=passed,
        failed=failed,
        needs_review=needs_review,
        avg_accuracy=sum(accuracy_scores) / len(accuracy_scores) if accuracy_scores else None,
        avg_human_score=sum(human_scores) / len(human_scores) if human_scores else None
    )


# --- Background Task ---
def run_pipeline_async(run_id: int):
    """Execute pipeline in background."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        orchestrator = PipelineOrchestrator(db)
        orchestrator.execute(run_id)
    finally:
        db.close()
