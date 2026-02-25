"""
Settings routes for model configuration.

Manages Whisper and Ollama model settings, stored in settings.json.
Supports listing available Ollama models and pulling new ones.
"""
import json
import os
import requests
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Settings"])

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "settings.json")

DEFAULTS = {
    "whisper_model": "mlx-community/whisper-large-v3-turbo",
    "whisper_backend": "auto",
    "qwen3_model": "Qwen/Qwen3-ASR-1.7B",
    "qwen3_enabled": False,
    "ollama_model": "gemma3:4b",
    "ollama_base_url": "http://localhost:11434",
}


def load_settings() -> dict:
    """Load settings from JSON file, falling back to defaults."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                saved = json.load(f)
            return {**DEFAULTS, **saved}
        except (json.JSONDecodeError, IOError):
            pass
    return dict(DEFAULTS)


def save_settings(settings: dict):
    """Persist settings to JSON file."""
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


class ModelConfig(BaseModel):
    whisper_model: Optional[str] = None
    whisper_backend: Optional[str] = None
    qwen3_model: Optional[str] = None
    qwen3_enabled: Optional[bool] = None
    ollama_model: Optional[str] = None
    ollama_base_url: Optional[str] = None


@router.get("/models")
def get_model_config():
    """Get current model configuration."""
    return load_settings()


@router.put("/models")
def update_model_config(config: ModelConfig):
    """Update model configuration. Only provided fields are updated."""
    current = load_settings()
    updates = config.model_dump(exclude_none=True)
    current.update(updates)
    save_settings(current)
    logger.info(f"Model config updated: {updates}")
    return current


@router.get("/models/ollama/available")
def list_ollama_models():
    """List models currently available in Ollama."""
    settings = load_settings()
    base_url = settings["ollama_base_url"]
    try:
        res = requests.get(f"{base_url}/api/tags", timeout=10)
        res.raise_for_status()
        models = res.json().get("models", [])
        return {
            "models": [
                {
                    "name": m.get("name", "unknown"),
                    "size_gb": round(m.get("size", 0) / (1024**3), 2),
                    "modified_at": m.get("modified_at"),
                }
                for m in models
            ],
            "ollama_running": True,
        }
    except requests.ConnectionError:
        return {"models": [], "ollama_running": False, "error": "Ollama not running"}
    except Exception as e:
        return {"models": [], "ollama_running": False, "error": str(e)}


@router.post("/models/ollama/pull")
def pull_ollama_model(model_name: str = Query(..., description="Model name to pull, e.g. 'gemma3:4b'")):
    """Pull/download a model in Ollama. This can take a while for large models."""
    settings = load_settings()
    base_url = settings["ollama_base_url"]
    try:
        logger.info(f"Pulling Ollama model: {model_name}")
        res = requests.post(
            f"{base_url}/api/pull",
            json={"name": model_name, "stream": False},
            timeout=600,  # 10 min timeout for large models
        )
        res.raise_for_status()
        data = res.json()
        logger.info(f"Model pull complete: {model_name}")
        return {"message": f"Model '{model_name}' pulled successfully", "status": data.get("status", "success")}
    except requests.ConnectionError:
        raise HTTPException(status_code=503, detail="Ollama is not running")
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="Model pull timed out (>10 min). Try pulling via CLI: ollama pull " + model_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pull failed: {str(e)}")


@router.get("/models/whisper/status")
def get_whisper_status():
    """Get Whisper backend status and detected backend type."""
    settings = load_settings()
    try:
        from backend.whisper import detect_backend, WhisperBackend
        backend = detect_backend()
        return {
            "configured_model": settings["whisper_model"],
            "configured_backend": settings["whisper_backend"],
            "detected_backend": backend.value,
            "available": True,
        }
    except Exception as e:
        return {
            "configured_model": settings["whisper_model"],
            "configured_backend": settings["whisper_backend"],
            "detected_backend": None,
            "available": False,
            "error": str(e),
        }


@router.get("/models/qwen3/status")
def get_qwen3_status():
    """Get Qwen3-ASR availability and configuration status."""
    settings = load_settings()
    try:
        from backend.qwen3_asr import get_qwen3_status as _get_status
        status = _get_status()
        status["enabled"] = settings.get("qwen3_enabled", False)
        return status
    except Exception as e:
        return {
            "configured_model": settings.get("qwen3_model", "Qwen/Qwen3-ASR-1.7B"),
            "package_installed": False,
            "enabled": settings.get("qwen3_enabled", False),
            "error": str(e),
        }
