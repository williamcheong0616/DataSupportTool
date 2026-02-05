"""Client for interacting with fine-tuned models."""
import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import httpx

from config import MODEL_ENDPOINT


@dataclass
class ModelResponse:
    """Response from a model inference call."""
    text: str
    model_name: str
    latency_ms: float
    tokens_used: Optional[int] = None
    raw_response: Optional[Dict[str, Any]] = None


class ModelClient:
    """Client for calling fine-tuned model endpoints."""
    
    def __init__(
        self,
        endpoint: Optional[str] = None,
        model_name: str = "default-model",
        timeout: float = 30.0,
        max_retries: int = 3
    ):
        """
        Initialize model client.
        
        Args:
            endpoint: Model API endpoint URL
            model_name: Name/identifier of the model
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts for failed requests
        """
        self.endpoint = endpoint or MODEL_ENDPOINT
        self.model_name = model_name
        self.timeout = timeout
        self.max_retries = max_retries
        self.client = httpx.Client(timeout=timeout)
    
    def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.7,
        **kwargs
    ) -> ModelResponse:
        """
        Generate a response from the model.
        
        Args:
            prompt: Input prompt text
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            **kwargs: Additional model parameters
        
        Returns:
            ModelResponse with generated text and metadata
        """
        payload = {
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "model": self.model_name,
            **kwargs
        }
        
        start_time = time.time()
        
        for attempt in range(self.max_retries):
            try:
                response = self.client.post(
                    self.endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                
                latency_ms = (time.time() - start_time) * 1000
                data = response.json()
                
                # Handle different API response formats
                text = self._extract_text(data)
                tokens = self._extract_tokens(data)
                
                return ModelResponse(
                    text=text,
                    model_name=self.model_name,
                    latency_ms=latency_ms,
                    tokens_used=tokens,
                    raw_response=data
                )
            
            except httpx.HTTPStatusError as e:
                if attempt == self.max_retries - 1:
                    raise RuntimeError(f"Model API error: {e.response.status_code} - {e.response.text}")
                time.sleep(2 ** attempt)  # Exponential backoff
            
            except httpx.RequestError as e:
                if attempt == self.max_retries - 1:
                    raise RuntimeError(f"Model API request failed: {str(e)}")
                time.sleep(2 ** attempt)
        
        raise RuntimeError("Max retries exceeded")
    
    def generate_batch(
        self,
        prompts: List[str],
        **kwargs
    ) -> List[ModelResponse]:
        """Generate responses for multiple prompts."""
        responses = []
        for prompt in prompts:
            response = self.generate(prompt, **kwargs)
            responses.append(response)
        return responses
    
    def _extract_text(self, data: Dict[str, Any]) -> str:
        """Extract generated text from various API response formats."""
        # OpenAI-style format
        if "choices" in data and len(data["choices"]) > 0:
            choice = data["choices"][0]
            if "message" in choice:
                return choice["message"].get("content", "")
            if "text" in choice:
                return choice["text"]
        
        # Simple text field
        if "text" in data:
            return data["text"]
        
        # Generated text field
        if "generated_text" in data:
            return data["generated_text"]
        
        # Response field
        if "response" in data:
            return data["response"]
        
        return str(data)
    
    def _extract_tokens(self, data: Dict[str, Any]) -> Optional[int]:
        """Extract token count from response."""
        if "usage" in data:
            return data["usage"].get("total_tokens")
        if "tokens" in data:
            return data["tokens"]
        return None
    
    def health_check(self) -> bool:
        """Check if the model endpoint is available."""
        try:
            # Try a simple request
            response = self.client.get(
                self.endpoint.replace("/completions", "/health"),
                timeout=5.0
            )
            return response.status_code == 200
        except Exception:
            return False
    
    def close(self):
        """Close the HTTP client."""
        self.client.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class MockModelClient(ModelClient):
    """Mock client for testing without a real model endpoint."""
    
    def __init__(self, *args, **kwargs):
        # Don't call parent init to avoid HTTP client setup
        self.model_name = kwargs.get("model_name", "mock-model")
        self.mock_responses = kwargs.get("mock_responses", {})
    
    def generate(
        self,
        prompt: str,
        **kwargs
    ) -> ModelResponse:
        """Return mock response."""
        # Simulate some latency
        time.sleep(0.1)
        
        # Check for predefined mock response
        if prompt in self.mock_responses:
            text = self.mock_responses[prompt]
        else:
            # Generate a simple mock response
            text = f"Mock response for: {prompt[:50]}..."
        
        return ModelResponse(
            text=text,
            model_name=self.model_name,
            latency_ms=100.0,
            tokens_used=len(text.split())
        )
    
    def health_check(self) -> bool:
        return True
    
    def close(self):
        pass


def create_model_client(config: Dict[str, Any], use_mock: bool = False) -> ModelClient:
    """Factory function to create model client from config."""
    if use_mock:
        return MockModelClient(model_name=config.get("model_name", "mock-model"))
    
    return ModelClient(
        endpoint=config.get("model_endpoint"),
        model_name=config.get("model_name", "default-model"),
        timeout=config.get("timeout", 30.0),
        max_retries=config.get("max_retries", 3)
    )
