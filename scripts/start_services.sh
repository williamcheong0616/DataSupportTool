#!/bin/bash
# Start all DataSupportTool infrastructure services via Docker Compose
# then apply migrations and start the API + Celery worker.

set -e

echo "🚀 Starting DataSupportTool Services..."

# ── 0. Set Environment Path ───────────────────────────────────
# Get the absolute path to the project root (one level up from this script)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Change to project root to ensure all commands run correctly
cd "$PROJECT_ROOT"

# Export PYTHONPATH so Celery and Python can find the 'backend' package
export PYTHONPATH="$PROJECT_ROOT:$PYTHONPATH"
echo "  📍 Project Root: $PROJECT_ROOT"
echo "  🐍 PYTHONPATH:   $PYTHONPATH"


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

# ── 5. Start FastAPI ────────────────────────────────────────
echo ""
echo "🌐 Starting FastAPI server..."
#python run_api.py &
#API_PID=$!
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
