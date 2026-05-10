# DataSupportTool 🎙️📝

A self-hosted web platform for building annotated NLP training datasets. Supports two end-to-end workflows: **ASR (speech recognition)** annotation with dual-engine transcription, and a **5-stage Bahasa Rojak pipeline** combining LLM automation with human-in-the-loop validation.

**Tech Stack:**
- **Frontend**: React 18 + Vite + Tailwind CSS (built SPA served by FastAPI)
- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **ASR Engines**: Whisper (MLX / standard) + Qwen3 ASR — run in parallel via Celery
- **LLM Inference**: Ollama (local) or any OpenAI-compatible endpoint
- **Task Queue**: Celery + Redis (required for async transcription and pipeline tasks)
- **Infrastructure**: Docker Compose (PostgreSQL 16, Redis 7, Flower monitor)

---

## ✨ Features

### 🎙️ ASR Annotation
- Upload MP3, WAV, M4A, FLAC files or import directly from YouTube (via yt-dlp)
- **Silero VAD segmentation** — natural speech boundaries (≤30 s kept whole, >30 s split)
- **Dual transcription**: Whisper + Qwen3 ASR run in parallel as background Celery tasks
- **WaveSurfer.js annotation UI** — waveform visualisation, speed control, Find & Replace (`Ctrl+H`)
- Export as **CSV**, **JSONL**, or **ZIP** (audio + annotations bundled)

### 📝 Text Annotation & BR Pipeline
- Upload CSV / JSON text datasets and annotate Bahasa Rojak flag, classification, and questions
- **5-stage automated pipeline**: BR Detection → Restructuring → Question Generation → Human Validation → Model Responses
- **Dashboard** shows live per-dataset pipeline completion progress
- **Keyboard-driven validation UI** — process 60–100 records/hour with `j/k`, `1/2/3`, `q`, `g` hotkeys
- Export Stage 2 as **CSV**, Stage 3 as **JSONL** (fine-tuning ready)

### 🛡️ Operations
- **Automated backup**: `scripts/backup.sh` — `pg_dump` + `rclone` cloud sync
- **Celery Beat** scheduled tasks: daily backup, 30-min incremental, stale transcription cleanup
- **Flower** task monitor at `http://localhost:5556`
- **Dark mode** — system-wide toggle, persisted in `localStorage`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│         Browser  (React 18 SPA — served by FastAPI /*           │
│  Dashboard · ASR Datasets · Text Datasets · BR Pipeline         │
│  ASR Annotate · BR Classification/Restructure/Questions/Responses│
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTP / REST  (/api/*)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FastAPI  (port 8000)                           │
│  /api/health   /api/stats                                        │
│  /api/asr/*    /api/text/*    /api/br-pipeline/*                │
│  /api/settings/*                                                 │
│  /*  → serves React SPA (frontend-react/dist/)                  │
└──────────────┬──────────────────────────────┬───────────────────┘
               │ SQLAlchemy ORM               │ Celery tasks
               ▼                              ▼
┌─────────────────────┐         ┌─────────────────────────────────┐
│  PostgreSQL  :5432  │         │  Redis  :6379 (broker + result) │
└─────────────────────┘         └──────────────────┬──────────────┘
                                                   │
                                        ┌──────────▼──────────┐
                                        │    Celery Worker     │
                                        │  + Beat scheduler    │
                                        │  queues:             │
                                        │    celery            │
                                        │    transcription     │
                                        │    br_pipeline       │
                                        └─────────────────────┘
```

---

## 📁 Project Structure

```
DataSupportTool/
├── backend/
│   ├── routes/
│   │   ├── asr.py                  # ASR annotation endpoints
│   │   ├── text.py                 # Text annotation endpoints
│   │   ├── health.py               # Health + stats
│   │   └── settings.py             # Model config + backup
│   ├── services/
│   │   ├── transcription_service.py
│   │   └── backup_service.py
│   ├── utils/
│   │   ├── logger.py               # JSON structured logging
│   │   └── helpers.py
│   ├── middleware/
│   │   └── logging_middleware.py   # Request/response logging + X-Request-ID
│   ├── api.py                      # App factory, router assembly, SPA mount
│   ├── models.py                   # SQLAlchemy models (ASR + Text + Pipeline)
│   ├── br_pipeline_models.py       # BR Pipeline DB models
│   ├── br_pipeline_routes.py       # BR Pipeline API router
│   ├── br_pipeline_orchestrator.py # Stage orchestration logic
│   ├── br_pipeline_tasks.py        # Celery tasks for BR stages
│   ├── br_pipeline_schemas.py      # Pydantic schemas (BR)
│   ├── celery_app.py               # Celery + Beat config
│   ├── database.py                 # Engine + session factory
│   ├── enums.py                    # Shared enumerations
│   ├── schemas.py                  # Pydantic schemas (ASR + Text)
│   ├── tasks.py                    # Celery tasks (ASR transcription, export)
│   ├── audio_segment.py            # Silero VAD segmentation
│   ├── whisper.py                  # Whisper transcription wrapper
│   ├── qwen3_asr.py                # Qwen3 ASR wrapper
│   ├── ollama_service.py           # Ollama LLM client
│   ├── youtube_service.py          # yt-dlp download wrapper
│   └── similarity.py               # Cosine similarity utility
├── frontend-react/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ASRDatasets.jsx
│   │   │   ├── ASRAnnotate.jsx
│   │   │   ├── TextDatasets.jsx
│   │   │   ├── TextAnnotate.jsx
│   │   │   ├── TextResponsePool.jsx
│   │   │   ├── BRClassification.jsx    # Stage 1
│   │   │   ├── BRRestructure.jsx       # Stage 2
│   │   │   ├── BRQuestionValidation.jsx# Stage 3 + 4
│   │   │   ├── BRModelResponses.jsx    # Stage 5
│   │   │   ├── BRPipelineResults.jsx
│   │   │   ├── BRPipelineValidation.jsx
│   │   │   └── Settings.jsx
│   │   ├── utils/
│   │   │   └── logger.js               # Frontend request logger
│   │   ├── api.js                      # Centralised Axios API client
│   │   ├── App.jsx                     # Router + nav shell
│   │   └── main.jsx
│   ├── dist/                           # Production build output (gitignored)
│   ├── package.json
│   └── vite.config.js
├── alembic/                            # DB migration scripts
├── scripts/
│   ├── start_services.sh               # One-shot startup (Docker + Celery + FastAPI)
│   ├── backup.sh                       # pg_dump + rclone cloud sync
│   └── init_production_db.py
├── docs/
│   ├── USER_GUIDE.md                   # End-user guide (all workflows, shortcuts)
│   ├── TECHNICAL_GUIDE.md              # Architecture, API reference, deployment
│   ├── TECHNICAL_PAPER.md              # Academic system design paper
│   ├── BACKUP_SETUP.md                 # Backup automation + rclone setup
│   ├── CLEANUP_SUMMARY.md              # Code cleanup history
│   └── LOGGING_SETUP.md               # Logging configuration reference
├── data/                               # Runtime data — audio, uploads, exports (gitignored)
├── logs/                               # Application logs (gitignored)
├── sql_backups/                        # Database backup archives
├── config.py                           # Centralised config (reads .env)
├── docker-compose.yml                  # PostgreSQL + Redis + Flower
├── run_api.py                          # Uvicorn launcher
├── alembic.ini
├── requirements.txt
├── .env.example
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Use conda env `datasupport` |
| Node.js | 18 LTS+ | For frontend build |
| Docker | 24+ | PostgreSQL + Redis + Flower |
| FFmpeg | any | Audio processing |

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, REDIS_URL, MODEL_ENDPOINT
```

Key `.env` variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/data_pipeline` | PostgreSQL DSN |
| `REDIS_URL` | `redis://localhost:6379/0` | Celery broker |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | Celery results |
| `API_HOST` | `0.0.0.0` | FastAPI bind host |
| `API_PORT` | `8000` | FastAPI bind port |
| `MODEL_ENDPOINT` | `http://localhost:8080/v1/completions` | LLM endpoint (Ollama/vLLM) |
| `CORS_ORIGINS` | `*` | Restrict in production |

### 2. Install dependencies

```bash
# Python (use your conda env)
conda activate datasupport
pip install -r requirements.txt

# Node.js
cd frontend-react && npm install && cd ..
```

### 3. Build the frontend

```bash
cd frontend-react && npm run build && cd ..
```

### 4. Start everything

```bash
bash scripts/start_services.sh
```

This starts PostgreSQL + Redis via Docker Compose, runs Celery worker + Beat scheduler, then starts FastAPI.

Open **http://localhost:8000** — FastAPI serves both the API and the React SPA.

| URL | What |
|-----|------|
| http://localhost:8000 | React SPA (production build) |
| http://localhost:8000/api/docs | Swagger UI |
| http://localhost:8000/api/health | Health check |
| http://localhost:5556 | Flower (Celery monitor) |

> **Development mode** (hot-reload):
> ```bash
> docker compose up -d                           # infrastructure
> conda activate datasupport
> PYTHONPATH=. celery -A backend.celery_app:celery_app worker \
>   --beat --pool=solo --loglevel=info \
>   --queues=celery,transcription,br_pipeline &  # background worker
> python run_api.py &                            # API at :8000
> cd frontend-react && npm run dev               # Vite at :3000 (proxies /api to :8000)
> ```

---

## 📋 ASR Workflow

```
Upload / YouTube → Segment (VAD) → Transcribe (Whisper + Qwen3) → Annotate → Export
```

| Step | How |
|------|-----|
| **1. Create dataset** | ASR Annotation → **+ Create Dataset** |
| **2. Add audio** | Upload files (MP3/WAV/M4A/FLAC) or **Import YouTube** URL |
| **3. Segment** | Click **✂ Segment** — Silero VAD splits at natural speech boundaries |
| **4. Transcribe** | **🎤 Transcribe All** — Whisper + Qwen3 run in parallel via Celery |
| **5. Annotate** | **Annotate** button — waveform player + editable transcript |
| **6. Export** | **CSV / JSONL / ZIP** — large exports run as background tasks |

### Annotation keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause audio |
| `Ctrl+Left/Right` | Rewind / Forward 5 s |
| `Ctrl+S` | Save annotation |
| `Ctrl+Enter` | Save + next file |
| `Ctrl+H` | Find & Replace |

---

## 📝 BR Pipeline Workflow

```
Upload text → Stage 1: BR Detection → Stage 2: Restructure →
Stage 3: Question Generation → Stage 4: Human Validation (select question) →
Stage 5: Model Responses → Export
```

Stages 1–3 and 5 run **automatically** as Celery tasks. Stage 4 requires human input.

| Stage | Automated | Output |
|-------|-----------|--------|
| 1. BR Detection | ✅ LLM | `is_bahasa_rojak` flag + confidence |
| 2. Text Restructuring | ✅ LLM | Consolidated MCQ text |
| 3. Question Generation | ✅ LLM | 3 candidate questions per record |
| 4. Human Validation | ❌ Manual | Selected best question |
| 5. Model Responses | ✅ LLM × N | Response + problems per model |

### Stage 4 keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous record |
| `1` `2` `3` | Select question |
| `q` | Generate questions for current record |
| `g` | Generate model response |

### Exports

| Stage | Format | Use |
|-------|--------|-----|
| Stage 2 | CSV | Restructured texts |
| Stage 3 | JSONL | Fine-tuning instruction dataset |
| Final | CSV | Full results (question + model responses + problems) |

---

## 📊 API Reference (Summary)

Full reference in [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md).

### Health & Stats
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| GET | `/api/stats` | Global counts |

### ASR (`/api/asr/`)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/asr/datasets` | List / create datasets |
| POST | `/asr/datasets/{id}/upload` | Upload audio files |
| POST | `/asr/datasets/{id}/youtube` | Import from YouTube |
| POST | `/asr/datasets/{id}/transcribe-all` | Batch transcribe (Celery) |
| GET | `/asr/datasets/{id}/export` | Export CSV/JSONL/ZIP |
| GET | `/asr/files/{id}/audio` | Stream audio |
| POST | `/asr/files/{id}/annotate` | Save corrected transcript |
| GET | `/asr/tasks/{task_id}/status` | Celery task status |

### Text (`/api/text/`)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/text/datasets` | List / create datasets |
| POST | `/text/datasets/{id}/upload` | Upload CSV/JSON |
| GET | `/text/datasets/{id}/records` | Paginated records |
| GET | `/text/datasets/{id}/export` | Export |
| POST | `/text/records/{id}/annotate/*` | Annotate (BR flag / classification / modification / questions) |

### BR Pipeline (`/api/br-pipeline/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/br-pipeline/start` | Start pipeline for a dataset |
| GET | `/br-pipeline/status/{id}` | Pipeline status |
| POST | `/br-pipeline/run-stage1` | Trigger Stage 1 (Celery) |
| POST | `/br-pipeline/run-stage2` | Trigger Stage 2 (Celery) |
| POST | `/br-pipeline/run-stage3` | Trigger Stage 3 (Celery) |
| GET | `/br-pipeline/restructure/{id}/export-csv` | Stage 2 CSV |
| POST | `/br-pipeline/questions/{id}/generate-all` | Batch generate questions |
| POST | `/br-pipeline/questions/{record_id}/select` | Select best question |
| GET | `/br-pipeline/questions/{id}/export-jsonl` | Stage 3 JSONL |
| POST | `/br-pipeline/responses/{id}/generate-all` | Batch generate responses |
| GET | `/br-pipeline/results/{id}` | Final results |

---

## 🛠️ Technology Details

### Dual ASR Engines

| Engine | Model | Platform |
|--------|-------|----------|
| **Whisper** | `mlx-community/whisper-large-v3-turbo` | MLX (Apple Silicon) or PyTorch (Linux/GPU) |
| **Qwen3 ASR** | Alibaba Qwen3-based | CPU/GPU, supports code-mixed Malay/English |

Both engines run in parallel Celery tasks. The annotator sees both transcripts side-by-side as reference during correction.

### Silero VAD Segmentation

1. Resample to 16 kHz mono
2. Slide 512-sample window → frame-level voice probability
3. Merge consecutive voiced frames into speech segments
4. Keep segments ≤ 30 s; split longer runs at 30 s boundaries
5. Result: natural utterance-length training samples

### Database Schema (summary)

| Table | Purpose |
|-------|---------|
| `asr_datasets` / `audio_files` | ASR workflow |
| `text_datasets` / `text_records` | Text annotation |
| `br_pipeline_runs` | Per-run aggregate state |
| `br_record_stages` | Per-record stage outputs (all 5 stages) |
| `br_model_configs` | LLM model registry |
| `pipeline_datasets` / `pipeline_runs` / `model_responses` / `validation_records` | Generic pipeline models |

Full schema in [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md).

---

## 🧪 Development

```bash
# Backend (hot-reload)
conda activate datasupport
python run_api.py

# Frontend (Vite dev server — proxies /api to :8000)
cd frontend-react && npm run dev

# Build frontend for production
cd frontend-react && npm run build

# DB migrations
conda activate datasupport
PYTHONPATH=. alembic upgrade head
PYTHONPATH=. alembic revision --autogenerate -m "describe change"
```

---

## 📦 Deployment

### Single-Server (Recommended)

```bash
cd frontend-react && npm run build && cd ..
bash scripts/start_services.sh
# → http://localhost:8000
```

FastAPI serves both API (`/api/*`) and the React SPA (`/*`) on port 8000.

### Manual

```bash
# 1. Build frontend
cd frontend-react && npm run build && cd ..

# 2. Apply DB migrations
conda activate datasupport
PYTHONPATH=. alembic upgrade head

# 3. Start Celery
PYTHONPATH=. celery -A backend.celery_app:celery_app worker --beat \
  --queues=celery,transcription,br_pipeline --pool=prefork --concurrency=4 \
  --loglevel=info &

# 4. Start API
uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 4
```

### Nginx (optional reverse proxy)

```nginx
location / {
    root /path/to/DataSupportTool/frontend-react/dist;
    try_files $uri $uri/ /index.html;
}
location /api/ {
    proxy_pass http://127.0.0.1:8000;
}
```

See [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) for the full nginx config.

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| App doesn't load at :8000 | Check `curl http://localhost:8000/api/health`; run `npm run build` if dist/ missing |
| Transcription stuck | Check Celery is running; `tail -f celery.log`; restart via `start_services.sh` |
| Database error | Check `DATABASE_URL` in `.env`; run `docker compose up -d` |
| YouTube import fails | `pip install -U yt-dlp`; verify FFmpeg (`ffmpeg -version`) |
| BR pipeline stuck | Check Flower at `http://localhost:5556`; review `logs/api.log` |
| Waveform not loading | Check browser console for CORS errors; verify file exists in `data/audio/` |
| `ModuleNotFoundError` | Ensure `conda activate datasupport` and `PYTHONPATH=.` are set |

---

## 🎯 Roadmap

- [ ] **Speaker diarization** (pyannote.audio)
- [ ] **WER/CER metrics** — score Whisper output against corrected transcript
- [ ] **Active learning** — surface lowest-confidence files first
- [ ] **SRT/VTT export** — subtitle format for video corpora
- [ ] **Multi-user auth** — JWT-based annotator accounts with assignment queues
- [ ] **Automated BR detection model** — fine-tune BERT/RoBERTa on accumulated Stage 1 labels

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Step-by-step guide for all workflows, keyboard shortcuts, troubleshooting FAQ |
| [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) | Full architecture, complete API reference, DB schema, deployment options |
| [docs/TECHNICAL_PAPER.md](docs/TECHNICAL_PAPER.md) | Academic-style system design and pipeline analysis |
| [docs/BACKUP_SETUP.md](docs/BACKUP_SETUP.md) | Automated backup configuration (pg_dump + rclone) |

---

## 📜 License

MIT License — see LICENSE file for details.

---

*Built for Bahasa Rojak NLP research* 🇲🇾
