import axios from 'axios'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Datasets
export const getDatasets = () => api.get('/datasets')
export const createDataset = (data) => api.post('/datasets', data)
export const deleteDataset = (id) => api.delete(`/datasets/${id}`)
export const uploadDataFile = (datasetId, file, autoConvert = true) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/datasets/${datasetId}/upload?auto_convert=${autoConvert}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// Records
export const getRecords = (datasetId, limit = 50) => 
  api.get(`/datasets/${datasetId}/records`, { params: { limit } })
export const getRecord = (id) => api.get(`/records/${id}`)
export const updateRecord = (id, data) => api.put(`/records/${id}`, data)
export const deleteRecord = (id) => api.delete(`/records/${id}`)

// Pipeline
export const runPipeline = (datasetId) => api.post('/pipeline/run', { dataset_id: datasetId })
export const getPipelineRuns = (status = null, limit = 50) => 
  api.get('/pipeline/runs', { params: { status, limit } })

// Validation / Human Review
export const getPendingReviews = (limit = 50) => api.get('/validation/pending', { params: { limit } })
export const submitReview = (validationId, data) => api.post(`/validation/${validationId}/review`, data)

// Stats
export const getStats = () => api.get('/stats')

export default api
