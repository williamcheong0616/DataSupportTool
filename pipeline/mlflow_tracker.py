"""MLflow integration for experiment tracking and model versioning."""
import mlflow
from mlflow.tracking import MlflowClient
from typing import Dict, Any, Optional, List
from datetime import datetime

from config import MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT_NAME


class MLflowTracker:
    """
    MLflow integration for tracking pipeline runs, metrics, and model performance.
    """
    
    def __init__(
        self,
        tracking_uri: Optional[str] = None,
        experiment_name: Optional[str] = None
    ):
        """
        Initialize MLflow tracker.
        
        Args:
            tracking_uri: MLflow tracking server URI
            experiment_name: Name of the experiment
        """
        self.tracking_uri = tracking_uri or MLFLOW_TRACKING_URI
        self.experiment_name = experiment_name or MLFLOW_EXPERIMENT_NAME
        
        # Set tracking URI
        mlflow.set_tracking_uri(self.tracking_uri)
        
        # Get or create experiment
        self.client = MlflowClient()
        experiment = mlflow.get_experiment_by_name(self.experiment_name)
        
        if experiment is None:
            self.experiment_id = mlflow.create_experiment(self.experiment_name)
        else:
            self.experiment_id = experiment.experiment_id
        
        mlflow.set_experiment(self.experiment_name)
        
        self.active_run = None
    
    def start_run(
        self,
        run_name: str,
        tags: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Start a new MLflow run.
        
        Args:
            run_name: Name for the run
            tags: Optional tags for the run
            params: Optional parameters to log
        
        Returns:
            Run ID
        """
        self.active_run = mlflow.start_run(
            run_name=run_name,
            tags=tags
        )
        
        if params:
            self.log_params(params)
        
        return self.active_run.info.run_id
    
    def end_run(self, status: str = "FINISHED"):
        """
        End the current MLflow run.
        
        Args:
            status: Run status (FINISHED, FAILED, KILLED)
        """
        if self.active_run:
            mlflow.end_run(status=status)
            self.active_run = None
    
    def log_params(self, params: Dict[str, Any]):
        """Log parameters to the current run."""
        for key, value in params.items():
            # MLflow params must be strings
            mlflow.log_param(key, str(value))
    
    def log_metrics(self, metrics: Dict[str, float], step: Optional[int] = None):
        """
        Log metrics to the current run.
        
        Args:
            metrics: Dict of metric names to values
            step: Optional step number for tracking over time
        """
        for key, value in metrics.items():
            if value is not None:
                mlflow.log_metric(key, value, step=step)
    
    def log_validation_metrics(
        self,
        pipeline_run_id: int,
        iteration: int,
        accuracy: Optional[float],
        bleu: Optional[float],
        rouge: Optional[float],
        pass_rate: float,
        total_validations: int,
        passed: int,
        failed: int,
        needs_review: int
    ):
        """
        Log validation metrics for a pipeline run.
        
        Args:
            pipeline_run_id: Pipeline run ID
            iteration: Current iteration number
            accuracy: Average accuracy score
            bleu: Average BLEU score
            rouge: Average ROUGE score
            pass_rate: Overall pass rate
            total_validations: Total number of validations
            passed: Number passed
            failed: Number failed
            needs_review: Number needing review
        """
        metrics = {
            "accuracy": accuracy,
            "bleu_score": bleu,
            "rouge_score": rouge,
            "pass_rate": pass_rate,
            "total_validations": total_validations,
            "passed_count": passed,
            "failed_count": failed,
            "needs_review_count": needs_review,
        }
        
        self.log_metrics(
            {k: v for k, v in metrics.items() if v is not None},
            step=iteration
        )
    
    def log_artifact(self, local_path: str, artifact_path: Optional[str] = None):
        """
        Log a file or directory as an artifact.
        
        Args:
            local_path: Path to the local file/directory
            artifact_path: Optional path within the artifact store
        """
        mlflow.log_artifact(local_path, artifact_path)
    
    def log_dict(self, data: Dict[str, Any], filename: str):
        """
        Log a dictionary as a JSON artifact.
        
        Args:
            data: Dictionary to log
            filename: Name for the artifact file
        """
        mlflow.log_dict(data, filename)
    
    def log_model_info(
        self,
        model_name: str,
        model_version: Optional[str] = None,
        endpoint: Optional[str] = None
    ):
        """
        Log model information as tags.
        
        Args:
            model_name: Name of the model
            model_version: Optional version string
            endpoint: Optional model endpoint URL
        """
        mlflow.set_tag("model_name", model_name)
        if model_version:
            mlflow.set_tag("model_version", model_version)
        if endpoint:
            mlflow.set_tag("model_endpoint", endpoint)
    
    def get_run_metrics(self, run_id: str) -> Dict[str, Any]:
        """
        Get all metrics for a specific run.
        
        Args:
            run_id: MLflow run ID
        
        Returns:
            Dict of metric names to values
        """
        run = self.client.get_run(run_id)
        return run.data.metrics
    
    def compare_runs(
        self,
        run_ids: List[str],
        metric_keys: Optional[List[str]] = None
    ) -> Dict[str, Dict[str, float]]:
        """
        Compare metrics across multiple runs.
        
        Args:
            run_ids: List of run IDs to compare
            metric_keys: Optional list of specific metrics to compare
        
        Returns:
            Dict mapping run_id to metrics dict
        """
        comparison = {}
        
        for run_id in run_ids:
            metrics = self.get_run_metrics(run_id)
            
            if metric_keys:
                metrics = {k: v for k, v in metrics.items() if k in metric_keys}
            
            comparison[run_id] = metrics
        
        return comparison
    
    def get_best_run(
        self,
        metric: str = "pass_rate",
        maximize: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Get the best run based on a metric.
        
        Args:
            metric: Metric to optimize
            maximize: Whether to maximize (True) or minimize (False)
        
        Returns:
            Dict with run info and metrics
        """
        order = "DESC" if maximize else "ASC"
        
        runs = self.client.search_runs(
            experiment_ids=[self.experiment_id],
            order_by=[f"metrics.{metric} {order}"],
            max_results=1
        )
        
        if runs:
            run = runs[0]
            return {
                "run_id": run.info.run_id,
                "run_name": run.info.run_name,
                "metrics": run.data.metrics,
                "params": run.data.params,
                "tags": run.data.tags
            }
        
        return None


# Global tracker instance
_tracker: Optional[MLflowTracker] = None


def get_mlflow_tracker() -> MLflowTracker:
    """Get or create the global MLflow tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = MLflowTracker()
    return _tracker


def track_pipeline_run(
    pipeline_run_id: int,
    dataset_name: str,
    config: Dict[str, Any],
    results: Dict[str, Any]
):
    """
    Convenience function to track a complete pipeline run.
    
    Args:
        pipeline_run_id: Pipeline run ID
        dataset_name: Name of the dataset
        config: Pipeline configuration
        results: Validation results
    """
    tracker = get_mlflow_tracker()
    
    run_name = f"pipeline_run_{pipeline_run_id}"
    
    try:
        tracker.start_run(
            run_name=run_name,
            tags={
                "pipeline_run_id": str(pipeline_run_id),
                "dataset": dataset_name,
            },
            params=config
        )
        
        tracker.log_validation_metrics(
            pipeline_run_id=pipeline_run_id,
            iteration=results.get("iteration", 1),
            accuracy=results.get("avg_accuracy"),
            bleu=results.get("avg_bleu"),
            rouge=results.get("avg_rouge"),
            pass_rate=results.get("pass_rate", 0),
            total_validations=results.get("total", 0),
            passed=results.get("passed_count", 0),
            failed=results.get("failed_count", 0),
            needs_review=results.get("needs_review_count", 0)
        )
        
        tracker.end_run("FINISHED")
    
    except Exception as e:
        tracker.end_run("FAILED")
        raise
