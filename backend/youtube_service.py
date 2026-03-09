"""
YouTube Audio Download Service.

Downloads audio from YouTube videos using yt-dlp.
"""
import os
import re
import logging
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DownloadResult:
    """Result of YouTube audio download."""
    success: bool
    file_path: Optional[str]
    title: str
    duration: float  # seconds
    error: Optional[str] = None


def sanitize_filename(title: str) -> str:
    """Sanitize a string to be used as a filename."""
    # Remove invalid characters
    sanitized = re.sub(r'[<>:"/\\|?*]', '', title)
    # Replace spaces and other problematic chars
    sanitized = re.sub(r'\s+', '_', sanitized)
    # Limit length
    return sanitized[:100]


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:embed/)([a-zA-Z0-9_-]{11})',
        r'(?:shorts/)([a-zA-Z0-9_-]{11})',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def download_youtube_audio(
    url: str,
    output_dir: str,
    format: str = "wav"
) -> DownloadResult:
    """
    Download audio from a YouTube video.
    
    Args:
        url: YouTube video URL
        output_dir: Directory to save the audio file
        format: Output audio format (wav, mp3, m4a)
        
    Returns:
        DownloadResult with file path and metadata
    """
    try:
        import yt_dlp
    except ImportError:
        return DownloadResult(
            success=False,
            file_path=None,
            title="",
            duration=0,
            error="yt-dlp not installed. Run: pip install yt-dlp"
        )
    
    # Validate URL
    video_id = extract_video_id(url)
    if not video_id:
        return DownloadResult(
            success=False,
            file_path=None,
            title="",
            duration=0,
            error="Invalid YouTube URL"
        )
    
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # yt-dlp options for audio extraction
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(output_path / '%(title)s.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': format,
            'preferredquality': '192',
        }],
        'ffmpeg_location': '/usr/bin',
        'quiet': True,
        'no_warnings': True,
    }
    
    try:
        logger.info(f"Downloading audio from: {url}")
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video info first
            info = ydl.extract_info(url, download=False)
            title = info.get('title') or 'unknown'
            duration = float(info.get('duration') or 0)
            
            # Download
            ydl.download([url])
            
            # Find the downloaded file
            file_path: Optional[str] = None
            
            # yt-dlp uses original title, find the file
            for f in output_path.iterdir():
                if f.suffix == f'.{format}' and title[:30] in f.stem:
                    file_path = str(f)
                    break
            
            if file_path is None:
                # Fallback: find most recent file with the format
                files = list(output_path.glob(f'*.{format}'))
                if files:
                    file_path = str(max(files, key=os.path.getctime))
                else:
                    return DownloadResult(
                        success=False,
                        file_path=None,
                        title=title,
                        duration=duration,
                        error="Downloaded file not found"
                    )
            
            logger.info(f"Downloaded: {title} ({duration}s) -> {file_path}")
            
            return DownloadResult(
                success=True,
                file_path=file_path,
                title=title,
                duration=duration
            )
            
    except Exception as e:
        logger.error(f"Failed to download YouTube audio: {e}")
        return DownloadResult(
            success=False,
            file_path=None,
            title="",
            duration=0,
            error=str(e)
        )


def download_and_segment_youtube(
    url: str,
    output_dir: str,
    chunk_length: int = 30
) -> dict:
    """
    Download YouTube audio and segment it into chunks.
    
    Args:
        url: YouTube video URL
        output_dir: Directory to save files
        chunk_length: Maximum length of each chunk in seconds
        
    Returns:
        dict with download and segment results
    """
    from backend.audio_segment import segment_audio_file
    
    # Download audio
    download_result = download_youtube_audio(url, output_dir, format="wav")
    
    if not download_result.success or download_result.file_path is None:
        return {
            "success": False,
            "error": download_result.error,
            "download": None,
            "segments": None
        }
    
    # Segment the audio
    try:
        segment_result = segment_audio_file(
            download_result.file_path,
            chunk_length=chunk_length,
            output_base=output_dir
        )
        
        return {
            "success": True,
            "download": {
                "file_path": download_result.file_path,
                "title": download_result.title,
                "duration": download_result.duration
            },
            "segments": {
                "output_folder": segment_result.output_folder,
                "chunks": segment_result.chunks,
                "total_chunks": segment_result.total_chunks
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to segment downloaded audio: {e}")
        return {
            "success": False,
            "error": f"Segmentation failed: {str(e)}",
            "download": {
                "file_path": download_result.file_path,
                "title": download_result.title,
                "duration": download_result.duration
            },
            "segments": None
        }
