#!/bin/bash
# Start all DataSupportTool infrastructure services via Docker Compose
# then apply migrations and start the API + Celery worker.

set -e

echo "🚀 Starting DataSupportTool Services..."

# ── 1. Check Docker ──────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# ── 2. Start infrastructure (PostgreSQL, Redis, Flower) ──────
echo "📦 Starting Docker containers..."
docker-compose up -d

echo "⏳ Waiting for services to be healthy..."
sleep 5

# ── 3. Check infrastructure health ──────────────────────────
echo ""
echo "✅ Infrastructure Status:"
echo "─────────────────────────"

if docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✅ PostgreSQL: Running on port 5432"
else
    echo "  ❌ PostgreSQL: Not ready"
    exit 1
fi

if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "  ✅ Redis: Running on port 6379"
else
    echo "  ❌ Redis: Not ready"
    exit 1
fi

# ── 4. Run Alembic migrations ────────────────────────────────
echo ""
echo "📋 Running database migrations..."
alembic upgrade head
echo "  ✅ Migrations applied"

# ── 5. Start Celery worker (background) ─────────────────────
echo ""
echo "🔄 Starting Celery worker..."
celery -A backend.celery_app:celery_app worker \
    --loglevel=info \
    --queues=celery,transcription \
    --concurrency=2 \
    &
CELERY_PID=$!
echo "  ✅ Celery worker started (PID: $CELERY_PID)"

# ── 6. Start FastAPI ────────────────────────────────────────
echo ""
echo "🌐 Starting FastAPI server..."
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
echo "  Flower (Celery): http://localhost:5555"
echo ""
echo "💡 To stop:"
echo "  kill $API_PID $CELERY_PID   # Stop API + Celery"
echo "  docker-compose down          # Stop infrastructure"
