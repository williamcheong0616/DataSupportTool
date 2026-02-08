import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getASRDatasets,
  createASRDataset,
  deleteASRDataset,
  uploadAudioFiles,
  exportASRDataset,
  getAudioFiles,
  transcribeAudio,
  batchTranscribe,
  getTaskStatus,
} from '../api'

function ASRDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newDataset, setNewDataset] = useState({ name: '', description: '' })
  const [showUpload, setShowUpload] = useState(null)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [transcribing, setTranscribing] = useState({})
  const [taskStatus, setTaskStatus] = useState({}) // { datasetId: { taskId, status, progress } }

  useEffect(() => {
    fetchDatasets()
  }, [])

  const fetchDatasets = async () => {
    try {
      const res = await getASRDatasets()
      setDatasets(res.data)
    } catch (err) {
      console.error('Failed to fetch datasets:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createASRDataset(newDataset)
      setShowCreate(false)
      setNewDataset({ name: '', description: '' })
      fetchDatasets()
    } catch (err) {
      alert('Failed to create dataset: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this dataset and all audio files?')) return
    try {
      await deleteASRDataset(id)
      fetchDatasets()
    } catch (err) {
      alert('Failed to delete dataset')
    }
  }

  const handleUpload = async () => {
    if (!uploadFiles.length) {
      alert('Please select audio files')
      return
    }

    setUploading(true)
    try {
      await uploadAudioFiles(showUpload, Array.from(uploadFiles))
      setShowUpload(null)
      setUploadFiles([])
      fetchDatasets()
    } catch (err) {
      alert('Failed to upload: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
    }
  }

  const handleTranscribeAll = async (datasetId) => {
    setTranscribing({ ...transcribing, [datasetId]: true })
    try {
      // Use Celery batch transcription
      const res = await batchTranscribe(datasetId)
      const taskId = res.data.task_id
      
      setTaskStatus(prev => ({
        ...prev,
        [datasetId]: { taskId, status: 'PENDING', message: res.data.message }
      }))
      
      // Poll for task status
      pollTaskStatus(datasetId, taskId)
      
    } catch (err) {
      alert('Failed to start transcription: ' + (err.response?.data?.detail || err.message))
      setTranscribing({ ...transcribing, [datasetId]: false })
    }
  }

  const pollTaskStatus = useCallback(async (datasetId, taskId) => {
    const checkStatus = async () => {
      try {
        const res = await getTaskStatus(taskId)
        const { status, ready, result } = res.data
        
        setTaskStatus(prev => ({
          ...prev,
          [datasetId]: { 
            taskId, 
            status, 
            ready,
            result,
            message: result?.message || `Status: ${status}`
          }
        }))
        
        if (ready) {
          // Task completed
          setTranscribing(prev => ({ ...prev, [datasetId]: false }))
          fetchDatasets() // Refresh to show updated counts
          
          if (result?.status === 'queued') {
            // Batch task queued individual tasks, keep polling for a bit
            setTimeout(() => {
              fetchDatasets()
            }, 5000)
          }
        } else {
          // Keep polling
          setTimeout(checkStatus, 2000)
        }
      } catch (err) {
        console.error('Failed to check task status:', err)
        setTranscribing(prev => ({ ...prev, [datasetId]: false }))
      }
    }
    
    checkStatus()
  }, [])

  const handleExport = async (id, format) => {
    try {
      const res = await exportASRDataset(id, format)
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `asr_dataset_${id}.${format === 'csv' ? 'csv' : 'jsonl'}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">ASR Datasets</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
        >
          + Create Dataset
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Create ASR Dataset</h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dataset Name
                </label>
                <input
                  type="text"
                  value={newDataset.name}
                  onChange={(e) => setNewDataset({ ...newDataset, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newDataset.description}
                  onChange={(e) => setNewDataset({ ...newDataset, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Upload Audio Files</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Audio Files (MP3, WAV, etc.)
              </label>
              <input
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => setUploadFiles(e.target.files)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              {uploadFiles.length > 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  {uploadFiles.length} file(s) selected
                </p>
              )}
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowUpload(null)
                  setUploadFiles([])
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFiles.length}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dataset List */}
      {datasets.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          <p className="text-xl mb-4">No ASR datasets yet</p>
          <p>Create a dataset and upload audio files to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {datasets.map((dataset) => {
            const progress = dataset.file_count > 0 
              ? (dataset.completed_count / dataset.file_count) * 100 
              : 0

            return (
              <div key={dataset.id} className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900">{dataset.name}</h3>
                    {dataset.description && (
                      <p className="text-gray-500 mt-1">{dataset.description}</p>
                    )}
                    <div className="flex space-x-4 mt-2 text-sm text-gray-600">
                      <span>🎵 {dataset.file_count || 0} files</span>
                      <span>⏳ {dataset.pending_count || 0} pending</span>
                      <span>✅ {dataset.completed_count || 0} completed</span>
                    </div>
                    
                    {/* Progress Bar */}
                    {dataset.file_count > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Progress</span>
                          <span>{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col space-y-2 ml-4">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setShowUpload(dataset.id)}
                        className="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                      >
                        Upload Audio
                      </button>
                      {dataset.file_count > 0 && (
                        <>
                          <button
                            onClick={() => handleTranscribeAll(dataset.id)}
                            disabled={transcribing[dataset.id]}
                            className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 disabled:opacity-50"
                          >
                            {transcribing[dataset.id] ? '⏳ Processing...' : '🎤 Transcribe All'}
                          </button>
                          <button
                            onClick={() => navigate(`/asr/${dataset.id}/annotate`)}
                            className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                          >
                            Annotate
                          </button>
                        </>
                      )}
                    </div>
                    
                    {/* Task Status */}
                    {taskStatus[dataset.id] && (
                      <div className={`text-xs px-2 py-1 rounded ${
                        taskStatus[dataset.id].status === 'SUCCESS' 
                          ? 'bg-green-50 text-green-700'
                          : taskStatus[dataset.id].status === 'FAILURE'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-yellow-50 text-yellow-700'
                      }`}>
                        <span className="font-medium">Task: </span>
                        {taskStatus[dataset.id].message || taskStatus[dataset.id].status}
                        {taskStatus[dataset.id].result?.count && (
                          <span className="ml-2">
                            ({taskStatus[dataset.id].result.count} files queued)
                          </span>
                        )}
                      </div>
                    )}
                    
                    <div className="flex space-x-2">
                      {dataset.file_count > 0 && (
                        <>
                          <button
                            onClick={() => handleExport(dataset.id, 'csv')}
                            className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            CSV
                          </button>
                          <button
                            onClick={() => handleExport(dataset.id, 'jsonl')}
                            className="px-3 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                          >
                            JSONL
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(dataset.id)}
                        className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4 text-blue-800">
        <h3 className="font-semibold mb-2">💡 How ASR Annotation Works</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Create a dataset and upload audio files in batch</li>
          <li>Click "Transcribe All" to run Whisper v2 on pending files</li>
          <li>Click "Annotate" to review and correct transcriptions</li>
          <li>Export results as CSV or JSONL when done</li>
        </ol>
      </div>
    </div>
  )
}

export default ASRDatasets
