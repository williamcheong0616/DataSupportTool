# BR Pipeline Improvements

## Overview

The BR Pipeline has been enhanced with the following major improvements:

1. **Individual Stage Execution** - Run each stage separately when you think it's suitable
2. **Automatic Language Detection** - Stage 1 now automatically detects languages used
3. **User Choice for Restructuring** - Stage 2 allows you to choose whether to restructure or keep original text
4. **Bahasa Rojak Question Generation** - Stage 3 now generates questions in Bahasa Rojak style

---

## 1. Individual Stage Execution

### Why This Matters
Instead of running the entire pipeline at once (which can take a long time), you can now run each stage individually. This gives you:
- **Control**: Run stages when you're ready
- **Flexibility**: Review results after each stage before proceeding
- **Time Management**: Avoid long waiting times by running stages in batches

### How to Use

#### Stage 1: BR Detection + Language Detection
```bash
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "record_ids": [5, 6, 7]  # Optional: specific records, or null for all
}
```

**What it does:**
- Detects if text is Bahasa Rojak (code-mixed)
- **NEW:** Automatically identifies all languages used (e.g., "Malay, English", "English, Mandarin")
- Provides confidence score

**Example Response:**
```json
{
  "pipeline_run_id": 1,
  "stage": "Stage 1: BR Detection + Language Detection",
  "records_processed": 50,
  "message": "Successfully processed 50 records"
}
```

#### Stage 2: Text Restructuring (with User Choice)
```bash
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "skip_restructure": false,  # false=restructure, true=keep original
  "record_ids": null  # Optional
}
```

**What it does:**
- **Option 1 (`skip_restructure: false`)**: Restructures MCQ text into clean, consolidated format
- **Option 2 (`skip_restructure: true`)**: Keeps original text as-is (if already contextualized enough)
- **IMPORTANT:** Original language is ALWAYS preserved - no translation occurs!

**When to Use Each Option:**
- Use `skip_restructure: false` when:
  - Text has messy MCQ formatting (A), B), C), etc.)
  - Need to consolidate multiple parts into one coherent passage
  
- Use `skip_restructure: true` when:
  - Text is already well-structured
  - Context is already clear and complete
  - You want to preserve exact original formatting

**Example:**
```json
{
  "pipeline_run_id": 1,
  "stage": "Stage 2: Text Restructuring",
  "records_processed": 50,
  "message": "Restructured text for 50 records"
}
```

#### Stage 3: Question Generation (Bahasa Rojak Style)
```bash
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": null
}
```

**What it does:**
- Generates 3 questions **in Bahasa Rojak style**
- Questions are generated in reverse (from the text/responses)
- Uses Malay-English code-mixing
- Includes authentic Malaysian/Singaporean slang and shortforms

**Bahasa Rojak Question Examples:**
```
- "Apa benda yang dia cakap about the economy ah?"
- "Why lah the government buat macam tu?"
- "Can you explain sikit about this policy or not?"
- "Betul ke this thing effective meh?"
- "How come dia tak mention anything about that lah?"
```

**Characteristics:**
- Code-mixing: Mix of Malay and English words
- Slang: lah, leh, meh, lor, kan, ke, ah
- Shortforms: sikit (a bit), buat (do), cakap (say), betul ke (is it true)
- Natural conversational tone

---

## 2. Automatic Language Detection (Stage 1)

### What Changed
Previously, Stage 1 only detected if text was Bahasa Rojak (yes/no).

**Now**, Stage 1 automatically identifies **all languages** used in the text.

### Examples

**Input Text 1:**
```
"Saya nak pergi shopping tomorrow lah, you want to join or not?"
```

**Output:**
```json
{
  "is_bahasa_rojak": true,
  "confidence": 0.95,
  "languages": "Malay, English"
}
```

**Input Text 2:**
```
"This is pure English text about economics."
```

**Output:**
```json
{
  "is_bahasa_rojak": false,
  "confidence": 0.9,
  "languages": "English"
}
```

**Input Text 3:**
```
"我要吃饭 but the restaurant is closed lah"
```

**Output:**
```json
{
  "is_bahasa_rojak": true,
  "confidence": 0.93,
  "languages": "Mandarin, English, Malay"
}
```

### Benefits
- **Better Understanding**: Know exactly which languages are present
- **Data Analysis**: Filter/analyze by language combinations
- **Quality Control**: Ensure language diversity in your dataset

---

## 3. User Choice for Text Restructuring (Stage 2)

### The Problem This Solves
Previously, Stage 2 always restructured text, which sometimes:
- Changed well-structured text unnecessarily
- Lost important formatting
- Wasted processing time on already-good text

### The Solution
Now you can choose:

#### Option A: Restructure Text
Use when text needs consolidation (MCQ formatting, fragmented text, etc.)

**Before:**
```
Question: What is the capital?
A) Kuala Lumpur
B) Penang
C) Johor
```

**After:**
```
The question asks about the capital city, with options including 
Kuala Lumpur, Penang, and Johor as possible answers.
```

#### Option B: Keep Original Text
Use when text is already good as-is.

**Before:**
```
Malaysia's economy focuses on manufacturing and services. 
The country has seen steady growth over the past decade.
```

**After:**
```
Malaysia's economy focuses on manufacturing and services. 
The country has seen steady growth over the past decade.
```
*(Unchanged, preserved exactly)*

### Important: Original Language Preserved
**Both options preserve the original language(s) - no translation occurs!**

If input is in Bahasa Rojak, output stays in Bahasa Rojak.
If input is in Malay, output stays in Malay.

---

## 4. Bahasa Rojak Question Generation (Stage 3)

### What Changed
Previously, questions were generated in formal English.

**Now**, questions are generated in **authentic Bahasa Rojak style** - matching how Malaysians/Singaporeans actually speak!

### Bahasa Rojak Features

#### 1. Code-Mixing (Malay + English)
```
✓ "Apa benda yang happen during the meeting?"
✓ "Why dia tak reply my message lah?"
✓ "Can explain sikit about this situation or not?"
```

#### 2. Authentic Slang/Particles
- **lah** - emphasis/softening (most common)
- **leh** - suggestion/possibility
- **meh** - doubt/questioning
- **lor** - resignation/acceptance
- **kan** - confirmation seeking
- **ah** - question tag
- **ke** - question particle

#### 3. Natural Conversational Flow
```
✓ "Government say will help, but how come tak nampak any action leh?"
✓ "This policy effective meh? I got my doubts lor."
✓ "Betul ke what he cakap about the economy ah?"
```

#### 4. Common Mixed Words
- **sikit** = a bit/little
- **buat** = do/make
- **cakap** = say/speak
- **betul** = correct/true
- **nampak** = see/visible
- **boleh** = can
- **nak** = want

### Examples of Generated Questions

**Text Input:**
```
"Malaysia's government announced new economic policies focusing on 
digital transformation and supporting SMEs."
```

**Generated Questions (Bahasa Rojak):**
```
1. "Apa benda the government announce about economy ah?"
2. "Why focus on digital transformation leh, got reason ke?"
3. "How the new policy will help SMEs or not?"
```

---

## Complete Workflow Example

### Scenario: Processing 100 Text Records

#### Step 1: Create Pipeline
```bash
POST /api/br-pipeline/start
{
  "dataset_id": 5
}

Response:
{
  "id": 10,
  "total_records": 100,
  "status": "pending"
}
```

#### Step 2: Run Stage 1 (BR Detection + Language)
```bash
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 10
}

Response:
{
  "records_processed": 100,
  "message": "Successfully processed 100 records"
}
```

**Review Results:**
```bash
GET /api/br-pipeline/classification/10?page=1

# Check detected_language field for each record
```

#### Step 3: Run Stage 2 (Restructure)
**Decision Point:** Do texts need restructuring?

**Option A - Restructure All:**
```bash
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 10,
  "skip_restructure": false
}
```

**Option B - Keep Original (Already Good):**
```bash
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 10,
  "skip_restructure": true
}
```

**Option C - Mixed (Process in Batches):**
```bash
# Restructure records 1-50
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 10,
  "skip_restructure": false,
  "record_ids": [1, 2, 3, ..., 50]
}

# Keep original for records 51-100
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 10,
  "skip_restructure": true,
  "record_ids": [51, 52, 53, ..., 100]
}
```

#### Step 4: Run Stage 3 (Generate Bahasa Rojak Questions)
```bash
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 10
}

Response:
{
  "records_processed": 100,
  "message": "Generated Bahasa Rojak questions for 100 records"
}
```

**Review Questions:**
```bash
GET /api/br-pipeline/questions/10?page=1

# Check generated_questions field
# Should see Bahasa Rojak style with lah, leh, meh, etc.
```

#### Step 5: Human Validation
Use the validation UI to select the best question from the 3 generated for each record.

#### Step 6: Generate Model Responses
This happens automatically after question selection.

---

## Benefits Summary

### 1. **Time Efficiency**
- Run stages when suitable instead of waiting for entire pipeline
- Process in smaller batches
- Review results incrementally

### 2. **Better Language Understanding**
- Know exactly which languages are in your data
- Auto-detected by LLM, no manual tagging needed
- Useful for analysis and filtering

### 3. **Text Quality Control**
- Choose to restructure or keep original based on quality
- No unnecessary processing of good text
- Original language always preserved

### 4. **Authentic Question Generation**
- Questions match natural Malaysian/Singaporean speech
- Code-mixing reflects real usage
- More realistic evaluation of model responses

---

## Database Changes

New field added to `br_record_stages` table:

```sql
ALTER TABLE br_record_stages 
ADD COLUMN skip_restructure BOOLEAN DEFAULT FALSE;
```

**Note:** This is handled automatically by SQLAlchemy when you restart the application.

---

## Migration from Old Pipeline

If you have existing pipeline runs:

1. **Old pipelines still work** - no breaking changes
2. **New features need new runs** - start a new pipeline to use individual stages
3. **Language field** - will be "Unknown" for old records, populated for new ones
4. **Restructure flag** - defaults to False (restructure) for backward compatibility

---

## API Endpoints Summary

### Individual Stage Execution
- `POST /api/br-pipeline/run-stage1` - BR Detection + Language
- `POST /api/br-pipeline/run-stage2` - Text Restructuring (with choice)
- `POST /api/br-pipeline/run-stage3` - Question Generation (Bahasa Rojak)

### Existing Endpoints (Still Work)
- `POST /api/br-pipeline/start` - Start full pipeline (background)
- `GET /api/br-pipeline/status/{id}` - Check status
- `GET /api/br-pipeline/classification/{id}` - Review Stage 1 results
- `GET /api/br-pipeline/questions/{id}` - Review Stage 3 results
- All other existing endpoints remain unchanged

---

## Tips for Best Results

### Stage 1 (BR Detection)
- Works best with clear text (no excessive formatting)
- Confidence score helps identify uncertain cases
- Review detected languages for accuracy

### Stage 2 (Restructuring)
- **Use skip_restructure=false for:**
  - MCQ with options (A, B, C, D)
  - Fragmented text across multiple lines
  - Text needing consolidation

- **Use skip_restructure=true for:**
  - Already well-written paragraphs
  - Text with good flow and context
  - When you want exact preservation

### Stage 3 (Question Generation)
- Model (gemma3:4b) needs to be running in Ollama
- Questions reflect Bahasa Rojak style automatically
- Review questions to ensure quality matches your needs
- If questions aren't Bahasa Rojak enough, you can regenerate

---

## Troubleshooting

### "Ollama service not available"
```bash
# Start Ollama first
ollama serve

# Pull the model if not already downloaded
ollama pull gemma3:4b
```

### "Stage failed: too many consecutive failures"
- Check Ollama is running
- Verify model is loaded
- Check system resources (CPU/RAM)

### "Questions not in Bahasa Rojak style"
- Model may need better examples
- Try regenerating (run stage 3 again)
- Check if input text has enough context

### "Language detection seems wrong"
- Check if text is clear (no excessive noise/formatting)
- Review confidence score
- You can manually correct via classification endpoint

---

## Future Enhancements (Potential)

1. **Custom Question Templates** - Define your own Bahasa Rojak patterns
2. **Batch Size Control** - Process X records at a time
3. **Stage Retry** - Retry failed records automatically
4. **Language-Specific Pipelines** - Different handling per language
5. **UI Improvements** - Visual stage execution with progress bars

---

## Support

For questions or issues:
1. Check this documentation first
2. Review API endpoint descriptions
3. Check logs for detailed error messages
4. Verify Ollama is running and model is available

---

**Happy Processing! 🎉**
