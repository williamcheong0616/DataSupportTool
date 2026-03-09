"""
Qwen3-ASR transcription service.

Provides a second ASR perspective alongside Whisper using Alibaba's Qwen3-ASR model.
Supports:
- CUDA (NVIDIA GPUs) - primary target
- MPS (Apple Silicon) - fallback
- CPU - last resort fallback

Uses the qwen-asr package with Qwen3ASRModel for inference.
"""
import os
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Singleton model instance
_qwen3_model = None
_qwen3_device = None


def detect_device() -> str:
    """
    Auto-detect the best available device for Qwen3-ASR.
    
    Returns:
        Device string: 'cuda:0', 'mps', or 'cpu'
    """
    try:
        import torch
        if torch.cuda.is_available():
            logger.info("Qwen3-ASR: CUDA detected")
            return "cuda:0"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("Qwen3-ASR: MPS (Apple Silicon) detected")
            return "mps"
        else:
            logger.info("Qwen3-ASR: No GPU found, using CPU")
            return "cpu"
    except ImportError:
        logger.warning("PyTorch not available, defaulting to CPU")
        return "cpu"


def get_qwen3_model(model_name: str = "Qwen/Qwen3-ASR-1.7B"):
    """
    Get or initialize the Qwen3-ASR model (singleton).
    
    Args:
        model_name: HuggingFace model name
        
    Returns:
        Initialized Qwen3ASRModel instance
    """
    global _qwen3_model, _qwen3_device
    
    if _qwen3_model is not None:
        return _qwen3_model
    
    try:
        import torch
        from qwen_asr import Qwen3ASRModel
        
        device = detect_device()
        _qwen3_device = device
        
        # Select dtype based on device
        if device.startswith("cuda"):
            dtype = torch.bfloat16
        elif device == "mps":
            dtype = torch.float16
        else:
            dtype = torch.float32
        
        logger.info(f"Loading Qwen3-ASR model: {model_name} on {device} with {dtype}")
        
        _qwen3_model = Qwen3ASRModel.from_pretrained(
            model_name,
            dtype=dtype,
            device_map=device,
            max_inference_batch_size=1,  # Single file at a time in worker context
            max_new_tokens=512,  # Sufficient for typical audio segments
        )
        
        logger.info(f"Qwen3-ASR model loaded successfully on {device}")
        return _qwen3_model
        
    except ImportError as e:
        logger.error(f"qwen-asr package not installed: {e}")
        raise ImportError(
            "qwen-asr package is required for Qwen3 transcription. "
            "Install with: pip install qwen-asr"
        ) from e
    except Exception as e:
        logger.error(f"Failed to load Qwen3-ASR model: {e}")
        raise


def _get_configured_model() -> str:
    """Read Qwen3 model name from settings.json."""
    try:
        import json
        settings_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "settings.json")
        if os.path.exists(settings_path):
            with open(settings_path) as f:
                settings = json.load(f)
            return settings.get("qwen3_model", "Qwen/Qwen3-ASR-1.7B")
    except Exception:
        pass
    return "Qwen/Qwen3-ASR-1.7B"


def transcribe_audio_qwen3(
    audio_path: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Transcribe an audio file using Qwen3-ASR.
    
    Args:
        audio_path: Path to audio file
        language: Optional language hint (e.g., "English", "Chinese", "Malay")
                  If None, auto-detects language.
        
    Returns:
        Dict with 'text', 'language', 'confidence', 'backend' keys
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    
    model_name = _get_configured_model()
    model = get_qwen3_model(model_name)
    
    logger.info(f"Qwen3-ASR transcribing: {os.path.basename(audio_path)}")
    
    try:
        results = model.transcribe(
            audio=audio_path,
            language=language,
        )
        
        if not results or len(results) == 0:
            logger.warning(f"Qwen3-ASR returned empty results for {audio_path}")
            return {
                "text": "",
                "language": None,
                "confidence": None,
                "backend": "qwen3",
            }
        
        result = results[0]
        
        # Extract language and text from result
        text = getattr(result, "text", "") or ""
        detected_language = getattr(result, "language", None)
        
        logger.info(
            f"Qwen3-ASR transcription complete: "
            f"language={detected_language}, "
            f"text_length={len(text)}"
        )
        
        return {
            "text": text.strip(),
            "language": detected_language,
            "confidence": None,  # Qwen3-ASR doesn't provide a confidence score
            "backend": "qwen3",
        }
        
    except Exception as e:
        logger.error(f"Qwen3-ASR transcription failed for {audio_path}: {e}")
        raise


def transcribe_audio_qwen3_simple(
    audio_path: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Simple transcription interface compatible with the API.
    Mirrors whisper.transcribe_audio_simple() contract.
    
    Args:
        audio_path: Path to audio file
        language: Optional language hint
        
    Returns:
        Dict with 'text', 'language', 'confidence', and 'backend'
    """
    return transcribe_audio_qwen3(audio_path, language=language)


def is_qwen3_available() -> bool:
    """Check if qwen-asr package is installed and importable."""
    try:
        import qwen_asr  # noqa: F401
        return True
    except ImportError:
        return False


def get_qwen3_status() -> Dict[str, Any]:
    """Get Qwen3-ASR availability and configuration status."""
    available = is_qwen3_available()
    model_name = _get_configured_model()
    
    status = {
        "configured_model": model_name,
        "package_installed": available,
        "model_loaded": _qwen3_model is not None,
        "device": _qwen3_device,
    }
    
    if available:
        try:
            device = detect_device()
            status["detected_device"] = device
        except Exception as e:
            status["detected_device"] = None
            status["error"] = str(e)
    
    return status


# For direct module testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python qwen3_asr.py <audio_file>")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    
    print(f"Transcribing with Qwen3-ASR: {audio_file}")
    print(f"Qwen3 available: {is_qwen3_available()}")
    print(f"Device: {detect_device()}")
    
    result = transcribe_audio_qwen3_simple(audio_file)
    
    print(f"\nLanguage: {result['language']}")
    print(f"Backend: {result['backend']}")
    print(f"\nTranscription:\n{result['text']}")
