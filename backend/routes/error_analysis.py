from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Any
from pydantic import BaseModel
from datetime import datetime
from backend.database import get_db
from backend.models import (
    TextDataset, TextRecord, ASRDataset, AudioFile,
    FinetunedModelOutput, ErrorAnnotation
)

router = APIRouter(prefix="/api/error-analysis", tags=["Error Analysis"])


# --- Schemas ---
class AnnotationCreate(BaseModel):
    output_id: int
    source_side: str
    start_index: int
    end_index: int
    selected_text: str
    error_type: Optional[str] = None
    comment: Optional[str] = None


def _serialize_annotation(ann: ErrorAnnotation) -> dict:
    return {
        "id": ann.id,
        "output_id": ann.output_id,
        "source_side": ann.source_side,
        "start_index": ann.start_index,
        "end_index": ann.end_index,
        "selected_text": ann.selected_text,
        "error_type": ann.error_type,
        "comment": ann.comment,
        "annotated_by": ann.annotated_by,
        "created_at": ann.created_at.isoformat() if ann.created_at else None,
    }


def _serialize_output(output: FinetunedModelOutput) -> dict:
    return {
        "id": output.id,
        "dataset_type": output.dataset_type,
        "record_id": output.record_id,
        "model_name": output.model_name,
        "output_text": output.output_text,
        "created_at": output.created_at.isoformat() if output.created_at else None,
        "annotations": [_serialize_annotation(a) for a in output.annotations],
    }


# --- Endpoints ---

@router.get("/datasets/text")
def list_text_datasets_with_outputs(db: Session = Depends(get_db)):
    """Return text datasets that have at least one finetuned output."""
    datasets = (
        db.query(TextDataset)
        .join(TextRecord, TextRecord.dataset_id == TextDataset.id)
        .join(
            FinetunedModelOutput,
            (FinetunedModelOutput.record_id == TextRecord.id)
            & (FinetunedModelOutput.dataset_type == "text"),
        )
        .distinct()
        .all()
    )
    return [{"id": d.id, "name": d.name} for d in datasets]


@router.get("/datasets/asr")
def list_asr_datasets_with_outputs(db: Session = Depends(get_db)):
    """Return ASR datasets that have at least one finetuned output."""
    datasets = (
        db.query(ASRDataset)
        .join(AudioFile, AudioFile.dataset_id == ASRDataset.id)
        .join(
            FinetunedModelOutput,
            (FinetunedModelOutput.record_id == AudioFile.id)
            & (FinetunedModelOutput.dataset_type == "asr"),
        )
        .distinct()
        .all()
    )
    return [{"id": d.id, "name": d.name} for d in datasets]


@router.get("/text/{dataset_id}")
def get_text_error_analysis(dataset_id: int, db: Session = Depends(get_db)):
    """Only fetch text records that have at least one finetuned output."""
    from collections import defaultdict

    outputs = (
        db.query(FinetunedModelOutput)
        .join(TextRecord, FinetunedModelOutput.record_id == TextRecord.id)
        .filter(
            FinetunedModelOutput.dataset_type == "text",
            TextRecord.dataset_id == dataset_id,
        )
        .all()
    )

    if not outputs:
        return []

    outputs_by_record: dict = defaultdict(list)
    for o in outputs:
        outputs_by_record[o.record_id].append(o)

    records = db.query(TextRecord).filter(
        TextRecord.id.in_(list(outputs_by_record.keys()))
    ).all()

    return [
        {
            "record_id": r.id,
            "ground_truth": r.modified_text if r.modified_text else r.original_text,
            "finetuned_outputs": [_serialize_output(o) for o in outputs_by_record[r.id]],
        }
        for r in records
    ]


@router.get("/asr/{dataset_id}")
def get_asr_error_analysis(dataset_id: int, db: Session = Depends(get_db)):
    """Only fetch ASR records that have at least one finetuned output."""
    from collections import defaultdict

    outputs = (
        db.query(FinetunedModelOutput)
        .join(AudioFile, FinetunedModelOutput.record_id == AudioFile.id)
        .filter(
            FinetunedModelOutput.dataset_type == "asr",
            AudioFile.dataset_id == dataset_id,
        )
        .all()
    )

    if not outputs:
        return []

    outputs_by_record: dict = defaultdict(list)
    for o in outputs:
        outputs_by_record[o.record_id].append(o)

    records = db.query(AudioFile).filter(
        AudioFile.id.in_(list(outputs_by_record.keys()))
    ).all()

    return [
        {
            "record_id": r.id,
            "file_path": r.file_path,
            "filename": r.filename,
            "ground_truth": r.corrected_transcript if r.corrected_transcript else r.whisper_transcript,
            "finetuned_outputs": [_serialize_output(o) for o in outputs_by_record[r.id]],
        }
        for r in records
    ]


@router.post("/annotations")
def create_annotation(annotation: AnnotationCreate, db: Session = Depends(get_db)):
    """Create a new error annotation or comment."""
    db_annotation = ErrorAnnotation(
        output_id=annotation.output_id,
        source_side=annotation.source_side,
        start_index=annotation.start_index,
        end_index=annotation.end_index,
        selected_text=annotation.selected_text,
        error_type=annotation.error_type,
        comment=annotation.comment,
        annotated_by="User",
    )
    db.add(db_annotation)
    db.commit()
    db.refresh(db_annotation)
    return _serialize_annotation(db_annotation)


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: int, db: Session = Depends(get_db)):
    """Delete an annotation."""
    db_annotation = db.query(ErrorAnnotation).filter(ErrorAnnotation.id == annotation_id).first()
    if not db_annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(db_annotation)
    db.commit()
    return {"message": "Annotation deleted"}


@router.get("/stats")
def get_error_stats(db: Session = Depends(get_db)):
    """Aggregate error counts by dataset_type, model_name, error_type."""
    stats = (
        db.query(
            FinetunedModelOutput.dataset_type,
            FinetunedModelOutput.model_name,
            ErrorAnnotation.error_type,
            func.count(ErrorAnnotation.id).label("count"),
        )
        .join(ErrorAnnotation, FinetunedModelOutput.id == ErrorAnnotation.output_id)
        .filter(ErrorAnnotation.error_type.isnot(None))
        .group_by(
            FinetunedModelOutput.dataset_type,
            FinetunedModelOutput.model_name,
            ErrorAnnotation.error_type,
        )
        .all()
    )
    return [
        {
            "dataset_type": s.dataset_type,
            "model_name": s.model_name,
            "error_type": s.error_type,
            "count": s.count,
        }
        for s in stats
    ]

# === Eval Dataset Endpoints ===

from fastapi import UploadFile, File, Form, HTTPException
import json
import csv
import io
from backend.models import EvalDataset, EvalRecord

@router.post("/eval/upload")
async def upload_eval_dataset(
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Uploads a CSV/JSON file to create a standalone EvalDataset."""
    if not file.filename.endswith(('.csv', '.json', '.jsonl')):
        raise HTTPException(status_code=400, detail="Only CSV, JSON, and JSONL files are supported")
        
    content = await file.read()
    records_data = []
    
    if file.filename.endswith('.csv'):
        # Decode and parse CSV
        text_content = content.decode('utf-8')
        reader = csv.DictReader(io.StringIO(text_content))
        records_data = list(reader)
    elif file.filename.endswith('.jsonl'):
        text_content = content.decode('utf-8')
        for line in text_content.strip().split('\n'):
            if line.strip():
                records_data.append(json.loads(line))
    else:
        # JSON
        records_data = json.loads(content)

    if not records_data:
        raise HTTPException(status_code=400, detail="File is empty or invalid")

    # Create EvalDataset
    dataset = EvalDataset(name=name, description=description)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    # Guess columns
    first_row = records_data[0]
    keys = list(first_row.keys())
    
    gt_key = next((k for k in keys if k.lower() in ['ground truth', 'ground_truth', 'gt', 'expected', 'target', 'reference']), None)
    prompt_key = next((k for k in keys if k.lower() in ['prompt', 'input', 'instruction', 'text']), None)
    
    # Everything else is considered a model output
    ignore_keys = {gt_key, prompt_key, 'id', 'index', 'record_id'}
    model_keys = [k for k in keys if k not in ignore_keys]

    for row in records_data:
        gt_val = str(row.get(gt_key, '')) if gt_key else ''
        prompt_val = str(row.get(prompt_key, '')) if prompt_key else ''
        
        # Create Record
        record = EvalRecord(
            dataset_id=dataset.id,
            prompt=prompt_val,
            ground_truth=gt_val
        )
        db.add(record)
        db.flush() # flush to get record.id
        
        # Create Model Outputs
        for m_key in model_keys:
            m_val = str(row.get(m_key, ''))
            if m_val.strip():
                output = FinetunedModelOutput(
                    dataset_type='eval',
                    record_id=record.id,
                    model_name=m_key,
                    output_text=m_val
                )
                db.add(output)
                
    db.commit()
    return {"message": "Dataset uploaded successfully", "dataset_id": dataset.id}

@router.get("/datasets/eval")
def list_eval_datasets(db: Session = Depends(get_db)):
    datasets = db.query(EvalDataset).all()
    return [{"id": d.id, "name": d.name} for d in datasets]

@router.delete("/eval/{dataset_id}")
def delete_eval_dataset(dataset_id: int, db: Session = Depends(get_db)):
    dataset = db.query(EvalDataset).filter(EvalDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    db.delete(dataset)
    db.commit()
    return {"message": "Dataset deleted successfully"}

@router.get("/eval/{dataset_id}")
def get_eval_error_analysis(dataset_id: int, db: Session = Depends(get_db)):
    records = db.query(EvalRecord).filter(EvalRecord.dataset_id == dataset_id).all()
    
    record_ids = [r.id for r in records]
    
    outputs_all = (
        db.query(FinetunedModelOutput)
        .filter(FinetunedModelOutput.dataset_type == 'eval')
        .filter(FinetunedModelOutput.record_id.in_(record_ids))
        .all()
    )
    
    from collections import defaultdict
    outputs_by_record = defaultdict(list)
    for o in outputs_all:
        outputs_by_record[o.record_id].append(o)
        
    result = []
    for r in records:
        result.append({
            "record_id": r.id,
            "prompt": r.prompt,
            "ground_truth": r.ground_truth,
            "finetuned_outputs": [_serialize_output(o) for o in outputs_by_record[r.id]],
        })
    return result
