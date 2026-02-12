# type: ignore
"""FastAPI application for Text and ASR Annotation."""

from datetime import datetime
from typing import List, Optional, Any, TYPE_CHECKING
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
import math

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
from backend.tasks import transcribe_audio_task, batch_transcribe_task


def clean_nan_values(data):
    """Clean NaN/Inf values from data for JSON serialization."""
    if data is None:
        return None
    if isinstance(data, dict):
        return {k: clean_nan_values(v) for k, v in data.items()}
    if isinstance(data, list):
        return [clean_nan_values(v) for v in data]
    if isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    return data


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

# Include BR Pipeline routes
try:
    from backend.br_pipeline_routes import router as br_pipeline_router
    app.include_router(br_pipeline_router)
except ImportError:
    pass  # BR pipeline not installed yet

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
        task_type=data.task_type if data.task_type else TaskType.GENERAL,
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
            # For GENERAL, just export base fields (id, text, annotation status)
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
    auto_transcribe: bool = Query(True, description="Automatically queue transcription"),
    db: Session = Depends(get_db)
):
    """Upload audio files to an ASR dataset."""
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    dataset_dir = os.path.join(AUDIO_DIR, str(dataset_id))
    os.makedirs(dataset_dir, exist_ok=True)
    
    uploaded = []
    task_ids = []
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
        
        # Queue transcription via Celery
        if auto_transcribe:
            task = transcribe_audio_task.delay(audio_file.id)
            task_ids.append(task.id)
    
    return {
        "message": f"Uploaded {len(uploaded)} files",
        "file_ids": uploaded,
        "transcription_queued": auto_transcribe,
        "task_ids": task_ids if auto_transcribe else []
    }


@app.post("/api/asr/datasets/{dataset_id}/youtube")
def import_youtube_audio(
    dataset_id: int,
    youtube_url: str = Query(..., description="YouTube video URL"),
    auto_segment: bool = Query(True, description="Automatically segment into chunks"),
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    auto_transcribe: bool = Query(False, description="Automatically transcribe after segmentation"),
    db: Session = Depends(get_db)
):
    """
    Import audio from a YouTube video into an ASR dataset.
    
    Downloads the audio, optionally segments it into chunks,
    and adds the files to the dataset.
    
    Set use_vad=True to use Silero VAD (captures voice segments only).
    Set use_vad=False for fixed-length cuts (preserves all audio including music).
    """
    from backend.youtube_service import download_youtube_audio, extract_video_id
    from backend.audio_segment import segment_audio
    
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Validate URL
    video_id = extract_video_id(youtube_url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")
    
    dataset_dir = os.path.join(AUDIO_DIR, str(dataset_id))
    os.makedirs(dataset_dir, exist_ok=True)
    
    # Download YouTube audio
    download_result = download_youtube_audio(youtube_url, dataset_dir, format="wav")
    
    if not download_result.success:
        raise HTTPException(status_code=500, detail=f"Download failed: {download_result.error}")
    
    created_files = []
    task_ids = []
    
    if auto_segment and download_result.duration > chunk_length:
        # Segment the audio
        try:
            segment_result = segment_audio(
                download_result.file_path,
                chunk_length=chunk_length,
                output_base=dataset_dir,
                use_vad=use_vad
            )
            
            # Create AudioFile records for each chunk
            for chunk_path in segment_result.chunks:
                chunk_filename = os.path.basename(chunk_path)
                chunk_size = os.path.getsize(chunk_path) if os.path.exists(chunk_path) else 0
                
                audio_file = AudioFile(
                    dataset_id=dataset_id,
                    filename=chunk_filename,
                    file_path=chunk_path,
                    file_size=chunk_size,
                    status=TranscriptionStatus.PENDING,
                )
                db.add(audio_file)
                db.flush()
                created_files.append(audio_file.id)
                
                if auto_transcribe:
                    task = transcribe_audio_task.delay(audio_file.id)
                    task_ids.append(task.id)
            
            db.commit()
            
            return {
                "message": f"Downloaded and segmented into {segment_result.total_chunks} chunks",
                "youtube_title": download_result.title,
                "youtube_duration": download_result.duration,
                "source_file": download_result.file_path,
                "chunks_created": segment_result.total_chunks,
                "file_ids": created_files,
                "transcription_queued": auto_transcribe,
                "task_ids": task_ids
            }
            
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    
    else:
        # Just add the downloaded file without segmentation
        file_size = os.path.getsize(download_result.file_path) if os.path.exists(download_result.file_path) else 0
        
        audio_file = AudioFile(
            dataset_id=dataset_id,
            filename=os.path.basename(download_result.file_path),
            file_path=download_result.file_path,
            file_size=file_size,
            duration=download_result.duration,
            status=TranscriptionStatus.PENDING,
        )
        db.add(audio_file)
        db.commit()
        db.refresh(audio_file)
        created_files.append(audio_file.id)
        
        if auto_transcribe:
            task = transcribe_audio_task.delay(audio_file.id)
            task_ids.append(task.id)
        
        return {
            "message": "Downloaded YouTube audio",
            "youtube_title": download_result.title,
            "youtube_duration": download_result.duration,
            "file_id": audio_file.id,
            "file_ids": created_files,
            "transcription_queued": auto_transcribe,
            "task_ids": task_ids
        }


@app.post("/api/asr/files/{file_id}/transcribe")
def manual_transcribe(
    file_id: int,
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """Trigger transcription for a file. Runs synchronously by default, or via Celery if use_celery=true."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if use_celery:
        # Async via Celery (requires Redis)
        task = transcribe_audio_task.delay(file_id)
        return {"message": "Transcription queued", "task_id": task.id}
    else:
        # Synchronous transcription
        from backend.whisper import transcribe_audio_simple
        
        if not os.path.exists(str(audio_file.file_path)):
            raise HTTPException(status_code=404, detail="Audio file not found on disk")
        
        audio_file.status = TranscriptionStatus.TRANSCRIBING
        db.commit()
        
        try:
            result = transcribe_audio_simple(audio_file.file_path)
            
            audio_file.whisper_transcript = result.get("text", "")
            audio_file.whisper_language = result.get("language")
            audio_file.whisper_confidence = result.get("confidence")
            audio_file.status = TranscriptionStatus.TRANSCRIBED
            audio_file.transcribed_at = datetime.utcnow()
            db.commit()
            
            return {
                "status": "success",
                "file_id": file_id,
                "filename": audio_file.filename,
                "transcript": audio_file.whisper_transcript,
                "language": audio_file.whisper_language,
                "confidence": audio_file.whisper_confidence,
                "backend": result.get("backend")
            }
        except Exception as e:
            audio_file.status = TranscriptionStatus.PENDING
            db.commit()
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@app.post("/api/asr/datasets/{dataset_id}/transcribe-all")
def batch_transcribe(
    dataset_id: int,
    file_ids: Optional[List[int]] = Query(None, description="Specific file IDs to transcribe"),
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """Transcribe all pending files in a dataset. Runs synchronously by default."""
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    if use_celery:
        # Async via Celery (requires Redis)
        task = batch_transcribe_task.delay(dataset_id, file_ids)
        return {"message": "Batch transcription queued", "task_id": task.id}
    else:
        # Synchronous batch transcription
        from backend.whisper import transcribe_audio_simple
        
        # Get files to transcribe
        query = db.query(AudioFile).filter(
            AudioFile.dataset_id == dataset_id,
            AudioFile.status == TranscriptionStatus.PENDING
        )
        if file_ids:
            query = query.filter(AudioFile.id.in_(file_ids))
        
        audio_files = query.all()
        
        if not audio_files:
            return {
                "status": "completed",
                "message": "No pending files to transcribe",
                "files_processed": 0
            }
        
        results = []
        success_count = 0
        error_count = 0
        
        for audio_file in audio_files:
            try:
                if not os.path.exists(str(audio_file.file_path)):
                    results.append({"file_id": audio_file.id, "status": "error", "message": "File not found"})
                    error_count += 1
                    continue
                
                audio_file.status = TranscriptionStatus.TRANSCRIBING
                db.commit()
                
                result = transcribe_audio_simple(audio_file.file_path)
                
                audio_file.whisper_transcript = result.get("text", "")
                audio_file.whisper_language = result.get("language")
                audio_file.whisper_confidence = result.get("confidence")
                audio_file.status = TranscriptionStatus.TRANSCRIBED
                audio_file.transcribed_at = datetime.utcnow()
                db.commit()
                
                results.append({
                    "file_id": audio_file.id,
                    "status": "success",
                    "language": audio_file.whisper_language
                })
                success_count += 1
                
            except Exception as e:
                audio_file.status = TranscriptionStatus.PENDING
                db.commit()
                results.append({"file_id": audio_file.id, "status": "error", "message": str(e)})
                error_count += 1
        
        return {
            "status": "completed",
            "files_processed": len(audio_files),
            "success_count": success_count,
            "error_count": error_count,
            "results": results
        }


@app.get("/api/tasks/{task_id}/status")
def get_task_status(task_id: str):
    """Get the status of a Celery task."""
    from backend.celery_app import celery_app
    
    result = celery_app.AsyncResult(task_id)
    
    response = {
        "task_id": task_id,
        "status": result.status,
        "ready": result.ready(),
    }
    
    if result.ready():
        if result.successful():
            response["result"] = result.result
        else:
            response["error"] = str(result.result)
    
    return response


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
    
    # Convert to dicts for JSON serialization
    files_data = []
    for f in files:
        files_data.append({
            "id": f.id,
            "dataset_id": f.dataset_id,
            "filename": f.filename,
            "file_path": f.file_path,
            "file_size": f.file_size,
            "duration": f.duration,
            "whisper_transcript": f.whisper_transcript,
            "whisper_language": f.whisper_language,
            "whisper_confidence": f.whisper_confidence,
            "transcribed_at": f.transcribed_at.isoformat() if f.transcribed_at else None,
            "corrected_transcript": f.corrected_transcript,
            "status": f.status.value,
            "annotated_by": f.annotated_by,
            "annotated_at": f.annotated_at.isoformat() if f.annotated_at else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        })
    
    return {
        "files": files_data,
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
    
    if not os.path.exists(str(audio_file.file_path)):
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


@app.delete("/api/asr/files/{file_id}")
def delete_audio_file(file_id: int, db: Session = Depends(get_db)):
    """Delete an audio file and its physical file from disk."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete physical file if it exists
    if audio_file.file_path and os.path.exists(str(audio_file.file_path)):
        try:
            os.remove(audio_file.file_path)
        except OSError as e:
            # Log but don't fail if file deletion fails
            print(f"Warning: Could not delete file {audio_file.file_path}: {e}")
    
    # Delete from database
    db.delete(audio_file)
    db.commit()
    return {"message": "Audio file deleted"}


@app.post("/api/asr/files/{file_id}/retranscribe")
def retranscribe_audio(
    file_id: int,
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """Clear existing transcription and re-transcribe an audio file."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.exists(str(audio_file.file_path)):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    # Clear existing transcription
    audio_file.whisper_transcript = None
    audio_file.corrected_transcript = None
    audio_file.whisper_language = None
    audio_file.whisper_confidence = None
    audio_file.status = TranscriptionStatus.TRANSCRIBING
    db.commit()
    
    if use_celery:
        # Async via Celery (requires Redis)
        task = transcribe_audio_task.delay(file_id)
        return {"message": "Re-transcription queued", "task_id": task.id}
    else:
        # Synchronous transcription
        from backend.whisper import transcribe_audio_simple
        
        try:
            result = transcribe_audio_simple(audio_file.file_path)
            
            audio_file.whisper_transcript = result.get("text", "")
            audio_file.whisper_language = result.get("language")
            audio_file.whisper_confidence = result.get("confidence")
            audio_file.status = TranscriptionStatus.TRANSCRIBED
            audio_file.transcribed_at = datetime.utcnow()
            db.commit()
            
            return {
                "status": "success",
                "file_id": file_id,
                "filename": audio_file.filename,
                "transcript": audio_file.whisper_transcript,
                "language": audio_file.whisper_language,
                "confidence": audio_file.whisper_confidence,
                "backend": result.get("backend")
            }
        except Exception as e:
            audio_file.status = TranscriptionStatus.PENDING
            db.commit()
            raise HTTPException(status_code=500, detail=f"Re-transcription failed: {str(e)}")


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


# === Audio Segmentation Endpoints ===

@app.post("/api/asr/files/{file_id}/segment")
def segment_single_file(
    file_id: int,
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    use_celery: bool = Query(False, description="Run segmentation in background via Celery"),
    db: Session = Depends(get_db)
):
    """
    Segment a single audio file.
    
    Set use_vad=True to use Silero VAD (voice segments only, max chunk_length each).
    Set use_vad=False for fixed-length cuts (preserves all audio including music).
    """
    from backend.audio_segment import segment_audio
    from backend.tasks import segment_audio_task
    
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.exists(str(audio_file.file_path)):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    if use_celery:
        # Queue task for background processing
        task = segment_audio_task.delay(file_id, chunk_length, use_vad)
        return {
            "message": "Segmentation queued",
            "task_id": task.id,
            "file_id": file_id,
            "chunk_length": chunk_length,
            "use_vad": use_vad
        }
    
    # Run segmentation synchronously
    try:
        result = segment_audio(
            audio_file.file_path,
            chunk_length=chunk_length,
            output_base=os.path.dirname(audio_file.file_path),
            use_vad=use_vad
        )
        
        # Create new AudioFile records for each chunk
        chunk_ids = []
        for chunk_path in result.chunks:
            chunk_filename = os.path.basename(chunk_path)
            chunk_size = os.path.getsize(chunk_path) if os.path.exists(chunk_path) else 0
            
            chunk_file = AudioFile(
                dataset_id=audio_file.dataset_id,
                filename=chunk_filename,
                file_path=chunk_path,
                file_size=chunk_size,
                status=TranscriptionStatus.PENDING,
            )
            db.add(chunk_file)
            db.flush()
            chunk_ids.append(chunk_file.id)
        
        db.commit()
        
        return {
            "message": f"Segmented into {result.total_chunks} chunks",
            "file_id": file_id,
            "source_filename": audio_file.filename,
            "output_folder": result.output_folder,
            "chunks_created": result.total_chunks,
            "chunk_ids": chunk_ids
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")


@app.post("/api/asr/datasets/{dataset_id}/segment-all")
def segment_all_files(
    dataset_id: int,
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    use_celery: bool = Query(True, description="Run segmentation in background via Celery"),
    db: Session = Depends(get_db)
):
    """
    Segment all audio files in a dataset.
    
    Files that are already chunks (contain '_chunk' in filename) will be skipped.
    Set use_vad=True for Silero VAD, use_vad=False for fixed-length cuts.
    """
    from backend.audio_segment import segment_audio
    from backend.tasks import segment_audio_task, batch_segment_task
    
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Get files that are not already chunks
    audio_files = db.query(AudioFile).filter(
        AudioFile.dataset_id == dataset_id,
        ~AudioFile.filename.like("%_chunk%")
    ).all()
    
    if not audio_files:
        return {
            "message": "No files to segment (all may already be chunks)",
            "dataset_id": dataset_id,
            "files_found": 0
        }
    
    if use_celery:
        # Queue batch task
        task = batch_segment_task.delay(dataset_id, chunk_length, use_vad)
        return {
            "message": f"Batch segmentation queued for {len(audio_files)} files",
            "task_id": task.id,
            "dataset_id": dataset_id,
            "files_queued": len(audio_files),
            "chunk_length": chunk_length,
            "use_vad": use_vad
        }
    
    # Run synchronously for each file
    results = []
    total_chunks = 0
    
    for audio_file in audio_files:
        if not os.path.exists(str(audio_file.file_path)):
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "error",
                "message": "File not found on disk"
            })
            continue
        
        try:
            result = segment_audio(
                audio_file.file_path,
                chunk_length=chunk_length,
                output_base=os.path.dirname(audio_file.file_path),
                use_vad=use_vad
            )
            
            # Create chunk records
            chunk_ids = []
            for chunk_path in result.chunks:
                chunk_filename = os.path.basename(chunk_path)
                chunk_size = os.path.getsize(chunk_path) if os.path.exists(chunk_path) else 0
                
                chunk_file = AudioFile(
                    dataset_id=audio_file.dataset_id,
                    filename=chunk_filename,
                    file_path=chunk_path,
                    file_size=chunk_size,
                    status=TranscriptionStatus.PENDING,
                )
                db.add(chunk_file)
                db.flush()
                chunk_ids.append(chunk_file.id)
            
            total_chunks += result.total_chunks
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "success",
                "chunks_created": result.total_chunks,
                "chunk_ids": chunk_ids
            })
            
        except Exception as e:
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "error",
                "message": str(e)
            })
    
    db.commit()
    
    success_count = sum(1 for r in results if r["status"] == "success")
    
    return {
        "message": f"Segmented {success_count}/{len(audio_files)} files into {total_chunks} total chunks",
        "dataset_id": dataset_id,
        "files_processed": len(audio_files),
        "success_count": success_count,
        "total_chunks_created": total_chunks,
        "results": results
    }
