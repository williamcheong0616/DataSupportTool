# DataSupportTool — User Guide

> **Version 3.0** · Last updated May 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Requirements](#2-system-requirements)
3. [Installation & First Launch](#3-installation--first-launch)
4. [Dashboard](#4-dashboard)
5. [ASR Annotation Workflow](#5-asr-annotation-workflow)
6. [Text Annotation Workflow](#6-text-annotation-workflow)
7. [Bahasa Rojak (BR) Pipeline](#7-bahasa-rojak-br-pipeline)
8. [Response Pool](#8-response-pool)
9. [Settings](#9-settings)
10. [Dark Mode](#10-dark-mode)
11. [Keyboard Shortcuts](#11-keyboard-shortcuts)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview

DataSupportTool is a local web application for creating annotated training datasets across two workflows:

| Workflow | Purpose |
|----------|---------|
| **ASR** | Upload audio → auto-transcribe (Whisper / Qwen3) → correct → export CSV/JSONL |
| **Text / BR Pipeline** | Import MCQ text → 5-stage automated + human pipeline → export training pairs |

All data stays on your machine; no data is sent to external services unless you configure external model endpoints.

---

## 2. System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Linux (Ubuntu 20.04+) / macOS 12+ | Ubuntu 22.04 LTS |
| Python | 3.11 | 3.12 |
| Node.js | 18 LTS | 20 LTS |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free | 100 GB+ |
| Docker | 24+ | latest |
| FFmpeg | any | latest |

---

## 3. Installation & First Launch

### Step 1 — Clone and configure

```bash
git clone <repo-url> DataSupportTool
cd DataSupportTool
cp .env.example .env
# Edit .env with your database/Redis URLs
```

Key `.env` variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/data_pipeline` | PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379/0` | Celery broker |
| `API_HOST` | `0.0.0.0` | FastAPI bind |
| `API_PORT` | `8000` | FastAPI port |
| `MODEL_ENDPOINT` | `http://localhost:8080/v1/completions` | LLM endpoint |

### Step 2 — Install dependencies

```bash
pip install -r requirements.txt
cd frontend-react && npm install && npm run build && cd ..
```

### Step 3 — Start all services

```bash
bash scripts/start_services.sh
```

Open **http://localhost:8000** in your browser.

> **Development mode** (hot-reload): run Docker + Celery + FastAPI + Vite dev server in four separate terminals. The Vite dev server runs at `http://localhost:3000` and proxies `/api` to the backend.

---

## 4. Dashboard

The Dashboard shows summary statistics and per-dataset progress at a glance.

| Section | Description |
|---------|-------------|
| Statistics cards | Total ASR files, text records, pipeline runs |
| Dataset breakdown | Per-dataset annotation/pipeline progress bars |

Click any dataset name to navigate directly to it.

---

## 5. ASR Annotation Workflow

### 5.1 Create a Dataset

1. Click **ASR Annotation** → **+ Create Dataset**.
2. Enter name and optional description → **Create**.

### 5.2 Add Audio

**Upload files**: Click **➕ Add Audio** and select MP3/WAV/M4A/FLAC files (max 100 MB each).

**Import from YouTube**:
1. Click **▶ Import YouTube** and paste a YouTube URL.
2. Choose segmentation: **VAD** (natural speech boundaries) or **Fixed-length** (15 s/30 s/60 s/120 s).
3. Toggle **Auto-transcribe** if you want transcription to queue immediately.
4. Click **Import**.

### 5.3 Segment Long Audio

Click **✂ Segment** on a file → adjust chunk length → **Segment**.  
Files ≤ 30 s are kept whole; longer runs are split at natural pause points detected by Silero VAD.

### 5.4 Transcribe

- **Single file**: Click **🎤 Transcribe** on the file row.
- **Whole dataset**: Click **🎤 Transcribe All** on the dataset card.

Both Whisper and Qwen3 ASR engines run in parallel as background Celery tasks.  
File status: `pending → transcribing → transcribed`.

### 5.5 Annotate

Click **Annotate** on a dataset to open the annotation interface:

```
[◀ Prev]  File 12 of 247  [Next ▶]
────────────────────────────────────────────
🎵 Waveform  [⏮][⏪5s][▶][5s⏩][⏭]  Speed: 1x
────────────────────────────────────────────
Whisper:  "teks asal..."
Qwen3:    "alternative..."
────────────────────────────────────────────
Corrected Transcript:
┌───────────────────────────────────────────┐
│ Edit here...                              │
└───────────────────────────────────────────┘
[Save — Ctrl+S]       [Complete — Ctrl+Enter]
```

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `Ctrl+Left` | Rewind 5 s |
| `Ctrl+Right` | Forward 5 s |
| `Ctrl+S` | Save annotation |
| `Ctrl+Enter` | Save + move to next |
| `Ctrl+H` | Find & Replace |

### 5.6 Export

Click **Export** on a dataset and choose:

| Format | Content |
|--------|---------|
| CSV | `filename, whisper_transcript, corrected_transcript, duration, status` |
| JSONL | Same fields, one JSON object per line |
| ZIP | Audio files + JSONL annotation bundled together |

Large exports run as background tasks and download automatically when ready.

---

## 6. Text Annotation Workflow

### 6.1 Create a Dataset

**Text Annotation** → **+ Create Dataset** → enter name and task type → **Create**.

### 6.2 Upload Data

Click **Upload Data** → select CSV or JSON file → map text column if prompted → **Upload**.

### 6.3 Annotate Records

Click **Annotate** and for each record:
- Toggle **Is Bahasa Rojak**
- Enter **Classification label**
- Write **Modified text**, **Subject**, **Context**
- Enter up to **3 questions**

Press `Ctrl+S` to save and advance.

### 6.4 Export

Click **Export → CSV** or **Export → JSONL** from the dataset card.

---

## 7. Bahasa Rojak (BR) Pipeline

The BR Pipeline automates processing of code-mixed MCQ text in five stages:

```
Upload → Stage 1: BR Detection → Stage 2: Restructure →
Stage 3: Question Generation → Stage 4: Human Validation →
Stage 5: Model Responses → Export
```

Stages 1–3 and Stage 5 run automatically as Celery background tasks.  
Stage 4 (selecting the best question) requires human input.

### 7.1 Start the Pipeline

From a Text Dataset, click **🚀 Start BR Pipeline**.  
Stages 1–3 begin automatically. A link appears to the pipeline dashboard.

### 7.2 Stage 1: BR Classification

View and override automated BR detection results.

| Control | Effect |
|---------|--------|
| Toggle (BR / Not BR) | Override detection |
| Language tags | Edit detected languages |
| Trash icon | Remove record from pipeline |
| Filters (top bar) | Show All / BR only / Non-BR only |

### 7.3 Stage 2: Text Restructuring

Review and edit AI-consolidated MCQ text.

| Button | Effect |
|--------|--------|
| Auto | Run AI restructuring for this record |
| Skip | Use original text |
| Discard | Remove from pipeline |
| Edit | Manually edit restructured text |
| Run Stage 2 | Batch-process all pending |

Click **Export CSV** to download restructured texts.

### 7.4 Stage 3: Question Generation & Validation

1. Click **Run Stage 3** to batch-generate questions.
2. For each record, three AI questions are shown — click the radio button to select the best.

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous record |
| `1`, `2`, `3` | Select question |
| `q` | Generate questions for current record |

Click **Export JSONL** for model fine-tuning format.

### 7.5 Stage 4: Model Response Generation

1. Open the **Responses** tab.
2. Click **Generate All** — selected questions are sent to all configured LLM models.
3. Edit **problems** (hallucinations, errors) per response using the edit icon.

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate records |
| `g` | Generate response for current record |

### 7.6 Pipeline Results

The **Results** page shows a full table: Record ID, BR flag, selected question, model, response, and problems flagged.  
Click **Export CSV** for a complete dump.

---

## 8. Response Pool

**Text Annotation → Response Pool** provides a global view of all model responses.

| Feature | Description |
|---------|-------------|
| Search | Full-text search |
| Filter | All / Human annotations / Model responses |
| Pagination | 100 records per page |

---

## 9. Settings

**⚙️ Settings** (top navigation bar) covers:

### Model Configuration

Configure the LLM endpoint, model name, temperature, and max tokens.  
Use **Pull Model** to download a new Ollama model.

### Whisper Status

Displays whether the ASR service is reachable.

### Database Backup

| Button | Effect |
|--------|--------|
| Create Backup | Runs `pg_dump`, saves compressed archive to `sql_backups/` |
| Download | Downloads the selected backup |

---

## 10. Dark Mode

Click the **☀️ / 🌙** icon (top-right) to toggle. Preference is saved in `localStorage`.

---

## 11. Keyboard Shortcuts Summary

| Context | Shortcut | Action |
|---------|----------|--------|
| Global | `Ctrl+S` | Save annotation |
| Global | `Ctrl+Enter` | Save + next record |
| ASR | `Space` | Play / Pause audio |
| ASR | `Ctrl+Left/Right` | Rewind / Forward 5 s |
| ASR | `Ctrl+H` | Find & Replace |
| BR Questions | `j` / `k` | Next / previous |
| BR Questions | `1` `2` `3` | Select question |
| BR Questions | `q` | Generate questions |
| BR Responses | `j` / `k` | Navigate |
| BR Responses | `g` | Generate response |

---

## 12. Troubleshooting

| Symptom | Solution |
|---------|----------|
| App doesn't load at port 8000 | Run `curl http://localhost:8000/api/health`; rebuild frontend if needed (`npm run build`) |
| Transcription stuck in "transcribing" | Check Celery worker is running (`ps aux | grep celery`); restart via `start_services.sh` |
| Database connection error | Verify `DATABASE_URL` in `.env`; run `docker compose up -d` |
| YouTube import fails | Update yt-dlp (`pip install -U yt-dlp`); check video is public; verify FFmpeg is installed |
| BR pipeline stuck | Check Flower UI at `http://localhost:5556`; review `logs/api.log` |
| Waveform not rendering | Open browser console; check for CORS errors; verify audio file exists in `data/audio/` |

---

*For architecture and API reference, see [TECHNICAL_GUIDE.md](./TECHNICAL_GUIDE.md).*  
*For the academic system design paper, see [TECHNICAL_PAPER.md](./TECHNICAL_PAPER.md).*
