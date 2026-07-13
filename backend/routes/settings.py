"""
Settings routes for model configuration.

Manages Whisper and Ollama model settings, stored in settings.json.
Supports listing available Ollama models and pulling new ones.
"""
import json
import os
import secrets
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
    "provider_api_key": os.getenv("PROVIDER_API_KEY") or None,
    "provider_base_url": "",
    "response_system_prompt": """You are a helpful AI assistant that answers questions in Bahasa Rojak (Malaysian/Singaporean code-mixed style).

Bahasa Rojak characteristics:
- Mix of Malay (MAJORITY language) and English
- Use Malaysian/Singaporean slang and shortforms naturally (lah, leh, meh, lor, kan, sikit, macam, tau tak, betul tak, etc.)
- Natural conversational style
- Casual but informative tone

Your task: Answer the question based on the provided context/text.
The answer MUST:
- Be in Bahasa Rojak style with MALAY as MAJORITY language, codemixed with English
- Use slang/shortforms naturally (lah, leh, meh, sikit, macam, tau tak, betul tak)
- Be DETAILED and informative (not too short!)
- Directly address the question
- Reference specific details from the context
- Sound natural and conversational""",
}


def load_settings() -> dict:
    """Load settings from JSON file, falling back to defaults."""
    if os.path.exists(SETTINGS_FILE):
        try:
            # settings.json holds provider_api_key; tighten permissions on
            # every read in case the file predates this check or something
            # else widened its mode.
            if os.stat(SETTINGS_FILE).st_mode & 0o077:
                os.chmod(SETTINGS_FILE, 0o600)
            with open(SETTINGS_FILE) as f:
                saved = json.load(f)
            return {**DEFAULTS, **saved}
        except (json.JSONDecodeError, IOError):
            pass
    return dict(DEFAULTS)


def save_settings(settings: dict) -> None:
    """Persist settings to JSON file with owner-only (0600) permissions."""
    fd = os.open(SETTINGS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(settings, f, indent=2)


class ModelConfig(BaseModel):
    whisper_model: Optional[str] = None
    whisper_backend: Optional[str] = None
    qwen3_model: Optional[str] = None
    qwen3_enabled: Optional[bool] = None
    ollama_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    response_system_prompt: Optional[str] = None


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


# ==================== PROVIDER API (external integrations) ====================

class ProviderSettingsUpdate(BaseModel):
    provider_base_url: Optional[str] = None


def _mask_key(key: Optional[str]) -> Optional[str]:
    """Shorten a key to a display-safe 'first4…last4' form."""
    if not key:
        return None
    if len(key) <= 8:
        return "…"
    return f"{key[:4]}…{key[-4:]}"


@router.get("/provider")
def get_provider_settings():
    """Get the provider API's status, masked key, and base URL."""
    settings = load_settings()
    key = settings.get("provider_api_key")
    return {
        "enabled": bool(key),
        "masked_key": _mask_key(key),
        "provider_base_url": settings.get("provider_base_url", ""),
    }


@router.put("/provider")
def update_provider_settings(data: ProviderSettingsUpdate):
    """Update the provider base URL shown to external integrators."""
    current = load_settings()
    if data.provider_base_url is not None:
        current["provider_base_url"] = data.provider_base_url
    save_settings(current)
    return get_provider_settings()


@router.post("/provider/generate-key")
def generate_provider_api_key():
    """
    Generate (or rotate) the provider API key.

    Takes effect immediately — no server restart required. The full key is
    returned once in this response only; afterwards only a masked form is
    ever shown again, so the caller must copy it now.
    """
    current = load_settings()
    new_key = secrets.token_hex(32)
    current["provider_api_key"] = new_key
    save_settings(current)
    logger.info("Provider API key regenerated")
    return {
        "provider_api_key": new_key,
        "provider_base_url": current.get("provider_base_url", ""),
    }


@router.delete("/provider/key")
def revoke_provider_api_key():
    """Disable the provider API by clearing its key."""
    current = load_settings()
    current["provider_api_key"] = None
    save_settings(current)
    logger.info("Provider API key revoked")
    return get_provider_settings()


# ==================== DATABASE BACKUP ====================

@router.post("/backup")
def create_database_backup():
    """
    Manually trigger a database backup.
    
    Creates a pg_dump SQL file in the sql_backups/ directory.
    
    Returns:
        Backup metadata (filename, size, timestamp)
    """
    from backend.services.backup_service import create_backup
    
    try:
        result = create_backup(triggered_by="manual")
        logger.info(f"Manual backup created: {result['filename']}")
        return {"message": "Backup created successfully", **result}
    except Exception as e:
        logger.error(f"Manual backup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")


@router.get("/backups")
def list_database_backups():
    """
    List all available database backups, newest first.
    
    Returns:
        List of backup files with metadata
    """
    from backend.services.backup_service import list_backups
    
    backups = list_backups()
    return {"backups": backups, "total": len(backups)}


@router.get("/backup/download")
def download_backup(filename: str = Query(..., description="Backup filename to download")):
    """
    Download a specific backup file.
    
    Args:
        filename: Name of the backup file (e.g. db_backup_20260410_180000.sql)
    
    Returns:
        SQL file download
    """
    from backend.services.backup_service import BACKUP_DIR
    from fastapi.responses import FileResponse
    
    filepath = BACKUP_DIR / filename
    
    # Security: prevent directory traversal
    if ".." in filename or "/" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")
    
    return FileResponse(
        path=str(filepath),
        filename=filename,
        media_type="application/sql",
    )
