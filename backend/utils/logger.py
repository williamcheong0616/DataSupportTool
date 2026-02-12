"""
Logging configuration and utilities.

Provides structured logging with different levels for development and production.
Includes request ID tracking for distributed tracing.
"""

import logging
import sys
import json
from datetime import datetime
from typing import Any, Dict, Optional
from pythonjsonlogger import jsonlogger
import uuid


# ==================== LOGGING CONFIGURATION ====================

def setup_logging(log_level: str = "INFO", log_file: Optional[str] = None) -> logging.Logger:
    """
    Configure application-wide logging.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional file path to write logs to
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger("datasupporttool")
    logger.setLevel(getattr(logging, log_level.upper()))
    
    # Remove existing handlers
    logger.handlers.clear()
    
    # Console handler with colored output for development
    console_handler = logging.StreamHandler(sys.stdout)
    console_formatter = ColoredFormatter(
        '%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)
    
    # File handler with JSON format for production
    if log_file:
        file_handler = logging.FileHandler(log_file)
        json_formatter = CustomJsonFormatter()
        file_handler.setFormatter(json_formatter)
        logger.addHandler(file_handler)
    
    return logger


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colored output for console."""
    
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
        'RESET': '\033[0m'       # Reset
    }
    
    def format(self, record):
        log_color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        record.levelname = f"{log_color}{record.levelname}{self.COLORS['RESET']}"
        return super().format(record)


class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """JSON formatter for structured logging."""
    
    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        log_record['timestamp'] = datetime.utcnow().isoformat()
        log_record['level'] = record.levelname
        log_record['logger'] = record.name


# ==================== LOGGING UTILITIES ====================

class RequestLogger:
    """
    Context manager for logging API requests with automatic timing and error handling.
    
    Usage:
        with RequestLogger("process_audio", file_id=123) as log:
            result = process_audio(file_id)
            log.success("Processing completed", result_count=10)
    """
    
    def __init__(self, operation: str, **context):
        self.operation = operation
        self.context = context
        self.request_id = str(uuid.uuid4())[:8]
        self.logger = logging.getLogger("datasupporttool")
        self.start_time = None
        
    def __enter__(self):
        self.start_time = datetime.utcnow()
        self.logger.info(
            f"[{self.request_id}] Starting: {self.operation}",
            extra={'request_id': self.request_id, 'operation': self.operation, **self.context}
        )
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = (datetime.utcnow() - self.start_time).total_seconds()
        
        if exc_type:
            self.logger.error(
                f"[{self.request_id}] Failed: {self.operation} ({duration:.2f}s)",
                extra={
                    'request_id': self.request_id,
                    'operation': self.operation,
                    'duration': duration,
                    'error': str(exc_val),
                    **self.context
                },
                exc_info=True
            )
        else:
            self.logger.info(
                f"[{self.request_id}] Completed: {self.operation} ({duration:.2f}s)",
                extra={
                    'request_id': self.request_id,
                    'operation': self.operation,
                    'duration': duration,
                    **self.context
                }
            )
        return False  # Don't suppress exceptions
    
    def success(self, message: str, **extra_data):
        """Log success message with additional data."""
        self.logger.info(
            f"[{self.request_id}] {message}",
            extra={'request_id': self.request_id, **extra_data}
        )
    
    def warning(self, message: str, **extra_data):
        """Log warning message."""
        self.logger.warning(
            f"[{self.request_id}] {message}",
            extra={'request_id': self.request_id, **extra_data}
        )
    
    def error(self, message: str, **extra_data):
        """Log error message."""
        self.logger.error(
            f"[{self.request_id}] {message}",
            extra={'request_id': self.request_id, **extra_data}
        )


def log_function_call(func):
    """
    Decorator to automatically log function calls with timing.
    
    Usage:
        @log_function_call
        def process_data(data_id):
            # Function logic
            pass
    """
    import functools
    
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        logger = logging.getLogger("datasupporttool")
        func_name = f"{func.__module__}.{func.__name__}"
        
        # Log function call
        logger.debug(f"Calling: {func_name}", extra={
            'function': func_name,
            'args_count': len(args),
            'kwargs': list(kwargs.keys())
        })
        
        start_time = datetime.utcnow()
        try:
            result = func(*args, **kwargs)
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.debug(f"Completed: {func_name} ({duration:.2f}s)")
            return result
        except Exception as e:
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.error(
                f"Failed: {func_name} ({duration:.2f}s) - {str(e)}",
                exc_info=True
            )
            raise
    
    return wrapper


# ==================== INITIALIZE DEFAULT LOGGER ====================

# Create default logger instance
logger = setup_logging(log_level="INFO")
