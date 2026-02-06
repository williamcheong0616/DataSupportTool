"""FastAPI application for Text and ASR Annotation."""
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func
import pandas as pd
import json
import os
import io
import csv
import httpx

from backend.database import get_db, init_db
from backend.models import (
    TextDataset, TextRecord, ASRDataset, AudioFile,
    TaskType, TranscriptionStatus
)
from backend.schemas import (
    TextDatasetCreate, TextDatasetUpdate, TextDatasetResponse,
    TextRecordResponse, BahasaRojakAnnotation, ClassificationAnnotation,
    TextModificationAnnotation, QuestionGenerationAnnotation,
    ASRDatasetCreate, ASRDatasetResponse, AudioFileResponse,
    TranscriptAnnotation, AnnotationStats
)

app = FastAPI(
    title="Annotation Tool API",
    description="API for Text and ASR Annotation",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Audio files directory
AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# Whisper API URL (from docker-compose)
WHISPER_API_URL = os.getenv("WHISPER_API_URL", "http://localhost:9000")


@app.on_event("startup")
def startup():
    init_db()


# === Health Check ===

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}


# === Stats ===

@app.get("/api/stats", response_model=AnnotationStats)
def get_stats(db: Session = Depends(get_db)):
    """Get overall annotation statistics."""
    text_records = db.query(TextRecord).count()
    text_annotated = db.query(TextRecord).filter(TextRecord.is_annotated == True).count()
    audio_files = db.query(AudioFile).count()
    asr_completed = db.query(AudioFile).filter(AudioFile.status == TranscriptionStatus.COMPLETED).count()
    
    return {
        "text_datasets": db.query(TextDataset).count(),
        "text_records": text_records,
        "text_annotated": text_annotated,
        "asr_datasets": db.query(ASRDataset).count(),
        "audio_files": audio_files,
        "asr_completed": asr_completed,
    }


# =====================
# TEXT ANNOTATION APIs
# =====================

@app.get("/api/text/datasets", response_model=List[TextDatasetResponse])
def list_text_datasets(db: Session = Depends(get_db)):
    """List all text datasets."""
    datasets = db.query(TextDataset).order_by(TextDataset.created_at.desc()).all()
    result = []
    for ds in datasets:
        record_count = db.query(TextRecord).filter(TextRecord.dataset_id == ds.id).count()
        annotated_count = db.query(TextRecord).filter(
            TextRecord.dataset_id == ds.id,
            TextRecord.is_annotated == True
        ).count()
        result.append({
            **ds.__dict__,
            "record_count": record_count,
            "annotated_count": annotated_count,
        })
    return result


@app.post("/api/text/datasets", response_model=TextDatasetResponse)
def create_text_dataset(data: TextDatasetCreate, db: Session = Depends(get_db)):
    """Create a new text dataset."""
    dataset = TextDataset(
        name=data.name,
        description=data.description,
        task_type=data.task_type,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return {**dataset.__dict__, "record_count": 0, "annotated_count": 0}


@app.get("/api/text/datasets/{dataset_id}", response_model=TextDatasetResponse)
def get_text_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Get a specific text dataset."""
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    record_count = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id).count()
    annotated_count = db.query(TextRecord).filter(
        TextRecord.dataset_id == dataset_id,
        TextRecord.is_annotated == True
    ).count()
    return {**dataset.__dict__, "record_count": record_count, "annotated_count": annotated_count}


@app.put("/api/text/datasets/{dataset_id}", response_model=TextDatasetResponse)
def update_text_dataset(dataset_id: int, data: TextDatasetUpdate, db: Session = Depends(get_db)):
    """Update dataset (name, description, column mapping)."""
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


@app.delete("/api/text/datasets/{dataset_id}")
def delete_text_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Delete a text dataset and all its records."""
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    db.delete(dataset)
    db.commit()
    return {"message": f"Dataset '{dataset.name}' deleted"}


@app.post("/api/text/datasets/{dataset_id}/upload")
async def upload_text_data(
    dataset_id: int,
    file: UploadFile = File(...),
    text_column: Optional[str] = Query(None, description="Column to use as text"),
    db: Session = Depends(get_db)
):
    """Upload CSV/JSON file to a text dataset."""
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    content = await file.read()
    
    try:
        if file.filename.endswith('.csv'):
            # Try different parsing options
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
    if not dataset.original_headers:
        dataset.original_headers = headers
    
    # Determine text column
    if text_column and text_column in df.columns:
        selected_col = text_column
    elif dataset.column_mapping and 'text' in dataset.column_mapping:
        selected_col = dataset.column_mapping['text']
    else:
        # Try common column names
        for col in ['text', 'content', 'sentence', 'input', 'message', headers[0]]:
            if col in df.columns:
                selected_col = col
                break
        else:
            selected_col = headers[0]
    
    # Add records
    records_added = 0
    for _, row in df.iterrows():
        record = TextRecord(
            dataset_id=dataset_id,
            original_text=str(row[selected_col]),
            raw_data=row.to_dict(),
        )
        db.add(record)
        records_added += 1
    
    db.commit()
    return {"message": f"Added {records_added} records", "headers": headers}


@app.get("/api/text/datasets/{dataset_id}/records")
def list_text_records(
    dataset_id: int,
    annotated: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """List records in a dataset with pagination info."""
    base_query = db.query(TextRecord).filter(TextRecord.dataset_id == dataset_id)
    
    # Get totals
    total = base_query.count()
    annotated_count = base_query.filter(TextRecord.is_annotated == True).count()
    
    # Apply filter
    query = base_query
    if annotated is not None:
        query = query.filter(TextRecord.is_annotated == annotated)
    
    records = query.offset(offset).limit(limit).all()
    
    return {
        "records": records,
        "total": total,
        "annotated": annotated_count,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/text/records/{record_id}", response_model=TextRecordResponse)
def get_text_record(record_id: int, db: Session = Depends(get_db)):
    """Get a specific record."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return record


@app.post("/api/text/records/{record_id}/annotate/bahasa-rojak")
def annotate_bahasa_rojak(
    record_id: int,
    data: BahasaRojakAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """Annotate a record for Bahasa Rojak identification (Yes/No)."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.is_bahasa_rojak = data.is_bahasa_rojak
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@app.post("/api/text/records/{record_id}/annotate/classification")
def annotate_classification(
    record_id: int,
    data: ClassificationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """Annotate a record with classification label."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    record.classification_label = data.classification_label
    record.is_annotated = True
    record.annotated_by = annotator
    record.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@app.post("/api/text/records/{record_id}/annotate/modification")
def annotate_modification(
    record_id: int,
    data: TextModificationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """Annotate a record with text modification."""
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


@app.post("/api/text/records/{record_id}/annotate/questions")
def annotate_questions(
    record_id: int,
    data: QuestionGenerationAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """Annotate a record with 3 questions."""
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


@app.delete("/api/text/records/{record_id}")
def delete_text_record(record_id: int, db: Session = Depends(get_db)):
    """Delete a text record."""
    record = db.query(TextRecord).filter(TextRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    db.delete(record)
    db.commit()
    return {"message": "Record deleted"}


@app.get("/api/text/datasets/{dataset_id}/export")
def export_text_dataset(
    dataset_id: int,
    format: str = Query("csv", enum=["csv", "jsonl"]),
    db: Session = Depends(get_db)
):
    """Export dataset as CSV or JSONL."""
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
        else:  # QUESTION_GENERATION
            writer.writerow(["id", "original_text", "question_1", "question_2", "question_3", "annotated_by"])
            for r in records:
                writer.writerow([r.id, r.original_text, r.question_1, r.question_2, r.question_3, r.annotated_by])
        
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
            else:
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


# =====================
# ASR ANNOTATION APIs
# =====================

@app.get("/api/asr/datasets", response_model=List[ASRDatasetResponse])
def list_asr_datasets(db: Session = Depends(get_db)):
    """List all ASR datasets."""
    datasets = db.query(ASRDataset).order_by(ASRDataset.created_at.desc()).all()
    result = []
    for ds in datasets:
        file_count = db.query(AudioFile).filter(AudioFile.dataset_id == ds.id).count()
        pending_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status.in_([TranscriptionStatus.PENDING, TranscriptionStatus.TRANSCRIBING])
        ).count()
        completed_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status == TranscriptionStatus.COMPLETED
        ).count()
        result.append({
            **ds.__dict__,
            "file_count": file_count,
            "pending_count": pending_count,
            "completed_count": completed_count,
        })
    return result


@app.post("/api/asr/datasets", response_model=ASRDatasetResponse)
def create_asr_dataset(data: ASRDatasetCreate, db: Session = Depends(get_db)):
    """Create a new ASR dataset."""
    dataset = ASRDataset(name=data.name, description=data.description)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return {**dataset.__dict__, "file_count": 0, "pending_count": 0, "completed_count": 0}


@app.delete("/api/asr/datasets/{dataset_id}")
def delete_asr_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Delete an ASR dataset and all its audio files."""
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Delete audio files from disk
    audio_files = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id).all()
    for af in audio_files:
        if os.path.exists(af.file_path):
            os.remove(af.file_path)
    
    db.delete(dataset)
    db.commit()
    return {"message": f"Dataset '{dataset.name}' deleted"}


@app.post("/api/asr/datasets/{dataset_id}/upload")
async def upload_audio_files(
    dataset_id: int,
    files: List[UploadFile] = File(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """Upload audio files to an ASR dataset."""
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    dataset_dir = os.path.join(AUDIO_DIR, str(dataset_id))
    os.makedirs(dataset_dir, exist_ok=True)
    
    uploaded = []
    for file in files:
        # Save file
        file_path = os.path.join(dataset_dir, file.filename)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        # Create record
        audio_file = AudioFile(
            dataset_id=dataset_id,
            filename=file.filename,
            file_path=file_path,
            file_size=len(content),
            status=TranscriptionStatus.PENDING,
        )
        db.add(audio_file)
        db.commit()
        db.refresh(audio_file)
        uploaded.append(audio_file.id)
        
        # Queue transcription
        if background_tasks:
            background_tasks.add_task(transcribe_audio, audio_file.id)
    
    return {"message": f"Uploaded {len(uploaded)} files", "file_ids": uploaded}


async def transcribe_audio(audio_file_id: int):
    """Background task to transcribe audio using Whisper API."""
    from backend.database import SessionLocal
    
    db = SessionLocal()
    try:
        audio_file = db.query(AudioFile).filter(AudioFile.id == audio_file_id).first()
        if not audio_file:
            return
        
        audio_file.status = TranscriptionStatus.TRANSCRIBING
        db.commit()
        
        # Call Whisper API
        async with httpx.AsyncClient(timeout=300.0) as client:
            with open(audio_file.file_path, "rb") as f:
                response = await client.post(
                    f"{WHISPER_API_URL}/asr",
                    files={"audio_file": (audio_file.filename, f)},
                    params={"output": "json"}
                )
            
            if response.status_code == 200:
                result = response.json()
                audio_file.whisper_transcript = result.get("text", "")
                audio_file.whisper_language = result.get("language")
                audio_file.status = TranscriptionStatus.TRANSCRIBED
                audio_file.transcribed_at = datetime.utcnow()
            else:
                audio_file.status = TranscriptionStatus.PENDING  # Retry later
        
        db.commit()
    except Exception as e:
        print(f"Transcription error: {e}")
        audio_file.status = TranscriptionStatus.PENDING
        db.commit()
    finally:
        db.close()


@app.post("/api/asr/files/{file_id}/transcribe")
async def manual_transcribe(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Manually trigger transcription for a file."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    background_tasks.add_task(transcribe_audio, file_id)
    return {"message": "Transcription queued"}


@app.get("/api/asr/datasets/{dataset_id}/files")
def list_audio_files(
    dataset_id: int,
    status: Optional[TranscriptionStatus] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """List audio files in a dataset with pagination info."""
    base_query = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id)
    
    # Get totals
    total = base_query.count()
    pending_count = base_query.filter(AudioFile.status == TranscriptionStatus.PENDING).count()
    completed_count = base_query.filter(AudioFile.status == TranscriptionStatus.COMPLETED).count()
    
    # Apply filter
    query = base_query
    if status:
        query = query.filter(AudioFile.status == status)
    
    files = query.order_by(AudioFile.created_at).offset(offset).limit(limit).all()
    
    return {
        "files": files,
        "total": total,
        "pending": pending_count,
        "completed": completed_count,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/asr/files/{file_id}", response_model=AudioFileResponse)
def get_audio_file(file_id: int, db: Session = Depends(get_db)):
    """Get a specific audio file."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    return audio_file


@app.get("/api/asr/files/{file_id}/audio")
def stream_audio(file_id: int, db: Session = Depends(get_db)):
    """Stream audio file for playback."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.exists(audio_file.file_path):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    return FileResponse(
        audio_file.file_path,
        media_type="audio/mpeg",
        filename=audio_file.filename
    )


@app.post("/api/asr/files/{file_id}/annotate")
def annotate_transcript(
    file_id: int,
    data: TranscriptAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """Save corrected transcript."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    audio_file.corrected_transcript = data.corrected_transcript
    audio_file.status = TranscriptionStatus.COMPLETED
    audio_file.annotated_by = annotator
    audio_file.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@app.post("/api/asr/files/{file_id}/status")
def update_file_status(
    file_id: int,
    status: TranscriptionStatus,
    db: Session = Depends(get_db)
):
    """Update file status."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    audio_file.status = status
    db.commit()
    return {"message": f"Status updated to {status}"}


@app.get("/api/asr/datasets/{dataset_id}/export")
def export_asr_dataset(
    dataset_id: int,
    format: str = Query("csv", enum=["csv", "jsonl"]),
    db: Session = Depends(get_db)
):
    """Export ASR dataset as CSV or JSONL."""
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    files = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id).all()
    
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "filename", "whisper_transcript", "corrected_transcript", "status", "annotated_by"])
        for f in files:
            writer.writerow([f.id, f.filename, f.whisper_transcript, f.corrected_transcript, f.status.value, f.annotated_by])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}_transcripts.csv"}
        )
    else:
        lines = []
        for f in files:
            lines.append(json.dumps({
                "id": f.id,
                "filename": f.filename,
                "whisper_transcript": f.whisper_transcript,
                "corrected_transcript": f.corrected_transcript,
                "status": f.status.value,
                "annotated_by": f.annotated_by,
            }, ensure_ascii=False))
        
        return StreamingResponse(
            iter(["\n".join(lines)]),
            media_type="application/jsonl",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}_transcripts.jsonl"}
        )
