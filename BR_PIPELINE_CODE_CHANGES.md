# BR Pipeline Code Changes Summary

## Files Modified

### 1. `backend/br_pipeline_models.py`
**Change:** Added `skip_restructure` field to `BRRecordStage` model

```python
# Stage 2: Text Restructuring
skip_restructure = Column(Boolean, default=False)  # User choice to skip restructuring
```

**Purpose:** Track whether user chose to skip restructuring for each record

---

### 2. `backend/ollama_service.py`
**Changes:** Enhanced three main methods with new capabilities

#### A. `detect_bahasa_rojak()` - Now returns language detection
```python
# OLD
def detect_bahasa_rojak(self, text: str) -> tuple[bool, float]:
    # Returns: (is_bahasa_rojak, confidence)

# NEW  
def detect_bahasa_rojak(self, text: str) -> tuple[bool, float, str]:
    # Returns: (is_bahasa_rojak, confidence, detected_languages)
```

**Added:** System prompt now asks LLM to identify all languages used in text

#### B. `restructure_mcq_text()` - Now supports skip option and preserves language
```python
# OLD
def restructure_mcq_text(self, text: str) -> str:
    # Returns: restructured_text

# NEW
def restructure_mcq_text(self, text: str, skip_restructure: bool = False) -> tuple[str, dict]:
    # Returns: (restructured_text, metadata)
```

**Added Features:**
- `skip_restructure` parameter: if True, returns original text unchanged
- Metadata tracking: records whether restructuring was performed, skipped, or failed
- Enhanced prompt: explicitly instructs to preserve original language (no translation)

#### C. `generate_questions()` - Now generates in Bahasa Rojak style
```python
# OLD System Prompt
"Generate diverse, thoughtful questions..."

# NEW System Prompt
"Generate questions in Bahasa Rojak style with:
- Malay-English code-mixing
- Slang: lah, leh, meh, lor, kan, etc.
- Natural Malaysian/Singaporean conversational style"
```

**Added:** Complete Bahasa Rojak characteristics and example patterns in system prompt

---

### 3. `backend/br_pipeline_orchestrator.py`
**Changes:** Updated existing methods + added new individual stage execution methods

#### A. Updated Existing Methods

```python
# Updated to use new 3-tuple return
async def _detect_bahasa_rojak(self, text: str) -> tuple[bool, float, str]:
    # Now returns languages as third element

# Updated to use new signature with metadata
async def _restructure_mcq_text(self, text: str, skip_restructure: bool = False) -> tuple[str, dict]:
    # Now accepts skip parameter and returns metadata
```

#### B. Added New Methods for Individual Stage Execution

**`run_stage_1()`** - Run Stage 1 individually
```python
async def run_stage_1(self, pipeline_run_id: int, record_ids: Optional[List[int]] = None):
    """
    Run Stage 1 (BR Detection + Language Detection) individually.
    If record_ids provided, only run for those records.
    """
```

**Features:**
- Can process all pending records or specific record_ids
- Checks Ollama availability before running
- Updates record_stage with: is_bahasa_rojak, br_confidence, detected_language

**`run_stage_2()`** - Run Stage 2 individually with user choice
```python
async def run_stage_2(
    self, 
    pipeline_run_id: int, 
    record_ids: Optional[List[int]] = None,
    skip_restructure: bool = False
):
    """
    Run Stage 2 (Text Restructuring) individually.
    skip_restructure: User choice to keep original or restructure.
    """
```

**Features:**
- User can choose to skip restructuring via parameter
- Sets skip_restructure flag on record
- Stores metadata about action taken
- Preserves original language (no translation)

**`run_stage_3()`** - Run Stage 3 individually (Bahasa Rojak questions)
```python
async def run_stage_3(self, pipeline_run_id: int, record_ids: Optional[List[int]] = None):
    """
    Run Stage 3 (Question Generation in Bahasa Rojak) individually.
    """
```

**Features:**
- Generates questions in Bahasa Rojak style
- Failure detection with consecutive failure counter
- Only processes records that completed Stage 2

---

### 4. `backend/br_pipeline_routes.py`
**Changes:** Added new schemas and API endpoints

#### A. New Pydantic Schemas

```python
class StageExecutionRequest(BaseModel):
    pipeline_run_id: int
    record_ids: Optional[List[int]] = None

class Stage2ExecutionRequest(BaseModel):
    pipeline_run_id: int
    skip_restructure: bool = False
    record_ids: Optional[List[int]] = None

class StageExecutionResponse(BaseModel):
    pipeline_run_id: int
    stage: str
    records_processed: int
    message: str
```

#### B. New API Endpoints

**`POST /api/br-pipeline/run-stage1`** - Execute Stage 1
```python
@router.post("/run-stage1", response_model=StageExecutionResponse)
async def run_stage_1_individually(request: StageExecutionRequest, ...):
    """
    Run Stage 1 (BR Detection + Language Detection) individually.
    """
```

**Request:**
```json
{
  "pipeline_run_id": 1,
  "record_ids": [1, 2, 3]  // optional
}
```

**Response:**
```json
{
  "pipeline_run_id": 1,
  "stage": "Stage 1: BR Detection + Language Detection",
  "records_processed": 50,
  "message": "Successfully processed 50 records"
}
```

**`POST /api/br-pipeline/run-stage2`** - Execute Stage 2
```python
@router.post("/run-stage2", response_model=StageExecutionResponse)
async def run_stage_2_individually(request: Stage2ExecutionRequest, ...):
    """
    Run Stage 2 (Text Restructuring) with user choice.
    """
```

**Request:**
```json
{
  "pipeline_run_id": 1,
  "skip_restructure": false,  // false=restructure, true=keep original
  "record_ids": null
}
```

**`POST /api/br-pipeline/run-stage3`** - Execute Stage 3
```python
@router.post("/run-stage3", response_model=StageExecutionResponse)
async def run_stage_3_individually(request: StageExecutionRequest, ...):
    """
    Run Stage 3 (Question Generation in Bahasa Rojak).
    """
```

---

## Summary of Improvements

### 1. Individual Stage Execution ✅
- **Before:** Pipeline runs all stages automatically in sequence
- **After:** Each stage can be run independently when ready
- **Benefit:** Better control, no long waiting times

### 2. Automatic Language Detection ✅
- **Before:** Only detected if text is BR (yes/no)
- **After:** Also identifies all languages used (e.g., "Malay, English, Mandarin")
- **Benefit:** Better understanding of language composition

### 3. User Choice for Restructuring ✅
- **Before:** Always restructures text
- **After:** User can choose to skip if text is already good
- **Benefit:** Preserves well-structured text, saves processing time
- **Important:** Original language always preserved (no translation)

### 4. Bahasa Rojak Question Generation ✅
- **Before:** Questions in formal English
- **After:** Questions in Bahasa Rojak style with code-mixing and slang
- **Benefit:** More authentic, realistic evaluation

---

## Backward Compatibility

✅ **All existing functionality preserved**
- Old endpoints still work
- Existing pipelines unaffected
- Database changes are additive (new field with default value)

✅ **Gradual migration**
- Can continue using full pipeline (`POST /start`)
- New features optional via new endpoints
- Mix old and new approaches

---

## Testing Recommendations

### 1. Test Individual Stage Execution
```bash
# Create pipeline
POST /api/br-pipeline/start {"dataset_id": 1}

# Run each stage individually
POST /api/br-pipeline/run-stage1 {"pipeline_run_id": 1}
POST /api/br-pipeline/run-stage2 {"pipeline_run_id": 1, "skip_restructure": false}
POST /api/br-pipeline/run-stage3 {"pipeline_run_id": 1}
```

### 2. Test Language Detection
```bash
# Check classification results
GET /api/br-pipeline/classification/1

# Verify detected_language field is populated
```

### 3. Test Skip Restructure
```bash
# Test both options
POST /api/br-pipeline/run-stage2 
{
  "pipeline_run_id": 1, 
  "skip_restructure": true  // Test keeping original
}

POST /api/br-pipeline/run-stage2 
{
  "pipeline_run_id": 2, 
  "skip_restructure": false  // Test restructuring
}
```

### 4. Test Bahasa Rojak Questions
```bash
# Generate questions
POST /api/br-pipeline/run-stage3 {"pipeline_run_id": 1}

# Check results
GET /api/br-pipeline/questions/1

# Verify questions have:
# - Malay-English mixing
# - Slang (lah, leh, meh, etc.)
# - Natural conversational tone
```

---

## Required Setup

1. **Ollama must be running:**
   ```bash
   ollama serve
   ```

2. **Model must be available:**
   ```bash
   ollama pull gemma3:4b
   ```

3. **Database migration (automatic):**
   - Restart the application
   - SQLAlchemy will add the new `skip_restructure` column automatically

---

## Performance Considerations

### Memory Usage
- Individual stage execution uses same resources as full pipeline
- Processing in batches (via record_ids) can reduce peak memory

### Ollama Service
- Each stage makes API calls to Ollama
- Stage 3 (question generation) is most resource-intensive
- Ensure Ollama has sufficient resources (4GB+ RAM recommended)

### Database
- New metadata field (JSON) adds minimal overhead
- Indexes remain unchanged
- Query performance unaffected

---

## Future Enhancement Ideas

1. **Parallel Processing**: Process multiple records concurrently
2. **Progress Tracking**: Real-time progress updates via WebSocket
3. **Retry Logic**: Auto-retry failed records
4. **Custom Models**: Allow user to specify different Ollama models per stage
5. **Quality Metrics**: Score generated questions for Bahasa Rojak authenticity

---

## Code Quality

- ✅ Type hints added to all new methods
- ✅ Comprehensive docstrings
- ✅ Error handling with informative messages
- ✅ Logging for debugging
- ✅ Pydantic validation for API inputs
- ✅ SQLAlchemy best practices

---

## Documentation

- `BR_PIPELINE_IMPROVEMENTS.md` - User-facing documentation
- `BR_PIPELINE_CODE_CHANGES.md` - This file (technical documentation)
- Inline code comments for complex logic
- API endpoint docstrings visible in OpenAPI/Swagger UI
