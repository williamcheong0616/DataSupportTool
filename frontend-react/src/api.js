import axios from 'axios'
import { RequestLogger } from './utils/logger'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// ==================== REQUEST/RESPONSE INTERCEPTORS ====================

/**
 * Request interceptor - logs all outgoing requests
 */
api.interceptors.request.use(
  (config) => {
    // Create request logger and store in config for use in response
    const operation = `${config.method.toUpperCase()} ${config.url}`
    const requestLogger = new RequestLogger(operation, {
      params: config.params,
      data: config.data,
    })
    
    // Start logging
    requestLogger.start()
    
    // Store logger in config for response interceptor
    config.metadata = { startTime: Date.now(), requestLogger }
    
    return config
  },
  (error) => {
    // Log request setup errors
    const reqLogger = new RequestLogger('REQUEST_SETUP_ERROR')
    reqLogger.start()
    reqLogger.error(error)
    return Promise.reject(error)
  }
)

/**
 * Response interceptor - logs all responses and errors
 */
api.interceptors.response.use(
  (response) => {
    // Log successful response
    const { requestLogger } = response.config.metadata || {}
    if (requestLogger) {
      requestLogger.success(response, {
        status: response.status,
        request_id: response.headers['x-request-id'],
      })
    }
    return response
  },
  (error) => {
    // Log error response
    const { requestLogger } = error.config?.metadata || {}
    if (requestLogger) {
      requestLogger.error(error, {
        status: error.response?.status,
        message: error.response?.data?.detail || error.message,
        request_id: error.response?.headers['x-request-id'],
      })
    }
    return Promise.reject(error)
  }
)

// =============================================================================

// Stats
export const getStats = () => api.get('/stats')
export const getDatasetStats = () => api.get('/stats/datasets')

// === TEXT ANNOTATION ===

// Text Datasets
export const getTextDatasets = () => api.get('/text/datasets')
export const createTextDataset = (data) => api.post('/text/datasets', data)
export const getTextDataset = (id) => api.get(`/text/datasets/${id}`)
export const updateTextDataset = (id, data) => api.put(`/text/datasets/${id}`, data)
export const deleteTextDataset = (id) => api.delete(`/text/datasets/${id}`)

export const uploadTextData = (datasetId, file, textColumn = null) => {
  const formData = new FormData()
  formData.append('file', file)
  const params = textColumn ? `?text_column=${textColumn}` : ''
  return api.post(`/text/datasets/${datasetId}/upload${params}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const exportTextDataset = (datasetId, format = 'csv') => {
  return api.get(`/text/datasets/${datasetId}/export?format=${format}`, {
    responseType: 'blob'
  })
}

// Text Records
export const getTextRecords = (datasetId, annotated = null, limit = 50, offset = 0) => {
  const params = new URLSearchParams({ limit, offset })
  if (annotated !== null) params.append('annotated', annotated)
  return api.get(`/text/datasets/${datasetId}/records?${params}`)
}

export const getTextRecord = (id) => api.get(`/text/records/${id}`)
export const deleteTextRecord = (id) => api.delete(`/text/records/${id}`)

export const getResponsePool = (q = '', limit = 100, offset = 0) => {
  const params = new URLSearchParams({ limit, offset })
  if (q) params.append('q', q)
  return api.get(`/text/response-pool?${params}`)
}

// Annotations
export const annotateBahasaRojak = (recordId, isBahasaRojak, annotator = 'anonymous') =>
  api.post(`/text/records/${recordId}/annotate/bahasa-rojak?annotator=${annotator}`, {
    is_bahasa_rojak: isBahasaRojak
  })

export const annotateClassification = (recordId, label, annotator = 'anonymous') =>
  api.post(`/text/records/${recordId}/annotate/classification?annotator=${annotator}`, {
    classification_label: label
  })

export const annotateModification = (recordId, data, annotator = 'anonymous') =>
  api.post(`/text/records/${recordId}/annotate/modification?annotator=${annotator}`, data)

export const annotateQuestions = (recordId, questions, annotator = 'anonymous') =>
  api.post(`/text/records/${recordId}/annotate/questions?annotator=${annotator}`, questions)


// === ASR ANNOTATION ===

// ASR Datasets
export const getASRDatasets = () => api.get('/asr/datasets')
export const createASRDataset = (data) => api.post('/asr/datasets', data)
export const deleteASRDataset = (id) => api.delete(`/asr/datasets/${id}`)

export const uploadAudioFiles = (datasetId, files) => {
  const formData = new FormData()
  files.forEach(file => formData.append('files', file))
  return api.post(`/asr/datasets/${datasetId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const exportASRDataset = (datasetId, format = 'csv', asZip = true) => {
  return api.get(`/asr/datasets/${datasetId}/export?format=${format}&as_zip=${asZip}`, {
    responseType: asZip ? 'json' : 'blob'
  })
}

export const downloadASRExport = (taskId) => {
  return api.get(`/asr/exports/${taskId}/download`, {
    responseType: 'blob'
  })
}

// Audio Files
export const getAudioFiles = (datasetId, status = null, limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'asc') => {
  const params = new URLSearchParams({ limit, offset, sort_by: sortBy, sort_order: sortOrder })
  if (status) params.append('status', status)
  return api.get(`/asr/datasets/${datasetId}/files?${params}`)
}

export const getAudioFile = (id) => api.get(`/asr/files/${id}`)
export const getAudioUrl = (id) => `${API_BASE}/asr/files/${id}/audio`
// Transcription now always uses Celery background tasks
export const transcribeAudio = (id, engine = 'whisper') => 
  api.post(`/asr/files/${id}/transcribe?engine=${engine}`)
export const retranscribeAudio = (id, engine = 'whisper') => 
  api.post(`/asr/files/${id}/retranscribe?engine=${engine}`)
export const deleteAudioFile = (id) => api.delete(`/asr/files/${id}`)
export const fuseAudioFiles = (fileIds, outputFilename = null) => {
  const params = new URLSearchParams()
  fileIds.forEach(id => params.append('file_ids', id))
  if (outputFilename) params.append('output_filename', outputFilename)
  return api.post(`/asr/files/fuse?${params}`)
}
export const annotateTranscript = (id, transcript, annotator = 'anonymous') =>
  api.post(`/asr/files/${id}/annotate?annotator=${annotator}`, {
    corrected_transcript: transcript
  })
export const updateFileStatus = (id, status) => api.post(`/asr/files/${id}/status?status=${status}`)

// Batch Transcription - runs BOTH Whisper + Qwen3 via Celery background tasks
export const batchTranscribe = (datasetId, fileIds = null) => {
  const params = new URLSearchParams()
  if (fileIds && fileIds.length > 0) {
    fileIds.forEach(id => params.append('file_ids', id))
  }
  const queryString = params.toString()
  return api.post(`/asr/datasets/${datasetId}/transcribe-all${queryString ? '?' + queryString : ''}`)
}

// Audio Segmentation
export const segmentAudioFile = (fileId, chunkLength = 30, useCelery = false, useVad = true) => {
  return api.post(`/asr/files/${fileId}/segment?chunk_length=${chunkLength}&use_celery=${useCelery}&use_vad=${useVad}`)
}

export const segmentAllFiles = (datasetId, chunkLength = 30, useCelery = true, useVad = true) => {
  return api.post(`/asr/datasets/${datasetId}/segment-all?chunk_length=${chunkLength}&use_celery=${useCelery}&use_vad=${useVad}`)
}

// YouTube Import
export const importYoutubeAudio = (datasetId, youtubeUrl, autoSegment = true, chunkLength = 30, autoTranscribe = false, useVad = true, minSpeechDuration = 500, minSilenceDuration = 300) => {
  const params = new URLSearchParams({
    youtube_url: youtubeUrl,
    auto_segment: autoSegment,
    chunk_length: chunkLength,
    auto_transcribe: autoTranscribe,
    use_vad: useVad,
    min_speech_duration_ms: minSpeechDuration,
    min_silence_duration_ms: minSilenceDuration
  })
  return api.post(`/asr/datasets/${datasetId}/youtube?${params}`)
}

// Task Status (Celery) - uses ASR router prefix
export const getTaskStatus = (taskId) => api.get(`/asr/tasks/${taskId}/status`)

// Poll a Celery task until completion - returns final result
export const pollTaskUntilDone = async (taskId, intervalMs = 2000, maxAttempts = 300) => {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await getTaskStatus(taskId)
    const { status, result, error } = res.data
    if (status === 'SUCCESS') return result
    if (status === 'FAILURE') throw new Error(error || 'Task failed')
    // Keep polling for PENDING, STARTED, RETRY
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error('Task polling timed out')
}


// === BR PIPELINE ===

// Start BR Pipeline
export const startBRPipeline = (datasetId) => 
  api.post('/br-pipeline/start', { dataset_id: datasetId })

// Get pipeline status
export const getBRPipelineStatus = (pipelineId) => 
  api.get(`/br-pipeline/status/${pipelineId}`)

// List all pipelines (optionally by dataset)
export const listBRPipelines = (datasetId = null) => {
  const params = datasetId ? `?dataset_id=${datasetId}` : ''
  return api.get(`/br-pipeline/pipelines${params}`)
}

// Get classification records with pagination and optional filter
export const getBRClassificationRecords = (pipelineId, page = 1, perPage = 15, isBahasaRojak = null) => {
  const params = new URLSearchParams({ page, per_page: perPage })
  if (isBahasaRojak !== null) params.append('is_bahasa_rojak', isBahasaRojak)
  return api.get(`/br-pipeline/classification/${pipelineId}?${params}`)
}

// Update classification (is_bahasa_rojak and/or detected_language)
export const updateBRClassification = (recordStageId, data) =>
  api.patch(`/br-pipeline/classification/${recordStageId}`, data)

// Delete a classification record
export const deleteBRClassificationRecord = (recordStageId) =>
  api.delete(`/br-pipeline/classification/${recordStageId}`)

// Get pending validation records
export const getBRPendingValidation = (pipelineId = null) => {
  const params = pipelineId ? `?pipeline_run_id=${pipelineId}` : ''
  return api.get(`/br-pipeline/pending-validation${params}`)
}

// Submit question validation
export const validateBRQuestion = (recordStageId, questionIndex, validatedBy) =>
  api.post(`/br-pipeline/validate/${recordStageId}`, {
    question_index: questionIndex,
    validated_by: validatedBy
  })

// Get pipeline results
export const getBRPipelineResults = (pipelineId) =>
  api.get(`/br-pipeline/results/${pipelineId}`)

// Run individual stages
export const runBRStage1 = (pipelineId, recordIds = null, forceRerun = false) =>
  api.post('/br-pipeline/run-stage1', {
    pipeline_run_id: pipelineId,
    record_ids: recordIds,
    force_rerun: forceRerun
  })

export const runBRStage2 = (pipelineId, skipRestructure = false, recordIds = null, forceRerun = false) =>
  api.post('/br-pipeline/run-stage2', {
    pipeline_run_id: pipelineId,
    skip_restructure: skipRestructure,
    record_ids: recordIds,
    force_rerun: forceRerun
  })

export const runBRStage3 = (pipelineId, recordIds = null, forceRerun = false) =>
  api.post('/br-pipeline/run-stage3', {
    pipeline_run_id: pipelineId,
    record_ids: recordIds,
    force_rerun: forceRerun
  })

// Merge/concatenate records
export const mergeBRRecords = (recordIds, separator = ' ') =>
  api.post('/br-pipeline/restructure/merge', {
    record_ids: recordIds,
    separator: separator
  })

// Get stage progress (for polling)
export const getBRStageProgress = (pipelineId) =>
  api.get(`/br-pipeline/stage-progress/${pipelineId}`)

// Restructure records
export const getBRRestructureRecords = (pipelineId, page = 1, perPage = 10, status = 'all') =>
  api.get(`/br-pipeline/restructure/${pipelineId}?page=${page}&per_page=${perPage}&status=${status}`)

export const updateBRRestructure = (recordId, data) =>
  api.patch(`/br-pipeline/restructure/${recordId}`, data)

export const autoRestructureBR = (recordId) =>
  api.post(`/br-pipeline/restructure/${recordId}/auto`)

// Question generation & selection
export const getBRQuestionRecords = (pipelineId, page = 1, perPage = 10, status = 'all') =>
  api.get(`/br-pipeline/questions/${pipelineId}?page=${page}&per_page=${perPage}&status=${status}`)

export const generateBRQuestionsBatch = (pipelineId) =>
  api.post(`/br-pipeline/questions/${pipelineId}/generate-all`)

export const generateBRQuestions = (recordId) =>
  api.post(`/br-pipeline/questions/${recordId}/generate`)

export const selectBRQuestion = (recordId, questionIndex, validatedBy) =>
  api.post(`/br-pipeline/questions/${recordId}/select`, {
    question_index: questionIndex,
    validated_by: validatedBy
  })

// Model responses
export const getBRResponseRecords = (pipelineId, page = 1, perPage = 10, status = 'all') =>
  api.get(`/br-pipeline/responses/${pipelineId}?page=${page}&per_page=${perPage}&status=${status}`)

export const generateBRResponse = (recordId, models = null) =>
  api.post(`/br-pipeline/responses/${recordId}/generate`, models ? { models } : null)

export const generateBRResponseBatch = (pipelineId, models) =>
  api.post(`/br-pipeline/responses/${pipelineId}/generate-all`, { models })

export const editBRResponseProblems = (recordId, modelName, problems, editedBy = 'annotator') =>
  api.post(`/br-pipeline/responses/${recordId}/edit-problems`, {
    model_name: modelName,
    problems,
    edited_by: editedBy
  })

// System Prompt
export const getSystemPrompt = (pipelineId) =>
  api.get(`/br-pipeline/system-prompt/${pipelineId}`)

export const updateSystemPrompt = (pipelineId, data) =>
  api.put(`/br-pipeline/system-prompt/${pipelineId}`, data)

// Search & Similarity
export const searchBRResponses = (pipelineId, query, page = 1, perPage = 10) =>
  api.get(`/br-pipeline/responses/${pipelineId}/search?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`)

export const getBRResponseSimilarity = (pipelineId, thresholdHigh = 0.85, thresholdLow = 0.15) =>
  api.get(`/br-pipeline/responses/${pipelineId}/similarity?threshold_high=${thresholdHigh}&threshold_low=${thresholdLow}`)

// Task status polling (for Celery background tasks)
export const getBRTaskStatus = (taskId) =>
  api.get(`/br-pipeline/task-status/${taskId}`)

/**
 * Poll a Celery task until it completes or fails.
 * @param {string} taskId - Celery task ID
 * @param {object} opts - { interval: ms between polls (default 2000), timeout: max ms (default 600000) }
 * @returns {Promise<object>} - The task result on success
 */
export async function pollBRTask(taskId, opts = {}) {
  const interval = opts.interval || 2000
  const timeout = opts.timeout || 600000  // 10 min max
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const res = await getBRTaskStatus(taskId)
    const { state, result, error } = res.data

    if (state === 'SUCCESS') {
      if (result && result.status === 'error') {
        throw new Error(result.message || 'Task returned an error')
      }
      return result
    }
    if (state === 'FAILURE') {
      throw new Error(error || 'Task failed')
    }
    // PENDING / STARTED / RETRY — keep polling
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error('Task timed out')
}


// === SETTINGS ===

export const getModelConfig = () => api.get('/settings/models')
export const updateModelConfig = (config) => api.put('/settings/models', config)
export const getOllamaModels = () => api.get('/settings/models/ollama/available')
export const pullOllamaModel = (modelName) =>
  api.post(`/settings/models/ollama/pull?model_name=${encodeURIComponent(modelName)}`)
export const getWhisperStatus = () => api.get('/settings/models/whisper/status')

export default api
