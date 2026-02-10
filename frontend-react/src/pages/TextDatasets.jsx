import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getTextDatasets,
  createTextDataset,
  deleteTextDataset,
  uploadTextData,
  exportTextDataset,
} from '../api'

const TASK_TYPES = [
  { value: 'bahasa_rojak_identification', label: 'Bahasa Rojak Identification (Yes/No)' },
  { value: 'bahasa_rojak_classification', label: 'Bahasa Rojak Classification' },
  { value: 'text_modification', label: 'Text Modification (Subject/Context)' },
  { value: 'question_generation', label: 'Question Generation (3 Questions)' },
]

function TextDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showUpload, setShowUpload] = useState(null)
  const [newDataset, setNewDataset] = useState({ name: '', task_type: 'bahasa_rojak_identification' })
  const [uploadFile, setUploadFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [selectedColumn, setSelectedColumn] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetchDatasets()
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

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createTextDataset(newDataset)
      setShowCreate(false)
      setNewDataset({ name: '', task_type: 'bahasa_rojak_identification' })
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
        if (file.name.endsWith('.json')) {
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
      const res = await exportTextDataset(id, format)
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dataset_${id}.${format === 'csv' ? 'csv' : 'jsonl'}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    }
  }

  const getTaskLabel = (taskType) => {
    return TASK_TYPES.find(t => t.value === taskType)?.label || taskType
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Text Datasets</h1>
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
                Select JSON or CSV File
              </label>
              <input
                type="file"
                accept=".json,.csv"
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
          <p>Create a dataset and upload your JSON or CSV file to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {datasets.map((dataset) => (
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
    </div>
  )
}

export default TextDatasets
