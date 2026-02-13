# DataSupportTool 🎙️📝

A modern web application for managing **ASR (Automatic Speech Recognition)** and **Text** annotation workflows. Create datasets, transcribe audio with Whisper, annotate transcriptions, and export training data—all with a beautiful dark mode interface.

**Tech Stack:**
- **Frontend**: React 18 + Vite + Tailwind CSS + Dark Mode
- **Backend**: FastAPI + SQLAlchemy + SQLite
- **Audio Processing**: MLX Whisper (Apple Silicon optimized), Silero VAD, WaveSurfer.js
- **Task Queue**: Celery + Redis (optional for async processing)

## ✨ Features

### 🎙️ ASR (Speech Recognition) Datasets
- **Audio Upload**: Upload MP3, WAV, M4A, FLAC files
- **YouTube Import**: Direct import from YouTube URLs with auto-segmentation
- **Smart Segmentation**: 
  - Silero VAD for natural speech boundaries (≤30s kept whole, >30s split)
  - Fixed-length segmentation (15s/30s/60s/120s intervals)
- **Whisper Transcription**: On-device transcription using MLX Whisper v2
- **Waveform Visualization**: Interactive audio player with WaveSurfer.js
- **Annotation Interface**: Review and correct transcriptions with keyboard shortcuts
- **Export**: CSV and JSONL formats for training data

### 📝 Text Datasets
- **Data Collection**: Upload CSV/JSON or manually add records
- **Annotation**: Review and annotate text data
- **Validation**: Track completion and quality metrics
- **Export**: Multiple export formats

### 🌓 Dark Mode
- System-wide dark mode toggle
- Persistent preference with localStorage
- Eye-friendly design for extended annotation sessions

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    REACT FRONTEND (Vite + Tailwind)               │
│  ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────┐    │
│  │Dashboard │ │ASR Datasets│ │Text Datasets│ │Dark Mode 🌓 │    │
│  │          │ │  Annotate  │ │  Annotate   │ │             │    │
│  └──────────┘ └────────────┘ └────────────┘ └─────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              │ HTTP/REST
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      FASTAPI BACKEND                              │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐  │
│  │Dataset │ │Audio File│ │Transcribe│ │YouTube │ │Task Queue│  │
│  │  API   │ │   API    │ │   API    │ │  API   │ │  Status  │  │
│  └────────┘ └──────────┘ └──────────┘ └────────┘ └──────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     AUDIO PROCESSING PIPELINE                     │
│                                                                   │
│   ┌──────────────┐    ┌──────────────┐    ┌─────────────┐      │
│   │ YouTube DL   │───▶│  Silero VAD  │───▶│MLX Whisper  │      │
│   │ (yt-dlp)     │    │ Segmentation │    │Transcription│      │
│   └──────────────┘    └──────────────┘    └─────────────┘      │
│                                                    │              │
│                                                    ▼              │
│                                              ┌──────────┐        │
│                                              │SQLite DB │        │
│                                              └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
DataSupportTool/
├── backend/
│   ├── routes/                # API routes organized by domain
│   │   ├── __init__.py
│   │   ├── health.py          # Health check and statistics
│   │   ├── text.py            # Text annotation routes
│   │   └── asr.py             # ASR annotation routes
│   ├── utils/                 # Utility functions
│   │   ├── __init__.py
│   │   └── helpers.py         # Helper functions (clean_nan_values, etc.)
│   ├── __init__.py
│   ├── api.py                 # Main FastAPI app (assembles routers)
│   ├── audio_segment.py       # VAD segmentation logic (Silero)
│   ├── br_pipeline_models.py  # BR Pipeline database models
│   ├── br_pipeline_orchestrator.py # BR Pipeline orchestrator
│   ├── br_pipeline_routes.py  # BR Pipeline API routes
│   ├── celery_app.py          # Celery task queue config
│   ├── database.py            # SQLAlchemy setup
│   ├── models.py              # Database models (ASR + Text)
│   ├── schemas.py             # Pydantic schemas
│   ├── ollama_service.py      # Ollama LLM service
│   ├── setup_ollama.py        # Ollama setup utility
│   ├── tasks.py               # Async background tasks
│   ├── whisper.py             # MLX Whisper transcription
│   └── youtube_service.py     # YouTube download service
├── frontend-react/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx       # Main dashboard
│   │   │   ├── ASRDatasets.jsx     # ASR dataset manager
│   │   │   ├── ASRAnnotate.jsx     # Audio annotation UI
│   │   │   ├── TextDatasets.jsx    # Text dataset manager
│   │   │   ├── TextAnnotate.jsx    # Text annotation UI
│   │   │   ├── BRClassification.jsx # BR Pipeline: Stage 1
│   │   │   ├── BRRestructure.jsx   # BR Pipeline: Stage 2
│   │   │   ├── BRQuestionValidation.jsx # BR Pipeline: Stage 3
│   │   │   ├── BRModelResponses.jsx # BR Pipeline: Stage 4
│   │   │   └── BRPipelineResults.jsx # BR Pipeline: Results
│   │   ├── App.jsx            # Main app with dark mode
│   │   ├── api.js             # API client
│   │   └── index.css          # Tailwind + dark mode styles
│   ├── package.json           # Node dependencies
│   └── vite.config.js         # Vite configuration
├── data/                      # Auto-created (audio files, uploads)
├── scripts/                   # Utility scripts
│   ├── init_production_db.py  # Initialize production database
│   └── start_services.sh      # Start all services
├── config.py                  # Configuration
├── requirements.txt           # Python dependencies
├── run_api.py                 # Start FastAPI backend
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- **Python 3.12+** (for backend)
- **Node.js 18+** (for frontend)
- **FFmpeg** (for audio processing)
- **Redis** (optional, for Celery task queue)

### 1. Install Dependencies

**Backend (Python):**
```bash
cd DataSupportTool
pip install -r requirements.txt
```

**Frontend (Node.js):**
```bash
cd frontend-react
npm install
```

**Audio Dependencies:**
```bash
# macOS (Homebrew)
brew install ffmpeg

# Install MLX Whisper (Apple Silicon only)
pip install mlx-whisper
```

### 2. Start the Backend API

```bash
# From project root
python run_api.py
```

The API will be available at: **http://localhost:8000**
- API Docs: http://localhost:8000/docs
- Database: `data_pipeline.db` (SQLite, auto-created)

### 3. Start the Frontend (in a new terminal)

```bash
cd frontend-react
npm run dev
```

The UI will be available at: **http://localhost:3000**

### 4. (Optional) Start Celery Worker for Async Tasks

```bash
# Terminal 3 - Redis
redis-server

# Terminal 4 - Celery worker
celery -A backend.celery_app worker --loglevel=info
```

## 📋 ASR Workflow

### 1. Create Dataset
- Navigate to **ASR Datasets** page
- Click **"+ Create Dataset"**
- Enter name and optional description

### 2. Add Audio
Two methods:

**A. Upload Audio Files**
- Click **"➕ Add Audio"** on a dataset
- Upload MP3, WAV, M4A, or FLAC files
- Files are stored in `data/audio/`

**B. Import from YouTube**
- Enter YouTube URL
- Choose segmentation mode:
  - **VAD (natural speech)**: Silero VAD finds speech boundaries
  - **Fixed-length**: Split into equal intervals (15s/30s/60s/120s)
- Click **"Import from YouTube"**

### 3. Segment Audio (Optional)
- Click **"✂️ Segment"** to split long audio files
- Uses Silero VAD for natural speech boundaries
- Segments ≤30s kept whole, >30s split into 30s chunks

### 4. Transcribe Audio
- Click **"🎤 Transcribe All"** to run Whisper v2
- Transcription runs in background (Celery) or foreground
- Progress tracked with status badges (pending → transcribing → transcribed)

### 5. Annotate Transcriptions
- Click **"Annotate"** to open annotation UI
- Features:
  - **Waveform visualization** with WaveSurfer.js
  - **Audio controls**: Play/pause, rewind/forward 5s, speed control (0.5x - 2x)
  - **Original transcription** (Whisper output)
  - **Corrected transcription** (editable textarea)
  - **Keyboard shortcuts**:
    - `Space`: Play/pause (when not typing)
    - `Ctrl+S`: Save annotation
    - `Ctrl+Enter`: Mark complete and move to next file
  - **Delete/Re-transcribe** buttons in audio player

### 6. Export Dataset
- Click **CSV** or **JSONL** to download annotated data
- Formats:
  ```csv
  filename,whisper_transcript,corrected_transcript,duration,status
  audio1.mp3,"Original text","Corrected text",15.2,completed
  ```

## 🎨 Dark Mode

- Click **☀️/🌙** icon in navbar to toggle
- Preference saved in localStorage
- Applies to all pages: Dashboard, ASR Datasets, Text Datasets, Annotations

## 🔧 Configuration

Edit `config.py` or create `.env` file:

```python
# API Server
API_HOST = "0.0.0.0"
API_PORT = 8000

# Database
DATABASE_URL = "sqlite:///./data_pipeline.db"

# Audio Processing
AUDIO_UPLOAD_DIR = "./data/audio"
MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

# Whisper (MLX)
WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"  # or "tiny", "base", "small", "medium"

# VAD Segmentation
VAD_THRESHOLD = 0.5           # Voice activity threshold
MAX_SEGMENT_DURATION = 30     # Max duration before splitting (seconds)

# Celery + Redis (optional)
CELERY_BROKER_URL = "redis://localhost:6379/0"
CELERY_RESULT_BACKEND = "redis://localhost:6379/0"

# YouTube Download
YOUTUBE_DOWNLOAD_DIR = "./data/youtube"
```

## 📊 API Endpoints

### ASR Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/asr/datasets` | List all ASR datasets |
| POST | `/api/asr/datasets` | Create new ASR dataset |
| DELETE | `/api/asr/datasets/{id}` | Delete ASR dataset |
| POST | `/api/asr/datasets/{id}/upload` | Upload audio files |
| POST | `/api/asr/datasets/{id}/youtube` | Import from YouTube |
| POST | `/api/asr/datasets/{id}/segment` | Segment all audio files (VAD) |
| POST | `/api/asr/datasets/{id}/transcribe` | Batch transcribe all files |
| GET | `/api/asr/datasets/{id}/export` | Export dataset (CSV/JSONL) |
| GET | `/api/asr/datasets/{id}/files` | Get audio files in dataset |
| GET | `/api/asr/files/{id}` | Get audio file metadata |
| GET | `/api/asr/files/{id}/audio` | Stream audio file |
| POST | `/api/asr/files/{id}/transcribe` | Transcribe single file |
| POST | `/api/asr/files/{id}/retranscribe` | Re-transcribe file (clear + transcribe) |
| DELETE | `/api/asr/files/{id}` | Delete audio file |
| POST | `/api/asr/files/{id}/annotate` | Save annotation |
| PUT | `/api/asr/files/{id}/status` | Update file status |

### Text Dataset Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/text/datasets` | List text datasets |
| POST | `/api/text/datasets` | Create text dataset |
| DELETE | `/api/text/datasets/{id}` | Delete text dataset |
| POST | `/api/text/datasets/{id}/upload` | Upload CSV/JSON |
| POST | `/api/text/datasets/{id}/records` | Add text record |
| GET | `/api/text/datasets/{id}/records` | Get records |
| GET | `/api/text/datasets/{id}/export` | Export dataset |
| POST | `/api/text/records/{id}/annotate` | Save text annotation |

### Utility Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/stats` | Get statistics (datasets, files, annotations) |
| GET | `/api/tasks/{id}/status` | Get Celery task status |

## 🛠️ Technology Details

### Audio Processing Pipeline

**1. YouTube Import (yt-dlp)**
```bash
# Automatically downloads best quality audio
# Converts to WAV for processing
# Stores in data/youtube/
```

**2. Silero VAD Segmentation**
- **Model**: Silero VAD v4.0 (PyTorch)
- **Purpose**: Detect speech vs. silence
- **Algorithm**:
  1. Split audio into windows (512 samples @ 16kHz)
  2. Classify each window (voice probability 0-1)
  3. Merge consecutive speech windows
  4. Keep segments ≤30s whole
  5. Split segments >30s into 30s chunks (preserves context)
- **Benefits**: Natural sentence/phrase boundaries vs. arbitrary fixed-length cuts

**3. MLX Whisper Transcription**
- **Model**: Whisper Large V3 Turbo (Apple Silicon optimized)
- **Performance**: ~10x faster than original Whisper on M1/M2/M3
- **Quality**: State-of-the-art ASR accuracy
- **Output**: Plain text transcription with timestamps

**4. WaveSurfer.js Visualization**
- **Interactive waveform** rendering
- **Seek by clicking** waveform
- **Play/pause/speed controls**
- **Real-time playhead** tracking

### Database Schema

**ASRDataset**
- `id`, `name`, `description`, `created_at`
- Relationships: `audio_files[]`

**AudioFile**
- `id`, `dataset_id`, `filename`, `filepath`, `duration`
- `status` (pending → transcribing → transcribed → annotating → completed)
- `whisper_transcript`, `corrected_transcript`
- `created_at`, `updated_at`

**TextDataset** (legacy feature)
- Similar structure for text annotation workflows

## 🧪 Development

### Frontend Development
```bash
cd frontend-react
npm run dev        # Start dev server (http://localhost:3000)
npm run build      # Production build
npm run preview    # Preview production build
```

### Backend Development
```bash
# Hot reload enabled by default
python run_api.py

# Run with custom host/port
API_HOST=127.0.0.1 API_PORT=9000 python run_api.py

# Database migrations (if needed)
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### Testing Audio Processing Locally
```python
from backend.whisper import transcribe_audio
from backend.audio_segment import segment_audio_file

# Transcribe a file
result = transcribe_audio("data/audio/sample.mp3")
print(result["text"])

# Segment a file with VAD
segments = segment_audio_file("data/audio/sample.mp3", use_vad=True)
for i, seg in enumerate(segments):
    print(f"Segment {i}: {seg['start']:.2f}s - {seg['end']:.2f}s")
```

## 📦 Deployment

### Docker (Coming Soon)
```bash
docker-compose up -d
```

### Manual Deployment
1. **Build frontend**:
   ```bash
   cd frontend-react
   npm run build
   # Serve dist/ with nginx or similar
   ```

2. **Deploy backend**:
   ```bash
   pip install -r requirements.txt
   uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 4
   ```

3. **Start Celery workers** (for async tasks):
   ```bash
   celery -A backend.celery_app worker --loglevel=info --concurrency=4
   ```

## 🐛 Troubleshooting

### "FFmpeg not found"
```bash
# Install ffmpeg
brew install ffmpeg  # macOS
apt install ffmpeg   # Ubuntu/Debian
```

### "MLX not supported"
MLX requires Apple Silicon (M1/M2/M3). For Intel/non-Mac:
```bash
# Use standard Whisper instead
pip install openai-whisper
# Modify backend/whisper.py to use openai-whisper
```

### "Waveform not loading"
- Check browser console for CORS errors
- Verify audio file exists in `data/audio/`
- Check file permissions (should be readable by API process)

### "Transcription fails"
- Check Whisper model is downloaded (happens on first run)
- Verify audio file format is supported (MP3, WAV, M4A, FLAC)
- Check available disk space for temp files

## 🎯 Roadmap

- [ ] **Multi-language support** (Whisper supports 99 languages)
- [ ] **Speaker diarization** (who speaks when)
- [ ] **Batch export formats** (SRT subtitles, VTT, etc.)
- [ ] **Cloud storage integration** (S3, GCS)
- [ ] **Team collaboration** (multi-user annotations)
- [ ] **Quality metrics** (WER, CER calculation)
- [ ] **Docker deployment** templates

## 📝 Data Formats

### CSV Export Format (ASR)
```csv
filename,whisper_transcript,corrected_transcript,duration,status
audio1.mp3,"Original text from Whisper","Corrected annotation",15.2,completed
audio2.mp3,"Another transcription","Fixed version",8.5,completed
```

### JSONL Export Format (ASR)
```jsonl
{"filename":"audio1.mp3","whisper_transcript":"Original text","corrected_transcript":"Corrected annotation","duration":15.2,"status":"completed"}
{"filename":"audio2.mp3","whisper_transcript":"Another transcription","corrected_transcript":"Fixed version","duration":8.5,"status":"completed"}
```

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

MIT License - see LICENSE file for details

---

**Built with ❤️ for the annotation community**
# Bahasa Rojak (BR) Automated Pipeline

## Overview

The BR Pipeline automates the process of detecting Bahasa Rojak (code-mixed text), restructuring content, generating questions, and collecting model responses. This reduces manual work and standardizes the evaluation process.

## Pipeline Stages

### Stage 1: BR Detection (Automated)
- **Purpose**: Identify if text contains Bahasa Rojak (code-mixing between languages)
- **Output**: Boolean flag + confidence score
- **Duration**: ~1-2 seconds per record

### Stage 2: Text Restructuring (Automated)
- **Purpose**: Consolidate MCQ (Multiple Choice Questions) text into a single coherent format
- **What it does**: 
  - Extracts question stem
  - Consolidates options
  - Removes formatting artifacts
  - Standardizes structure
- **Output**: Clean, restructured text
- **Duration**: ~2-3 seconds per record

### Stage 3: Question Generation (Automated)
- **Purpose**: Generate 3 diverse questions from the restructured text
- **Output**: 3 questions per record
- **Duration**: ~5-10 seconds per record (depends on model)

### Stage 4: Human Validation (Manual)
- **Purpose**: Human expert selects the best question from the 3 generated
- **Interface**: Web UI showing:
  - Original vs restructured text
  - BR detection result
  - 3 generated questions (selectable)
- **Duration**: ~30-60 seconds per record

### Stage 5: Model Response Generation (Automated)
- **Purpose**: Generate responses from 3 base models using the selected question
- **Output**: For each model:
  - Response text
  - Identified problems (hallucinations, factual errors, etc.)
- **Duration**: ~10-20 seconds per record (parallel execution)

## Usage

### 1. Start a Pipeline

```bash
# From Text Datasets page, click "Start BR Pipeline" button
# Or via API:
POST /api/br-pipeline/start
{
  "dataset_id": 1
}
```

### 2. Monitor Progress

```bash
GET /api/br-pipeline/status/{pipeline_run_id}

Response:
{
  "id": 1,
  "dataset_id": 1,
  "total_records": 100,
  "processed_records": 45,
  "pending_validation": 55,
  "current_stage": "human_validation",
  "status": "awaiting_validation"
}
```

### 3. Human Validation

Navigate to: `/br-pipeline/validate`

The interface shows:
- Progress bar (X of Y records completed)
- BR detection result
- Restructured text
- 3 generated questions (clickable)

Click on the best question to select it and automatically trigger model response generation.

### 4. View Results

Navigate to: `/br-pipeline/results/{pipeline_id}`

View a table showing:
- **Record ID**: Original text record identifier
- **BR**: Whether text is Bahasa Rojak (Yes/No)
- **Question**: The human-selected question
- **Model**: Base model name and ID
- **Response**: Model's generated response
- **Problems**: Identified issues (hallucinations, errors, etc.)

Export results to CSV for further analysis.

## API Endpoints

### Pipeline Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/br-pipeline/start` | POST | Start pipeline for a dataset |
| `/api/br-pipeline/status/{id}` | GET | Get pipeline status |
| `/api/br-pipeline/pending-validation` | GET | Get records needing validation |
| `/api/br-pipeline/validate/{record_id}` | POST | Submit question selection |
| `/api/br-pipeline/results/{id}` | GET | Get final results |

### Model Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/br-pipeline/models` | GET | List configured models |
| `/api/br-pipeline/models` | POST | Add new model |
| `/api/br-pipeline/models/{id}/toggle` | PATCH | Enable/disable model |

## Model Configuration

Before starting a pipeline, configure at least 3 base models:

```bash
POST /api/br-pipeline/models
{
  "name": "GPT-4",
  "model_type": "openai",
  "model_id": "gpt-4",
  "api_key_env_var": "OPENAI_API_KEY",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 512
  },
  "is_active": true
}
```

Supported model types:
- `openai` - OpenAI models (GPT-4, GPT-3.5)
- `anthropic` - Claude models
- `local` - Local models (Ollama, llama.cpp, etc.)
- `azure` - Azure OpenAI
- `custom` - Custom API endpoints

## Implementation Details

### Placeholder Functions (To Be Implemented)

The following functions in `br_pipeline_orchestrator.py` are **placeholders** and need real implementations:

1. **`_detect_bahasa_rojak(text)`**
   - Current: Returns `(False, 0.5)`
   - Needed: Train or use a code-mixing detection model
   - Options:
     - Fine-tuned BERT/RoBERTa for language identification
     - Rule-based approach with language detection libraries
     - LLM-based classification

2. **`_restructure_mcq_text(text)`**
   - Current: Returns original text
   - Needed: MCQ parsing and consolidation logic
   - Options:
     - Prompt engineering with GPT-4/Claude
     - Custom parsing logic
     - Fine-tuned model for MCQ restructuring

3. **`_generate_questions(text, count=3)`**
   - Current: Returns placeholder questions
   - Needed: Question generation model
   - Options:
     - GPT-4 with structured prompt
     - T5-based question generation model
     - BART fine-tuned on QG dataset

4. **`_generate_model_response(model, context, question)`**
   - Current: Returns placeholder response
   - Needed: Actual model API calls
   - Implementation varies by model type (see Model Configuration)

### Database Schema

**br_pipeline_runs**: Tracks overall pipeline execution
- `total_records`, `processed_records`, `pending_validation`
- `current_stage`, `status`
- Timestamps: `started_at`, `completed_at`

**br_record_stages**: Tracks each record's progress through stages
- Stage 1: `is_bahasa_rojak`, `br_confidence`
- Stage 2: `restructured_text`
- Stage 3: `generated_questions` (JSON array)
- Stage 4: `selected_question_index`, `selected_question`
- Stage 5: `model_responses` (JSON object)

**br_model_configs**: Stores base model configurations
- `name`, `model_type`, `model_id`
- `api_endpoint`, `api_key_env_var`
- `parameters` (JSON), `is_active`

## Performance Considerations

### Estimated Time per Record

| Stage | Duration | Parallelizable |
|-------|----------|----------------|
| BR Detection | 1-2s | ✅ Yes |
| Text Restructure | 2-3s | ✅ Yes |
| Question Generation | 5-10s | ✅ Yes |
| Human Validation | 30-60s | ❌ No (manual) |
| Model Responses | 10-20s | ✅ Yes (3 models parallel) |

**Total**: ~1-2 minutes per record (mostly human validation time)

### Optimization Tips

1. **Batch Processing**: Run stages 1-3 in batches for better throughput
2. **Async Workers**: Use Celery/background tasks for long-running operations
3. **Caching**: Cache model responses for identical questions
4. **Parallel Execution**: Run model responses in parallel (already implemented)

## Troubleshooting

### Pipeline Stuck at "awaiting_validation"
- Check `/br-pipeline/validate` page for pending records
- Ensure human validators complete their reviews

### Model Response Generation Failing
- Verify model configurations are correct
- Check API keys are set in environment variables
- Review error logs: `pipeline_run.error_message`

### Slow Performance
- Consider running pipeline in background (async)
- Increase batch sizes for stages 1-3
- Use faster models for initial stages (cheaper/faster models)

## Next Steps

1. **Implement AI Functions**: Replace placeholder functions with real models
2. **Add Batch Processing**: Process multiple records in parallel
3. **Add Analytics**: Track completion rates, average validation time
4. **Add User Management**: Track which validators complete most records
5. **Add Quality Metrics**: Score model responses automatically
