"""Validation module for model responses."""
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import Counter
import math


@dataclass
class ValidationMetrics:
    """Container for validation metrics."""
    accuracy_score: Optional[float] = None
    bleu_score: Optional[float] = None
    rouge_score: Optional[float] = None
    exact_match: Optional[bool] = None
    length_ratio: Optional[float] = None
    custom_metrics: Dict[str, float] = field(default_factory=dict)
    
    def overall_score(self, weights: Optional[Dict[str, float]] = None) -> float:
        """Calculate weighted overall score."""
        weights = weights or {
            "accuracy_score": 0.4,
            "bleu_score": 0.3,
            "rouge_score": 0.3
        }
        
        total_weight = 0
        total_score = 0
        
        for metric, weight in weights.items():
            value = getattr(self, metric, None)
            if value is not None:
                total_score += value * weight
                total_weight += weight
        
        return total_score / total_weight if total_weight > 0 else 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "accuracy_score": self.accuracy_score,
            "bleu_score": self.bleu_score,
            "rouge_score": self.rouge_score,
            "exact_match": self.exact_match,
            "length_ratio": self.length_ratio,
            "custom_metrics": self.custom_metrics,
        }


@dataclass
class ValidationResult:
    """Result of validating a model response."""
    passed: bool
    metrics: ValidationMetrics
    needs_human_review: bool
    failure_reasons: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)


class ResponseValidator:
    """Validates model responses against expected outputs and quality standards."""
    
    def __init__(
        self,
        threshold: float = 0.8,
        metrics: Optional[List[str]] = None,
        human_review_threshold: float = 0.6
    ):
        """
        Initialize validator.
        
        Args:
            threshold: Minimum score to pass validation
            metrics: List of metrics to compute. Options: accuracy, bleu, rouge, exact_match
            human_review_threshold: If score is between this and threshold, flag for human review
        """
        self.threshold = threshold
        self.metrics = metrics or ["accuracy", "bleu", "rouge"]
        self.human_review_threshold = human_review_threshold
    
    def validate(
        self,
        response: str,
        expected: Optional[str] = None,
        input_text: Optional[str] = None,
        custom_validators: Optional[List[callable]] = None
    ) -> ValidationResult:
        """
        Validate a model response.
        
        Args:
            response: Model's response text
            expected: Expected/reference output (if available)
            input_text: Original input (for context-based validation)
            custom_validators: List of custom validation functions
        
        Returns:
            ValidationResult with metrics and pass/fail status
        """
        metrics = ValidationMetrics()
        failure_reasons = []
        suggestions = []
        
        # Basic quality checks
        if not response or len(response.strip()) == 0:
            failure_reasons.append("Empty response")
            return ValidationResult(
                passed=False,
                metrics=metrics,
                needs_human_review=False,
                failure_reasons=failure_reasons
            )
        
        # Compute metrics if expected output is available
        if expected:
            if "accuracy" in self.metrics:
                metrics.accuracy_score = self._compute_accuracy(response, expected)
            
            if "bleu" in self.metrics:
                metrics.bleu_score = self._compute_bleu(response, expected)
            
            if "rouge" in self.metrics:
                metrics.rouge_score = self._compute_rouge(response, expected)
            
            metrics.exact_match = response.strip().lower() == expected.strip().lower()
            metrics.length_ratio = len(response) / len(expected) if expected else None
        
        # Run custom validators
        if custom_validators:
            for validator in custom_validators:
                try:
                    result = validator(response, expected, input_text)
                    if isinstance(result, tuple):
                        metric_name, metric_value = result
                        metrics.custom_metrics[metric_name] = metric_value
                except Exception as e:
                    failure_reasons.append(f"Custom validator error: {str(e)}")
        
        # Determine pass/fail
        overall_score = metrics.overall_score()
        
        if overall_score >= self.threshold:
            passed = True
            needs_human_review = False
        elif overall_score >= self.human_review_threshold:
            passed = False
            needs_human_review = True
            suggestions.append("Score is borderline - human review recommended")
        else:
            passed = False
            needs_human_review = False
            if metrics.accuracy_score and metrics.accuracy_score < 0.5:
                failure_reasons.append("Low accuracy score")
                suggestions.append("Consider reviewing training data quality")
            if metrics.length_ratio and (metrics.length_ratio < 0.5 or metrics.length_ratio > 2.0):
                failure_reasons.append("Response length significantly differs from expected")
        
        return ValidationResult(
            passed=passed,
            metrics=metrics,
            needs_human_review=needs_human_review,
            failure_reasons=failure_reasons,
            suggestions=suggestions
        )
    
    def validate_batch(
        self,
        responses: List[str],
        expected_outputs: List[Optional[str]],
        input_texts: Optional[List[str]] = None
    ) -> Tuple[List[ValidationResult], Dict[str, float]]:
        """
        Validate a batch of responses.
        
        Returns:
            Tuple of (list of results, aggregate stats)
        """
        results = []
        input_texts = input_texts or [None] * len(responses)
        
        for response, expected, input_text in zip(responses, expected_outputs, input_texts):
            result = self.validate(response, expected, input_text)
            results.append(result)
        
        # Compute aggregate stats
        passed_count = sum(1 for r in results if r.passed)
        review_count = sum(1 for r in results if r.needs_human_review)
        
        aggregate = {
            "total": len(results),
            "passed": passed_count,
            "failed": len(results) - passed_count,
            "needs_review": review_count,
            "pass_rate": passed_count / len(results) if results else 0,
            "avg_accuracy": self._safe_avg([r.metrics.accuracy_score for r in results]),
            "avg_bleu": self._safe_avg([r.metrics.bleu_score for r in results]),
            "avg_rouge": self._safe_avg([r.metrics.rouge_score for r in results]),
        }
        
        return results, aggregate
    
    def _compute_accuracy(self, response: str, expected: str) -> float:
        """Compute token-level accuracy (F1-like score)."""
        response_tokens = set(self._tokenize(response))
        expected_tokens = set(self._tokenize(expected))
        
        if not expected_tokens:
            return 1.0 if not response_tokens else 0.0
        
        intersection = response_tokens & expected_tokens
        precision = len(intersection) / len(response_tokens) if response_tokens else 0
        recall = len(intersection) / len(expected_tokens) if expected_tokens else 0
        
        if precision + recall == 0:
            return 0.0
        
        f1 = 2 * (precision * recall) / (precision + recall)
        return f1
    
    def _compute_bleu(self, response: str, expected: str, max_n: int = 4) -> float:
        """Compute BLEU score (simplified implementation)."""
        response_tokens = self._tokenize(response)
        expected_tokens = self._tokenize(expected)
        
        if len(response_tokens) == 0:
            return 0.0
        
        # Compute n-gram precisions
        precisions = []
        for n in range(1, min(max_n + 1, len(response_tokens) + 1)):
            response_ngrams = self._get_ngrams(response_tokens, n)
            expected_ngrams = self._get_ngrams(expected_tokens, n)
            
            if not response_ngrams:
                precisions.append(0)
                continue
            
            response_counts = Counter(response_ngrams)
            expected_counts = Counter(expected_ngrams)
            
            clipped_count = sum(
                min(count, expected_counts.get(ngram, 0))
                for ngram, count in response_counts.items()
            )
            
            precision = clipped_count / len(response_ngrams)
            precisions.append(precision)
        
        if not precisions or all(p == 0 for p in precisions):
            return 0.0
        
        # Geometric mean of precisions
        log_precisions = [math.log(p) if p > 0 else -float('inf') for p in precisions]
        avg_log_precision = sum(log_precisions) / len(log_precisions)
        
        # Brevity penalty
        bp = 1.0 if len(response_tokens) >= len(expected_tokens) else \
             math.exp(1 - len(expected_tokens) / len(response_tokens))
        
        bleu = bp * math.exp(avg_log_precision) if avg_log_precision > -float('inf') else 0.0
        return min(bleu, 1.0)
    
    def _compute_rouge(self, response: str, expected: str) -> float:
        """Compute ROUGE-L score (longest common subsequence)."""
        response_tokens = self._tokenize(response)
        expected_tokens = self._tokenize(expected)
        
        if not expected_tokens or not response_tokens:
            return 1.0 if not expected_tokens and not response_tokens else 0.0
        
        # Compute LCS length
        lcs_length = self._lcs_length(response_tokens, expected_tokens)
        
        precision = lcs_length / len(response_tokens)
        recall = lcs_length / len(expected_tokens)
        
        if precision + recall == 0:
            return 0.0
        
        f1 = 2 * precision * recall / (precision + recall)
        return f1
    
    def _tokenize(self, text: str) -> List[str]:
        """Simple word tokenization."""
        return re.findall(r'\b\w+\b', text.lower())
    
    def _get_ngrams(self, tokens: List[str], n: int) -> List[tuple]:
        """Get n-grams from token list."""
        return [tuple(tokens[i:i+n]) for i in range(len(tokens) - n + 1)]
    
    def _lcs_length(self, seq1: List[str], seq2: List[str]) -> int:
        """Compute longest common subsequence length."""
        m, n = len(seq1), len(seq2)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if seq1[i-1] == seq2[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                else:
                    dp[i][j] = max(dp[i-1][j], dp[i][j-1])
        
        return dp[m][n]
    
    def _safe_avg(self, values: List[Optional[float]]) -> Optional[float]:
        """Compute average of non-None values."""
        valid_values = [v for v in values if v is not None]
        return sum(valid_values) / len(valid_values) if valid_values else None


def create_validator(config: Dict[str, Any]) -> ResponseValidator:
    """Factory function to create validator from config."""
    return ResponseValidator(
        threshold=config.get("validation_threshold", 0.8),
        metrics=config.get("metrics", ["accuracy", "bleu", "rouge"]),
        human_review_threshold=config.get("human_review_threshold", 0.6)
    )
