import React, { useState, useEffect } from 'react'
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
  downloadASRExport,
  pollTaskUntilDone
} from '../api'

function ASRDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newDataset, setNewDataset] = useState({ name: '', description: '', created_by: localStorage.getItem('dst_username') || '' })
  const [showUpload, setShowUpload] = useState(null)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [transcribing, setTranscribing] = useState({})
  const [segmenting, setSegmenting] = useState({})
  const [exporting, setExporting] = useState({})
  
  // YouTube import state
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeImporting, setYoutubeImporting] = useState(false)
  const [youtubeAutoSegment, setYoutubeAutoSegment] = useState(true)
  const [youtubeChunkLength, setYoutubeChunkLength] = useState(30)
  const [useVad, setUseVad] = useState(true) // true = Silero VAD, false = fixed-length
  const [minSpeechDuration, setMinSpeechDuration] = useState(500) // VAD min speech duration in ms
  const [minSilenceDuration, setMinSilenceDuration] = useState(300) // VAD min silence duration in ms
  const [filterText, setFilterText] = useState('')

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
      if (newDataset.created_by) localStorage.setItem('dst_username', newDataset.created_by)
      setShowCreate(false)
      setNewDataset({ name: '', description: '', created_by: newDataset.created_by })
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
        useVad,
        minSpeechDuration,
        minSilenceDuration
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
      const res = await batchTranscribe(datasetId)
      const result = res.data
      
      if (result.status === 'no_files' || result.files_processed === 0) {
        alert('No pending files to transcribe')
        setTranscribing({ ...transcribing, [datasetId]: false })
        return
      }
      
      if (result.status === 'queued' && result.task_id) {
        // Poll task status until complete
        const taskId = result.task_id
        const pendingCount = result.pending_count || 0
        
        let attempts = 0
        const maxAttempts = 600 // 10 minutes at 2s interval
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          attempts++
          
          try {
            const statusRes = await getTaskStatus(taskId)
            const taskStatus = statusRes.data
            
            if (taskStatus.status === 'SUCCESS') {
              const taskResult = taskStatus.result
              if (taskResult) {
                alert(`✅ Dual-engine transcription complete: ${taskResult.count || pendingCount} files processed with Whisper + Qwen3`)
              } else {
                alert(`✅ Batch transcription completed`)
              }
              break
            } else if (taskStatus.status === 'FAILURE') {
              alert(`❌ Transcription failed: ${taskStatus.error || 'Unknown error'}`)
              break
            }
            // Refresh dataset counts periodically
            if (attempts % 5 === 0) {
              fetchDatasets()
            }
          } catch (pollErr) {
            console.warn('Poll error:', pollErr)
          }
        }
        
        if (attempts >= maxAttempts) {
          alert('⏰ Transcription is still running in the background. Refresh the page to check progress.')
        }
      }
      
      fetchDatasets() // Final refresh
      
    } catch (err) {
      alert('Failed to transcribe: ' + (err.response?.data?.detail || err.message))
    } finally {
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

  const handleExport = async (id, format) => {
    setExporting({ ...exporting, [id]: true })
    try {
      const dataset = datasets.find(d => d.id === id)
      const datasetName = dataset?.name || 'asr_dataset'
      const initRes = await exportASRDataset(id, format, true) // asZip = true
      
      let taskId = initRes.data.task_id
      
      // Poll until background process finishes creating ZIP
      await pollTaskUntilDone(taskId, 2000, 300)
      
      // Fetch the actual ZIP file from the download endpoint
      const res = await downloadASRExport(taskId)
      
      const blob = new Blob([res.data], { type: 'application/zip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().split('T')[0]
      const sanitizedName = datasetName.replace(/[^a-zA-Z0-9]/g, '_')
      a.download = `${sanitizedName}_${date}_export_asr_${format}.zip`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExporting({ ...exporting, [id]: false })
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
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search datasets..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
          >
            + Create Dataset
          </button>
        </div>
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
                  value={newDataset.name}
                  onChange={(e) => setNewDataset({ ...newDataset, name: e.target.value })}
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
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={newDataset.created_by}
                  onChange={(e) => setNewDataset({ ...newDataset, created_by: e.target.value })}
                  placeholder="Enter your name"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  required
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
                  
                  {youtubeAutoSegment && useVad && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <label className="flex flex-col space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Min Speech Duration: {minSpeechDuration}ms</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Filter out very short segments</span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="2000"
                          step="100"
                          value={minSpeechDuration}
                          onChange={(e) => setMinSpeechDuration(Number(e.target.value))}
                          className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>100ms (more segments)</span>
                          <span>2000ms (fewer segments)</span>
                        </div>
                      </label>
                      <label className="flex flex-col space-y-2 mt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Min Silence Duration: {minSilenceDuration}ms</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Gap needed to split segments</span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="2000"
                          step="50"
                          value={minSilenceDuration}
                          onChange={(e) => setMinSilenceDuration(Number(e.target.value))}
                          className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>100ms (split on short pauses)</span>
                          <span>2000ms (merge across pauses)</span>
                        </div>
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
          {datasets
            .filter(d => !filterText || d.name.toLowerCase().includes(filterText.toLowerCase()))
            .map((dataset) => {
            const annotationProgress = dataset.file_count > 0 
              ? (dataset.completed_count / dataset.file_count) * 100 
              : 0
            
            const transcribedTotal = (dataset.transcribed_count || 0) + (dataset.completed_count || 0)
            const transcriptionProgress = dataset.file_count > 0 
              ? (transcribedTotal / dataset.file_count) * 100 
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
                      <span>🔄 {dataset.transcribed_count || 0} ready</span>
                      <span>✅ {dataset.completed_count || 0} annotated</span>
                    </div>
                    
                    {/* Progress Bars */}
                    {dataset.file_count > 0 && (
                      <div className="mt-3 space-y-2">
                        <div>
                          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <span>Transcription Progress</span>
                            <span>{transcriptionProgress.toFixed(0)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full transition-all"
                              style={{ width: `${transcriptionProgress}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <span>Annotation Progress</span>
                            <span>{annotationProgress.toFixed(0)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${annotationProgress}%` }}
                            ></div>
                          </div>
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
                    
                    <div className="flex space-x-2">
                      {dataset.file_count > 0 && (
                        <>
                          <button
                            onClick={() => handleExport(dataset.id, 'csv')}
                            disabled={exporting[dataset.id]}
                            className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50"
                            title="Download ZIP containing audio files and CSV transcriptions (Runs in background)"
                          >
                            {exporting[dataset.id] ? '⏳ Packing...' : '📦 Export CSV + Audio'}
                          </button>
                          <button
                            onClick={() => handleExport(dataset.id, 'jsonl')}
                            disabled={exporting[dataset.id]}
                            className="px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60 disabled:opacity-50"
                            title="Download ZIP containing audio files and JSONL transcriptions (Runs in background)"
                          >
                            {exporting[dataset.id] ? '⏳ Packing...' : '📦 Export JSONL + Audio'}
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
          <li>Click "🎤 Transcribe All" to run both Whisper and Qwen3 ASR on pending files (processes in background via Celery)</li>
          <li>Click "Annotate" to review and correct transcriptions</li>
          <li>Export results as a ZIP file (containing both audio segments and a CSV/JSONL file) when done</li>
        </ol>
      </div>
    </div>
  )
}

export default ASRDatasets
