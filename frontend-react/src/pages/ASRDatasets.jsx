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
  segmentAllFiles,
  importYoutubeAudio,
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
  const [segmenting, setSegmenting] = useState({})
  const [taskStatus, setTaskStatus] = useState({}) // { datasetId: { taskId, status, progress } }
  
  // YouTube import state
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeImporting, setYoutubeImporting] = useState(false)
  const [youtubeAutoSegment, setYoutubeAutoSegment] = useState(true)
  const [youtubeChunkLength, setYoutubeChunkLength] = useState(30)
  const [useVad, setUseVad] = useState(true) // true = Silero VAD, false = fixed-length

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

  const handleYoutubeImport = async (datasetId) => {
    if (!youtubeUrl.trim()) {
      alert('Please enter a YouTube URL')
      return
    }

    setYoutubeImporting(true)
    try {
      const res = await importYoutubeAudio(
        datasetId,
        youtubeUrl,
        youtubeAutoSegment,
        youtubeChunkLength,
        false, // auto_transcribe
        useVad
      )
      
      const data = res.data
      if (data.chunks_created) {
        alert(`✅ Downloaded "${data.youtube_title}" and segmented into ${data.chunks_created} segments`)
      } else {
        alert(`✅ Downloaded "${data.youtube_title}" (${Math.round(data.youtube_duration)}s)`)
      }
      
      setYoutubeUrl('')
      setShowUpload(null)
      fetchDatasets()
    } catch (err) {
      alert('Failed to import: ' + (err.response?.data?.detail || err.message))
    } finally {
      setYoutubeImporting(false)
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

  const handleSegmentAll = async (datasetId, chunkLength = 30) => {
    setSegmenting({ ...segmenting, [datasetId]: true })
    try {
      // Use synchronous segmentation (Celery optional if Redis available)
      const res = await segmentAllFiles(datasetId, chunkLength, false)
      
      const result = res.data
      if (result.success_count > 0) {
        alert(`Segmented ${result.success_count} files into ${result.total_chunks_created} segments`)
      } else if (result.files_found === 0) {
        alert('No files to segment (files may already be segmented)')
      } else {
        alert('Segmentation completed with some errors. Check console for details.')
        console.log('Segmentation results:', result)
      }
      
      fetchDatasets() // Refresh to show new segment files
      
    } catch (err) {
      alert('Failed to segment files: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSegmenting({ ...segmenting, [datasetId]: false })
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">ASR Datasets</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
        >
          + Create Dataset
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4 dark:text-gray-100">Create ASR Dataset</h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Dataset Name
                </label>
                <input
                  type="text"
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newDataset.description}
                  onChange={(e) => setNewDataset({ ...newDataset, description: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-xl font-semibold mb-4 dark:text-gray-100">Add Audio to Dataset</h2>
            
            {/* Tab-like sections */}
            <div className="space-y-6">
              {/* Upload Files Section */}
              <div className="border dark:border-gray-600 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">📁 Upload Audio Files</h3>
                <div className="mb-3">
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={(e) => setUploadFiles(e.target.files)}
                    className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2"
                  />
                  {uploadFiles.length > 0 && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {uploadFiles.length} file(s) selected
                    </p>
                  )}
                </div>
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFiles.length}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload Files'}
                </button>
              </div>

              {/* YouTube Import Section */}
              <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">🎬 Import from YouTube</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2"
                  />
                  
                  <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={youtubeAutoSegment}
                        onChange={(e) => setYoutubeAutoSegment(e.target.checked)}
                        className="rounded text-red-600"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">Auto-segment</span>
                    </label>
                    
                    {youtubeAutoSegment && !useVad && (
                      <label className="flex items-center space-x-2">
                        <span className="text-sm text-gray-600 dark:text-gray-300">Segment length:</span>
                        <select
                          value={youtubeChunkLength}
                          onChange={(e) => setYoutubeChunkLength(Number(e.target.value))}
                          className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                        >
                          <option value={15}>15s</option>
                          <option value={30}>30s</option>
                          <option value={60}>60s</option>
                          <option value={120}>120s</option>
                        </select>
                      </label>
                    )}
                  </div>
                  
                  {youtubeAutoSegment && (
                    <div className="flex items-center space-x-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">Segmentation:</span>
                      <label className="flex items-center space-x-1">
                        <input
                          type="radio"
                          name="vadMode"
                          checked={useVad}
                          onChange={() => setUseVad(true)}
                          className="text-red-600"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-300">VAD (natural speech segments)</span>
                      </label>
                      <label className="flex items-center space-x-1">
                        <input
                          type="radio"
                          name="vadMode"
                          checked={!useVad}
                          onChange={() => setUseVad(false)}
                          className="text-red-600"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-300">Fixed-length (equal intervals)</span>
                      </label>
                    </div>
                  )}
                  
                  <button
                    onClick={() => handleYoutubeImport(showUpload)}
                    disabled={youtubeImporting || !youtubeUrl.trim()}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {youtubeImporting ? '⏳ Importing...' : '📥 Import from YouTube'}
                  </button>
                  
                  <p className="text-xs text-gray-500">
                    {useVad 
                      ? 'Downloads audio and segments into natural speech boundaries (preserves full conversations)'
                      : 'Downloads audio and cuts into equal fixed-length segments (keeps all audio including silence)'}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowUpload(null)
                  setUploadFiles([])
                  setYoutubeUrl('')
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dataset List */}
      {datasets.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
          <p className="text-xl mb-4">No ASR datasets yet</p>
          <p>Create a dataset and add audio files (upload or import from YouTube) to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {datasets.map((dataset) => {
            const progress = dataset.file_count > 0 
              ? (dataset.completed_count / dataset.file_count) * 100 
              : 0

            return (
              <div key={dataset.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{dataset.name}</h3>
                    {dataset.description && (
                      <p className="text-gray-500 dark:text-gray-400 mt-1">{dataset.description}</p>
                    )}
                    <div className="flex space-x-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
                      <span>🎵 {dataset.file_count || 0} files</span>
                      <span>⏳ {dataset.pending_count || 0} pending</span>
                      <span>✅ {dataset.completed_count || 0} completed</span>
                    </div>
                    
                    {/* Progress Bar */}
                    {dataset.file_count > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <span>Progress</span>
                          <span>{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
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
                        className="px-3 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/60"
                      >
                        ➕ Add Audio
                      </button>
                      {dataset.file_count > 0 && (
                        <>
                          <button
                            onClick={() => handleSegmentAll(dataset.id)}
                            disabled={segmenting[dataset.id]}
                            className="px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60 disabled:opacity-50"
                            title="Segment audio files using VAD (natural speech boundaries)"
                          >
                            {segmenting[dataset.id] ? '⏳ Segmenting...' : '✂️ Segment'}
                          </button>
                          <button
                            onClick={() => handleTranscribeAll(dataset.id)}
                            disabled={transcribing[dataset.id]}
                            className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/60 disabled:opacity-50"
                          >
                            {transcribing[dataset.id] ? '⏳ Processing...' : '🎤 Transcribe All'}
                          </button>
                          <button
                            onClick={() => navigate(`/asr/${dataset.id}/annotate`)}
                            className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/60"
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
                          ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : taskStatus[dataset.id].status === 'FAILURE'
                          ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          : 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
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
                            className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60"
                          >
                            CSV
                          </button>
                          <button
                            onClick={() => handleExport(dataset.id, 'jsonl')}
                            className="px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60"
                          >
                            JSONL
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(dataset.id)}
                        className="px-3 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/60"
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
      <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-blue-800 dark:text-blue-300 border dark:border-blue-800">
        <h3 className="font-semibold mb-2">💡 How ASR Annotation Works</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Create a dataset and add audio: upload files or <strong>import from YouTube</strong></li>
          <li><strong>Optional:</strong> Click "✂️ Segment" to split long audio into speech segments using VAD</li>
          <li>Click "🎤 Transcribe All" to run Whisper v2 on pending files</li>
          <li>Click "Annotate" to review and correct transcriptions</li>
          <li>Export results as CSV or JSONL when done</li>
        </ol>
      </div>
    </div>
  )
}

export default ASRDatasets
