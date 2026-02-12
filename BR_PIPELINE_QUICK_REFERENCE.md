# BR Pipeline Quick Reference Card

## 🚀 New Features

### ✅ Individual Stage Execution
Run each stage separately instead of all at once - no more long waits!

### ✅ Automatic Language Detection  
LLM automatically detects all languages in text (e.g., "Malay, English")

### ✅ User Choice for Restructuring
Choose to keep original text or restructure - your choice!

### ✅ Bahasa Rojak Questions
Questions now use authentic Malaysian/Singaporean code-mixing with slang

---

## 📊 API Endpoints

### Stage 1: BR Detection + Language Detection
```bash
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "record_ids": null  # or [1,2,3] for specific records
}
```
**Returns:** BR status, confidence, detected languages

---

### Stage 2: Text Restructuring (with choice)
```bash
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "skip_restructure": false,  # false=restructure, true=keep original
  "record_ids": null
}
```
**Key:** Original language ALWAYS preserved (no translation)

**When to use skip_restructure:**
- `false` - Text has MCQ formatting, needs consolidation
- `true` - Text is already well-structured, keep as-is

---

### Stage 3: Question Generation (Bahasa Rojak)
```bash
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": null
}
```
**Generates:** 3 questions in Bahasa Rojak style with slang (lah, leh, meh, etc.)

---

## 💡 Bahasa Rojak Examples

### What Questions Look Like Now:
```
✓ "Apa benda yang dia cakap about the economy ah?"
✓ "Why lah the government buat macam tu?"
✓ "Can you explain sikit about this policy or not?"
✓ "Betul ke this thing effective meh?"
```

### Common Slang Used:
- **lah** - emphasis (most common)
- **leh** - suggestion
- **meh** - doubt/question
- **sikit** - a bit
- **buat** - do/make
- **cakap** - say/speak

---

## 🔄 Typical Workflow

```
1. Create Pipeline
   POST /api/br-pipeline/start {"dataset_id": 5}
   → Returns pipeline_run_id

2. Run Stage 1
   POST /api/br-pipeline/run-stage1 {"pipeline_run_id": X}
   → Detects BR + languages
   → Review results at /classification/X

3. Run Stage 2
   POST /api/br-pipeline/run-stage2 
   {"pipeline_run_id": X, "skip_restructure": false}
   → Restructures text (or keeps original)
   → Review at /restructure/X

4. Run Stage 3
   POST /api/br-pipeline/run-stage3 {"pipeline_run_id": X}
   → Generates Bahasa Rojak questions
   → Review at /questions/X

5. Human Validation
   Use UI to select best question (1 of 3)

6. Generate Model Responses
   Automatic after validation
```

---

## ⚙️ Setup Requirements

### Before You Start:
```bash
# 1. Start Ollama
ollama serve

# 2. Pull model (if not already done)
ollama pull gemma3:4b

# 3. Run migration (optional - auto-runs on app start)
python scripts/migrate_br_pipeline.py
```

---

## 🎯 Decision Guide

### Should I skip restructuring?

**Use skip_restructure=false when:**
- ✓ Text has MCQ options (A, B, C, D)
- ✓ Text is fragmented across lines
- ✓ Needs consolidation

**Use skip_restructure=true when:**
- ✓ Text is already a complete paragraph
- ✓ Context is clear
- ✓ Want exact preservation

**Remember:** Original language preserved either way!

---

## 📋 Response Examples

### Stage 1 Response:
```json
{
  "pipeline_run_id": 1,
  "stage": "Stage 1: BR Detection + Language Detection",
  "records_processed": 50,
  "message": "Successfully processed 50 records"
}
```

### View Results:
```bash
GET /api/br-pipeline/classification/1?page=1
```

### Each Record Shows:
```json
{
  "id": 1,
  "is_bahasa_rojak": true,
  "br_confidence": 0.95,
  "detected_language": "Malay, English",  ← NEW!
  "original_text": "..."
}
```

---

## 🔧 Troubleshooting

### "Ollama service not available"
```bash
ollama serve  # Start Ollama
ollama pull gemma3:4b  # Ensure model is downloaded
```

### "Questions not in Bahasa Rojak"
- Check if input text has good context
- Try regenerating (run stage 3 again)
- Verify model is gemma3:4b

### "Stage failed"
- Check Ollama is running: `curl http://localhost:11434/api/tags`
- Review logs for details
- Ensure sufficient RAM (4GB+ recommended)

---

## 📊 View Results Endpoints

```bash
# Classification (Stage 1)
GET /api/br-pipeline/classification/{pipeline_run_id}?page=1

# Restructure (Stage 2)
GET /api/br-pipeline/restructure/{pipeline_run_id}?page=1

# Questions (Stage 3)  
GET /api/br-pipeline/questions/{pipeline_run_id}?page=1

# Final Results
GET /api/br-pipeline/results/{pipeline_run_id}
```

---

## 🎨 Code Examples

### Python
```python
import requests

# Run Stage 1
response = requests.post(
    "http://localhost:8000/api/br-pipeline/run-stage1",
    json={"pipeline_run_id": 1}
)
print(response.json())

# Run Stage 2 with skip
response = requests.post(
    "http://localhost:8000/api/br-pipeline/run-stage2",
    json={
        "pipeline_run_id": 1,
        "skip_restructure": True  # Keep original
    }
)
```

### JavaScript
```javascript
// Run Stage 3
fetch('/api/br-pipeline/run-stage3', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({pipeline_run_id: 1})
})
.then(r => r.json())
.then(data => console.log(data));
```

---

## 📚 Documentation

- **Full Guide:** `BR_PIPELINE_IMPROVEMENTS.md`
- **Code Changes:** `BR_PIPELINE_CODE_CHANGES.md`
- **This Card:** `BR_PIPELINE_QUICK_REFERENCE.md`

---

## ✨ Benefits Recap

| Feature | Before | After |
|---------|--------|-------|
| **Waiting Time** | Run all stages at once | Run when suitable |
| **Language Info** | Just BR yes/no | All languages detected |
| **Text Control** | Always restructure | Choose what to do |
| **Questions** | Formal English | Authentic Bahasa Rojak |

---

## 🎯 Key Takeaways

1. **Flexibility** - Run stages individually, no long waits
2. **Intelligence** - Auto language detection by LLM
3. **Control** - Choose to restructure or keep original
4. **Authenticity** - Questions match real Malaysian/Singaporean speech
5. **Backward Compatible** - Old pipelines still work

---

**Need Help?** Check the full documentation in `BR_PIPELINE_IMPROVEMENTS.md`

**Ready to Start?** Just ensure Ollama is running and fire away! 🚀
