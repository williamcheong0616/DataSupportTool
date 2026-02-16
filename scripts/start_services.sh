#!/bin/bash
# Script to start all production services

set -e

echo "🚀 Starting Data Pipeline Production Services..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start all services
echo "📦 Starting Docker containers..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check service status
echo ""
echo "✅ Services Status:"
echo "-------------------"

# PostgreSQL
if docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "✅ PostgreSQL: Running on port 5432"
else
    echo "❌ PostgreSQL: Not ready"
fi

# Redis
if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis: Running on port 6379"
else
    echo "❌ Redis: Not ready"
fi

# MLflow
if curl -s http://localhost:5000/health > /dev/null 2>&1; then
    echo "✅ MLflow: Running on http://localhost:5000"
else
    echo "⏳ MLflow: Starting up..."
fi

# Argilla
if curl -s http://localhost:6900/api/_status > /dev/null 2>&1; then
    echo "✅ Argilla: Running on http://localhost:6900"
else
    echo "⏳ Argilla: Starting up..."
fi

# Prefect
if curl -s http://localhost:4200/api/health > /dev/null 2>&1; then
    echo "✅ Prefect: Running on http://localhost:4200"
else
    echo "⏳ Prefect: Starting up..."
fi

# Flower
if curl -s http://localhost:5555 > /dev/null 2>&1; then
    echo "✅ Flower (Celery Monitor): Running on http://localhost:5555"
else
    echo "⏳ Flower: Starting up..."
fi

# API
if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    echo "✅ FastAPI Backend: Running on http://localhost:8000"
else
    echo "⏳ FastAPI: Starting up..."
fi

# Frontend (React)
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "✅ React Frontend: Running on http://localhost:5173"
else
    echo "⏳ React Frontend: Not running (start with: cd frontend-react && npm run dev)"
fi

echo ""
echo "🎉 All services started!"
echo ""
echo "📚 Quick Links:"
echo "  - Frontend:        http://localhost:5173"
echo "  - API Docs:        http://localhost:8000/docs"
echo "  - MLflow:          http://localhost:5000"
echo "  - Argilla:         http://localhost:6900"
echo "  - Prefect:         http://localhost:4200"
echo "  - Flower (Celery): http://localhost:5555"
echo ""
echo "💡 To stop all services: docker-compose down"
echo "💡 To view logs: docker-compose logs -f [service_name]"
