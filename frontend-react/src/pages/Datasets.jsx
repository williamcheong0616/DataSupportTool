import { useState, useEffect } from 'react'
import { getDatasets, createDataset, deleteDataset, uploadDataFile, getRecords, updateRecord, deleteRecord } from '../api'
import { Plus, Upload, Trash2, Edit2, Save, X, ChevronDown, ChevronUp } from 'lucide-react'

function Datasets() {
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newDataset, setNewDataset] = useState({ name: '', description: '', source_type: 'upload' })
  const [expandedDataset, setExpandedDataset] = useState(null)
  const [records, setRecords] = useState({})
  const [editingRecord, setEditingRecord] = useState(null)
  const [editForm, setEditForm] = useState({})

  useEffect(() => {
    loadDatasets()
  }, [])

  const loadDatasets = async () => {
    try {
      const res = await getDatasets()
      setDatasets(res.data)
    } catch (error) {
      console.error('Failed to load datasets:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createDataset(newDataset)
      setNewDataset({ name: '', description: '', source_type: 'upload' })
      setShowCreate(false)
      loadDatasets()
    } catch (error) {
      console.error('Failed to create dataset:', error)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this dataset and all its records?')) return
    try {
      await deleteDataset(id)
      loadDatasets()
    } catch (error) {
      console.error('Failed to delete dataset:', error)
    }
  }

  const handleUpload = async (datasetId, file) => {
    try {
      await uploadDataFile(datasetId, file, true)
      loadDatasets()
      if (expandedDataset === datasetId) {
        loadRecords(datasetId)
      }
    } catch (error) {
      console.error('Failed to upload file:', error)
      alert('Upload failed: ' + (error.response?.data?.detail || error.message))
    }
  }

  const loadRecords = async (datasetId) => {
    try {
      const res = await getRecords(datasetId, 100)
      setRecords({ ...records, [datasetId]: res.data })
    } catch (error) {
      console.error('Failed to load records:', error)
    }
  }

  const toggleExpand = (datasetId) => {
    if (expandedDataset === datasetId) {
      setExpandedDataset(null)
    } else {
      setExpandedDataset(datasetId)
      if (!records[datasetId]) {
        loadRecords(datasetId)
      }
    }
  }

  const startEdit = (record) => {
    setEditingRecord(record.id)
    setEditForm({
      input_text: record.input_text,
      expected_output: record.expected_output || ''
    })
  }

  const saveEdit = async (recordId, datasetId) => {
    try {
      await updateRecord(recordId, editForm)
      setEditingRecord(null)
      loadRecords(datasetId)
    } catch (error) {
      console.error('Failed to update record:', error)
    }
  }

  const handleDeleteRecord = async (recordId, datasetId) => {
    if (!confirm('Delete this record?')) return
    try {
      await deleteRecord(recordId)
      loadRecords(datasetId)
      loadDatasets()
    } catch (error) {
      console.error('Failed to delete record:', error)
    }
  }

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Datasets</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          New Dataset
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Create New Dataset</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={newDataset.name}
                onChange={(e) => setNewDataset({ ...newDataset, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={newDataset.description}
                onChange={(e) => setNewDataset({ ...newDataset, description: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Source Type</label>
              <select
                value={newDataset.source_type}
                onChange={(e) => setNewDataset({ ...newDataset, source_type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="upload">Upload</option>
                <option value="api">API</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg">
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="bg-gray-200 px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Datasets List */}
      {datasets.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No datasets yet. Create one to get started!
        </div>
      ) : (
        <div className="space-y-4">
          {datasets.map((dataset) => (
            <div key={dataset.id} className="bg-white rounded-lg shadow">
              {/* Dataset Header */}
              <div className="p-4 flex items-center justify-between">
                <div
                  className="flex items-center gap-3 cursor-pointer flex-1"
                  onClick={() => toggleExpand(dataset.id)}
                >
                  {expandedDataset === dataset.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  <div>
                    <h3 className="font-semibold">{dataset.name}</h3>
                    <p className="text-sm text-gray-500">
                      {dataset.record_count} records • {dataset.source_type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 bg-green-600 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-green-700">
                    <Upload size={16} />
                    Upload
                    <input
                      type="file"
                      accept=".csv,.json"
                      className="hidden"
                      onChange={(e) => e.target.files[0] && handleUpload(dataset.id, e.target.files[0])}
                    />
                  </label>
                  <button
                    onClick={() => handleDelete(dataset.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>

              {/* Records Table */}
              {expandedDataset === dataset.id && (
                <div className="border-t p-4">
                  {!records[dataset.id] ? (
                    <p className="text-gray-500">Loading records...</p>
                  ) : records[dataset.id].length === 0 ? (
                    <p className="text-gray-500">No records. Upload a file to add data.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b">
                            <th className="pb-2 w-16">ID</th>
                            <th className="pb-2">Input Text</th>
                            <th className="pb-2">Expected Output</th>
                            <th className="pb-2 w-24">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records[dataset.id].map((record) => (
                            <tr key={record.id} className="border-b">
                              <td className="py-2">#{record.id}</td>
                              <td className="py-2">
                                {editingRecord === record.id ? (
                                  <textarea
                                    value={editForm.input_text}
                                    onChange={(e) => setEditForm({ ...editForm, input_text: e.target.value })}
                                    className="w-full border rounded px-2 py-1 text-sm"
                                    rows={3}
                                  />
                                ) : (
                                  <span className="line-clamp-2">{record.input_text}</span>
                                )}
                              </td>
                              <td className="py-2">
                                {editingRecord === record.id ? (
                                  <textarea
                                    value={editForm.expected_output}
                                    onChange={(e) => setEditForm({ ...editForm, expected_output: e.target.value })}
                                    className="w-full border rounded px-2 py-1 text-sm"
                                    rows={3}
                                  />
                                ) : (
                                  <span className="line-clamp-2 text-gray-600">
                                    {record.expected_output || '-'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2">
                                {editingRecord === record.id ? (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => saveEdit(record.id, dataset.id)}
                                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    >
                                      <Save size={16} />
                                    </button>
                                    <button
                                      onClick={() => setEditingRecord(null)}
                                      className="p-1 text-gray-600 hover:bg-gray-100 rounded"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => startEdit(record)}
                                      className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteRecord(record.id, dataset.id)}
                                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Datasets
