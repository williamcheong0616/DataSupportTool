# DataSupportTool — From-Scratch Setup Guide

Tested on **Ubuntu 22.04 / 24.04 LTS**. All commands run as a regular user (not root) unless noted.

---

## Prerequisites Overview

| Tool | Version | Purpose |
|---|---|---|
| Miniconda | latest | Python env manager |
| Python | 3.12 | Runtime (via conda) |
| Docker Engine | 26+ | PostgreSQL + Redis + Flower |
| Docker Compose | v2 plugin | Orchestrates containers |
| Node.js | 20 LTS | Frontend build toolchain |
| npm | 10+ | Frontend package manager |
| Ollama | latest | Local LLM inference (BR pipeline) |
| Git | system | Clone the repo |

---

## Step 1 — System Packages

```bash
sudo apt update && sudo apt install -y \
    git curl wget ca-certificates \
    build-essential libpq-dev \
    ffmpeg          # required for audio processing (yt-dlp, Whisper, pydub)
```

---

## Step 2 — Install Docker Engine

> Skip if Docker is already installed (`docker --version`).

```bash
# Add Docker's official GPG key and repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) \
    signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list

sudo apt update && sudo apt install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker   # apply group change in current shell without re-login

# Verify
docker --version          # Docker version 26+
docker compose version    # Docker Compose version v2+
```

---

## Step 3 — Install Miniconda

> Skip if `conda` is already installed (`conda --version`).

```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh \
    -O /tmp/miniconda.sh

bash /tmp/miniconda.sh -b -p "$HOME/miniconda3"

# Add conda to PATH permanently
"$HOME/miniconda3/bin/conda" init bash
source ~/.bashrc
```

---

## Step 4 — Install Node.js 20 LTS

> Ubuntu's default apt package is too old (Node 12). This installs Node 20 via NodeSource.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x
```

---

## Step 5 — Install Ollama

Ollama runs the local LLMs used by the BR pipeline (question generation, model responses, classification).

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Verify the service is running
ollama --version
systemctl status ollama   # should show "active (running)"
```

Pull the default model the app expects:

```bash
ollama pull gemma3:4b
```

> The app reads the Ollama model name and base URL from `settings.json` in the project root (not from `.env`). The defaults are `gemma3:4b` at `http://localhost:11434`. You can change them via the Settings page in the UI after the app starts, or by editing `settings.json` directly.

---

## Step 6 — Clone the Repository

```bash
git clone <your-repo-url> DataSupportTool
cd DataSupportTool
```

---

## Step 7 — Create the Conda Environment

```bash
conda create -n datasupport python=3.12 -y
conda activate datasupport
```

### Install PyTorch first (before the rest of requirements)

PyTorch must be installed separately because the correct variant depends on your hardware. Pick **one**:

```bash
# NVIDIA GPU (CUDA 12.1)
pip install torch --index-url https://download.pytorch.org/whl/cu121

# CPU only (no GPU)
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

> If you skip PyTorch, ASR features (Whisper, Silero VAD) will be unavailable but the rest of the app still works.

### Install all other dependencies

```bash
pip install -r requirements.txt
```

> **Note:** `psycopg2-binary` requires `libpq-dev` (installed in Step 1). If pip fails on it, re-check Step 1.

---

## Step 8 — Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

The defaults in `.env.example` work for local development as-is. The only values you may want to change:

| Variable | Default | When to change |
|---|---|---|
| `DATABASE_URL` | postgres on localhost:5432 | If you change the DB password in docker-compose |
| `CORS_ORIGINS` | localhost:3000 + :5173 | If you access the app from another machine |
| `USE_LOCAL_WHISPER` | `true` | Set to `false` to use an external Whisper HTTP API |

> **Ollama is not configured in `.env`.** The app stores Ollama settings (`ollama_model`, `ollama_base_url`) in `settings.json` at the project root. The file ships with sensible defaults (`gemma3:4b`, `http://localhost:11434`) and can be edited via the Settings page in the UI.

---

## Step 9 — Start Infrastructure (PostgreSQL, Redis, Flower)

Before starting, confirm ports 5432 and 6379 are free. On a fresh Ubuntu install, `apt` may have installed native PostgreSQL or Redis that auto-start and block these ports:

```bash
# Check if anything is already holding the ports
sudo ss -tlnp | grep -E '5432|6379'
```

If you see `postgres` or `redis-server` in the output, stop and remove them:

```bash
# Native Redis conflict
sudo systemctl stop redis-server && sudo systemctl disable redis-server
sudo apt purge redis-server -y && sudo apt autoremove -y

# Native PostgreSQL conflict
sudo systemctl stop postgresql && sudo systemctl disable postgresql
sudo apt purge postgresql* -y && sudo apt autoremove -y
```

Then start the containers:

```bash
docker compose up -d

# Confirm all containers are healthy
docker compose ps
```

Expected: `dst-postgres`, `dst-redis`, and `dst-flower` all showing `healthy` or `running`.

---

## Step 10 — Database Initialisation

**You do not need to run Alembic for a fresh setup.** The app auto-creates all tables on startup via `Base.metadata.create_all()` inside the FastAPI lifespan handler. Just start the app (Step 12) and the schema will be ready.

**When you DO need `alembic upgrade head`:**

- After `git pull` introduces new migration files in `alembic/versions/` — `create_all()` won't add new columns to existing tables, but Alembic will.
- Check if new migrations landed: `git log --oneline alembic/versions/`

```bash
# Only run this when schema migrations need to be applied to an existing database
conda activate datasupport
PYTHONPATH=. alembic upgrade head
```

For a brand-new database, skip this step entirely.

---

## Step 11 — Build the Frontend

```bash
cd frontend-react
npm install
npm run build        # outputs to frontend-react/dist/
cd ..
```

The production API server serves `dist/` as the React SPA. You only need to rebuild when frontend source files change.

---

## Step 12 — Start All Services

### Option A — One command (production-style)

```bash
bash scripts/start_services.sh
```

The script activates the `datasupport` conda env automatically.

### Option B — Four terminals (development, with hot-reload)

**Terminal 1 — Infrastructure** (already running from Step 9)
```bash
docker compose up -d
```

**Terminal 2 — Celery worker + beat**
```bash
conda activate datasupport
PYTHONPATH=. celery -A backend.celery_app:celery_app worker \
    --beat --pool=solo --loglevel=info \
    --queues=celery,transcription,br_pipeline
```

**Terminal 3 — FastAPI backend**
```bash
conda activate datasupport
PYTHONPATH=. python run_api.py
```

**Terminal 4 — Vite dev server** (proxies `/api` → `:8000`, UI at `:3000`)
```bash
cd frontend-react
npm run dev
```

---

## Step 13 — Verify Everything Works

| URL | Expected |
|---|---|
| http://localhost:3000 | React app (Vite dev mode) |
| http://localhost:8000 | React app (production build) |
| http://localhost:8000/api/docs | Swagger UI |
| http://localhost:8000/api/health | `{"status": "ok"}` |
| http://localhost:5556 | Flower — Celery task monitor |
| http://localhost:11434 | Ollama API root |

---

## Stopping Everything

```bash
# Stop API and Celery (if started manually)
pkill -f "run_api.py"
pkill -f "celery -A"

# Stop Docker containers (data is preserved in Docker volumes)
docker compose down

# To also delete all database data (destructive — cannot be undone)
docker compose down -v
```

---

## Troubleshooting

### `psycopg2` fails to install
```bash
sudo apt install -y libpq-dev python3-dev
pip install psycopg2-binary
```

### `alembic upgrade head` — "connection refused"
The PostgreSQL container is not yet healthy. Wait 15 seconds and retry.
```bash
docker compose ps   # check dst-postgres shows "healthy"
```

### Celery cannot connect to Redis
```bash
docker compose exec dst-redis redis-cli ping   # should return PONG
```

### Frontend shows blank page or 404 on `/api` routes
- Dev mode: confirm Vite is on `:3000` and FastAPI is on `:8000`.
- Production mode: run `npm run build` (Step 11) before `python run_api.py`.

### `ModuleNotFoundError: No module named 'backend'`
`PYTHONPATH` is not set. Prefix commands with `PYTHONPATH=.` or use the provided scripts.

### Ollama: model not responding / BR pipeline errors
```bash
ollama list                      # confirm the model is downloaded
ollama run gemma3:4b "hello"     # quick smoke test
```
The active model is set in `settings.json` (`ollama_model` key), not in `.env`. If you pulled a different model, either update `settings.json` or change it in the app Settings page.

### ASR not working (Whisper / Silero VAD)
These require PyTorch. Confirm it is installed and detected:
```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```
If CUDA shows `False` on a machine with an NVIDIA GPU, reinstall PyTorch with the correct CUDA variant (see Step 7).
