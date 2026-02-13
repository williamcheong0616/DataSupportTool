"""Helper utility functions for data processing and validation."""

import math
from typing import Any, Dict, List, Union


def clean_nan_values(data: Any) -> Any:
    """
    Clean NaN/Inf values from data for JSON serialization.
    
    Recursively processes dictionaries, lists, and numeric values to replace
    NaN and Inf values with None for safe JSON serialization.
    
    Args:
        data: Input data of any type (dict, list, float, etc.)
        
    Returns:
        Cleaned data with NaN/Inf replaced by None
        
    Examples:
        >>> clean_nan_values({"value": float('nan')})
        {"value": None}
        
        >>> clean_nan_values([1.0, float('inf'), 2.0])
        [1.0, None, 2.0]
    """
    if data is None:
        return None
    
    if isinstance(data, dict):
        return {k: clean_nan_values(v) for k, v in data.items()}
    
    if isinstance(data, list):
        return [clean_nan_values(v) for v in data]
    
    if isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return None
        return data
    
    return data
