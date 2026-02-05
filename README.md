# Data Pipeline Tool 🔄

A web application for managing the complete data pipeline flow: **Data Collection → Preprocessing → Validation → Iteration**.

Built with **Streamlit** (frontend) + **FastAPI** (backend) - 100% Python.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        STREAMLIT UI                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Dashboard │ │ Datasets │ │ Pipeline │ │  Review  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FASTAPI BACKEND                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Datasets │ │ Records  │ │ Pipeline │ │Validation│           │
│  │   API    │ │   API    │ │   API    │ │   API    │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PIPELINE ORCHESTRATOR                        │
│                                                                  │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐           │
│   │ Preprocess │───▶│  Inference │───▶│  Validate  │           │
│   └────────────┘    └────────────┘    └────────────┘           │
│                                              │                   │
│                                              ▼                   │
│                                        ┌──────────┐             │
│   ◀────────────── ITERATE ◀────────────│  Failed? │             │
│                                        └──────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
DataSupportTool/
├── backend/
│   ├── __init__.py
│   ├── api.py           # FastAPI routes
│   ├── database.py      # SQLAlchemy setup
│   ├── models.py        # Database models
│   └── schemas.py       # Pydantic schemas
├── frontend/
│   ├── __init__.py
│   └── app.py           # Streamlit UI
├── pipeline/
│   ├── __init__.py
│   ├── orchestrator.py  # Pipeline coordinator
│   ├── preprocessor.py  # Data preprocessing
│   ├── validator.py     # Response validation (metrics)
│   └── model_client.py  # Model API client
├── data/                # Auto-created for uploads
├── config.py            # Configuration
├── requirements.txt     # Dependencies
├── run_api.py          # Start backend
├── run_frontend.py     # Start frontend
└── README.md
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd DataSupportTool
pip install -r requirements.txt
```

### 2. Start the Backend API

```bash
python run_api.py
```

The API will be available at: http://localhost:8000
- API Docs: http://localhost:8000/docs

### 3. Start the Frontend (in a new terminal)

```bash
python run_frontend.py
```

The UI will be available at: http://localhost:8501

## 📋 Pipeline Flow

### 1. Data Collection
- Create datasets via UI or API
- Upload CSV/JSON files with `input_text` and optional `expected_output` columns
- Add records manually or via API

### 2. Preprocessing
- Text cleaning (whitespace, null characters)
- Unicode normalization
- PII removal (optional)
- Custom preprocessing steps

### 3. Model Inference
- Sends preprocessed data to your fine-tuned model endpoint
- Captures responses, latency, and token usage
- Mock mode available for testing

### 4. Validation
Automated metrics:
- **Accuracy** (Token-level F1 score)
- **BLEU** (N-gram precision)
- **ROUGE-L** (Longest common subsequence)

Human review:
- Review queue for borderline responses
- Score (0-1) and feedback submission
- Reviewer tracking

### 5. Iteration
- If validation fails → mark for iteration
- Create new pipeline run with incremented iteration count
- Max iterations limit prevents infinite loops

## 🔧 Configuration

Edit `config.py` or use environment variables (`.env`):

```python
# Database
DATABASE_URL = "sqlite:///./data_pipeline.db"

# Model endpoint
MODEL_ENDPOINT = "http://localhost:8080/v1/completions"

# Validation
VALIDATION_THRESHOLD = 0.8  # Pass threshold
MAX_ITERATIONS = 5          # Max retry iterations
```

## 📊 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/datasets` | Create dataset |
| GET | `/api/datasets` | List datasets |
| POST | `/api/datasets/{id}/upload` | Upload data file |
| POST | `/api/datasets/{id}/records` | Add record |
| POST | `/api/pipeline/run` | Start pipeline |
| GET | `/api/pipeline/runs` | List runs |
| POST | `/api/pipeline/runs/{id}/iterate` | Trigger iteration |
| GET | `/api/pipeline/runs/{id}/validations` | Get validations |
| POST | `/api/validations/{id}/review` | Submit human review |
| GET | `/api/stats` | Get statistics |

## 🧪 Testing Without a Real Model

The pipeline uses a `MockModelClient` by default for testing. To use a real model:

1. Set your model endpoint in `.env`:
   ```
   MODEL_ENDPOINT=http://your-model-api/v1/completions
   ```

2. In `pipeline/orchestrator.py`, change:
   ```python
   self.use_mock_model = False
   ```

## 📈 Validation Metrics

| Metric | Description | Range |
|--------|-------------|-------|
| Accuracy | Token-level F1 score | 0-1 |
| BLEU | N-gram precision (1-4 grams) | 0-1 |
| ROUGE-L | LCS-based F1 score | 0-1 |
| Human Score | Manual quality rating | 0-1 |

## 🔄 Iteration Logic

```
IF overall_score >= threshold (0.8):
    → COMPLETED ✅
ELIF overall_score >= human_review_threshold (0.6):
    → HUMAN_REVIEW 👤
ELSE:
    IF iteration < MAX_ITERATIONS:
        → FAILED (can iterate) 🔄
    ELSE:
        → HUMAN_REVIEW (max iterations reached) 👤
```

## 📝 Data Format

### Input CSV/JSON
```csv
input_text,expected_output
"What is Python?","Python is a programming language..."
"Explain AI","AI stands for Artificial Intelligence..."
```

### API Request
```json
{
  "records": [
    {
      "input_text": "What is Python?",
      "expected_output": "Python is a programming language..."
    }
  ]
}
```

## 🛠️ Extending the Pipeline

### Add Custom Preprocessing Step
Edit `pipeline/preprocessor.py`:
```python
def _my_custom_step(self, text: str, **kwargs) -> str:
    # Your logic here
    return processed_text

# Add to step_functions dict
self.step_functions["my_step"] = self._my_custom_step
```

### Add Custom Validation Metric
Edit `pipeline/validator.py`:
```python
def _compute_my_metric(self, response: str, expected: str) -> float:
    # Your metric logic
    return score
```

## 📜 License

MIT License
