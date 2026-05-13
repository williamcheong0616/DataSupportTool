# DataSupportTool — From-Scratch Setup Guide

Tested on **Ubuntu 22.04 / 24.04 LTS**.  
All commands run as a regular user (not root) unless noted.

---

## What You Need

| Tool | Version | Purpose |
|---|---|---|
| Miniconda | latest | Python environment manager |
| Python | 3.12 | Runtime (managed by conda) |
| Docker Engine | 26+ | Runs PostgreSQL, Redis, Flower |
| Docker Compose | v2 plugin | Orchestrates containers |
| Node.js | 20 LTS | Frontend build toolchain |
| Ollama | latest | Local LLM inference for BR pipeline |
| Git | system | Clone the repo |

---

## Step 1 — System Packages

```bash
sudo apt update && sudo apt install -y \
    git curl wget ca-certificates \
    build-essential libpq-dev \
    ffmpeg
```

`libpq-dev` is required to build `psycopg2`. `ffmpeg` is required for audio processing.

---

## Step 2 — Free Up Required Ports

Docker needs ports **5432** (PostgreSQL) and **6379** (Redis). Ubuntu often ships with native versions of both that auto-start and block these ports.

Check first:

```bash
sudo ss -tlnp | grep -E '5432|6379'
```

If anything appears, remove it:

```bash
# Native Redis on port 6379
sudo systemctl stop redis-server && sudo systemctl disable redis-server
sudo apt purge redis-server -y && sudo apt autoremove -y

# Native PostgreSQL on port 5432
sudo systemctl stop postgresql && sudo systemctl disable postgresql
sudo apt purge postgresql* -y && sudo apt autoremove -y
```

Skipping this step causes Docker to fail with `address already in use`.

---

## Step 3 — Install Docker Engine

> Skip if already installed (`docker --version`).

```bash
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

# Run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 4 — Install Miniconda

> Skip if already installed (`conda --version`).

```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh \
    -O /tmp/miniconda.sh

bash /tmp/miniconda.sh -b -p "$HOME/miniconda3"

"$HOME/miniconda3/bin/conda" init bash
source ~/.bashrc
```

---

## Step 5 — Install Node.js 20 LTS

Ubuntu's default apt package ships Node 12, which is too old. Install Node 20 via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node --version   # v20.x.x
npm --version    # 10.x.x
```

---

## Step 6 — Install Ollama

Ollama runs the local LLMs used by the BR pipeline. It installs as a systemd service and starts automatically.

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Verify it's running
systemctl status ollama
```

Pull the default model the app expects:

```bash
ollama pull gemma3:4b
```

> The model name and Ollama URL are stored in `settings.json` at the project root (not in `.env`). Defaults are `gemma3:4b` at `http://localhost:11434`. You can change them via the Settings page in the UI after the app starts.

---

## Step 7 — Clone the Repository

```bash
git clone <your-repo-url> DataSupportTool
cd DataSupportTool
```

---

## Step 8 — Create the Conda Environment

```bash
conda create -n datasupport python=3.12 -y
conda activate datasupport
```

### Install PyTorch first

PyTorch must be installed separately before the rest of the requirements because the correct variant depends on your hardware:

```bash
# NVIDIA GPU (CUDA 12.1)
pip install torch --index-url https://download.pytorch.org/whl/cu121

# CPU only
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

> If you skip PyTorch, ASR features (Whisper, Silero VAD) will be unavailable but the rest of the app works fine.

### Install all other dependencies

```bash
pip install -r requirements.txt
```

---

## Step 9 — Configure Environment Variables

```bash
cp .env.example .env
```

The defaults in `.env.example` work as-is for local development. The only variables you may need to change:

| Variable | Default | When to change |
|---|---|---|
| `DATABASE_URL` | `postgres@localhost:5432` | If you changed the DB password in docker-compose |
| `CORS_ORIGINS` | `localhost:3000, localhost:5173` | If accessing from another machine |
| `USE_LOCAL_WHISPER` | `true` | Set `false` to use an external Whisper HTTP API |

**Ollama is not configured in `.env`.** It reads from `settings.json` automatically.

---

## Step 10 — Start Infrastructure

```bash
docker compose up -d
docker compose ps   # all three containers should show "healthy" or "running"
```

Expected containers: `dst-postgres`, `dst-redis`, `dst-flower`.

---

## Step 11 — Build the Frontend

```bash
cd frontend-react
npm install
npm run build
cd ..
```

This outputs the React app to `frontend-react/dist/`. Only needs to be re-run when frontend source files change.

---

## Step 12 — Start Everything

```bash
bash scripts/start_services.sh
```

The script automatically:
- Detects and activates the `datasupport` conda environment
- Stops any stale API / Celery processes
- Brings Docker containers up
- Starts Celery worker + beat in the background
- Starts the FastAPI server

No need to `conda activate` first — the script handles it.

---

## Step 13 — Verify

| URL | Expected |
|---|---|
| http://localhost:8000 | React frontend UI |
| http://localhost:8000/api/docs | Swagger UI |
| http://localhost:8000/api/health | `{"status": "ok"}` |
| http://localhost:5556 | Flower — Celery task monitor |
| http://localhost:11434 | Ollama API |

---

## Database Notes

**You do not need to run Alembic on a fresh setup.** The app calls `Base.metadata.create_all()` on startup, which creates all tables automatically if they don't exist.

Run Alembic only when pulling changes that include new migration files:

```bash
# Check if new migrations were added
git log --oneline alembic/versions/

# Apply them to an existing database
PYTHONPATH=. alembic upgrade head
```

---

## Development Mode (hot-reload)

Run each in its own terminal instead of using `start_services.sh`:

```bash
# Terminal 1 — infrastructure
docker compose up -d

# Terminal 2 — Celery worker + beat
conda activate datasupport
PYTHONPATH=. celery -A backend.celery_app:celery_app worker \
    --beat --pool=solo --loglevel=info \
    --queues=celery,transcription,br_pipeline

# Terminal 3 — FastAPI backend
conda activate datasupport
PYTHONPATH=. python run_api.py

# Terminal 4 — Vite dev server (UI at localhost:3000, proxies /api → :8000)
cd frontend-react && npm run dev
```

---

## Stopping Everything

```bash
pkill -f "run_api.py"
pkill -f "celery -A"
docker compose down

# Also wipe all database data (destructive)
docker compose down -v
```

---

## Troubleshooting

### Docker: `address already in use` on port 5432 or 6379
A native PostgreSQL or Redis is running. See Step 2.

### `ModuleNotFoundError: No module named 'dotenv'` or packages missing
The system Python is being used instead of the conda env. The `start_services.sh` script activates conda automatically — if running commands manually, prefix with `conda activate datasupport` first.

### `conda not found` inside start_services.sh
Conda was installed but its shell init hasn't been sourced. Run `source ~/.bashrc` and try again.

### `alembic upgrade head` — connection refused
PostgreSQL container isn't ready yet. Wait 10 seconds and retry. Check with `docker compose ps`.

### Frontend shows a blank white page
The frontend `dist/` was not built, or was built against a stale version. Rebuild:
```bash
cd frontend-react && npm run build
```
Then restart the API.

### Ollama / BR pipeline not responding
```bash
ollama list                    # confirm model is downloaded
ollama run gemma3:4b "hello"   # smoke test
```
The active model is set in `settings.json` (`ollama_model` key), not in `.env`.

### ASR not working (Whisper / Silero VAD)
Confirm PyTorch is installed and sees your hardware:
```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```
If CUDA shows `False` on a GPU machine, reinstall PyTorch with the correct CUDA variant (Step 8).
