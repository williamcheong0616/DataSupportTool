# Bahasa Rojak (BR) Automated Pipeline

## Overview

The BR Pipeline automates the process of detecting Bahasa Rojak (code-mixed text), restructuring content, generating questions, and collecting model responses. This reduces manual work and standardizes the evaluation process.

## Pipeline Stages

### Stage 1: BR Detection (Automated)
- **Purpose**: Identify if text contains Bahasa Rojak (code-mixing between languages)
- **Output**: Boolean flag + confidence score
- **Duration**: ~1-2 seconds per record

### Stage 2: Text Restructuring (Automated)
- **Purpose**: Consolidate MCQ (Multiple Choice Questions) text into a single coherent format
- **What it does**: 
  - Extracts question stem
  - Consolidates options
  - Removes formatting artifacts
  - Standardizes structure
- **Output**: Clean, restructured text
- **Duration**: ~2-3 seconds per record

### Stage 3: Question Generation (Automated)
- **Purpose**: Generate 3 diverse questions from the restructured text
- **Output**: 3 questions per record
- **Duration**: ~5-10 seconds per record (depends on model)

### Stage 4: Human Validation (Manual)
- **Purpose**: Human expert selects the best question from the 3 generated
- **Interface**: Web UI showing:
  - Original vs restructured text
  - BR detection result
  - 3 generated questions (selectable)
- **Duration**: ~30-60 seconds per record

### Stage 5: Model Response Generation (Automated)
- **Purpose**: Generate responses from 3 base models using the selected question
- **Output**: For each model:
  - Response text
  - Identified problems (hallucinations, factual errors, etc.)
- **Duration**: ~10-20 seconds per record (parallel execution)

## Usage

### 1. Start a Pipeline

```bash
# From Text Datasets page, click "Start BR Pipeline" button
# Or via API:
POST /api/br-pipeline/start
{
  "dataset_id": 1
}
```

### 2. Monitor Progress

```bash
GET /api/br-pipeline/status/{pipeline_run_id}

Response:
{
  "id": 1,
  "dataset_id": 1,
  "total_records": 100,
  "processed_records": 45,
  "pending_validation": 55,
  "current_stage": "human_validation",
  "status": "awaiting_validation"
}
```

### 3. Human Validation

Navigate to: `/br-pipeline/validate`

The interface shows:
- Progress bar (X of Y records completed)
- BR detection result
- Restructured text
- 3 generated questions (clickable)

Click on the best question to select it and automatically trigger model response generation.

### 4. View Results

Navigate to: `/br-pipeline/results/{pipeline_id}`

View a table showing:
- **Record ID**: Original text record identifier
- **BR**: Whether text is Bahasa Rojak (Yes/No)
- **Question**: The human-selected question
- **Model**: Base model name and ID
- **Response**: Model's generated response
- **Problems**: Identified issues (hallucinations, errors, etc.)

Export results to CSV for further analysis.

## API Endpoints

### Pipeline Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/br-pipeline/start` | POST | Start pipeline for a dataset |
| `/api/br-pipeline/status/{id}` | GET | Get pipeline status |
| `/api/br-pipeline/pending-validation` | GET | Get records needing validation |
| `/api/br-pipeline/validate/{record_id}` | POST | Submit question selection |
| `/api/br-pipeline/results/{id}` | GET | Get final results |

### Model Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/br-pipeline/models` | GET | List configured models |
| `/api/br-pipeline/models` | POST | Add new model |
| `/api/br-pipeline/models/{id}/toggle` | PATCH | Enable/disable model |

## Model Configuration

Before starting a pipeline, configure at least 3 base models:

```bash
POST /api/br-pipeline/models
{
  "name": "GPT-4",
  "model_type": "openai",
  "model_id": "gpt-4",
  "api_key_env_var": "OPENAI_API_KEY",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 512
  },
  "is_active": true
}
```

Supported model types:
- `openai` - OpenAI models (GPT-4, GPT-3.5)
- `anthropic` - Claude models
- `local` - Local models (Ollama, llama.cpp, etc.)
- `azure` - Azure OpenAI
- `custom` - Custom API endpoints

## Implementation Details

### Placeholder Functions (To Be Implemented)

The following functions in `br_pipeline_orchestrator.py` are **placeholders** and need real implementations:

1. **`_detect_bahasa_rojak(text)`**
   - Current: Returns `(False, 0.5)`
   - Needed: Train or use a code-mixing detection model
   - Options:
     - Fine-tuned BERT/RoBERTa for language identification
     - Rule-based approach with language detection libraries
     - LLM-based classification

2. **`_restructure_mcq_text(text)`**
   - Current: Returns original text
   - Needed: MCQ parsing and consolidation logic
   - Options:
     - Prompt engineering with GPT-4/Claude
     - Custom parsing logic
     - Fine-tuned model for MCQ restructuring

3. **`_generate_questions(text, count=3)`**
   - Current: Returns placeholder questions
   - Needed: Question generation model
   - Options:
     - GPT-4 with structured prompt
     - T5-based question generation model
     - BART fine-tuned on QG dataset

4. **`_generate_model_response(model, context, question)`**
   - Current: Returns placeholder response
   - Needed: Actual model API calls
   - Implementation varies by model type (see Model Configuration)

### Database Schema

**br_pipeline_runs**: Tracks overall pipeline execution
- `total_records`, `processed_records`, `pending_validation`
- `current_stage`, `status`
- Timestamps: `started_at`, `completed_at`

**br_record_stages**: Tracks each record's progress through stages
- Stage 1: `is_bahasa_rojak`, `br_confidence`
- Stage 2: `restructured_text`
- Stage 3: `generated_questions` (JSON array)
- Stage 4: `selected_question_index`, `selected_question`
- Stage 5: `model_responses` (JSON object)

**br_model_configs**: Stores base model configurations
- `name`, `model_type`, `model_id`
- `api_endpoint`, `api_key_env_var`
- `parameters` (JSON), `is_active`

## Performance Considerations

### Estimated Time per Record

| Stage | Duration | Parallelizable |
|-------|----------|----------------|
| BR Detection | 1-2s | ✅ Yes |
| Text Restructure | 2-3s | ✅ Yes |
| Question Generation | 5-10s | ✅ Yes |
| Human Validation | 30-60s | ❌ No (manual) |
| Model Responses | 10-20s | ✅ Yes (3 models parallel) |

**Total**: ~1-2 minutes per record (mostly human validation time)

### Optimization Tips

1. **Batch Processing**: Run stages 1-3 in batches for better throughput
2. **Async Workers**: Use Celery/background tasks for long-running operations
3. **Caching**: Cache model responses for identical questions
4. **Parallel Execution**: Run model responses in parallel (already implemented)

## Troubleshooting

### Pipeline Stuck at "awaiting_validation"
- Check `/br-pipeline/validate` page for pending records
- Ensure human validators complete their reviews

### Model Response Generation Failing
- Verify model configurations are correct
- Check API keys are set in environment variables
- Review error logs: `pipeline_run.error_message`

### Slow Performance
- Consider running pipeline in background (async)
- Increase batch sizes for stages 1-3
- Use faster models for initial stages (cheaper/faster models)

## Next Steps

1. **Implement AI Functions**: Replace placeholder functions with real models
2. **Add Batch Processing**: Process multiple records in parallel
3. **Add Analytics**: Track completion rates, average validation time
4. **Add User Management**: Track which validators complete most records
5. **Add Quality Metrics**: Score model responses automatically
