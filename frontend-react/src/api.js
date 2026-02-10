import axios from 'axios'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// Stats
export const getStats = () => api.get('/stats')

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

export const exportASRDataset = (datasetId, format = 'csv') => {
  return api.get(`/asr/datasets/${datasetId}/export?format=${format}`, {
    responseType: 'blob'
  })
}

// Audio Files
export const getAudioFiles = (datasetId, status = null, limit = 50, offset = 0) => {
  const params = new URLSearchParams({ limit, offset })
  if (status) params.append('status', status)
  return api.get(`/asr/datasets/${datasetId}/files?${params}`)
}

export const getAudioFile = (id) => api.get(`/asr/files/${id}`)
export const getAudioUrl = (id) => `${API_BASE}/asr/files/${id}/audio`
export const transcribeAudio = (id, useCelery = false) => 
  api.post(`/asr/files/${id}/transcribe?use_celery=${useCelery}`)
export const retranscribeAudio = (id, useCelery = false) => 
  api.post(`/asr/files/${id}/retranscribe?use_celery=${useCelery}`)
export const deleteAudioFile = (id) => api.delete(`/asr/files/${id}`)
export const annotateTranscript = (id, transcript, annotator = 'anonymous') =>
  api.post(`/asr/files/${id}/annotate?annotator=${annotator}`, {
    corrected_transcript: transcript
  })
export const updateFileStatus = (id, status) => api.post(`/asr/files/${id}/status?status=${status}`)

// Batch Transcription (synchronous by default, use_celery=true requires Redis)
export const batchTranscribe = (datasetId, fileIds = null, useCelery = false) => {
  const params = new URLSearchParams({ use_celery: useCelery })
  if (fileIds) params.append('file_ids', fileIds.join(','))
  return api.post(`/asr/datasets/${datasetId}/transcribe-all?${params}`)
}

// Audio Segmentation
export const segmentAudioFile = (fileId, chunkLength = 30, useCelery = false, useVad = true) => {
  return api.post(`/asr/files/${fileId}/segment?chunk_length=${chunkLength}&use_celery=${useCelery}&use_vad=${useVad}`)
}

export const segmentAllFiles = (datasetId, chunkLength = 30, useCelery = true, useVad = true) => {
  return api.post(`/asr/datasets/${datasetId}/segment-all?chunk_length=${chunkLength}&use_celery=${useCelery}&use_vad=${useVad}`)
}

// YouTube Import
export const importYoutubeAudio = (datasetId, youtubeUrl, autoSegment = true, chunkLength = 30, autoTranscribe = false, useVad = true) => {
  const params = new URLSearchParams({
    youtube_url: youtubeUrl,
    auto_segment: autoSegment,
    chunk_length: chunkLength,
    auto_transcribe: autoTranscribe,
    use_vad: useVad
  })
  return api.post(`/asr/datasets/${datasetId}/youtube?${params}`)
}

// Task Status (Celery)
export const getTaskStatus = (taskId) => api.get(`/tasks/${taskId}/status`)


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

// Get classification records with pagination
export const getBRClassificationRecords = (pipelineId, page = 1, perPage = 15) =>
  api.get(`/br-pipeline/classification/${pipelineId}?page=${page}&per_page=${perPage}`)

// Update classification (is_bahasa_rojak and/or detected_language)
export const updateBRClassification = (recordStageId, data) =>
  api.patch(`/br-pipeline/classification/${recordStageId}`, data)

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

export default api
