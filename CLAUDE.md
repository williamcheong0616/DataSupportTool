# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Common Commands

All commands assume the project root as working directory and `conda activate datasupport` is active.

### Start everything (production mode)
```bash
bash scripts/start_services.sh
```
This starts Docker Compose (PostgreSQL + Redis + Flower), Celery worker+beat, and FastAPI. Always run from the project root so `PYTHONPATH` is set correctly.

### Development mode (hot-reload, four terminals)
```bash
# Terminal 1 — infrastructure
docker compose up -d

# Terminal 2 — Celery worker + beat
PYTHONPATH=. celery -A backend.celery_app:celery_app worker \
  --beat --pool=solo --loglevel=info \
  --queues=celery,transcription,br_pipeline

# Terminal 3 — FastAPI (reloads on backend/ changes)
PYTHONPATH=. python run_api.py

# Terminal 4 — Vite dev server (proxies /api → :8000, UI at :3000)
cd frontend-react && npm run dev
```

### Frontend
```bash
cd frontend-react
npm install          # first time / after package.json changes
npm run build        # production build → frontend-react/dist/
npm run dev          # dev server at http://localhost:3000
```

### Database migrations
```bash
PYTHONPATH=. alembic upgrade head                              # apply all pending
PYTHONPATH=. alembic revision --autogenerate -m "description" # generate new migration
PYTHONPATH=. alembic downgrade -1                             # roll back one step
```
`alembic.ini` does not hardcode `sqlalchemy.url` — it is read from `DATABASE_URL` in `.env`.

### Stop all services
```bash
pkill -f "run_api.py"; pkill -f "celery -A"
docker compose down
```

---

## Architecture

### Request path
```
Browser → Vite dev server (:3000) -/api proxy→ FastAPI (:8000)
                     or
Browser → FastAPI (:8000) /* → serves frontend-react/dist/ (production)
```

FastAPI registers all `/api/*` routers first, then mounts the React SPA as a catch-all at `/{full_path:path}`. API routes always win over the SPA catch-all.

### Backend (`backend/`)

| File / directory | Role |
|---|---|
| `api.py` | App factory — assembles middleware, routers, SPA mount |
| `database.py` | SQLAlchemy engine + `get_db()` FastAPI dependency |
| `models.py` | Core ORM models: `TextDataset`, `TextRecord`, `ASRDataset`, `AudioFile`, `FinetunedModelOutput`, `ErrorAnnotation` |
| `br_pipeline_models.py` | BR-specific ORM models: `BRPipelineRun`, `BRRecordStage`, `ModelConfig` |
| `schemas.py` / `br_pipeline_schemas.py` | Pydantic request/response schemas |
| `enums.py` | Shared `TaskType`, `TranscriptionStatus` enums |
| `celery_app.py` | Celery instance, task routing, Beat schedule |
| `tasks.py` | Celery tasks for ASR: transcription, segmentation, export |
| `br_pipeline_tasks.py` | Celery tasks for BR stages: question generation, model responses |
| `backup_tasks.py` | Scheduled `pg_dump` backup tasks |
| `routes/` | Modular FastAPI routers: `health`, `text`, `asr`, `settings`, `error_analysis` |
| `br_pipeline_routes.py` | BR pipeline router (kept at `backend/` root, loaded with try/except in `api.py`) |
| `br_pipeline_orchestrator.py` | Stage orchestration logic called by routes and tasks |
| `services/transcription_service.py` | Whisper + Qwen3 invocation logic |
| `services/backup_service.py` | `pg_dump` execution + rotation |
| `whisper.py` / `qwen3_asr.py` | ASR engine wrappers |
| `ollama_service.py` | LLM inference client (Ollama / OpenAI-compatible) |
| `youtube_service.py` | `yt-dlp` download wrapper |
| `audio_segment.py` | Silero VAD segmentation |
| `utils/logger.py` | JSON structured logging setup |
| `middleware/logging_middleware.py` | Per-request logging + `X-Request-ID` injection |

`config.py` (project root, not inside `backend/`) is the single source for all configuration; it reads from `.env` via `python-dotenv`.

### Celery task queues

Three queues with explicit routing:
- `celery` — default / general tasks
- `transcription` — Whisper and Qwen3 ASR tasks (rate-limited to 10/min)
- `br_pipeline` — question generation and model response tasks

The worker must subscribe to all three: `--queues=celery,transcription,br_pipeline`.

### BR Pipeline stages

Five stages stored per-record in `BRRecordStage`. Stages 1–3 and 5 are Celery tasks; Stage 4 is human input only.

```
Stage 1: BR classification (LLM)
Stage 2: Text restructuring (LLM)
Stage 3: Question generation (LLM) — 3 candidates per record
Stage 4: Human selects best question
Stage 5: Model response generation (LLM × N models)
```

### Frontend (`frontend-react/`)

React 18 SPA using React Router v6 for client-side routing. `api.js` is the single Axios instance for all backend calls. All pages are in `src/pages/`. The Vite config proxies `/api` to `:8000` during development.

### Infrastructure (Docker Compose)

| Container | Port | Purpose |
|---|---|---|
| `dst-postgres` | 5432 | PostgreSQL 16 — primary data store |
| `dst-redis` | 6379 | Redis 7 — Celery broker (db 0) and result backend (db 1) |
| `dst-flower` | 5556 | Flower — Celery task monitor UI |

Data is persisted in named Docker volumes (`pgdata`, `redisdata`).

### Key URLs (all local)

| URL | What |
|---|---|
| http://localhost:8000 | App (production build) |
| http://localhost:3000 | App (Vite dev server) |
| http://localhost:8000/api/docs | Swagger UI |
| http://localhost:5556 | Flower (Celery monitor) |

---

## Environment

- Python environment: conda env named `datasupport` (Python 3.12)
- `PYTHONPATH` must be set to the project root — `run_api.py` and `start_services.sh` handle this automatically, but manual `celery` or `alembic` invocations need `PYTHONPATH=.` prefixed
- Timezone for Celery Beat is `Asia/Kuala_Lumpur`
- Audio files are stored under `data/audio/`; uploads under `data/uploads/`; exports under `data/exports/`
