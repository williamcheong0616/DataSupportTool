"""
Text annotation API routes.

Handles all endpoints related to text datasets, records, and annotations.
Supports multiple annotation tasks:
- Bahasa Rojak identification
- Classification labeling
- Text modification
- Question generation
"""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case
from sqlalchemy.orm import Session
import pandas as pd
import json
import io
import csv
import math

from backend.database import get_db
from backend.models import TextDataset, TextRecord, TaskType
from backend.schemas import (
    TextDatasetCreate, TextDatasetUpdate, TextDatasetResponse,
    TextRecordResponse, BahasaRojakAnnotation, ClassificationAnnotation,
    TextModificationAnnotation, QuestionGenerationAnnotation
)
from backend.utils.helpers import clean_nan_values

# Create router with /api/text prefix
router = APIRouter(prefix="/api/text", tags=["text"])


# ==================== DATASET MANAGEMENT ====================

@router.get("/datasets", response_model=List[TextDatasetResponse])
def list_text_datasets(db: Session = Depends(get_db)):
    """
    List all text datasets with record counts.

    Returns:
        List of datasets with record and annotation counts
    """
    rows = (
        db.query(
            TextDataset,
            func.count(TextRecord.id).label("record_count"),
            func.sum(case((TextRecord.is_annotated == True, 1), else_=0)).label("annotated_count"),
        )
        .outerjoin(TextRecord, TextRecord.dataset_id == TextDataset.id)
        .group_by(TextDataset.id)
        .order_by(TextDataset.created_at.desc())
        .all()
    )
    return [
        {**ds.__dict__, "record_count": int(rc or 0), "annotated_count": int(ac or 0)}
        for ds, rc, ac in rows
    ]


@router.post("/datasets", response_model=TextDatasetResponse)
def create_text_dataset(data: TextDatasetCreate, db: Session = Depends(get_db)):
    """
    Create a new text dataset.
    
    Args:
        data: Dataset creation data (name, description, task_type)
        
    Returns:
        Created dataset with initial counts
    """
    dataset = TextDataset(
        name=data.name,
        description=data.description,
        task_type=data.task_type if data.task_type else TaskType.GENERAL,
        created_by=data.created_by,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return {**dataset.__dict__, "record_count": 0, "annotated_count": 0}


@router.get("/datasets/{dataset_id}", response_model=TextDatasetResponse)
def get_text_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Get a specific text dataset with counts."""
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    record_count = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id).count()
    annotated_count = db.query(TextRecord).filter(
        TextRecord.dataset_id == dataset_id,
        TextRecord.is_annotated == True
    ).count()
    return {**dataset.__dict__, "record_count": record_count, "annotated_count": annotated_count}


@router.put("/datasets/{dataset_id}", response_model=TextDatasetResponse)
def update_text_dataset(dataset_id: int, data: TextDatasetUpdate, db: Session = Depends(get_db)):
    """
    Update dataset metadata.
    
    Args:
        dataset_id: Dataset ID to update
        data: Fields to update (name, description, column_mapping)
        
    Returns:
        Updated dataset
    """
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    if data.name is not None:
        dataset.name = data.name
    if data.description is not None:
        dataset.description = data.description
    if data.column_mapping is not None:
        dataset.column_mapping = data.column_mapping
    
    dataset.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(dataset)
    
    record_count = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id).count()
    annotated_count = db.query(TextRecord).filter(
        TextRecord.dataset_id == dataset_id,
        TextRecord.is_annotated == True
    ).count()
    return {**dataset.__dict__, "record_count": record_count, "annotated_count": annotated_count}


@router.delete("/datasets/{dataset_id}")
def delete_text_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Delete a text dataset and all its records (CASCADE)."""
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    db.delete(dataset)
    db.commit()
    return {"message": f"Dataset '{dataset.name}' deleted"}


# ==================== DATA UPLOAD ====================

@router.post("/datasets/{dataset_id}/upload")
async def upload_text_data(
    dataset_id: int,
    file: UploadFile = File(...),
    text_column: Optional[str] = Query(None, description="Column to use as text"),
    db: Session = Depends(get_db)
):
    """
    Upload CSV/JSON/JSONL file to a text dataset.
    
    Automatically detects text column or uses provided column name.
    Tries common column names: text, content, sentence, input, message.
    
    Args:
        dataset_id: Target dataset ID
        file: CSV, JSON, or JSONL file
        text_column: Optional explicit column name for text field
        
    Returns:
        Upload summary with record count and detected headers
    """
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    content = await file.read()
    
    # Parse file based on extension
    try:
        if file.filename.endswith('.csv'):
            try:
                df = pd.read_csv(io.BytesIO(content))
            except:
                df = pd.read_csv(io.BytesIO(content), on_bad_lines='skip', sep=None, engine='python')
        elif file.filename.endswith('.json') or file.filename.endswith('.jsonl'):
            if file.filename.endswith('.jsonl'):
                lines = content.decode('utf-8').strip().split('\n')
                data = [json.loads(line) for line in lines if line.strip()]
            else:
                data = json.loads(content)
                if isinstance(data, dict):
                    data = data.get('data', [data])
            df = pd.DataFrame(data)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Use CSV or JSON.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing file: {str(e)}")
    
    # Store original headers
    headers = list(df.columns)
    if not headers:
        raise HTTPException(status_code=400, detail="File has no columns")
    if dataset.original_headers is None:
        dataset.original_headers = headers

    # Determine text column
    if text_column and text_column in df.columns:
        selected_col = text_column
    elif dataset.column_mapping is not None and 'text' in dataset.column_mapping:
        selected_col = dataset.column_mapping['text']
    else:
        # Try common column names
        for col in ['text', 'content', 'sentence', 'input', 'message', headers[0]]:
            if col in df.columns:
                selected_col = col
                break
        else:
            selected_col = headers[0]
    
    # Build a set of original_text values already in this dataset so we can
    # skip duplicates on upload.  We never overwrite an existing record — the
    # annotated copy (if any) is always the one that stays.
    existing_texts: set = {
        r.original_text
        for r in db.query(TextRecord.original_text)
                    .filter(TextRecord.dataset_id == dataset_id)
                    .all()
    }

    records_added = 0
    records_skipped = 0
    try:
        for _, row in df.iterrows():
            text_value = str(row[selected_col])

            # Skip rows that are already present in this dataset
            if text_value in existing_texts:
                records_skipped += 1
                continue

            # Sanitize raw_data: replace NaN/Inf with None for PostgreSQL JSON compatibility
            raw = row.to_dict()
            raw = {k: (None if pd.isna(v) or (isinstance(v, float) and not math.isfinite(v)) else v) for k, v in raw.items()}
            record = TextRecord(
                dataset_id=dataset_id,
                original_text=text_value,
                raw_data=raw,
            )
            db.add(record)
            existing_texts.add(text_value)   # prevent intra-file duplicates too
            records_added += 1

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save records: {str(e)}")
    return {
        "message": f"Added {records_added} records ({records_skipped} duplicates skipped)",
        "headers": headers,
        "records_added": records_added,
        "records_skipped": records_skipped,
    }


# ==================== RECORD LISTING ====================

@router.get("/datasets/{dataset_id}/records")
def list_text_records(
    dataset_id: int,
    annotated: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """
    List records in a dataset with pagination.
    
    Args:
        dataset_id: Dataset ID to list records from
        annotated: Filter by annotation status (None = all, True = annotated only, False = unannotated)
        limit: Maximum records per page (default: 50)
        offset: Number of records to skip (default: 0)
        
    Returns:
        Paginated records with totals and counts
    """
    base_query = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id)
    
    # Get totals
    total = base_query.count()
    annotated_count = base_query.filter(TextRecord.is_annotated == True).count()
    
    # Apply filter
    query = base_query
    if annotated is not None:
        query = query.filter(TextRecord.is_annotated == annotated)
    
    records = query.offset(offset).limit(limit).all()
    
    # Convert to dicts for JSON serialization
    records_data = []
    for r in records:
        records_data.append({
            "id": r.id,
            "dataset_id": r.dataset_id,
            "original_text": r.original_text,
            "raw_data": clean_nan_values(r.raw_data),
            "is_bahasa_rojak": r.is_bahasa_rojak,
            "classification_label": r.classification_label,
            "modified_text": r.modified_text,
            "subject_added": r.subject_added,
            "context_added": r.context_added,
            "question_1": r.question_1,
            "question_2": r.question_2,
            "question_3": r.question_3,
            "is_annotated": r.is_annotated,
            "annotated_by": r.annotated_by,
            "annotated_at": r.annotated_at.isoformat() if r.annotated_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    
    return {
        "records": records_data,
        "total": total,
        "annotated": annotated_count,
        "limit": limit,
        "offset": offset,
    }


@router.get("/records/{record_id}", response_model=TextRecordResponse)
def get_text_record(record_id: int, db: Session = Depends(get_db)):
    """Get a specific text record by ID."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@router.delete("/records/{record_id}")
def delete_text_record(record_id: int, db: Session = Depends(get_db)):
    """Delete a text record."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    db.delete(record)
    db.commit()
    return {"message": "Record deleted"}


# ==================== ANNOTATION ENDPOINTS ====================
# Different annotation types for different task types

@router.post("/records/{record_id}/annotate/bahasa-rojak")
def annotate_bahasa_rojak(
    record_id: int,
    data: BahasaRojakAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """
    Annotate record for Bahasa Rojak identification (Yes/No).
    
    Args:
        record_id: Record to annotate
        data: Annotation data (is_bahasa_rojak boolean)
        annotator: Name of annotator (default: anonymous)
    """
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.is_bahasa_rojak = data.is_bahasa_rojak
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@router.post("/records/{record_id}/annotate/classification")
def annotate_classification(
    record_id: int,
    data: ClassificationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """
    Annotate record with classification label.
    
    Args:
        record_id: Record to annotate
        data: Annotation data (classification_label string)
        annotator: Name of annotator
    """
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.classification_label = data.classification_label
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@router.post("/records/{record_id}/annotate/modification")
def annotate_modification(
    record_id: int,
    data: TextModificationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """
    Annotate record with text modifications.
    
    Supports modifying text and adding subject/context information.
    
    Args:
        record_id: Record to annotate
        data: Modification data (modified_text, subject_added, context_added)
        annotator: Name of annotator
    """
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    if data.modified_text:
        record.modified_text = data.modified_text
    if data.subject_added:
        record.subject_added = data.subject_added
    if data.context_added:
        record.context_added = data.context_added
    
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@router.post("/records/{record_id}/annotate/questions")
def annotate_questions(
    record_id: int,
    data: QuestionGenerationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """
    Annotate record with 3 generated questions.
    
    Args:
        record_id: Record to annotate
        data: Question data (question_1, question_2, question_3)
        annotator: Name of annotator
    """
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.question_1 = data.question_1
    record.question_2 = data.question_2
    record.question_3 = data.question_3
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


# ==================== DATA EXPORT ====================

@router.get("/datasets/{dataset_id}/export")
def export_text_dataset(
    dataset_id: int,
    format: str = Query("csv", enum=["csv", "jsonl"]),
    db: Session = Depends(get_db)
):
    """
    Export dataset as CSV or JSONL.
    
    Export format varies by task type:
    - Bahasa Rojak: includes is_bahasa_rojak field
    - Classification: includes classification_label field
    - Text Modification: includes modified_text, subject_added, context_added
    - Question Generation: includes question_1/2/3 fields
    - General: basic export with annotation status
    
    Args:
        dataset_id: Dataset to export
        format: Export format ('csv' or 'jsonl')
        
    Returns:
        Streaming response with file download
    """
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    records = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id).all()
    
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Header based on task type
        if dataset.task_type == TaskType.BAHASA_ROJAK_IDENTIFICATION:
            writer.writerow(["id", "original_text", "is_bahasa_rojak", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.is_bahasa_rojak, r.annotated_by])
        elif dataset.task_type == TaskType.BAHASA_ROJAK_CLASSIFICATION:
            writer.writerow(["id", "original_text", "classification_label", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.classification_label, r.annotated_by])
        elif dataset.task_type == TaskType.TEXT_MODIFICATION:
            writer.writerow(["id", "original_text", "modified_text", "subject_added", "context_added", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.modified_text, r.subject_added, r.context_added, r.annotated_by])
        elif dataset.task_type == TaskType.QUESTION_GENERATION:
            writer.writerow(["id", "original_text", "question_1", "question_2", "question_3", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.question_1, r.question_2, r.question_3, r.annotated_by])
        else:  # GENERAL - Simple export
            writer.writerow(["id", "original_text", "is_annotated", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.is_annotated, r.annotated_by])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}.csv"}
        )
    else:  # jsonl
        lines = []
        for r in records:
            row = {
                "id": r.id,
                "original_text": r.original_text,
                "is_annotated": r.is_annotated,
                "annotated_by": r.annotated_by,
            }
            if dataset.task_type == TaskType.BAHASA_ROJAK_IDENTIFICATION:
                row["is_bahasa_rojak"] = r.is_bahasa_rojak
            elif dataset.task_type == TaskType.BAHASA_ROJAK_CLASSIFICATION:
                row["classification_label"] = r.classification_label
            elif dataset.task_type == TaskType.TEXT_MODIFICATION:
                row["modified_text"] = r.modified_text
                row["subject_added"] = r.subject_added
                row["context_added"] = r.context_added
            elif dataset.task_type == TaskType.QUESTION_GENERATION:
                row["question_1"] = r.question_1
                row["question_2"] = r.question_2
                row["question_3"] = r.question_3
            lines.append(json.dumps(row, ensure_ascii=False))
        
        content = "\n".join(lines)
        return StreamingResponse(
            iter([content]),
            media_type="application/jsonl",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}.jsonl"}
        )


# ==================== CROSS-DATASET RESPONSE POOL ====================

@router.get("/response-pool")
def get_response_pool(
    q: Optional[str] = Query(None, description="Search query to filter texts"),
    type_filter: str = Query("all", description="Filter by type: 'all', 'original_text', or 'model_response'"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Aggregate all original texts and BR pipeline model responses from every
    text dataset into a single searchable pool.

    Useful for detecting cross-dataset overlap that could cause over- or
    under-training.

    Args:
        q: Optional search string (case-insensitive substring match)
        limit: Page size (default 100, max 500)
        offset: Pagination offset

    Returns:
        Paginated list of entries with type, dataset info, and text content
    """
    from backend.br_pipeline_models import BRRecordStage

    results = []
    query_lower = q.lower() if q else None

    # --- original texts ---
    text_records = (
        db.query(TextRecord, TextDataset)
        .join(TextDataset, TextRecord.dataset_id == TextDataset.id)
        .all()
    )
    for record, dataset in text_records:
        text = record.original_text or ""
        if query_lower and query_lower not in text.lower():
            continue
        results.append({
            "type": "original_text",
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "record_id": record.id,
            "text": text,
            "model_name": None,
            "question": None,
        })

    # --- BR pipeline model responses ---
    stages = (
        db.query(BRRecordStage, TextRecord, TextDataset)
        .join(TextRecord, BRRecordStage.text_record_id == TextRecord.id)
        .join(TextDataset, TextRecord.dataset_id == TextDataset.id)
        .filter(BRRecordStage.model_responses.isnot(None))
        .all()
    )
    for stage, record, dataset in stages:
        if not stage.model_responses:
            continue
        for model_name, resp_data in stage.model_responses.items():
            response_text = (
                resp_data.get("response", "") if isinstance(resp_data, dict) else str(resp_data)
            )
            if not response_text:
                continue
            if query_lower and query_lower not in response_text.lower():
                continue
            results.append({
                "type": "model_response",
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "record_id": record.id,
                "text": response_text,
                "model_name": model_name,
                "question": stage.selected_question,
            })

    # Compute unfiltered counts for display
    original_count = sum(1 for r in results if r["type"] == "original_text")
    model_response_count = len(results) - original_count

    # Apply type filter
    if type_filter == "original_text":
        results = [r for r in results if r["type"] == "original_text"]
    elif type_filter == "model_response":
        results = [r for r in results if r["type"] == "model_response"]

    total = len(results)

    return {
        "results": results[offset: offset + limit],
        "total": total,
        "original_count": original_count,
        "model_response_count": model_response_count,
        "query": q,
    }
