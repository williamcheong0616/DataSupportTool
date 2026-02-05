"""Argilla integration for human annotation and LLM evaluation."""
import argilla as rg
from typing import Dict, Any, Optional, List
from datetime import datetime

from config import ARGILLA_API_URL, ARGILLA_API_KEY, ARGILLA_WORKSPACE


class ArgillaAnnotationClient:
    """
    Argilla integration for human annotation of model responses.
    Provides professional annotation UI and workflow management.
    """
    
    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        workspace: Optional[str] = None
    ):
        """
        Initialize Argilla client.
        
        Args:
            api_url: Argilla server URL
            api_key: API key for authentication
            workspace: Workspace name
        """
        self.api_url = api_url or ARGILLA_API_URL
        self.api_key = api_key or ARGILLA_API_KEY
        self.workspace = workspace or ARGILLA_WORKSPACE
        
        self._initialized = False
    
    def _ensure_initialized(self):
        """Initialize Argilla connection if not already done."""
        if not self._initialized:
            try:
                rg.init(
                    api_url=self.api_url,
                    api_key=self.api_key,
                    workspace=self.workspace
                )
                self._initialized = True
            except Exception as e:
                raise RuntimeError(f"Failed to initialize Argilla: {str(e)}")
    
    def create_validation_dataset(
        self,
        name: str,
        pipeline_run_id: int,
        guidelines: Optional[str] = None
    ) -> str:
        """
        Create an Argilla dataset for validation annotations.
        
        Args:
            name: Dataset name
            pipeline_run_id: Associated pipeline run ID
            guidelines: Annotation guidelines for reviewers
        
        Returns:
            Dataset name/ID
        """
        self._ensure_initialized()
        
        dataset_name = f"{name}_run_{pipeline_run_id}"
        
        # Define the annotation schema
        settings = rg.Settings(
            fields=[
                rg.TextField(
                    name="input_text",
                    title="Input",
                    use_markdown=True
                ),
                rg.TextField(
                    name="expected_output",
                    title="Expected Output",
                    use_markdown=True,
                    required=False
                ),
                rg.TextField(
                    name="model_response",
                    title="Model Response",
                    use_markdown=True
                ),
            ],
            questions=[
                rg.RatingQuestion(
                    name="quality_score",
                    title="Quality Score",
                    description="Rate the overall quality of the response (1-5)",
                    values=[1, 2, 3, 4, 5]
                ),
                rg.LabelQuestion(
                    name="validation_result",
                    title="Validation Result",
                    labels=["Pass", "Fail", "Needs Improvement"],
                    required=True
                ),
                rg.TextQuestion(
                    name="feedback",
                    title="Feedback",
                    description="Provide detailed feedback on the response",
                    required=False,
                    use_markdown=True
                ),
                rg.MultiLabelQuestion(
                    name="issues",
                    title="Issues Found",
                    labels=[
                        "Factually Incorrect",
                        "Incomplete",
                        "Off-topic",
                        "Poor Formatting",
                        "Tone/Style Issues",
                        "No Issues"
                    ],
                    required=False
                ),
            ],
            guidelines=guidelines or self._default_guidelines()
        )
        
        # Create the dataset
        dataset = rg.Dataset(
            name=dataset_name,
            settings=settings,
            workspace=self.workspace
        )
        
        try:
            dataset.create()
        except Exception as e:
            # Dataset might already exist
            if "already exists" not in str(e).lower():
                raise
        
        return dataset_name
    
    def add_records_for_review(
        self,
        dataset_name: str,
        records: List[Dict[str, Any]]
    ) -> int:
        """
        Add records to Argilla for human review.
        
        Args:
            dataset_name: Name of the Argilla dataset
            records: List of records with input_text, expected_output, model_response
        
        Returns:
            Number of records added
        """
        self._ensure_initialized()
        
        dataset = rg.Dataset.from_name(dataset_name, workspace=self.workspace)
        
        argilla_records = []
        for record in records:
            argilla_record = rg.Record(
                fields={
                    "input_text": record.get("input_text", ""),
                    "expected_output": record.get("expected_output", "N/A"),
                    "model_response": record.get("model_response", ""),
                },
                metadata={
                    "record_id": record.get("record_id"),
                    "model_response_id": record.get("model_response_id"),
                    "pipeline_run_id": record.get("pipeline_run_id"),
                    "automated_accuracy": record.get("accuracy_score"),
                    "automated_bleu": record.get("bleu_score"),
                    "automated_result": record.get("automated_result"),
                }
            )
            argilla_records.append(argilla_record)
        
        dataset.records.log(argilla_records)
        
        return len(argilla_records)
    
    def get_annotations(
        self,
        dataset_name: str,
        status: Optional[str] = "submitted"
    ) -> List[Dict[str, Any]]:
        """
        Get human annotations from Argilla.
        
        Args:
            dataset_name: Name of the Argilla dataset
            status: Filter by annotation status (submitted, pending, discarded)
        
        Returns:
            List of annotation records
        """
        self._ensure_initialized()
        
        dataset = rg.Dataset.from_name(dataset_name, workspace=self.workspace)
        
        annotations = []
        for record in dataset.records:
            if record.responses:
                for response in record.responses:
                    if status and response.status != status:
                        continue
                    
                    annotation = {
                        "record_id": record.metadata.get("record_id"),
                        "model_response_id": record.metadata.get("model_response_id"),
                        "pipeline_run_id": record.metadata.get("pipeline_run_id"),
                        "quality_score": response.values.get("quality_score", {}).get("value"),
                        "validation_result": response.values.get("validation_result", {}).get("value"),
                        "feedback": response.values.get("feedback", {}).get("value"),
                        "issues": response.values.get("issues", {}).get("value", []),
                        "annotator": response.user_id,
                        "submitted_at": response.inserted_at.isoformat() if response.inserted_at else None
                    }
                    annotations.append(annotation)
        
        return annotations
    
    def sync_annotations_to_db(
        self,
        dataset_name: str,
        db_session
    ) -> int:
        """
        Sync Argilla annotations back to the database.
        
        Args:
            dataset_name: Name of the Argilla dataset
            db_session: SQLAlchemy database session
        
        Returns:
            Number of records updated
        """
        from backend.models import ValidationRecord, ValidationResult
        
        annotations = self.get_annotations(dataset_name, status="submitted")
        updated = 0
        
        for annotation in annotations:
            model_response_id = annotation.get("model_response_id")
            if not model_response_id:
                continue
            
            validation = db_session.query(ValidationRecord).filter(
                ValidationRecord.model_response_id == model_response_id
            ).first()
            
            if validation:
                # Convert quality score (1-5) to 0-1 scale
                quality = annotation.get("quality_score")
                if quality:
                    validation.human_score = (quality - 1) / 4.0
                
                validation.human_feedback = annotation.get("feedback")
                validation.reviewer_id = annotation.get("annotator")
                validation.reviewed_at = datetime.utcnow()
                validation.human_reviewed = True
                
                # Update result based on human validation
                result_map = {
                    "Pass": ValidationResult.PASSED,
                    "Fail": ValidationResult.FAILED,
                    "Needs Improvement": ValidationResult.NEEDS_REVIEW
                }
                human_result = annotation.get("validation_result")
                if human_result in result_map:
                    validation.result = result_map[human_result]
                
                updated += 1
        
        db_session.commit()
        return updated
    
    def get_annotation_stats(self, dataset_name: str) -> Dict[str, Any]:
        """
        Get annotation statistics for a dataset.
        
        Args:
            dataset_name: Name of the Argilla dataset
        
        Returns:
            Dict with annotation statistics
        """
        self._ensure_initialized()
        
        dataset = rg.Dataset.from_name(dataset_name, workspace=self.workspace)
        
        total = 0
        annotated = 0
        pending = 0
        pass_count = 0
        fail_count = 0
        quality_scores = []
        
        for record in dataset.records:
            total += 1
            
            if record.responses:
                annotated += 1
                for response in record.responses:
                    if response.status == "submitted":
                        result = response.values.get("validation_result", {}).get("value")
                        if result == "Pass":
                            pass_count += 1
                        elif result == "Fail":
                            fail_count += 1
                        
                        quality = response.values.get("quality_score", {}).get("value")
                        if quality:
                            quality_scores.append(quality)
            else:
                pending += 1
        
        return {
            "total_records": total,
            "annotated": annotated,
            "pending": pending,
            "pass_count": pass_count,
            "fail_count": fail_count,
            "avg_quality_score": sum(quality_scores) / len(quality_scores) if quality_scores else None,
            "completion_rate": annotated / total if total > 0 else 0
        }
    
    def _default_guidelines(self) -> str:
        """Return default annotation guidelines."""
        return """
# Model Response Validation Guidelines

## Overview
You are reviewing responses from a fine-tuned language model. Your task is to evaluate the quality and accuracy of each response.

## Scoring Criteria

### Quality Score (1-5)
- **5 - Excellent**: Perfect response, no improvements needed
- **4 - Good**: Minor issues, but overall high quality
- **3 - Acceptable**: Meets basic requirements but has room for improvement
- **2 - Poor**: Significant issues, needs substantial improvement
- **1 - Unacceptable**: Completely incorrect or off-topic

### Validation Result
- **Pass**: Response meets quality standards
- **Fail**: Response is unacceptable
- **Needs Improvement**: Response is borderline, could be better

### Issues to Look For
- **Factually Incorrect**: Information is wrong
- **Incomplete**: Missing important information
- **Off-topic**: Doesn't address the input
- **Poor Formatting**: Hard to read or poorly structured
- **Tone/Style Issues**: Inappropriate tone or writing style

## Tips
1. Compare the model response to the expected output when available
2. Consider the context and intent of the original input
3. Be consistent in your scoring across similar responses
4. Provide specific feedback to help improve the model
"""


# Global client instance
_client: Optional[ArgillaAnnotationClient] = None


def get_argilla_client() -> ArgillaAnnotationClient:
    """Get or create the global Argilla client instance."""
    global _client
    if _client is None:
        _client = ArgillaAnnotationClient()
    return _client


def create_review_task(
    pipeline_run_id: int,
    dataset_name: str,
    records: List[Dict[str, Any]]
) -> str:
    """
    Convenience function to create a review task in Argilla.
    
    Args:
        pipeline_run_id: Pipeline run ID
        dataset_name: Base name for the dataset
        records: Records to review
    
    Returns:
        Argilla dataset name
    """
    client = get_argilla_client()
    
    argilla_dataset_name = client.create_validation_dataset(
        name=dataset_name,
        pipeline_run_id=pipeline_run_id
    )
    
    client.add_records_for_review(argilla_dataset_name, records)
    
    return argilla_dataset_name
