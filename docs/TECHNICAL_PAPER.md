# DataSupportTool: A Multi-Modal Data Annotation Platform for Bahasa Rojak NLP Research

> **Technical Paper** · Version 3.0 · May 2026

---

## Abstract

We present **DataSupportTool**, a self-hosted, full-stack web platform designed to accelerate the creation of high-quality annotated datasets for two complementary natural language processing (NLP) tasks: Automatic Speech Recognition (ASR) annotation and Bahasa Rojak (code-mixed Malay/English) text pipeline processing. The system integrates state-of-the-art on-device transcription models (Whisper, Qwen3 ASR), a large language model (LLM) orchestration layer for automated text processing, a human-in-the-loop validation interface optimised with keyboard-driven workflows, and a distributed asynchronous task queue. The platform exports data in training-ready formats (CSV, JSONL, ZIP) directly compatible with modern fine-tuning frameworks. This paper describes the system architecture, pipeline design, annotation interface decisions, and scalability considerations.

---

## 1. Introduction

### 1.1 Motivation

The development of NLP systems for low-resource and code-mixed languages such as Bahasa Rojak (a blend of Bahasa Malaysia, English, and Mandarin spoken in Malaysia) is constrained by a critical bottleneck: the absence of large, high-quality annotated datasets. Existing general-purpose annotation platforms (Label Studio, Prodigy, Argilla) are either too heavyweight for small research teams, require cloud infrastructure, or lack domain-specific workflows for code-mixed MCQ (Multiple Choice Question) text processing.

DataSupportTool addresses this gap by providing:
1. A dedicated **ASR annotation pipeline** with on-device transcription
2. A **five-stage automated BR pipeline** combining LLM automation with human validation
3. A **single-server deployment model** suitable for university research labs and small teams

### 1.2 Scope

This paper covers the system as of version 3.0. The platform is designed for:
- Research teams of 1–20 annotators
- Deployment on a single GPU/CPU server (Linux)
- Datasets of up to ~100,000 records per pipeline run

---

## 2. System Architecture

### 2.1 Multi-Tier Design

The system follows a three-tier architecture:

| Tier | Technology | Role |
|------|-----------|------|
| **Presentation** | React 18 + Vite + Tailwind CSS | SPA served from FastAPI static mount |
| **Application** | FastAPI + Celery | REST API + async task processing |
| **Data** | PostgreSQL + Redis | Persistent storage + task broker/result backend |

All tiers run on a single host. The FastAPI process serves both the API (`/api/*`) and the compiled React SPA (`/*`) eliminating the need for a separate web server in standard deployments.

### 2.2 Asynchronous Task Model

Long-running operations (audio transcription, LLM inference, export packaging) are offloaded to Celery workers via Redis. This design ensures:
- The API remains responsive during GPU-intensive tasks
- Task results are persistent and queryable after completion
- Multiple annotation sessions can run concurrently

Three named queues partition work by resource profile:

```
celery        → General purpose (exports, cleanup)
transcription → CPU/GPU intensive ASR tasks
br_pipeline   → LLM inference tasks
```

### 2.3 Frontend Architecture

The React SPA uses client-side routing (React Router v6). All API calls are centralized in `src/api.js`, which wraps Axios with request/response interceptors for structured logging. In development, Vite proxies `/api/*` to `localhost:8000`, eliminating CORS complexity. In production, the built `dist/` directory is served directly by FastAPI via `StaticFiles`.

---

## 3. ASR Pipeline

### 3.1 Audio Ingestion

Audio is accepted via two paths:

**Direct upload**: Files (MP3, WAV, M4A, FLAC) are stored with absolute paths in `data/audio/`. An `AudioFile` database record is created immediately with status `pending`.

**YouTube import**: `yt-dlp` downloads the best-quality audio stream and converts it to WAV via FFmpeg. The resulting file is registered as a single `AudioFile` before segmentation.

### 3.2 Voice Activity Detection (VAD) Segmentation

Long-form audio is segmented using **Silero VAD v4** (a lightweight PyTorch model, ~1.8 MB). The algorithm:

1. Resamples audio to 16 kHz mono
2. Slides a 512-sample window, producing frame-level voice probability scores
3. Merges consecutive voiced frames into speech segments
4. Applies hysteresis: speech onset at probability > 0.5, offset at < 0.35
5. Post-processes: segments ≤ 30 s are retained as-is; segments > 30 s are split at 30 s boundaries preserving context

This approach produces more natural training utterances than fixed-length segmentation, preserving sentence and phrase boundaries.

### 3.3 Dual-Engine Transcription

The platform runs two transcription engines in parallel as separate Celery tasks:

| Engine | Model | Optimisation |
|--------|-------|-------------|
| **Whisper** | `mlx-community/whisper-large-v3-turbo` | MLX (Apple Silicon) or standard PyTorch (Linux) |
| **Qwen3 ASR** | Alibaba Qwen3-based | Supports code-mixed Malay/English |

Results from both engines are stored separately. The annotator sees both transcripts as reference during correction, enabling cross-model comparison and informed editing.

### 3.4 Annotation Interface

The annotation UI (`ASRAnnotate.jsx`) integrates **WaveSurfer.js v7** for waveform rendering. Key design decisions:

- **Keyboard-first interaction**: `Space` play/pause, `Ctrl+Enter` to complete and advance — minimising mouse travel for annotators processing hundreds of files
- **Find & Replace** (`Ctrl+H`): batch text correction for systematic transcription errors
- **Status state machine**: `pending → transcribing → transcribed → annotating → completed` — enabling resumable sessions and filtered views
- **Speed control**: 0.5×–2× playback for intelligibility in noisy recordings

### 3.5 Export Formats

| Format | Fields | Use case |
|--------|--------|---------|
| CSV | `filename, whisper_transcript, corrected_transcript, duration, status` | Tabular analysis |
| JSONL | Same fields as JSON objects | Direct model fine-tuning |
| ZIP | Audio files + JSONL | Self-contained training bundle |

Exports run as background Celery tasks. The frontend polls `GET /api/asr/tasks/{id}/status` at 2-second intervals and triggers an automatic browser download on completion.

---

## 4. Bahasa Rojak (BR) Automated Pipeline

### 4.1 Pipeline Design Philosophy

The BR Pipeline operationalises a five-stage data processing workflow that combines LLM automation with targeted human validation. The design principle is: **automate everything automatable; surface only the judgment-requiring step to humans**.

Stages 1–3 and Stage 5 run fully automated. Stage 4 (question selection) is intentionally kept manual: the choice of which generated question best represents the source text requires cultural and linguistic judgment that current LLMs cannot reliably provide for Bahasa Rojak.

### 4.2 Stage 1: Bahasa Rojak Detection

**Input**: Raw MCQ text records from the uploaded dataset  
**Output**: Boolean `is_bahasa_rojak` flag + confidence score + detected language tags

The detection step uses LLM-based zero-shot classification via the configured model endpoint. The prompt asks the model to identify whether the text contains code-mixing between Bahasa Malaysia and other languages (typically English or Mandarin). Annotators can override automated results via the Stage 1 UI before proceeding.

### 4.3 Stage 2: Text Restructuring

**Input**: Raw MCQ text (often with garbled OCR artefacts, inconsistent formatting)  
**Output**: Clean, consolidated MCQ text

The restructuring LLM prompt instructs the model to:
1. Identify and extract the question stem
2. Consolidate answer options (A–D or numbered) into a standardised format
3. Remove page headers, footers, and formatting artefacts
4. Preserve the original language (do not translate)

Human annotators review, edit, or discard restructured records. Records marked `skip` use the original text in subsequent stages. Records marked `discard` are soft-deleted and excluded from all further processing.

### 4.4 Stage 3: Question Generation

**Input**: Restructured MCQ text  
**Output**: Three diverse open-ended questions about the passage

The question generation prompt is configurable per pipeline run via the **System Prompt** feature, allowing researchers to experiment with different generation strategies (e.g., factual, inferential, evaluative questions). Three distinct questions are generated per record to provide variety for the human validator.

### 4.5 Stage 4: Human Validation (Question Selection)

This is the only manual stage. The annotator:
1. Reads the original and restructured text
2. Reviews all three generated questions
3. Selects the single best question using a keyboard shortcut (`1`, `2`, or `3`)

The interface is designed for high throughput: an experienced annotator can process 60–100 records per hour. No mouse interaction is required.

### 4.6 Stage 5: Model Response Generation

**Input**: Selected question + restructured text (as context)  
**Output**: For each configured model — a response text and a list of flagged problems

Multiple LLM models are queried in parallel. The response schema captures:
- `response`: the generated answer
- `problems`: a list of identified issues (hallucination, factual error, off-topic, etc.)

This stage produces the final training data: `(context, question, response)` triples with human-validated questions and multi-model responses.

### 4.7 Pipeline Database Design

Pipeline state is tracked at two granularities:

- `br_pipeline_runs`: aggregate counters and overall status for the pipeline run
- `br_record_stages`: per-record progress through all five stages, with individual stage outputs stored as columns or JSON

This design enables partial re-runs (re-processing only failed records), stage-specific exports, and fine-grained progress reporting.

---

## 5. Human-in-the-Loop Validation Interface

### 5.1 Design Principles

The annotation interfaces are designed around four principles:

1. **Keyboard-first**: All critical actions have keyboard shortcuts; the mouse is optional
2. **Progressive disclosure**: Complex options (export, batch operations) are secondary; the core annotation action is always one keypress away
3. **Non-destructive operations**: Records are soft-deleted (`is_discarded` flag); data is never permanently lost without confirmation
4. **Resume-anywhere**: Pagination state, filter selections, and in-progress annotations are preserved across page reloads via URL parameters and local state

### 5.2 Annotation Throughput

Based on internal testing:

| Task | Average throughput |
|------|--------------------|
| ASR transcript correction | 20–40 files/hour |
| BR question selection | 60–100 records/hour |
| BR response problem flagging | 30–50 records/hour |

---

## 6. Data Export Formats

### 6.1 ASR Export

**JSONL** (primary training format):
```json
{"filename": "/abs/path/audio1.wav", "whisper_transcript": "...", "corrected_transcript": "...", "duration": 14.3, "status": "completed"}
```

Absolute file paths are stored (not relative) to ensure compatibility with training scripts running from any working directory.

### 6.2 BR Pipeline — Stage 2 (Restructure) CSV

```
id,original_text,restructured_text,is_bahasa_rojak,detected_language
42,"Soalan: Apakah...","Apakah maksud...",true,"ms,en"
```

### 6.3 BR Pipeline — Stage 3 (Questions) JSONL

```json
{"record_id": 42, "original_text": "...", "restructured_text": "...", "selected_question": "Apakah..."}
```

This format is directly compatible with instruction fine-tuning datasets (Alpaca, ShareGPT schema with minor transformation).

### 6.4 BR Pipeline — Final Results CSV

```
record_id,is_bahasa_rojak,selected_question,model_name,response,problems
42,true,"Apakah...","qwen3:8b","Jawapannya ialah...","[]"
```

---

## 7. Scalability Considerations

### 7.1 Current Limits

| Resource | Practical limit | Bottleneck |
|----------|----------------|-----------|
| Concurrent annotators | ~10 | Single FastAPI process |
| Audio files per dataset | ~10,000 | Filesystem I/O |
| Text records per pipeline | ~100,000 | LLM inference rate |
| Celery workers | 1 (solo pool) | Can increase to `prefork` on Linux |

### 7.2 Scaling Up

**Horizontal API scaling**: Replace `--workers 1` with `--workers 4` for Uvicorn; all state is in PostgreSQL, so multiple API workers are safe.

**Celery concurrency**: Switch `--pool=solo` to `--pool=prefork --concurrency=4` on Linux. Use separate Celery nodes for `transcription` and `br_pipeline` queues to isolate GPU contention.

**Database**: PostgreSQL with connection pooling (SQLAlchemy `pool_size=20`) supports 100+ concurrent connections. For very large datasets, add indexes on `status`, `dataset_id`, and `pipeline_run_id` columns.

**LLM throughput**: Use vLLM instead of Ollama for batched inference. Adjust the `MODEL_ENDPOINT` environment variable to point to a vLLM server. No code changes required.

### 7.3 Storage

Audio data grows at approximately 1 MB per 30-second segment (WAV). For 10,000 segments this is ~10 GB. Use `data/` on a dedicated volume with sufficient capacity and configure `scripts/backup.sh` to sync to cloud storage via `rclone`.

---

## 8. Future Work

1. **Speaker diarization**: Integrate pyannote.audio to label who speaks in each segment, enabling multi-speaker ASR datasets
2. **Active learning**: Surface the most uncertain annotations for priority human review based on Whisper confidence scores
3. **WER/CER metrics**: Compute Word Error Rate and Character Error Rate between Whisper output and corrected transcript to track annotation quality
4. **Multi-user authentication**: JWT-based annotator accounts with per-user assignment queues
5. **SRT/VTT export**: Subtitle format export for video corpus annotation
6. **Automated BR detection model**: Fine-tune a lightweight BERT/RoBERTa model on the accumulated Stage 1 annotations to replace LLM-based detection
7. **Dataset versioning**: Immutable snapshots of datasets at export time for reproducible experiments

---

## 9. Conclusion

DataSupportTool provides a practical, self-hosted solution for building NLP training datasets targeting Bahasa Rojak and ASR tasks. Its five-stage BR pipeline demonstrates how LLM automation and human validation can be effectively combined: automating the mechanical transformation steps while preserving human judgment at the semantically critical step (question selection). The keyboard-driven annotation interfaces achieve high annotator throughput without requiring expensive crowd-sourcing infrastructure. The system is ready for immediate deployment on a standard research server with a single startup command.

---

## Appendix A — BR Pipeline Stage Durations

| Stage | Automated? | Typical duration per record |
|-------|-----------|----------------------------|
| 1. BR Detection | Yes (LLM) | 1–2 s |
| 2. Text Restructuring | Yes (LLM) | 2–5 s |
| 3. Question Generation | Yes (LLM) | 5–10 s |
| 4. Human Validation | No | 30–60 s |
| 5. Model Responses | Yes (LLM × N models) | 10–30 s |

**Total automated time** (Stages 1, 2, 3, 5): ~20–50 s per record  
**Human time** (Stage 4 only): ~45 s per record  
**End-to-end throughput** (single annotator): ~60–80 records/hour

## Appendix B — Directory Structure for `data/`

```
data/
├── audio/       # Uploaded and segmented WAV/MP3 files
├── uploads/     # Raw uploaded files before processing
├── processed/   # Intermediate processing artefacts
└── exports/     # Generated export ZIP/CSV/JSONL files
```

All paths stored in the database are **absolute** to ensure portability across different working directories during inference and training.
