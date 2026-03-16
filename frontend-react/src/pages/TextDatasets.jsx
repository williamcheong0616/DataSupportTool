import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  getTextDatasets,
  createTextDataset,
  deleteTextDataset,
  uploadTextData,
  exportTextDataset,
  startBRPipeline,
  listBRPipelines,
} from '../api'

const TASK_TYPES = [
  { value: 'general', label: 'General (For BR Pipeline)' },
  { value: 'bahasa_rojak_identification', label: 'Bahasa Rojak Identification (Yes/No)' },
  { value: 'bahasa_rojak_classification', label: 'Bahasa Rojak Classification' },
  { value: 'text_modification', label: 'Text Modification (Subject/Context)' },
  { value: 'question_generation', label: 'Question Generation (3 Questions)' },
]

const PIPELINE_STAGES = [
  { num: 1, key: 'stage_1', path: 'classification', label: 'Classification', icon: '🏷️' },
  { num: 2, key: 'stage_2', path: 'restructure', label: 'Restructure', icon: '📝' },
  { num: 3, key: 'stage_3', path: 'questions', label: 'Questions', icon: '❓' },
  { num: 4, key: 'stage_4', path: 'responses', label: 'Responses', icon: '💬' },
]

function TextDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showUpload, setShowUpload] = useState(null)
  const [newDataset, setNewDataset] = useState({ name: '', task_type: 'general', created_by: localStorage.getItem('dst_username') || '' })
  const [uploadFile, setUploadFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [selectedColumn, setSelectedColumn] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pipelines, setPipelines] = useState({}) // Map of dataset_id -> pipeline info
  const [pipelineList, setPipelineList] = useState([]) // Full list for sidebar
  const [startingPipeline, setStartingPipeline] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    fetchDatasets()
    fetchPipelines()
  }, [])

  const fetchDatasets = async () => {
    try {
      const res = await getTextDatasets()
      setDatasets(res.data)
    } catch (err) {
      console.error('Failed to fetch datasets:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPipelines = async () => {
    try {
      const res = await listBRPipelines()
      // Store full list for sidebar
      setPipelineList(res.data.pipelines || [])
      // Create a map of dataset_id -> latest pipeline
      const pipelineMap = {}
      res.data.pipelines.forEach(p => {
        if (!pipelineMap[p.dataset_id] || p.id > pipelineMap[p.dataset_id].id) {
          pipelineMap[p.dataset_id] = p
        }
      })
      setPipelines(pipelineMap)
    } catch (err) {
      console.error('Failed to fetch pipelines:', err)
    }
  }

  const handleStartPipeline = async (datasetId) => {
    if (!confirm('Start BR Pipeline Stage 1 (BR Detection + Language Detection)?\n\nNote: This only runs Stage 1. Use the rerun buttons in the BR Classification page to manually run Stages 2 & 3 when ready.')) return
    setStartingPipeline(datasetId)
    try {
      const res = await startBRPipeline(datasetId)
      alert(`✓ Pipeline #${res.data.id} - Stage 1 started!\n\n${res.data.total_records} records will be processed for BR Detection + Language Detection.\n\nAfter Stage 1 completes, use the rerun buttons to manually run Stages 2 & 3.`)
      fetchPipelines()
      // Navigate to classification page
      navigate(`/br-pipeline/classification/${res.data.id}`)
    } catch (err) {
      alert('Failed to start pipeline: ' + (err.response?.data?.detail || err.message))
    } finally {
      setStartingPipeline(null)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createTextDataset(newDataset)
      if (newDataset.created_by) localStorage.setItem('dst_username', newDataset.created_by)
      setShowCreate(false)
      setNewDataset({ name: '', task_type: 'general', created_by: newDataset.created_by })
      fetchDatasets()
    } catch (err) {
      alert('Failed to create dataset: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this dataset?')) return
    try {
      await deleteTextDataset(id)
      fetchDatasets()
    } catch (err) {
      alert('Failed to delete dataset')
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    
    // Read headers from file
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target.result
      try {
        if (file.name.endsWith('.jsonl')) {
          const firstLine = content.split('\n').find(l => l.trim())
          if (firstLine) {
            const firstItem = JSON.parse(firstLine)
            setHeaders(Object.keys(firstItem))
          }
        } else if (file.name.endsWith('.json')) {
          const data = JSON.parse(content)
          const firstItem = Array.isArray(data) ? data[0] : data
          setHeaders(Object.keys(firstItem))
        } else if (file.name.endsWith('.csv')) {
          const lines = content.split('\n')
          if (lines.length > 0) {
            setHeaders(lines[0].split(',').map(h => h.trim().replace(/"/g, '')))
          }
        }
      } catch (err) {
        console.error('Failed to parse file headers:', err)
        setHeaders([])
      }
    }
    reader.readAsText(file)
  }

  const handleUpload = async () => {
    if (!uploadFile || !selectedColumn) {
      alert('Please select a file and choose the text column')
      return
    }
    
    setUploading(true)
    try {
      await uploadTextData(showUpload, uploadFile, selectedColumn)
      setShowUpload(null)
      setUploadFile(null)
      setHeaders([])
      setSelectedColumn('')
      fetchDatasets()
    } catch (err) {
      alert('Failed to upload: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
    }
  }

  const handleExport = async (id, format) => {
    try {
      const dataset = datasets.find(d => d.id === id)
      const datasetName = dataset?.name || 'dataset'
      const res = await exportTextDataset(id, format)
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().split('T')[0]
      const sanitizedName = datasetName.replace(/[^a-zA-Z0-9]/g, '_')
      a.download = `${sanitizedName}_${date}_export_text_annotations.${format === 'csv' ? 'csv' : 'jsonl'}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    }
  }

  const getTaskLabel = (taskType) => {
    return TASK_TYPES.find(t => t.value === taskType)?.label || taskType
  }

  // Helper to render stage progress bar
  const renderStageProgress = (pipeline) => {
    const currentStage = pipeline.current_stage_num || 1
    
    return (
      <div className="mt-2">
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>Stage {currentStage} of 4</span>
        </div>
        <div className="flex gap-1">
          {PIPELINE_STAGES.map((stage) => {
            const progress = pipeline.stage_progress?.[stage.key]
            const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0
            const isActive = stage.num === currentStage
            const isComplete = stage.num < currentStage || pct === 100
            
            return (
              <Link
                key={stage.key}
                to={`/br-pipeline/${stage.path}/${pipeline.id}`}
                className={`flex-1 group relative`}
                title={`${stage.label}: ${progress?.done || 0}/${progress?.total || 0}`}
              >
                <div className={`h-2 rounded-full overflow-hidden ${
                  isActive ? 'bg-amber-200 dark:bg-amber-900/40' : 
                  isComplete ? 'bg-green-200 dark:bg-green-900/40' : 
                  'bg-gray-200 dark:bg-gray-700'
                }`}>
                  <div 
                    className={`h-full transition-all ${
                      isComplete ? 'bg-green-500' : isActive ? 'bg-amber-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`block text-center mt-0.5 text-[10px] ${
                  isActive ? 'text-amber-600 dark:text-amber-400 font-medium' : 
                  isComplete ? 'text-green-600 dark:text-green-400' : 
                  'text-gray-400 dark:text-gray-500'
                } group-hover:underline`}>
                  {stage.icon}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Sidebar - BR Pipeline Progress */}
      <div className={`${sidebarCollapsed ? 'w-12' : 'w-72'} flex-shrink-0 transition-all duration-200`}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden sticky top-4">
          <div className="flex items-center justify-between p-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
            {!sidebarCollapsed && (
              <h3 className="font-semibold text-sm">🔄 BR Pipelines</h3>
            )}
            <button 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 hover:bg-white/20 rounded"
              title={sidebarCollapsed ? 'Expand' : 'Collapse'}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>
          </div>
          
          {!sidebarCollapsed && (
            <div className="max-h-[70vh] overflow-y-auto">
              {pipelineList.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 p-4">
                  No pipelines started yet. Start one from a dataset.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {pipelineList.map((pipeline) => (
                    <div key={pipeline.id} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {pipeline.dataset_name}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          #{pipeline.id}
                        </span>
                      </div>
                      {renderStageProgress(pipeline)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Text Datasets</h1>
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
            <button
              onClick={() => navigate('/text/response-pool')}
              className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition flex items-center gap-1"
              title="View all original texts and model responses across every dataset"
            >
              🔍 Response Pool
            </button>
          </div>
        </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4 dark:text-gray-100">Create Text Dataset</h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Dataset Name
                </label>
                <input
                  type="text"
                  value={newDataset.name}
                  onChange={(e) => setNewDataset({ ...newDataset, name: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Task Type
                </label>
                <select
                  value={newDataset.task_type}
                  onChange={(e) => setNewDataset({ ...newDataset, task_type: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                >
                  {TASK_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
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
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4 dark:text-gray-100">Upload Data File</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Select JSON, JSONL, or CSV File
              </label>
              <input
                type="file"
                accept=".json,.jsonl,.csv"
                onChange={handleFileSelect}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2"
              />
            </div>
            {headers.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Text Column
                </label>
                <select
                  value={selectedColumn}
                  onChange={(e) => setSelectedColumn(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Choose column --</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Detected columns: {headers.join(', ')}
                </p>
              </div>
            )}
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowUpload(null)
                  setUploadFile(null)
                  setHeaders([])
                  setSelectedColumn('')
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFile || !selectedColumn}
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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
          <p className="text-xl mb-4">No datasets yet</p>
          <p>Create a dataset and upload your JSON, JSONL, or CSV file to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {datasets
            .filter(d => !filterText || d.name.toLowerCase().includes(filterText.toLowerCase()))
            .map((dataset) => (
            <div key={dataset.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{dataset.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Task: {getTaskLabel(dataset.task_type)}
                  </p>
                  <div className="flex space-x-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <span>📝 {dataset.record_count || 0} records</span>
                    <span>✅ {dataset.annotated_count || 0} annotated</span>
                    {dataset.original_headers && (
                      <span>📊 Columns: {dataset.original_headers.join(', ')}</span>
                    )}
                  </div>
                  {/* Pipeline Status */}
                  {pipelines[dataset.id] && (
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        pipelines[dataset.id].status === 'completed' 
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                          : pipelines[dataset.id].status === 'running'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        Pipeline: {pipelines[dataset.id].status}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400">
                        ({pipelines[dataset.id].processed_records}/{pipelines[dataset.id].total_records} classified)
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex space-x-2">
                  {(!dataset.record_count || dataset.record_count === 0) ? (
                    <button
                      onClick={() => setShowUpload(dataset.id)}
                      className="px-3 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/60"
                    >
                      Upload Data
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => navigate(`/text/${dataset.id}/annotate`)}
                        className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/60"
                      >
                        Annotate
                      </button>
                      {/* BR Pipeline buttons */}
                      {pipelines[dataset.id] ? (
                        <button
                          onClick={() => navigate(`/br-pipeline/classification/${pipelines[dataset.id].id}`)}
                          className="px-3 py-1 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-200 dark:hover:bg-amber-900/60"
                        >
                          View Classification
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartPipeline(dataset.id)}
                          disabled={startingPipeline === dataset.id}
                          className="px-3 py-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-200 dark:hover:bg-orange-900/60 disabled:opacity-50"
                        >
                          {startingPipeline === dataset.id ? 'Starting...' : 'Start BR Pipeline'}
                        </button>
                      )}
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
          ))}
        </div>
      )}
      </div> {/* End Main Content */}
    </div>
  )
}

export default TextDatasets
