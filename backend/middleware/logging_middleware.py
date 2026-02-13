"""
Logging middleware for FastAPI.

Automatically logs all HTTP requests and responses with timing, status codes,
and request metadata.
"""

import time
import logging
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
import uuid

logger = logging.getLogger("datasupporttool")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log all HTTP requests and responses.
    
    Logs:
    - Request method, path, query params
    - Response status code
    - Request processing time
    - Client IP address
    - User agent
    """
    
    def __init__(self, app: ASGIApp):
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate unique request ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        
        # Extract request metadata
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        
        # Log incoming request
        logger.info(
            f"[{request_id}] → {request.method} {request.url.path}",
            extra={
                'request_id': request_id,
                'method': request.method,
                'path': request.url.path,
                'query_params': str(request.query_params),
                'client_ip': client_ip,
                'user_agent': user_agent
            }
        )
        
        # Process request and measure time
        start_time = time.time()
        try:
            response = await call_next(request)
            duration = (time.time() - start_time) * 1000  # Convert to milliseconds
            
            # Log response
            log_level = logging.INFO if response.status_code < 400 else logging.ERROR
            logger.log(
                log_level,
                f"[{request_id}] ← {response.status_code} {request.method} {request.url.path} ({duration:.0f}ms)",
                extra={
                    'request_id': request_id,
                    'method': request.method,
                    'path': request.url.path,
                    'status_code': response.status_code,
                    'duration_ms': duration,
                    'client_ip': client_ip
                }
            )
            
            # Add request ID to response headers for debugging
            response.headers["X-Request-ID"] = request_id
            return response
            
        except Exception as e:
            duration = (time.time() - start_time) * 1000
            logger.error(
                f"[{request_id}] ✗ {request.method} {request.url.path} - {str(e)} ({duration:.0f}ms)",
                extra={
                    'request_id': request_id,
                    'method': request.method,
                    'path': request.url.path,
                    'error': str(e),
                    'duration_ms': duration
                },
                exc_info=True
            )
            raise
