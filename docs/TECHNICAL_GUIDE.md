# DataSupportTool — Technical Guide

> **Version 3.0** · Last updated May 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Configuration Reference](#4-configuration-reference)
5. [Database Schema](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [Background Task System](#7-background-task-system)
8. [Deployment](#8-deployment)
9. [Alembic Migrations](#9-alembic-migrations)
10. [Logging](#10-logging)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│           Browser  (React 18 + Vite + Tailwind)      │
│  Dashboard · ASR · Text · BR Pipeline · Settings     │
└──────────────────────────┬──────────────────────────┘
                           │  HTTP / REST
                           ▼
┌─────────────────────────────────────────────────────┐
│                   FastAPI  (port 8000)               │
│  /api/health   /api/asr   /api/text                 │
│  /api/br-pipeline         /api/settings             │
│  /*  → serves React SPA (frontend-react/dist/)      │
└──────┬────────────────────────────┬─────────────────┘
       │ SQLAlchemy ORM             │ Celery tasks
       ▼                            ▼
┌─────────────┐          ┌──────────────────────────┐
│  PostgreSQL │          │  Redis  (broker + result) │
│  (port 5432)│          │  (port 6379)              │
└─────────────┘          └──────────┬───────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │   Celery Worker   │
                          │  queues:          │
                          │  celery           │
                          │  transcription    │
                          │  br_pipeline      │
                          └───────────────────┘
```

**Data flow for a typical ASR request:**

1. Browser uploads audio → `POST /api/asr/datasets/{id}/upload`
2. FastAPI stores file to `data/audio/`, creates `AudioFile` DB record
3. Browser requests transcription → `POST /api/asr/files/{id}/transcribe`
4. FastAPI dispatches Celery task → returns `task_id`
5. Celery worker runs Whisper + Qwen3, updates DB row
6. Browser polls `GET /api/asr/tasks/{task_id}/status` until `SUCCESS`

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend framework | React | 18.x |
| Frontend build | Vite | 5.x |
| CSS | Tailwind CSS | 3.x |
| Routing (FE) | React Router DOM | 6.x |
| HTTP client (FE) | Axios | 1.x |
| Audio visualisation | WaveSurfer.js | 7.x |
| Backend framework | FastAPI | latest |
| ASGI server | Uvicorn | 0.27+ |
| ORM | SQLAlchemy | 2.x |
| DB migrations | Alembic | 1.13+ |
| Database | PostgreSQL | 16 |
| Task queue | Celery | 5.x |
| Message broker | Redis | 7 |
| Task monitor | Flower | 2.x |
| ASR (Whisper) | mlx-whisper / openai-whisper | — |
| ASR (Qwen3) | qwen-asr | 0.1+ |
| Audio processing | FFmpeg + yt-dlp + Silero VAD | — |
| LLM inference | Ollama (local) | — |
| Containerisation | Docker Compose | 3.9 |

---

## 3. Repository Layout

```
DataSupportTool/
├── backend/                   # FastAPI application
│   ├── routes/                # Domain-split API routers
│   │   ├── asr.py             # ASR annotation endpoints
│   │   ├── health.py          # Health + stats
│   │   ├── settings.py        # Model config + backup
│   │   └── text.py            # Text annotation endpoints
│   ├── services/              # Business logic services
│   │   ├── backup_service.py
│   │   └── transcription_service.py
│   ├── utils/                 # Shared utilities
│   │   ├── helpers.py
│   │   └── logger.py
│   ├── middleware/
│   │   └── logging_middleware.py
│   ├── api.py                 # App factory + SPA mount
│   ├── models.py              # SQLAlchemy models (ASR + Text)
│   ├── br_pipeline_models.py  # BR Pipeline models
│   ├── br_pipeline_routes.py  # BR Pipeline router
│   ├── br_pipeline_orchestrator.py
│   ├── br_pipeline_tasks.py   # Celery tasks for BR pipeline
│   ├── br_pipeline_schemas.py
│   ├── celery_app.py          # Celery + Beat configuration
│   ├── database.py            # Engine + session factory
│   ├── enums.py               # Shared enumerations
│   ├── schemas.py             # Pydantic request/response schemas
│   ├── tasks.py               # Celery tasks (ASR)
│   ├── audio_segment.py       # Silero VAD segmentation
│   ├── whisper.py             # Whisper transcription wrapper
│   ├── qwen3_asr.py           # Qwen3 ASR wrapper
│   ├── ollama_service.py      # Ollama LLM client
│   ├── youtube_service.py     # yt-dlp download wrapper
│   └── similarity.py          # Cosine similarity utility
├── frontend-react/            # React SPA
│   ├── src/
│   │   ├── pages/             # One file per page/route
│   │   ├── utils/             # Logger, helpers
│   │   ├── api.js             # Axios API client
│   │   ├── App.jsx            # Router + nav shell
│   │   └── main.jsx           # React entry point
│   ├── dist/                  # Production build output (gitignored)
│   ├── package.json
│   └── vite.config.js
├── alembic/                   # DB migration scripts
├── scripts/
│   ├── start_services.sh      # One-shot startup script
│   ├── backup.sh              # pg_dump + rclone cloud sync
│   ├── init_production_db.py
│   └── migrate_*.py           # One-off data migrations
├── docs/                      # Documentation
│   ├── USER_GUIDE.md
│   ├── TECHNICAL_GUIDE.md     # ← this file
│   ├── TECHNICAL_PAPER.md
│   ├── BACKUP_SETUP.md
│   ├── CLEANUP_SUMMARY.md
│   └── LOGGING_SETUP.md
├── data/                      # Runtime data (gitignored)
│   ├── audio/                 # Uploaded + segmented audio
│   ├── uploads/
│   ├── processed/
│   └── exports/
├── logs/                      # Application logs (gitignored)
├── sql_backups/               # Database backup archives
├── config.py                  # Centralised config (reads .env)
├── docker-compose.yml         # PostgreSQL + Redis + Flower
├── run_api.py                 # Uvicorn launcher
├── requirements.txt
├── .env.example
└── README.md
```

---

## 4. Configuration Reference

All configuration is read from environment variables (via `.env` file loaded by `python-dotenv`).

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/data_pipeline` | PostgreSQL DSN |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis broker URL |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | Redis result backend (separate DB) |
| `API_HOST` | `0.0.0.0` | FastAPI bind host |
| `API_PORT` | `8000` | FastAPI bind port |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins (restrict in production) |
| `WHISPER_API_URL` | `http://localhost:9000` | Remote Whisper service URL |
| `MODEL_ENDPOINT` | `http://localhost:8080/v1/completions` | LLM completions endpoint |
| `PREFECT_API_URL` | `http://localhost:4200/api` | Prefect orchestration (optional) |

Data directories are derived from `config.py` and created automatically on startup:

| Path | Purpose |
|------|---------|
| `data/uploads/` | Incoming file uploads |
| `data/processed/` | Post-processing artefacts |
| `data/exports/` | Generated export files |
| `data/audio/` | Stored audio segments |

---

## 5. Database Schema

### Core Tables

#### `text_datasets`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `name` | VARCHAR(255) | Required |
| `description` | TEXT | |
| `task_type` | ENUM(TaskType) | GENERAL, MCQ, … |
| `column_mapping` | JSON | Original CSV header → internal field |
| `original_headers` | JSON | |
| `created_at` / `updated_at` | TIMESTAMP | UTC |

#### `text_records`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `dataset_id` | FK → text_datasets | |
| `original_text` | TEXT | |
| `raw_data` | JSON | All original columns |
| `is_bahasa_rojak` | BOOLEAN | |
| `classification_label` | VARCHAR(255) | |
| `modified_text` / `subject_added` / `context_added` | TEXT | |
| `question_1/2/3` | TEXT | |
| `is_annotated` | BOOLEAN | |
| `annotated_by` / `annotated_at` | VARCHAR / TIMESTAMP | |

#### `asr_datasets`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `name` | VARCHAR(255) | |
| `description` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMP | |

#### `audio_files`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `dataset_id` | FK → asr_datasets | |
| `filename` | VARCHAR(512) | |
| `file_path` | VARCHAR(1024) | Absolute path |
| `file_size` | INTEGER | bytes |
| `duration` | FLOAT | seconds |
| `whisper_transcript` / `whisper_language` / `whisper_confidence` | TEXT / VARCHAR / FLOAT | |
| `qwen3_transcript` / `qwen3_language` / `qwen3_confidence` | TEXT / VARCHAR / FLOAT | |
| `corrected_transcript` | TEXT | Human annotation |
| `status` | ENUM(TranscriptionStatus) | pending → transcribing → transcribed → completed |
| `annotated_by` / `annotated_at` | VARCHAR / TIMESTAMP | |

### BR Pipeline Tables

#### `br_pipeline_runs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `dataset_id` | FK → text_datasets | CASCADE delete |
| `total_records` | INTEGER | |
| `processed_records` | INTEGER | |
| `pending_validation` | INTEGER | |
| `current_stage` | ENUM(BRPipelineStage) | |
| `status` | VARCHAR(50) | pending / running / completed / failed |
| `system_prompt` | TEXT | Per-run LLM prompt override |
| `started_at` / `completed_at` / `created_at` | TIMESTAMP | |

#### `br_record_stages`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `pipeline_run_id` | FK → br_pipeline_runs | |
| `text_record_id` | FK → text_records | |
| `current_stage` | ENUM(BRPipelineStage) | |
| `is_bahasa_rojak` / `br_confidence` / `detected_language` | | Stage 1 |
| `restructured_text` / `skip_restructure` / `is_discarded` / `restructure_metadata` | | Stage 2 |
| `generated_questions` | JSON | Stage 3: array of 3 strings |
| `selected_question_index` / `selected_question` / `validated_by` / `validated_at` | | Stage 4 |
| `model_responses` | JSON | Stage 5: `{model_name: {response, problems}}` |
| `completed` | BOOLEAN | |
| `error_message` | TEXT | |

#### `br_model_configs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `name` | VARCHAR(255) UNIQUE | |
| `model_type` | VARCHAR(100) | openai / local / anthropic / … |
| `model_id` | VARCHAR(255) | |
| `api_endpoint` | VARCHAR(512) | |
| `api_key_env_var` | VARCHAR(100) | Name of env var holding the key |
| `parameters` | JSON | temperature, max_tokens, … |
| `is_active` | BOOLEAN | |

---

## 6. API Reference

### Health & Stats

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| GET | `/api/stats` | Global counts |
| GET | `/api/stats/datasets` | Per-dataset statistics |

### ASR Endpoints (`/api/asr/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/asr/datasets` | List all ASR datasets |
| POST | `/asr/datasets` | Create dataset `{name, description}` |
| DELETE | `/asr/datasets/{id}` | Delete dataset + files |
| POST | `/asr/datasets/{id}/upload` | Upload audio files (multipart) |
| POST | `/asr/datasets/{id}/youtube` | Import from YouTube |
| POST | `/asr/datasets/{id}/transcribe-all` | Batch transcribe (Celery) |
| POST | `/asr/datasets/{id}/segment-all` | Segment all files (Celery) |
| GET | `/asr/datasets/{id}/files` | List audio files (paginated + filtered) |
| GET | `/asr/datasets/{id}/export` | Export CSV/JSONL/ZIP |
| GET | `/asr/files/{id}` | Get file metadata |
| GET | `/asr/files/{id}/audio` | Stream audio bytes |
| POST | `/asr/files/{id}/transcribe` | Transcribe single file |
| POST | `/asr/files/{id}/retranscribe` | Clear + re-transcribe |
| POST | `/asr/files/{id}/segment` | Segment single file |
| POST | `/asr/files/{id}/annotate` | Save corrected transcript |
| POST | `/asr/files/{id}/status` | Update status |
| DELETE | `/asr/files/{id}` | Delete audio file |
| POST | `/asr/files/fuse` | Fuse multiple files into one |
| GET | `/asr/exports/{task_id}/download` | Download completed export ZIP |
| GET | `/asr/tasks/{task_id}/status` | Celery task status |

### Text Endpoints (`/api/text/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/text/datasets` | List text datasets |
| POST | `/text/datasets` | Create dataset |
| GET | `/text/datasets/{id}` | Get dataset detail |
| PUT | `/text/datasets/{id}` | Update dataset |
| DELETE | `/text/datasets/{id}` | Delete dataset |
| POST | `/text/datasets/{id}/upload` | Upload CSV/JSON |
| GET | `/text/datasets/{id}/records` | Get records (paginated) |
| GET | `/text/datasets/{id}/export` | Export CSV/JSONL |
| GET | `/text/records/{id}` | Get single record |
| DELETE | `/text/records/{id}` | Delete record |
| POST | `/text/records/{id}/annotate/bahasa-rojak` | Annotate BR flag |
| POST | `/text/records/{id}/annotate/classification` | Annotate label |
| POST | `/text/records/{id}/annotate/modification` | Annotate text modification |
| POST | `/text/records/{id}/annotate/questions` | Annotate questions |
| GET | `/text/response-pool` | Global response pool |

### BR Pipeline Endpoints (`/api/br-pipeline/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/br-pipeline/start` | Start pipeline for a dataset |
| GET | `/br-pipeline/status/{id}` | Pipeline run status |
| GET | `/br-pipeline/pipelines` | List all pipeline runs |
| POST | `/br-pipeline/run-stage1` | Trigger Stage 1 (Celery) |
| POST | `/br-pipeline/run-stage2` | Trigger Stage 2 (Celery) |
| POST | `/br-pipeline/run-stage3` | Trigger Stage 3 (Celery) |
| GET | `/br-pipeline/stage-progress/{id}` | Stage progress counters |
| GET | `/br-pipeline/classification/{id}` | Classification records |
| PATCH | `/br-pipeline/classification/{record_id}` | Update classification |
| DELETE | `/br-pipeline/classification/{record_id}` | Delete record |
| GET | `/br-pipeline/restructure/{id}` | Restructure records |
| PATCH | `/br-pipeline/restructure/{record_id}` | Update restructured text |
| POST | `/br-pipeline/restructure/{record_id}/auto` | Auto-restructure single |
| GET | `/br-pipeline/restructure/{id}/export-csv` | Export Stage 2 CSV |
| GET | `/br-pipeline/questions/{id}` | Question records |
| POST | `/br-pipeline/questions/{id}/generate-all` | Batch generate questions |
| POST | `/br-pipeline/questions/{record_id}/generate` | Generate for single |
| POST | `/br-pipeline/questions/{record_id}/select` | Select best question |
| GET | `/br-pipeline/questions/{id}/export-jsonl` | Export Stage 3 JSONL |
| GET | `/br-pipeline/responses/{id}` | Response records |
| POST | `/br-pipeline/responses/{record_id}/generate` | Generate responses |
| POST | `/br-pipeline/responses/{id}/generate-all` | Batch generate |
| POST | `/br-pipeline/responses/{record_id}/edit-problems` | Edit problem flags |
| GET | `/br-pipeline/responses/{id}/search` | Search responses |
| GET | `/br-pipeline/responses/{id}/similarity` | Similarity analysis |
| GET | `/br-pipeline/results/{id}` | Final results |
| GET | `/br-pipeline/system-prompt/{id}` | Get system prompt |
| PUT | `/br-pipeline/system-prompt/{id}` | Update system prompt |
| GET | `/br-pipeline/task-status/{task_id}` | Celery task status |

### Settings Endpoints (`/api/settings/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings/models` | Get model config |
| PUT | `/settings/models` | Update model config |
| GET | `/settings/models/ollama/available` | List available Ollama models |
| POST | `/settings/models/ollama/pull` | Pull Ollama model |
| GET | `/settings/models/whisper/status` | Whisper service status |
| POST | `/settings/backup` | Create database backup |
| GET | `/settings/backups` | List backups |
| GET | `/settings/backup/download` | Download backup file |

---

## 7. Background Task System

### Celery Configuration (`backend/celery_app.py`)

```
Broker:  redis://localhost:6379/0
Backend: redis://localhost:6379/1
```

### Queues

| Queue | Purpose |
|-------|---------|
| `celery` | Default — general tasks |
| `transcription` | Whisper + Qwen3 ASR tasks (CPU/GPU intensive) |
| `br_pipeline` | BR stage execution tasks |

### Scheduled Tasks (Celery Beat)

| Task | Schedule | Description |
|------|----------|-------------|
| `backup_tasks.daily_backup` | Daily 02:00 | Full `pg_dump` |
| `backup_tasks.frequent_backup` | Every 30 min | Incremental backup |
| `tasks.cleanup_stale_transcriptions` | Every 10 min | Reset stuck transcriptions |

### Key Task Functions

| Task | Module | Queue |
|------|--------|-------|
| `transcribe_audio_task` | `backend.tasks` | `transcription` |
| `batch_transcribe_task` | `backend.tasks` | `transcription` |
| `run_br_stage1_task` | `backend.br_pipeline_tasks` | `br_pipeline` |
| `run_br_stage2_task` | `backend.br_pipeline_tasks` | `br_pipeline` |
| `run_br_stage3_task` | `backend.br_pipeline_tasks` | `br_pipeline` |
| `generate_responses_task` | `backend.br_pipeline_tasks` | `br_pipeline` |
| `export_asr_dataset_task` | `backend.tasks` | `celery` |

---

## 8. Deployment

### Option A — Single Server (current default)

FastAPI serves both the API (`/api/*`) and the built React SPA (`/*`).

```bash
# 1. Build frontend
cd frontend-react && npm run build && cd ..

# 2. Start infrastructure
docker compose up -d

# 3. Run migrations
PYTHONPATH=. alembic upgrade head

# 4. Start Celery
PYTHONPATH=. celery -A backend.celery_app:celery_app worker \
  --beat --pool=solo --loglevel=info \
  --queues=celery,transcription,br_pipeline &

# 5. Start API (serves both API + SPA)
uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 2
```

### Option B — Nginx Reverse Proxy (production)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Serve built React app
    location / {
        root /path/to/DataSupportTool/frontend-react/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API to FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

With nginx in front, run FastAPI without the SPA mount:
```bash
uvicorn backend.api:app --host 127.0.0.1 --port 8000 --workers 4
```

### Environment Notes

| Setting | Development | Production |
|---------|-------------|------------|
| `CORS_ORIGINS` | `*` | `https://yourdomain.com` |
| `reload` (uvicorn) | `True` | `False` |
| Workers | 1 | 4+ |
| `--pool` (Celery) | `solo` | `prefork` |

---

## 9. Alembic Migrations

```bash
# Apply all pending migrations
PYTHONPATH=. alembic upgrade head

# Generate a new migration from model changes
PYTHONPATH=. alembic revision --autogenerate -m "add_column_xyz"

# Downgrade one step
PYTHONPATH=. alembic downgrade -1

# Show current revision
PYTHONPATH=. alembic current
```

Migration scripts live in `alembic/versions/`. The `alembic.ini` at project root points to `backend/database.py` for the engine.

---

## 10. Logging

### Backend

Configured in `backend/utils/logger.py` using `python-json-logger`.  
Output targets: console (INFO+) and `logs/api.log` (DEBUG+).

Request/response logging is handled by `backend/middleware/logging_middleware.py`, which attaches a unique `X-Request-ID` header to every response.

### Frontend

The `src/utils/logger.js` `RequestLogger` class wraps every Axios request/response and logs to the browser console with timing information.

### Log Files

| File | Content |
|------|---------|
| `logs/api.log` | FastAPI access + application logs |
| `celery.log` | Celery worker task logs |
| `uvicorn.log` | Uvicorn ASGI server logs |

See `docs/LOGGING_SETUP.md` for the full logging configuration reference.
