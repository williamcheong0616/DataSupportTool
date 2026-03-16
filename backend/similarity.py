"""
Text similarity utilities for BR Pipeline quality analysis.
"""


def jaccard_similarity(text_a: str, text_b: str) -> float:
    """
    Compute word-level Jaccard similarity between two strings.

    Returns a float in [0.0, 1.0] where 1.0 means identical word sets.
    """
    words_a = set(text_a.lower().split())
    words_b = set(text_b.lower().split())
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union) if union else 0.0
