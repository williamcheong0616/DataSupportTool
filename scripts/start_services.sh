#!/bin/bash
# Start all DataSupportTool infrastructure services via Docker Compose
# then apply migrations and start the API + Celery worker.

set -e

echo "🚀 Starting DataSupportTool Services..."

# ── 0. Set Environment Path ───────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_ROOT"

export PYTHONPATH="$PROJECT_ROOT:$PYTHONPATH"
echo "  📍 Project Root: $PROJECT_ROOT"
echo "  🐍 PYTHONPATH:   $PYTHONPATH"

# ── Activate conda environment ────────────────────────────────
CONDA_ENV="datasupport"

# Derive conda base from CONDA_EXE (set whenever conda is initialised),
# falling back to common install locations.
if [ -n "$CONDA_EXE" ]; then
    CONDA_BASE="$(dirname "$(dirname "$CONDA_EXE")")"
elif [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
    CONDA_BASE="$HOME/miniconda3"
elif [ -f "$HOME/anaconda3/etc/profile.d/conda.sh" ]; then
    CONDA_BASE="$HOME/anaconda3"
else
    echo "❌ conda not found. Install Miniconda and create the '$CONDA_ENV' env first."
    exit 1
fi

source "$CONDA_BASE/etc/profile.d/conda.sh"
conda activate "$CONDA_ENV"
echo "  🐍 Conda env:    $CONDA_DEFAULT_ENV ($(which python))"

# ── CUDA library path for faster-whisper / CTranslate2 ───────
# nvidia-cublas-cu12 (in requirements.txt) provides libcublas.so.12 which
# CTranslate2 requires by exact name. Use Python to locate it so no paths
# or version numbers are hardcoded here.
CUDA_LIB=$(python -c "import nvidia.cublas, os; print(os.path.join(os.path.dirname(nvidia.cublas.__file__), 'lib'))" 2>/dev/null || true)
if [ -n "$CUDA_LIB" ] && [ -d "$CUDA_LIB" ]; then
    export LD_LIBRARY_PATH="$CUDA_LIB:${LD_LIBRARY_PATH:-}"
    echo "  🔧 CUDA libs:    $CUDA_LIB"
else
    echo "  ⚠️  nvidia-cublas-cu12 not found — run: pip install nvidia-cublas-cu12"
fi


# ── 1. Check Docker ──────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# ── 2. Clean up stale state ───────────────────────────────────
echo "🧹 Cleaning up existing background processes..."
pkill -f "celery -A" 2>/dev/null || true
pkill -f "run_api.py" 2>/dev/null || true
rm -f celerybeat-schedule*
sleep 2

echo "🧹 Cleaning up existing containers..."
docker compose down

# ── 3. Start infrastructure (PostgreSQL, Redis, Flower) ──────
echo "📦 Starting Docker containers..."
docker compose up -d

echo "⏳ Waiting for services to be healthy..."
sleep 5

# ── 4. Check infrastructure health ──────────────────────────
echo ""
echo "✅ Infrastructure Status:"
echo "─────────────────────────"

if docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✅ PostgreSQL: Running on port 5432"
else
    echo "  ❌ PostgreSQL: Not ready"
    exit 1
fi

if docker compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "  ✅ Redis: Running on port 6379"
else
    echo "  ❌ Redis: Not ready"
    exit 1
fi

# ── 5. Start Celery worker & beat (background) ────────────────
echo ""
echo "🔄 Starting Celery worker & scheduler (beat)..."
# macOS: use --pool=solo to avoid fork() crashes with MLX/Metal
# Linux/production: can use --pool=prefork --concurrency=2
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES celery -A backend.celery_app:celery_app worker \
    --beat \
    -n worker_%h \
    --loglevel=info \
    --queues=celery,transcription,br_pipeline \
    --pool=solo \
    &
CELERY_PID=$!
echo "  ✅ Celery worker + beat started (PID: $CELERY_PID)"

# ── 6. Start FastAPI ────────────────────────────────────────
echo ""
echo "🌐 Starting FastAPI server..."

# Pre-flight check: ensure frontend has been built
if [ ! -f "$PROJECT_ROOT/frontend-react/dist/index.html" ]; then
    echo "  ⚠️  WARNING: frontend-react/dist/ not found."
    echo "      Run: cd frontend-react && npm run build"
    echo "      The API will start but will not serve the frontend UI."
fi

python run_api.py &
API_PID=$!
sleep 3

echo ""
echo "════════════════════════════════════════"
echo "🎉 All services running!"
echo "════════════════════════════════════════"
echo ""
echo "📚 Quick Links:"
echo "  Frontend:        http://localhost:5173"
echo "  API Docs:        http://localhost:8000/api/docs"
echo "  Health Check:    http://localhost:8000/api/health"
echo "  Flower (Celery): http://localhost:5556"
echo ""
echo "💡 To stop:"
echo "  kill $API_PID $CELERY_PID   # Stop API + Celery"
echo "  docker compose down          # Stop infrastructure"
