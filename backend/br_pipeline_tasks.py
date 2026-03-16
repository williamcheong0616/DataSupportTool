"""
Celery tasks for BR Pipeline heavy processing (Ollama calls).

Moves long-running Ollama API calls out of the FastAPI event loop
and into Celery workers to prevent blocking the API and race conditions.
"""
import logging
from datetime import datetime, timezone

from backend.celery_app import celery_app
from backend.database import SessionLocal
from backend.br_pipeline_models import BRRecordStage

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=15)
def generate_questions_task(self, record_stage_id: int) -> dict:
    """
    Celery task: Generate 3 Bahasa Rojak questions for a single record.
    
    Args:
        record_stage_id: The BRRecordStage ID
        
    Returns:
        dict with generated questions or error
    """
    db = SessionLocal()
    try:
        record_stage = db.query(BRRecordStage).filter(
            BRRecordStage.id == record_stage_id
        ).first()
        
        if not record_stage:
            return {"status": "error", "message": "Record stage not found", "id": record_stage_id}
        
        if not record_stage.restructured_text:
            return {"status": "error", "message": "Text must be restructured first", "id": record_stage_id}
        
        restructured_text = record_stage.restructured_text
        db.close()  # Release DB before long Ollama call
        
        from backend.ollama_service import get_ollama_service
        ollama = get_ollama_service()
        questions = ollama.generate_questions(restructured_text, count=3)
        
        # Save results with fresh session
        fresh_db = SessionLocal()
        try:
            record_stage = fresh_db.query(BRRecordStage).filter(
                BRRecordStage.id == record_stage_id
            ).first()
            if record_stage:
                record_stage.generated_questions = questions
                record_stage.questions_generated_at = datetime.utcnow()
                fresh_db.commit()
        except Exception as e:
            fresh_db.rollback()
            raise
        finally:
            fresh_db.close()
        
        return {
            "status": "success",
            "id": record_stage_id,
            "questions": questions,
        }
    except Exception as e:
        logger.error(f"generate_questions_task failed for record {record_stage_id}: {e}")
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"status": "error", "message": str(e), "id": record_stage_id}
    finally:
        try:
            db.close()
        except Exception:
            pass


@celery_app.task(bind=True, max_retries=2, default_retry_delay=15)
def generate_responses_task(self, record_stage_id: int, model_configs: list = None) -> dict:
    """
    Celery task: Generate model responses for a single record.
    
    Args:
        record_stage_id: The BRRecordStage ID
        model_configs: List of [name, model_id] pairs. Defaults to 3x gemma3:4b.
        
    Returns:
        dict with generated responses or error
    """
    if not model_configs:
        model_configs = [
            ["Model-A (Gemma3:4b)", "gemma3:4b"],
            ["Model-B (Gemma3:4b)", "gemma3:4b"],
            ["Model-C (Gemma3:4b)", "gemma3:4b"],
        ]
    
    db = SessionLocal()
    try:
        record_stage = db.query(BRRecordStage).filter(
            BRRecordStage.id == record_stage_id
        ).first()
        
        if not record_stage:
            return {"status": "error", "message": "Record stage not found", "id": record_stage_id}
        
        if not record_stage.selected_question:
            return {"status": "error", "message": "No question selected yet", "id": record_stage_id}
        
        context = record_stage.restructured_text or ""
        if not context:
            return {"status": "error", "message": "No context available", "id": record_stage_id}
        
        selected_question = record_stage.selected_question
        db.close()  # Release DB before long Ollama calls
        
        from backend.ollama_service import get_ollama_service
        
        responses = {}
        for model_name, model_id in model_configs:
            try:
                ollama = get_ollama_service(model_name=model_id)
                response_text, problems = ollama.generate_model_response(
                    context, selected_question, detect_problems=True
                )
                responses[model_name] = {
                    "model_id": model_id,
                    "response": response_text,
                    "problems": problems,
                }
            except Exception as e:
                logger.error(f"Failed to generate response for {model_name}: {e}")
                responses[model_name] = {
                    "model_id": model_id,
                    "response": f"Error: {str(e)}",
                    "problems": ["Generation failed"],
                }
        
        # Save results
        fresh_db = SessionLocal()
        try:
            record_stage = fresh_db.query(BRRecordStage).filter(
                BRRecordStage.id == record_stage_id
            ).first()
            if record_stage:
                record_stage.model_responses = responses
                record_stage.responses_generated_at = datetime.utcnow()
                record_stage.completed = True
                fresh_db.commit()
        except Exception as e:
            fresh_db.rollback()
            raise
        finally:
            fresh_db.close()
        
        return {
            "status": "success",
            "id": record_stage_id,
            "responses": responses,
        }
    except Exception as e:
        logger.error(f"generate_responses_task failed for record {record_stage_id}: {e}")
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"status": "error", "message": str(e), "id": record_stage_id}
    finally:
        try:
            db.close()
        except Exception:
            pass


@celery_app.task(bind=True, max_retries=1, default_retry_delay=30)
def batch_generate_responses_task(self, pipeline_run_id: int, model_configs: list = None) -> dict:
    """
    Celery task: Batch-generate responses for all pending records.
    Processes all records per model before switching to next model.
    
    Args:
        pipeline_run_id: The pipeline run ID
        model_configs: List of [name, model_id] pairs
        
    Returns:
        dict with batch result summary
    """
    if not model_configs:
        return {"status": "error", "message": "No model configs provided"}
    
    db = SessionLocal()
    try:
        # Get all pending records
        pending_records = db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.selected_question != None,
            BRRecordStage.model_responses == None,
        ).all()
        
        if not pending_records:
            return {
                "status": "success",
                "pipeline_id": pipeline_run_id,
                "processed": 0,
                "message": "No pending records",
            }
        
        # Capture record data before releasing DB
        record_data = []
        for rs in pending_records:
            record_data.append({
                "id": rs.id,
                "context": rs.restructured_text or "",
                "question": rs.selected_question,
            })
        db.close()
        
        from backend.ollama_service import get_ollama_service
        
        all_responses = {rd["id"]: {} for rd in record_data}
        total_rd = len(record_data)
        
        # Process model-by-model
        for model_name, model_id in model_configs:
            logger.info(
                f"Batch generate: processing model '{model_name}' ({model_id}) "
                f"for {total_rd} records"
            )
            ollama = get_ollama_service(model_name=model_id)
            
            for rd_idx, rd in enumerate(record_data, 1):
                if not rd["context"] or not rd["question"]:
                    continue
                try:
                    response_text, problems = ollama.generate_model_response(
                        rd["context"], rd["question"], detect_problems=True
                    )
                    all_responses[rd["id"]][model_name] = {
                        "model_id": model_id,
                        "response": response_text,
                        "problems": problems,
                    }
                except Exception as e:
                    logger.error(
                        f"Batch generate failed for record {rd['id']} "
                        f"model {model_name}: {e}"
                    )
                    all_responses[rd["id"]][model_name] = {
                        "model_id": model_id,
                        "response": f"Error: {str(e)}",
                        "problems": ["Generation failed"],
                    }
                
                if rd_idx % 25 == 0 or rd_idx == total_rd:
                    logger.info(
                        f"Batch generate '{model_name}': {rd_idx}/{total_rd} records"
                    )
            
            # Save partial results after each model
            fresh_db = SessionLocal()
            try:
                for rd in record_data:
                    record_stage = fresh_db.query(BRRecordStage).filter(
                        BRRecordStage.id == rd["id"]
                    ).first()
                    if record_stage:
                        record_stage.model_responses = all_responses[rd["id"]]
                        if len(all_responses[rd["id"]]) == len(model_configs):
                            record_stage.responses_generated_at = datetime.utcnow()
                            record_stage.completed = True
                fresh_db.commit()
            except Exception as e:
                fresh_db.rollback()
                logger.error(f"Failed to save batch responses for model {model_name}: {e}")
            finally:
                fresh_db.close()
            
            logger.info(f"Batch generate: completed model '{model_name}'")
        
        processed = sum(
            1 for rd in record_data
            if len(all_responses[rd["id"]]) == len(model_configs)
        )
        return {
            "status": "success",
            "pipeline_id": pipeline_run_id,
            "processed": processed,
            "total_pending": total_rd,
            "models_used": [mc[0] for mc in model_configs],
            "message": f"Generated responses for {processed} records using {len(model_configs)} models",
        }
    except Exception as e:
        logger.error(f"batch_generate_responses_task failed: {e}")
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"status": "error", "message": str(e), "pipeline_id": pipeline_run_id}
    finally:
        try:
            db.close()
        except Exception:
            pass

@celery_app.task(bind=True, max_retries=1, default_retry_delay=30)
def batch_generate_questions_task(self, pipeline_run_id: int) -> dict:
    """
    Celery task: Batch-generate questions for all pending records (where questions are not generated yet, text is restructured, and record is not discarded).
    """
    db = SessionLocal()
    try:
        pending_records = db.query(BRRecordStage).filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.restructured_text != None,
            BRRecordStage.generated_questions == None,
            BRRecordStage.is_bahasa_rojak == True,
            BRRecordStage.is_discarded == False
        ).all()
        
        if not pending_records:
            return {"status": "success", "message": "No pending records found"}
        
        record_ids = [r.id for r in pending_records]
        db.close()
        
        from backend.ollama_service import get_ollama_service
        ollama = get_ollama_service()
        
        results = []
        errors = []
        
        for stage_id in record_ids:
            fresh_db = SessionLocal()
            try:
                record = fresh_db.query(BRRecordStage).filter(BRRecordStage.id == stage_id).first()
                if not record or not record.restructured_text:
                    continue
                
                text = record.restructured_text
                questions = ollama.generate_questions(text, count=3)
                
                record.generated_questions = questions
                record.questions_generated_at = datetime.utcnow()
                fresh_db.commit()
                results.append({"id": stage_id})
            except Exception as e:
                fresh_db.rollback()
                logger.error(f"Failed generating questions for record {stage_id}: {e}")
                errors.append({"id": stage_id, "error": str(e)})
            finally:
                fresh_db.close()
                
        return {
            "status": "success",
            "message": f"Generated questions for {len(results)} records",
            "processed": len(results),
            "errors": len(errors),
            "pipeline_id": pipeline_run_id
        }
    except Exception as e:
        logger.error(f"batch_generate_questions_task failed: {e}")
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"status": "error", "message": str(e)}
    finally:
        try:
            db.close()
        except Exception:
            pass
