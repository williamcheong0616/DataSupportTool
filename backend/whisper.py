"""
Local Whisper transcription service with multi-backend support.
Supports:
- MLX (Apple Silicon) - uses mlx-whisper
- CUDA (NVIDIA GPUs) - uses faster-whisper
- CPU fallback - uses faster-whisper with int8

Provides transcription functionality for the ASR annotation pipeline.
"""
import os
import platform
from typing import Optional, Dict, Any, List, Literal
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class WhisperBackend(str, Enum):
    """Available Whisper backends."""
    MLX = "mlx"          # Apple Silicon
    CUDA = "cuda"        # NVIDIA GPU
    CPU = "cpu"          # CPU fallback
    AUTO = "auto"        # Auto-detect best available


# Singleton model instances
_mlx_model = None
_cuda_model = None
_active_backend: Optional[WhisperBackend] = None


@dataclass
class TranscriptionResult:
    """Result of audio transcription."""
    text: str
    language: str
    confidence: Optional[float] = None
    segments: Optional[List[Dict[str, Any]]] = None
    backend: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "language": self.language,
            "confidence": self.confidence,
            "segments": self.segments,
            "backend": self.backend
        }


def detect_backend() -> WhisperBackend:
    """
    Auto-detect the best available Whisper backend.
    
    Returns:
        WhisperBackend enum indicating the best available backend
    """
    # Check for CUDA first (preferred for training/inference speed)
    try:
        import torch
        if torch.cuda.is_available():
            logger.info("CUDA detected - using faster-whisper with GPU")
            return WhisperBackend.CUDA
    except ImportError:
        pass
    
    # Check for Apple Silicon with MLX
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        try:
            import mlx_whisper
            logger.info("Apple Silicon detected - using mlx-whisper")
            return WhisperBackend.MLX
        except ImportError:
            logger.warning("MLX not available on Apple Silicon, falling back to CPU")
    
    # Fallback to CPU
    logger.info("Using CPU backend with faster-whisper")
    return WhisperBackend.CPU


def get_mlx_model(model_name: str = "mlx-community/whisper-large-v3-turbo"):
    """Get or initialize the MLX Whisper model."""
    global _mlx_model
    
    if _mlx_model is None:
        try:
            import mlx_whisper
            logger.info(f"Loading MLX Whisper model: {model_name}")
            _mlx_model = mlx_whisper
            logger.info("MLX Whisper model ready")
        except ImportError:
            raise ImportError(
                "mlx-whisper is required for MLX backend. "
                "Install with: pip install mlx-whisper"
            )
    
    return _mlx_model


def get_cuda_model(
    model_size: str = "large-v3-turbo",
    device: str = "cuda",
    compute_type: str = "float16"
):
    """Get or initialize the faster-whisper model for CUDA/CPU."""
    global _cuda_model
    
    if _cuda_model is None:
        try:
            from faster_whisper import WhisperModel
            
            # Adjust compute type for CPU
            if device == "cpu":
                compute_type = "int8"
            
            logger.info(f"Loading faster-whisper model: {model_size} on {device} ({compute_type})")
            _cuda_model = WhisperModel(model_size, device=device, compute_type=compute_type)
            logger.info("faster-whisper model ready")
        except ImportError:
            raise ImportError(
                "faster-whisper is required for CUDA/CPU backend. "
                "Install with: pip install faster-whisper"
            )
    
    return _cuda_model


def _transcribe_mlx(
    audio_path: str,
    model_name: str = "mlx-community/whisper-large-v3-turbo",
    language: Optional[str] = None,
    word_timestamps: bool = False,
) -> TranscriptionResult:
    """Transcribe using MLX Whisper (Apple Silicon)."""
    mlx_whisper = get_mlx_model(model_name)
    
    options: Dict[str, Any] = {
        "path_or_hf_repo": model_name,
        "word_timestamps": word_timestamps,
        "task": "transcribe",  # Never translate - keep original sounds as-is
        "condition_on_previous_text": False,  # Don't bias based on previous text (prevents language switching)
    }
    
    if language:
        options["language"] = language
    # If no language specified, let Whisper detect and transcribe as-is
    
    result: Dict[str, Any] = mlx_whisper.transcribe(audio_path, **options)
    
    return _parse_result(result, backend="mlx")


def _transcribe_cuda(
    audio_path: str,
    model_size: str = "large-v3-turbo",
    language: Optional[str] = None,
    word_timestamps: bool = False,
    device: str = "cuda",
    compute_type: str = "float16",
    beam_size: int = 5,
) -> TranscriptionResult:
    """Transcribe using faster-whisper (CUDA/CPU)."""
    model = get_cuda_model(model_size, device=device, compute_type=compute_type)
    
    # Build transcription options
    options: Dict[str, Any] = {
        "beam_size": beam_size,
        "word_timestamps": word_timestamps,
        "task": "transcribe",  # Never translate - keep original sounds as-is
        "condition_on_previous_text": False,  # Don't bias based on previous text (prevents language switching)
    }
    
    if language:
        options["language"] = language
    # If no language specified, let Whisper detect and transcribe as-is
    
    # Transcribe - returns generator of segments
    segments_gen, info = model.transcribe(audio_path, **options)
    
    # Collect all segments (processes entire audio)
    segments: List[Dict[str, Any]] = []
    full_text_parts: List[str] = []
    total_logprob = 0.0
    segment_count = 0
    
    for segment in segments_gen:
        seg_dict: Dict[str, Any] = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        
        if word_timestamps and hasattr(segment, 'words') and segment.words:
            seg_dict["words"] = [
                {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                for w in segment.words
            ]
        
        segments.append(seg_dict)
        full_text_parts.append(segment.text)
        
        if hasattr(segment, 'avg_logprob'):
            total_logprob += segment.avg_logprob
            segment_count += 1
    
    full_text = "".join(full_text_parts).strip()
    
    # Calculate confidence
    confidence: Optional[float] = None
    if segment_count > 0:
        import math
        avg_logprob = total_logprob / segment_count
        confidence = math.exp(avg_logprob)
    
    backend_name = "cuda" if device == "cuda" else "cpu"
    
    return TranscriptionResult(
        text=full_text,
        language=info.language,
        confidence=confidence,
        segments=segments,
        backend=backend_name
    )


def _parse_result(result: Dict[str, Any], backend: str = "unknown") -> TranscriptionResult:
    """Parse MLX whisper result into TranscriptionResult."""
    full_text: str = str(result.get("text", "")).strip()
    detected_language: str = str(result.get("language", "unknown"))
    
    segments: List[Dict[str, Any]] = []
    if "segments" in result:
        for seg in result["segments"]:
            seg_dict: Dict[str, Any] = seg if isinstance(seg, dict) else {}
            segment_info: Dict[str, Any] = {
                "start": seg_dict.get("start", 0),
                "end": seg_dict.get("end", 0),
                "text": str(seg_dict.get("text", "")).strip(),
            }
            if "words" in seg_dict:
                segment_info["words"] = seg_dict["words"]
            segments.append(segment_info)
    
    # Calculate confidence
    confidence: Optional[float] = None
    if "segments" in result:
        probs = []
        for s in result["segments"]:
            s_dict: Dict[str, Any] = s if isinstance(s, dict) else {}
            if s_dict.get("avg_logprob"):
                probs.append(s_dict["avg_logprob"])
        if probs:
            import math
            avg_logprob = sum(probs) / len(probs)
            confidence = math.exp(avg_logprob)
    
    return TranscriptionResult(
        text=full_text,
        language=detected_language,
        confidence=confidence,
        segments=segments,
        backend=backend
    )


def transcribe_audio(
    audio_path: str,
    backend: WhisperBackend = WhisperBackend.AUTO,
    model_name: str = "mlx-community/whisper-large-v3-turbo",
    model_size: str = "large-v3-turbo",
    language: Optional[str] = None,
    word_timestamps: bool = False,
    beam_size: int = 5,
) -> TranscriptionResult:
    """
    Transcribe an audio file using the best available Whisper backend.
    
    Automatically detects and uses:
    - MLX on Apple Silicon (fastest on M1/M2/M3)
    - CUDA on NVIDIA GPUs (fastest on RTX/A100)
    - CPU fallback with int8 quantization
    
    Args:
        audio_path: Path to the audio file
        backend: WhisperBackend to use (AUTO for auto-detection)
        model_name: HuggingFace model for MLX (e.g., "mlx-community/whisper-large-v3-turbo")
        model_size: Model size for CUDA/CPU (e.g., "large-v3-turbo", "medium", "small")
        language: Optional language code (e.g., 'en', 'ms', 'zh'). Auto-detect if None.
        word_timestamps: Whether to include word-level timestamps
        beam_size: Beam size for decoding (CUDA/CPU only)
        
    Returns:
        TranscriptionResult with text, language, confidence, segments, and backend used
        
    Raises:
        FileNotFoundError: If audio file doesn't exist
        ImportError: If required backend package is not installed
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    
    # Auto-detect backend if needed
    if backend == WhisperBackend.AUTO:
        backend = detect_backend()
    
    logger.info(f"Transcribing with {backend.value} backend: {audio_path}")
    
    if backend == WhisperBackend.MLX:
        return _transcribe_mlx(
            audio_path,
            model_name=model_name,
            language=language,
            word_timestamps=word_timestamps,
        )
    elif backend == WhisperBackend.CUDA:
        return _transcribe_cuda(
            audio_path,
            model_size=model_size,
            language=language,
            word_timestamps=word_timestamps,
            device="cuda",
            compute_type="float16",
            beam_size=beam_size,
        )
    else:  # CPU
        return _transcribe_cuda(
            audio_path,
            model_size=model_size,
            language=language,
            word_timestamps=word_timestamps,
            device="cpu",
            compute_type="int8",
            beam_size=beam_size,
        )


def transcribe_audio_simple(
    audio_path: str,
    language: Optional[str] = None,
    backend: WhisperBackend = WhisperBackend.AUTO,
) -> Dict[str, Any]:
    """
    Simple transcription interface compatible with the API.
    
    Returns a dict with 'text' and 'language' keys matching the existing API contract.
    
    Args:
        audio_path: Path to audio file
        language: Optional language hint
        backend: WhisperBackend to use (AUTO for auto-detection)
        
    Returns:
        Dict with 'text', 'language', 'confidence', 'segments', and 'backend'
    """
    result = transcribe_audio(audio_path, backend=backend, language=language)
    return result.to_dict()


# Environment variable to force a specific backend
def get_configured_backend() -> WhisperBackend:
    """Get backend from environment variable or auto-detect."""
    env_backend = os.getenv("WHISPER_BACKEND", "auto").lower()
    
    if env_backend == "mlx":
        return WhisperBackend.MLX
    elif env_backend == "cuda":
        return WhisperBackend.CUDA
    elif env_backend == "cpu":
        return WhisperBackend.CPU
    else:
        return WhisperBackend.AUTO


# For direct module testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python whisper.py <audio_file> [backend]")
        print("  backend: auto, mlx, cuda, cpu (default: auto)")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    backend_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"
    
    backend_map = {
        "auto": WhisperBackend.AUTO,
        "mlx": WhisperBackend.MLX,
        "cuda": WhisperBackend.CUDA,
        "cpu": WhisperBackend.CPU,
    }
    backend = backend_map.get(backend_arg.lower(), WhisperBackend.AUTO)
    
    print(f"Transcribing: {audio_file}")
    print(f"Backend: {backend.value}")
    
    result = transcribe_audio(audio_file, backend=backend)
    
    print(f"\nBackend used: {result.backend}")
    print(f"Language: {result.language}")
    if result.confidence:
        print(f"Confidence: {result.confidence:.2%}")
    print(f"\nTranscription:\n{result.text}")
    
    if result.segments:
        print(f"\n--- Segments ({len(result.segments)}) ---")
        for seg in result.segments:
            print(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")
