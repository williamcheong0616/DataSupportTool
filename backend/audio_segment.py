"""
Audio Segmentation Service using Silero VAD.

Segments long audio files into smaller chunks based on voice activity detection.
"""
import os
import logging
from pathlib import Path
from typing import List, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Lazy-loaded model instance
_vad_model = None


@dataclass
class SegmentResult:
    """Result of audio segmentation."""
    source_file: str
    output_folder: str
    chunks: List[str]
    total_chunks: int


def _load_vad_model():
    """Lazy load Silero VAD model using silero-vad package."""
    global _vad_model
    
    if _vad_model is None:
        from silero_vad import load_silero_vad
        
        logger.info("Loading Silero VAD model...")
        _vad_model = load_silero_vad()
        logger.info("Silero VAD model loaded")
    
    return _vad_model


def segment_audio_file(
    file_path: str,
    chunk_length: int = 30,
    output_base: Optional[str] = None,
    min_speech_duration_ms: int = 500
) -> SegmentResult:
    """
    Segment a single audio file using Silero VAD into chunks of max chunk_length seconds.
    
    Args:
        file_path: Path to the audio file
        chunk_length: Maximum length of each chunk in seconds (default: 30)
        output_base: Base directory for output (default: same as input file)
        min_speech_duration_ms: Minimum speech duration in milliseconds to keep (default: 500ms)
        
    Returns:
        SegmentResult with paths to generated chunks
    """
    import torch
    import torchaudio
    from pydub import AudioSegment
    from silero_vad import get_speech_timestamps
    
    audio_path = Path(file_path)
    
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    
    # Load VAD model
    model = _load_vad_model()
    
    logger.info(f"Segmenting {audio_path.name}...")
    
    # Load audio with torchaudio
    wav, sr = torchaudio.load(str(audio_path))
    
    # Convert to mono if stereo
    if wav.shape[0] > 1:
        wav = torch.mean(wav, dim=0, keepdim=True)
    
    # Get speech timestamps from VAD
    speech_timestamps = get_speech_timestamps(
        wav.squeeze(), 
        model, 
        sampling_rate=sr,
        min_speech_duration_ms=min_speech_duration_ms
    )
    
    if not speech_timestamps:
        logger.warning(f"No speech detected in {audio_path.name}")
        return SegmentResult(
            source_file=str(audio_path),
            output_folder="",
            chunks=[],
            total_chunks=0
        )
    
    # Load with pydub for slicing
    audio_segment = AudioSegment.from_file(str(audio_path))
    
    # Determine output folder
    if output_base is None:
        output_base = str(audio_path.parent)
    output_folder = Path(output_base) / f"{audio_path.stem}_chunks"
    output_folder.mkdir(parents=True, exist_ok=True)
    
    chunk_files = []
    chunk_counter = 0
    segment_length_ms = chunk_length * 1000
    
    for ts in speech_timestamps:
        # Convert start/end to milliseconds
        start_ms = int(ts['start'] / sr * 1000)
        end_ms = int(ts['end'] / sr * 1000)
        segment_duration_ms = end_ms - start_ms
        
        # If segment is <= chunk_length, keep it as a whole chunk (no splitting)
        if segment_duration_ms <= segment_length_ms:
            chunk_audio = audio_segment[start_ms:end_ms]
            chunk_counter += 1
            chunk_file = output_folder / f"{audio_path.stem}_chunk{chunk_counter:04d}.wav"
            chunk_audio.export(str(chunk_file), format="wav")
            chunk_files.append(str(chunk_file))
            logger.debug(f"Saved whole segment {chunk_counter} ({segment_duration_ms/1000:.1f}s)")
        else:
            # Split long segments into max chunk_length chunks
            segment_start = start_ms
            
            while segment_start < end_ms:
                segment_end = min(segment_start + segment_length_ms, end_ms)
                chunk_audio = audio_segment[segment_start:segment_end]
                
                chunk_counter += 1
                chunk_file = output_folder / f"{audio_path.stem}_chunk{chunk_counter:04d}.wav"
                chunk_audio.export(str(chunk_file), format="wav")
                chunk_files.append(str(chunk_file))
                
                segment_start = segment_end
    
    logger.info(f"[{audio_path.name}] Saved {chunk_counter} chunks to {output_folder}")
    
    return SegmentResult(
        source_file=str(audio_path),
        output_folder=str(output_folder),
        chunks=chunk_files,
        total_chunks=chunk_counter
    )


def segment_multiple_files(
    file_paths: List[str],
    chunk_length: int = 30,
    output_base: Optional[str] = None
) -> List[SegmentResult]:
    """
    Segment multiple audio files.
    
    Args:
        file_paths: List of audio file paths
        chunk_length: Maximum length of each chunk in seconds
        output_base: Base directory for output
        
    Returns:
        List of SegmentResult for each file
    """
    results = []
    
    for file_path in file_paths:
        try:
            result = segment_audio_file(file_path, chunk_length, output_base)
            results.append(result)
        except Exception as e:
            logger.error(f"Failed to segment {file_path}: {e}")
            results.append(SegmentResult(
                source_file=file_path,
                output_folder="",
                chunks=[],
                total_chunks=0
            ))
    
    return results


def get_audio_duration(file_path: str) -> float:
    """Get duration of an audio file in seconds."""
    from pydub import AudioSegment
    
    audio = AudioSegment.from_file(file_path)
    return len(audio) / 1000.0  # Convert ms to seconds


def segment_audio_fixed(
    file_path: str,
    chunk_length: int = 30,
    output_base: Optional[str] = None
) -> SegmentResult:
    """
    Segment audio file into fixed-length chunks (no VAD).
    
    Simply cuts the audio every chunk_length seconds, regardless of speech content.
    Useful for preserving all audio including music, background sounds, etc.
    
    Args:
        file_path: Path to the audio file
        chunk_length: Length of each chunk in seconds (default: 30)
        output_base: Base directory for output (default: same as input file)
        
    Returns:
        SegmentResult with paths to generated chunks
    """
    from pydub import AudioSegment
    
    audio_path = Path(file_path)
    
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    
    logger.info(f"Segmenting {audio_path.name} (fixed {chunk_length}s chunks)...")
    
    # Load audio with pydub
    audio = AudioSegment.from_file(str(audio_path))
    total_duration_ms = len(audio)
    
    # Determine output folder
    if output_base is None:
        output_base = str(audio_path.parent)
    output_folder = Path(output_base) / f"{audio_path.stem}_chunks"
    output_folder.mkdir(parents=True, exist_ok=True)
    
    chunk_files = []
    chunk_counter = 0
    segment_length_ms = chunk_length * 1000
    
    # Cut into fixed-length chunks
    start_ms = 0
    while start_ms < total_duration_ms:
        end_ms = min(start_ms + segment_length_ms, total_duration_ms)
        chunk_audio = audio[start_ms:end_ms]
        
        # Only save if chunk has meaningful length (at least 1 second)
        if len(chunk_audio) >= 1000:
            chunk_counter += 1
            chunk_file = output_folder / f"{audio_path.stem}_chunk{chunk_counter:04d}.wav"
            chunk_audio.export(str(chunk_file), format="wav")
            chunk_files.append(str(chunk_file))
        
        start_ms = end_ms
    
    logger.info(f"[{audio_path.name}] Saved {chunk_counter} fixed chunks to {output_folder}")
    
    return SegmentResult(
        source_file=str(audio_path),
        output_folder=str(output_folder),
        chunks=chunk_files,
        total_chunks=chunk_counter
    )


def segment_audio(
    file_path: str,
    chunk_length: int = 30,
    output_base: Optional[str] = None,
    use_vad: bool = True,
    min_speech_duration_ms: int = 500
) -> SegmentResult:
    """
    Segment audio file with choice of VAD or fixed-length cutting.
    
    Args:
        file_path: Path to the audio file
        chunk_length: Maximum/fixed length of each chunk in seconds (default: 30)
        output_base: Base directory for output (default: same as input file)
        use_vad: If True, use Silero VAD to detect speech segments (voice only).
                 If False, cut into fixed-length chunks (preserves all audio).
        min_speech_duration_ms: Minimum speech duration in ms when using VAD (default: 500ms)
        
    Returns:
        SegmentResult with paths to generated chunks
    """
    if use_vad:
        return segment_audio_file(file_path, chunk_length, output_base, min_speech_duration_ms)
    else:
        return segment_audio_fixed(file_path, chunk_length, output_base)