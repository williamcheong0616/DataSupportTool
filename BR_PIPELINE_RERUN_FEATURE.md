# BR Pipeline Rerun Feature

## Overview

You can now **rerun any stage** (Stage 1, 2, or 3) for records that have already been processed. This is useful when:

- Initial results weren't satisfactory
- You want to try different parameters (e.g., different `skip_restructure` settings)
- Model improved and you want to regenerate with updated LLM
- There was an error and you need to retry
- You want to experiment with different approaches

---

## How to Use

### Basic Syntax

Add `force_rerun: true` to any stage execution request:

```json
{
  "pipeline_run_id": 1,
  "force_rerun": true
}
```

---

## Stage 1: Rerun BR Detection + Language Detection

### Rerun All Records
```bash
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "force_rerun": true
}
```

This will rerun BR detection and language detection for **all records** in the pipeline, regardless of current stage.

### Rerun Specific Records
```bash
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "record_ids": [5, 10, 15],
  "force_rerun": true
}
```

**Note:** When `record_ids` are provided, `force_rerun` isn't strictly necessary (specific records are always processed), but it's good practice to include it for clarity.

---

## Stage 2: Rerun Text Restructuring

### Rerun All Records with Different Setting
```bash
# Originally ran with skip_restructure=false
# Now rerun with skip_restructure=true to keep originals instead
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "skip_restructure": true,
  "force_rerun": true
}
```

This is particularly useful when you want to **change your restructuring strategy** after seeing initial results.

### Rerun Specific Records
```bash
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "record_ids": [12, 13, 14],
  "skip_restructure": false,
  "force_rerun": true
}
```

---

## Stage 3: Rerun Question Generation

### Rerun All Records (New Bahasa Rojak Questions)
```bash
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "force_rerun": true
}
```

This regenerates all 3 questions for each record in Bahasa Rojak style. Useful when:
- Initial questions weren't Bahasa Rojak enough
- Model has been updated/improved
- You want fresh question variations

### Rerun Specific Records
```bash
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": [20, 21, 22],
  "force_rerun": true
}
```

---

## Behavior Comparison

### Without `force_rerun` (Default)

| Stage | Processes |
|-------|-----------|
| Stage 1 | Only PENDING records |
| Stage 2 | Only records that completed Stage 1 (and not yet Stage 2) |
| Stage 3 | Only records that completed Stage 2 (and not yet Stage 3) |

### With `force_rerun: true`

| Stage | Processes |
|-------|-----------|
| Stage 1 | **ALL records** in pipeline (any stage) |
| Stage 2 | **ALL records** that have at least completed Stage 1 |
| Stage 3 | **ALL records** that have at least completed Stage 2 |

---

## Use Cases

### 1. **Retry After Model Improvement**
```bash
# Your Ollama model was updated
# Rerun Stage 3 to get better Bahasa Rojak questions
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "force_rerun": true
}
```

### 2. **Change Restructuring Strategy**
```bash
# Initially restructured all text
# After review, some texts were better as-is
# Rerun specific records with skip_restructure=true
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "record_ids": [5, 8, 12, 19],
  "skip_restructure": true,
  "force_rerun": true
}
```

### 3. **Fix Language Detection Errors**
```bash
# Some languages were misdetected
# Rerun Stage 1 for those specific records
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "record_ids": [3, 7, 14],
  "force_rerun": true
}
```

### 4. **Regenerate Questions for Quality**
```bash
# Some questions weren't good enough
# Rerun to get new variations
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": [10, 11, 12, 13],
  "force_rerun": true
}
```

---

## Important Notes

### 1. **Data Overwrite**
When you rerun a stage, the previous results for that stage are **overwritten**:
- Stage 1: New BR detection, confidence, languages
- Stage 2: New restructured text, metadata
- Stage 3: New set of 3 questions

**⚠️ Warning:** Previous results are not backed up. If you need to compare, export data before rerunning.

### 2. **Downstream Stages Not Affected**
Rerunning a stage does **NOT** automatically rerun downstream stages:
- Rerunning Stage 1 doesn't rerun Stage 2 or 3
- Rerunning Stage 2 doesn't rerun Stage 3

If you want to rerun multiple stages, do them explicitly:
```bash
# Rerun Stage 2, then Stage 3
POST /api/br-pipeline/run-stage2 {...}
POST /api/br-pipeline/run-stage3 {...}
```

### 3. **Stage Order Still Matters**
You cannot rerun Stage 2 if Stage 1 hasn't been completed:
- Stage 2 requires Stage 1 to be completed first
- Stage 3 requires Stage 2 to be completed first

### 4. **Human Validation Not Affected**
Rerunning Stage 3 (questions) does **NOT** reset human validation:
- If you already selected a question, the selection remains
- You can re-validate if needed through the validation endpoint

---

## Response Format

All rerun operations return the same response format:

```json
{
  "pipeline_run_id": 1,
  "stage": "Stage 1: BR Detection + Language Detection",
  "records_processed": 50,
  "message": "Successfully processed (rerun) 50 records"
}
```

Notice the **(rerun)** indicator in the message when `force_rerun: true`.

---

## API Reference

### Stage 1
```
POST /api/br-pipeline/run-stage1
```

**Request Body:**
```typescript
{
  pipeline_run_id: number,
  record_ids?: number[],    // Optional: specific records
  force_rerun?: boolean     // Optional: default false
}
```

### Stage 2
```
POST /api/br-pipeline/run-stage2
```

**Request Body:**
```typescript
{
  pipeline_run_id: number,
  skip_restructure: boolean,  // Required
  record_ids?: number[],      // Optional: specific records
  force_rerun?: boolean       // Optional: default false
}
```

### Stage 3
```
POST /api/br-pipeline/run-stage3
```

**Request Body:**
```typescript
{
  pipeline_run_id: number,
  record_ids?: number[],    // Optional: specific records
  force_rerun?: boolean     // Optional: default false
}
```

---

## Best Practices

### 1. **Review Before Rerun**
Always review current results before deciding to rerun:
```bash
GET /api/br-pipeline/classification/{pipeline_run_id}  # Stage 1
GET /api/br-pipeline/restructure/{pipeline_run_id}     # Stage 2
GET /api/br-pipeline/questions/{pipeline_run_id}       # Stage 3
```

### 2. **Rerun Specific Records First**
Instead of rerunning everything, target problematic records:
```bash
# Better: Rerun only the 5 records with issues
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": [10, 15, 20, 25, 30],
  "force_rerun": true
}

# Avoid: Rerun all 1000 records unnecessarily
# (unless you really need to)
```

### 3. **Test with Small Batch**
When experimenting with new settings, test on a small subset:
```bash
# Test skip_restructure=true on 5 records first
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "record_ids": [1, 2, 3, 4, 5],
  "skip_restructure": true,
  "force_rerun": true
}

# Review results, then apply to all if satisfied
```

### 4. **Export Before Major Reruns**
If rerunning many records, export current results first:
```bash
GET /api/br-pipeline/results/{pipeline_run_id}
# Save the response
```

---

## Troubleshooting

### "No records processed"
**Cause:** No records match the criteria.

**Solutions:**
- Check if the pipeline has records
- Verify records have completed previous stages
- If rerunning specific record_ids, confirm they exist

### "Ollama service not available"
**Cause:** Ollama not running.

**Solution:**
```bash
ollama serve
ollama pull gemma3:4b
```

### "Stage X requires Stage Y to be completed"
**Cause:** Trying to rerun a stage when prerequisite stage isn't done.

**Solution:**
Run prerequisite stages first:
```bash
# To rerun Stage 3, ensure Stage 2 is done
POST /api/br-pipeline/run-stage2 {...}
POST /api/br-pipeline/run-stage3 {...}
```

---

## Examples

### Complete Rerun Workflow

```bash
# Scenario: Initial run had issues, rerunning everything with new settings

# 1. Rerun Stage 1 (maybe model improved)
POST /api/br-pipeline/run-stage1
{
  "pipeline_run_id": 1,
  "force_rerun": true
}

# 2. Rerun Stage 2 with different setting
POST /api/br-pipeline/run-stage2
{
  "pipeline_run_id": 1,
  "skip_restructure": true,  # Changed from false to true
  "force_rerun": true
}

# 3. Rerun Stage 3 (new questions based on updated Stage 2)
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "force_rerun": true
}
```

### Selective Rerun

```bash
# Scenario: Only 10 out of 100 records need regeneration

# Rerun just those 10 records
POST /api/br-pipeline/run-stage3
{
  "pipeline_run_id": 1,
  "record_ids": [5, 12, 23, 34, 45, 56, 67, 78, 89, 90],
  "force_rerun": true
}
```

---

## Summary

✅ **Added:** `force_rerun` parameter to all three stages  
✅ **Benefit:** Reprocess records even if already completed  
✅ **Use Cases:** Retry errors, try new settings, update with improved model  
✅ **Safety:** Downstream stages not auto-affected  
⚠️ **Warning:** Previous results are overwritten

---

**Happy Rerunning! 🔄**
