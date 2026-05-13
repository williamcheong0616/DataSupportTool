# DataSupportTool — User Guide

> **Version 3.0** · Last updated May 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Requirements](#2-system-requirements)
3. [Installing Prerequisites](#3-installing-prerequisites)
   - 3.1 [Install Docker](#31-install-docker)
   - 3.2 [Install Miniconda (Python)](#32-install-miniconda-python)
   - 3.3 [Install Node.js](#33-install-nodejs)
   - 3.4 [Install FFmpeg](#34-install-ffmpeg)
4. [Getting the Project](#4-getting-the-project)
5. [Setting Up the Python Environment](#5-setting-up-the-python-environment)
6. [Configuring the Environment File](#6-configuring-the-environment-file)
7. [Building the Frontend](#7-building-the-frontend)
8. [Starting All Services](#8-starting-all-services)
9. [Verifying the Installation](#9-verifying-the-installation)
10. [Dashboard](#10-dashboard)
11. [ASR Annotation Workflow](#11-asr-annotation-workflow)
12. [Text Annotation Workflow](#12-text-annotation-workflow)
13. [Bahasa Rojak (BR) Pipeline](#13-bahasa-rojak-br-pipeline)
14. [Response Pool](#14-response-pool)
15. [Settings](#15-settings)
16. [Dark Mode](#16-dark-mode)
17. [Keyboard Shortcuts](#17-keyboard-shortcuts)
18. [Stopping Services](#18-stopping-services)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Overview

DataSupportTool is a local web application for creating annotated NLP training datasets across two workflows:

| Workflow | Purpose |
|----------|---------|
| **ASR** | Upload audio → auto-transcribe (Whisper / Qwen3) → correct → export CSV/JSONL |
| **Text / BR Pipeline** | Import MCQ text → 5-stage automated + human pipeline → export training pairs |

All data stays on your machine. No data is sent to external services unless you configure an external model endpoint.

---

## 2. System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Ubuntu 20.04+ / macOS 12+ | Ubuntu 22.04 LTS |
| Python | 3.11 | 3.12 |
| Node.js | 18 LTS | 20 LTS |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free | 100 GB+ |
| Docker | 24+ | latest |
| FFmpeg | any | latest |

---

## 3. Installing Prerequisites

This section walks through installing each tool from scratch. If you already have one installed, skip that step and verify with the version command shown.

### 3.1 Install Docker

Docker runs the PostgreSQL database, Redis, and Flower task monitor inside containers so you do not need to install them manually.

**Ubuntu / Debian:**

```bash
# Remove any old Docker versions
sudo apt-get remove docker docker-engine docker.io containerd runc

# Install required packages
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine and the Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Allow running Docker without `sudo`** (log out and back in after this):

```bash
sudo usermod -aG docker $USER
```

**macOS:**

Download and install **Docker Desktop** from the official Docker website. Once installed, open Docker Desktop and wait for the whale icon in the menu bar to stop animating (this means it is ready).

**Verify Docker is working:**

```bash
docker --version
# Expected: Docker version 24.x.x or newer

docker compose version
# Expected: Docker Compose version v2.x.x
```

---

### 3.2 Install Miniconda (Python)

Miniconda gives you a lightweight Python installation plus the `conda` tool for creating isolated environments. This keeps the project's Python packages separate from any other software on your machine.

**Linux (x86_64):**

```bash
# Download the Miniconda installer
curl -O https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh

# Run the installer (press Enter to scroll the licence, type 'yes' to accept)
bash Miniconda3-latest-Linux-x86_64.sh

# When asked "Do you wish the installer to initialize Miniconda3?" — type: yes
```

Close and reopen your terminal, then verify:

```bash
conda --version
# Expected: conda 24.x.x or newer

python --version
# Expected: Python 3.12.x (base environment)
```

**macOS (Apple Silicon / M1/M2/M3):**

```bash
curl -O https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh
bash Miniconda3-latest-MacOSX-arm64.sh
```

**macOS (Intel):**

```bash
curl -O https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh
bash Miniconda3-latest-MacOSX-x86_64.sh
```

> If `conda` is not found after reopening the terminal, run `source ~/.bashrc` (Linux) or `source ~/.zshrc` (macOS).

---

### 3.3 Install Node.js

Node.js is needed to install and build the React frontend. The recommended way is through **nvm** (Node Version Manager), which lets you install and switch between Node versions easily.

**Linux and macOS:**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload your shell (or open a new terminal)
source ~/.bashrc   # or ~/.zshrc on macOS / zsh

# Install Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20
```

**Verify:**

```bash
node --version
# Expected: v20.x.x

npm --version
# Expected: 10.x.x
```

**Alternative — system package manager (Ubuntu):**

```bash
# Install the NodeSource repository for Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

### 3.4 Install FFmpeg

FFmpeg handles audio conversion and is required for the YouTube import and audio segmentation features.

**Ubuntu / Debian:**

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

**macOS (with Homebrew):**

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install ffmpeg
```

**Verify:**

```bash
ffmpeg -version
# Expected: ffmpeg version 6.x.x or similar
```

---

## 4. Getting the Project

Clone the repository to your machine:

```bash
git clone <repo-url> DataSupportTool
cd DataSupportTool
```

Replace `<repo-url>` with the actual Git URL provided to you. After cloning, your working directory should look like this:

```
DataSupportTool/
├── backend/
├── frontend-react/
├── scripts/
├── docs/
├── docker-compose.yml
├── requirements.txt
├── run_api.py
└── ...
```

---

## 5. Setting Up the Python Environment

Create a dedicated conda environment for this project. This ensures the project's Python packages do not interfere with anything else on your machine.

```bash
# Create the environment with Python 3.12
conda create -n datasupport python=3.12 -y

# Activate it
conda activate datasupport
```

Your terminal prompt should now start with `(datasupport)`, confirming you are inside the environment.

Install all Python dependencies:

```bash
pip install -r requirements.txt
```

This will download and install all backend packages (FastAPI, SQLAlchemy, Celery, etc.). It may take a few minutes on first run.

> **Important:** You must run `conda activate datasupport` every time you open a new terminal before working with this project.

---

## 6. Configuring the Environment File

The application reads its configuration from a `.env` file in the project root. A minimal `.env` is already present in the repository with the database URL pre-set. You can use it as-is for local development.

Check the current `.env`:

```bash
cat .env
```

It should contain at minimum:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/data_pipeline
```

For a full local setup, the complete set of variables is:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/data_pipeline` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis broker for Celery |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | Celery task results |
| `API_HOST` | `0.0.0.0` | FastAPI bind address |
| `API_PORT` | `8000` | FastAPI port |
| `MODEL_ENDPOINT` | `http://localhost:11434/v1/completions` | LLM endpoint (Ollama or OpenAI-compatible) |

The Docker Compose file already starts PostgreSQL and Redis with the credentials shown above, so no changes are needed for a default local setup.

---

## 7. Building the Frontend

The user interface is a React application that must be compiled into static files before the backend can serve it.

```bash
# Move into the frontend directory
cd frontend-react

# Install JavaScript dependencies (only needed once, or after package.json changes)
npm install

# Build the production bundle
npm run build

# Return to the project root
cd ..
```

After this, a `frontend-react/dist/` folder will be created. The backend serves these files automatically.

> You only need to run `npm run build` again if you change the frontend source code.

---

## 8. Starting All Services

With everything installed and configured, start the entire application with a single command from the project root:

```bash
conda activate datasupport
bash scripts/start_services.sh
```

The script performs these steps automatically:

1. Checks that Docker is running
2. Stops any leftover processes from a previous run
3. Starts PostgreSQL, Redis, and Flower via Docker Compose
4. Waits for the database and cache to be healthy
5. Starts the Celery worker and Beat scheduler in the background
6. Applies any pending database migrations
7. Starts the FastAPI server

When everything is ready you will see:

```
════════════════════════════════════════
🎉 All services running!
════════════════════════════════════════

📚 Quick Links:
  Frontend:        http://localhost:5173
  API Docs:        http://localhost:8000/api/docs
  Health Check:    http://localhost:8000/api/health
  Flower (Celery): http://localhost:5556
```

---

## 9. Verifying the Installation

Open your browser and go to **http://localhost:8000**.

You should see the DataSupportTool dashboard. If not, use the checks below:

**Check the API is alive:**

```bash
curl http://localhost:8000/api/health
# Expected: {"status": "ok", ...}
```

**Check Docker containers are running:**

```bash
docker compose ps
# You should see dst-postgres, dst-redis, and dst-flower all with status "Up"
```

**Check Celery is processing tasks:**

Open **http://localhost:5556** — the Flower dashboard shows connected workers and task history.

---

## 10. Dashboard

The Dashboard is the first page you see after opening the app. It shows a high-level summary of all your data.

| Section | Description |
|---------|-------------|
| Statistics cards | Total ASR files, text records, and pipeline runs across all datasets |
| Dataset breakdown | Per-dataset annotation and pipeline completion progress bars |

Click any dataset name to navigate directly to it.

---

## 11. ASR Annotation Workflow

Use this workflow to turn audio recordings into corrected, labelled transcripts.

```
Upload audio → (optional) Segment → Transcribe → Annotate → Export
```

### 11.1 Create a Dataset

1. Click **ASR Annotation** in the top navigation bar.
2. Click **+ Create Dataset**.
3. Enter a name and optional description.
4. Click **Create**.

### 11.2 Add Audio

**Upload files directly:**
Click **➕ Add Audio** and select one or more MP3, WAV, M4A, or FLAC files (max 100 MB each).

**Import from YouTube:**
1. Click **▶ Import YouTube** and paste a public YouTube URL.
2. Choose a segmentation method: **VAD** (splits at natural speech pauses) or **Fixed-length** (15 s / 30 s / 60 s / 120 s chunks).
3. Optionally toggle **Auto-transcribe** to queue transcription immediately after download.
4. Click **Import**.

### 11.3 Segment Long Audio

For files longer than 30 seconds, click **✂ Segment** on the file row, adjust the target chunk length, then click **Segment**. The Silero VAD engine splits the audio at natural pause points.

Files 30 seconds or shorter are kept whole.

### 11.4 Transcribe

- **Single file:** Click **🎤 Transcribe** on a specific file row.
- **Whole dataset:** Click **🎤 Transcribe All** on the dataset card.

Both Whisper and Qwen3 ASR engines run in parallel as background Celery tasks. File status progresses: `pending → transcribing → transcribed`.

### 11.5 Annotate

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

Both machine-generated transcripts are shown as reference. Type your correction in the **Corrected Transcript** box.

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `Ctrl+Left` | Rewind 5 s |
| `Ctrl+Right` | Forward 5 s |
| `Ctrl+S` | Save annotation |
| `Ctrl+Enter` | Save + move to next file |
| `Ctrl+H` | Find & Replace |

### 11.6 Export

Click **Export** on a dataset and choose a format:

| Format | Content |
|--------|---------|
| CSV | `filename, whisper_transcript, corrected_transcript, duration, status` |
| JSONL | Same fields, one JSON object per line |
| ZIP | Audio files + JSONL annotation bundled together |

Large exports run as background tasks and download automatically when ready.

---

## 12. Text Annotation Workflow

Use this workflow to label and enrich raw MCQ text records.

### 12.1 Create a Dataset

Click **Text Annotation** → **+ Create Dataset** → enter a name and task type → **Create**.

### 12.2 Upload Data

Click **Upload Data** → select a CSV or JSON file → map the text column if prompted → **Upload**.

### 12.3 Annotate Records

Click **Annotate** and for each record, fill in:

- **Is Bahasa Rojak** toggle
- **Classification label**
- **Modified text**, **Subject**, **Context**
- Up to **3 questions**

Press `Ctrl+S` to save and advance to the next record.

### 12.4 Export

Click **Export → CSV** or **Export → JSONL** from the dataset card.

---

## 13. Bahasa Rojak (BR) Pipeline

The BR Pipeline automates processing of code-mixed MCQ text through five stages. Stages 1–3 and Stage 5 run automatically as Celery background tasks. Stage 4 requires human input.

```
Upload → Stage 1: BR Detection → Stage 2: Restructure →
Stage 3: Question Generation → Stage 4: Human Validation →
Stage 5: Model Responses → Export
```

### 13.1 Start the Pipeline

From a Text Dataset card, click **🚀 Start BR Pipeline**. Stages 1–3 begin immediately. A link appears to the pipeline dashboard.

### 13.2 Stage 1: BR Classification

View and override the automated BR detection results.

| Control | Effect |
|---------|--------|
| Toggle (BR / Not BR) | Override automated detection |
| Language tags | Edit detected languages |
| Trash icon | Remove a record from the pipeline |
| Filters (top bar) | Show All / BR only / Non-BR only |

### 13.3 Stage 2: Text Restructuring

Review and edit the AI-consolidated MCQ text.

| Button | Effect |
|--------|--------|
| Auto | Run AI restructuring for this record |
| Skip | Use the original text unchanged |
| Discard | Remove from the pipeline |
| Edit | Manually edit the restructured text |
| Run Stage 2 | Batch-process all pending records |

Click **Export CSV** to download the restructured texts.

### 13.4 Stage 3: Question Generation & Validation

1. Click **Run Stage 3** to batch-generate candidate questions.
2. For each record, three AI-generated questions are shown — click the radio button to select the best one.

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous record |
| `1`, `2`, `3` | Select question 1, 2, or 3 |
| `q` | Generate questions for the current record |

Click **Export JSONL** for a model fine-tuning ready dataset.

### 13.5 Stage 5: Model Response Generation

1. Open the **Responses** tab.
2. Click **Generate All** — selected questions are sent to all configured LLM models.
3. Use the edit icon to flag **problems** (hallucinations, factual errors) per response.

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate records |
| `g` | Generate a response for the current record |

### 13.6 Pipeline Results

The **Results** page shows a full table: Record ID, BR flag, selected question, model, response, and flagged problems.

Click **Export CSV** for a complete dump of all pipeline results.

---

## 14. Response Pool

**Text Annotation → Response Pool** provides a global view of all model responses across all datasets.

| Feature | Description |
|---------|-------------|
| Search | Full-text search across all responses |
| Filter | All / Human annotations / Model responses |
| Pagination | 100 records per page |

---

## 15. Settings

Click **⚙️ Settings** in the top navigation bar.

### Model Configuration

Configure the LLM endpoint, model name, temperature, and max tokens.
Use **Pull Model** to download a new Ollama model directly from the UI.

### Whisper Status

Shows whether the ASR transcription service is reachable.

### Database Backup

| Button | Effect |
|--------|--------|
| Create Backup | Runs `pg_dump` and saves a compressed archive to `sql_backups/` |
| Download | Downloads the selected backup archive to your machine |

---

## 16. Dark Mode

Click the **☀️ / 🌙** icon in the top-right corner to toggle between light and dark mode. Your preference is saved in the browser and persists across sessions.

---

## 17. Keyboard Shortcuts Summary

| Context | Shortcut | Action |
|---------|----------|--------|
| Global | `Ctrl+S` | Save annotation |
| Global | `Ctrl+Enter` | Save + next record |
| ASR | `Space` | Play / Pause audio |
| ASR | `Ctrl+Left` / `Ctrl+Right` | Rewind / Forward 5 s |
| ASR | `Ctrl+H` | Find & Replace |
| BR Questions | `j` / `k` | Next / previous record |
| BR Questions | `1` `2` `3` | Select question |
| BR Questions | `q` | Generate questions for current record |
| BR Responses | `j` / `k` | Navigate records |
| BR Responses | `g` | Generate model response |

---

## 18. Stopping Services

To stop all running services cleanly:

```bash
# Find and stop the FastAPI and Celery processes
pkill -f "run_api.py"
pkill -f "celery -A"

# Stop and remove the Docker containers
docker compose down
```

Data stored in PostgreSQL and Redis is persisted in Docker volumes. Running `docker compose down` only stops the containers — your data is not deleted. To also delete all data (volumes), run:

```bash
docker compose down -v
```

---

## 19. Troubleshooting

| Symptom | Solution |
|---------|----------|
| App doesn't load at port 8000 | Run `curl http://localhost:8000/api/health`. If it fails, check `python run_api.py` is running. If the UI is missing, rebuild the frontend: `cd frontend-react && npm run build` |
| `conda: command not found` | Close and reopen your terminal, or run `source ~/.bashrc` |
| `(datasupport)` not shown in terminal | Run `conda activate datasupport` before any backend commands |
| Docker containers not starting | Ensure Docker Desktop is open (macOS) or run `sudo systemctl start docker` (Linux) |
| Transcription stuck in "transcribing" | Check Celery is running: `ps aux | grep celery`. Restart via `bash scripts/start_services.sh` |
| Database connection error | Verify `DATABASE_URL` in `.env`. Run `docker compose up -d` and wait 10 seconds |
| YouTube import fails | Run `pip install -U yt-dlp`. Check the video is public. Verify FFmpeg: `ffmpeg -version` |
| BR pipeline stuck | Check the Flower UI at `http://localhost:5556`. Review `logs/api.log` for errors |
| Waveform not rendering | Open the browser console (F12). Check for CORS or 404 errors. Verify the file exists in `data/audio/` |
| `ModuleNotFoundError` on startup | Ensure you ran `conda activate datasupport` and that `PYTHONPATH` is set to the project root |
| Port 8000 already in use | Find and kill the process: `lsof -i :8000` then `kill <PID>` |
| `npm: command not found` | Install Node.js via nvm (see Section 3.3) and open a new terminal |

---

*For architecture details and the full API reference, see [TECHNICAL_GUIDE.md](./TECHNICAL_GUIDE.md).*
*For the academic system design paper, see [TECHNICAL_PAPER.md](./TECHNICAL_PAPER.md).*
