"""Data preprocessing module."""
import re
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class PreprocessingResult:
    """Result of preprocessing a single record."""
    original_text: str
    processed_text: str
    transformations_applied: List[str]
    metadata: Dict[str, Any]


class DataPreprocessor:
    """Handles data preprocessing operations."""
    
    def __init__(self, steps: Optional[List[str]] = None):
        """
        Initialize preprocessor with specified steps.
        
        Args:
            steps: List of preprocessing steps to apply.
                   Options: clean, normalize, deduplicate, truncate, 
                           remove_pii, format_prompt
        """
        self.steps = steps or ["clean", "normalize"]
        
        # Available preprocessing functions
        self.step_functions = {
            "clean": self._clean_text,
            "normalize": self._normalize_text,
            "remove_pii": self._remove_pii,
            "truncate": self._truncate_text,
            "format_prompt": self._format_prompt,
            "remove_html": self._remove_html,
            "fix_encoding": self._fix_encoding,
        }
    
    def process(self, text: str, config: Optional[Dict[str, Any]] = None) -> PreprocessingResult:
        """
        Process a single text through the preprocessing pipeline.
        
        Args:
            text: Input text to preprocess
            config: Optional configuration for preprocessing steps
        
        Returns:
            PreprocessingResult with original and processed text
        """
        config = config or {}
        processed = text
        transformations = []
        
        for step in self.steps:
            if step in self.step_functions:
                step_config = config.get(step, {})
                processed = self.step_functions[step](processed, **step_config)
                transformations.append(step)
        
        return PreprocessingResult(
            original_text=text,
            processed_text=processed,
            transformations_applied=transformations,
            metadata={"config": config}
        )
    
    def process_batch(
        self, 
        texts: List[str], 
        config: Optional[Dict[str, Any]] = None
    ) -> List[PreprocessingResult]:
        """Process multiple texts."""
        return [self.process(text, config) for text in texts]
    
    def _clean_text(self, text: str, **kwargs) -> str:
        """Remove extra whitespace and clean up text."""
        # Remove multiple spaces
        text = re.sub(r'\s+', ' ', text)
        # Remove leading/trailing whitespace
        text = text.strip()
        # Remove null characters
        text = text.replace('\x00', '')
        return text
    
    def _normalize_text(self, text: str, lowercase: bool = False, **kwargs) -> str:
        """Normalize text (unicode normalization, optional lowercasing)."""
        import unicodedata
        # Unicode normalization
        text = unicodedata.normalize('NFKC', text)
        if lowercase:
            text = text.lower()
        return text
    
    def _remove_pii(self, text: str, **kwargs) -> str:
        """Remove common PII patterns (emails, phone numbers, etc.)."""
        # Email pattern
        text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', text)
        # Phone pattern (basic)
        text = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[PHONE]', text)
        # SSN pattern
        text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[SSN]', text)
        return text
    
    def _truncate_text(self, text: str, max_length: int = 2048, **kwargs) -> str:
        """Truncate text to maximum length."""
        if len(text) > max_length:
            return text[:max_length] + "..."
        return text
    
    def _format_prompt(
        self, 
        text: str, 
        template: str = "Input: {text}\nOutput:", 
        **kwargs
    ) -> str:
        """Format text as a prompt using a template."""
        return template.format(text=text)
    
    def _remove_html(self, text: str, **kwargs) -> str:
        """Remove HTML tags from text."""
        clean = re.compile('<.*?>')
        return re.sub(clean, '', text)
    
    def _fix_encoding(self, text: str, **kwargs) -> str:
        """Fix common encoding issues."""
        # Common replacements
        replacements = {
            'â€™': "'",
            'â€œ': '"',
            'â€': '"',
            'â€"': '-',
            'â€"': '-',
            'Ã©': 'é',
            'Ã¨': 'è',
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text


def create_preprocessor(config: Dict[str, Any]) -> DataPreprocessor:
    """Factory function to create preprocessor from config."""
    steps = config.get("preprocessing_steps", ["clean", "normalize"])
    return DataPreprocessor(steps=steps)
