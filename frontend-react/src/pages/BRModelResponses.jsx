import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:8000'

function BRModelResponses() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState({})
  
  // Edit state
  const [editingResponse, setEditingResponse] = useState(null) // {recordId, modelName}
  const [editedProblems, setEditedProblems] = useState('')
  const [saving, setSaving] = useState(false)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [datasetName, setDatasetName] = useState('')
  const perPage = 10

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page])

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/br-pipeline/responses/${pipelineId}?page=${page}&per_page=${perPage}`
      )
      setRecords(res.data.records)
      setTotal(res.data.total)
      setTotalPages(res.data.total_pages)
      setCompletedCount(res.data.completed_count)
      setDatasetName(res.data.dataset_name || 'dataset')
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load response records')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateResponses = async (recordId) => {
    setGenerating(prev => ({ ...prev, [recordId]: true }))
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/br-pipeline/responses/${recordId}/generate`
      )
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, model_responses: res.data.responses, completed: true } : r
      ))
      setCompletedCount(prev => prev + 1)
    } catch (err) {
      console.error('Failed to generate responses:', err)
      alert('Failed to generate responses: ' + (err.response?.data?.detail || err.message))
    } finally {
      setGenerating(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const startEditing = (recordId, modelName, currentProblems) => {
    setEditingResponse({ recordId, modelName })
    setEditedProblems(Array.isArray(currentProblems) ? currentProblems.join('\n') : '')
  }

  const cancelEditing = () => {
    setEditingResponse(null)
    setEditedProblems('')
  }

  const saveEditedProblems = async () => {
    if (!editingResponse) return
    
    const { recordId, modelName } = editingResponse
    setSaving(true)
    
    try {
      // Convert newline-separated text to array
      const problemsArray = editedProblems
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
      
      const res = await axios.post(
        `${API_BASE_URL}/api/br-pipeline/responses/${recordId}/edit-problems`,
        {
          model_name: modelName,
          problems: problemsArray,
          edited_by: 'annotator' // You can make this dynamic based on user
        }
      )
      
      // Update local state
      setRecords(prev => prev.map(r => {
        if (r.id === recordId && r.model_responses) {
          const updatedResponses = { ...r.model_responses }
          updatedResponses[modelName] = res.data.updated_response
          return { ...r, model_responses: updatedResponses }
        }
        return r
      }))
      
      setEditingResponse(null)
      setEditedProblems('')
      alert('Problems saved successfully!')
    } catch (err) {
      console.error('Failed to save problems:', err)
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const exportToCSV = () => {
    if (records.length === 0) return

    const headers = ['Record ID', 'Question', 'Model', 'Model ID', 'Response', 'Problems', 'Edited By']
    const rows = []

    records.forEach(r => {
      if (r.model_responses) {
        Object.entries(r.model_responses).forEach(([modelName, data]) => {
          rows.push([
            r.text_record_id,
            `"${r.selected_question?.replace(/"/g, '""') || ''}"`,
            modelName,
            data.model_id || '',
            `"${data.response?.replace(/"/g, '""') || ''}"`,
            `"${(data.problems || []).join('; ')}"`,
            data.edited_by || '',
          ])
        })
      }
    })

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().split('T')[0]
    const sanitizedName = (datasetName || 'dataset').replace(/[^a-zA-Z0-9]/g, '_')
    a.download = `${sanitizedName}_${date}_export_stage4_responses.csv`
    a.click()
  }

  const goToPage = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage)
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading response records...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Stage 4: Model Responses
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Generate responses from 3 base models for each validated question
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportToCSV}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              📥 Export CSV
            </button>
            <button
              onClick={() => navigate('/text')}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Datasets
            </button>
          </div>
        </div>

        {/* Stage Navigation */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-2">
            <Link
              to={`/br-pipeline/classification/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              1. Classification
            </Link>
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/restructure/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              2. Restructure
            </Link>
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/questions/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              3. Question Validation
            </Link>
            <span className="text-gray-400">→</span>
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">
              4. Model Responses
            </span>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {total}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">With Selected Questions</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {completedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Responses Generated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {total - completedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {Math.round((completedCount / total) * 100) || 0}% Complete
              </span>
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(completedCount / total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Records */}
        <div className="space-y-6 mb-6">
          {records.map((record, idx) => (
            <div key={record.id} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              {/* Record Header */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32">
                          Actions
                        </th>
                      Record #{(page - 1) * perPage + idx + 1}
                    </span>
                    <h3 className="text-lg font-medium mt-1">
                      <span className="text-gray-600 dark:text-gray-400">Question:</span>{' '}
                      <span className="text-gray-900 dark:text-gray-100">
                        {record.selected_question || <span className="text-gray-400 italic">No question selected</span>}
                      </span>
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    {record.model_responses && (
                      <button
                        onClick={() => handleGenerateResponses(record.id)}
                        disabled={generating[record.id]}
                        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {generating[record.id] ? '⏳ Regenerating...' : '🔄 Regenerate All'}
                      </button>
                    )}
                    {!record.model_responses && record.selected_question && (
                      <button
                        onClick={() => handleGenerateResponses(record.id)}
                        disabled={generating[record.id]}
                        className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                      >
                        {generating[record.id] ? '⏳ Generating...' : '🤖 Generate Responses'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Model Responses Table */}
              {record.model_responses ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-40">
                          Model
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Response
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-48">
                          Problems
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {Object.entries(record.model_responses).map(([modelName, data]) => {
                        const isEditing = editingResponse?.recordId === record.id && editingResponse?.modelName === modelName
                        const hasCorrectedVersion = data.corrected_response
                        
                        return (
                          <tr key={modelName} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-4 text-sm">
                              <div className="font-medium text-gray-900 dark:text-white">{modelName}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{data.model_id}</div>
                              {hasCorrectedVersion && (
                                <div className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                  Corrected
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                              <div className="whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {data.response}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editedProblems}
                                    onChange={(e) => setEditedProblems(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white min-h-[100px]"
                                    placeholder="Enter problems (one per line)..."
                                  />
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                    Enter one problem per line
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={saveEditedProblems}
                                      disabled={saving}
                                      className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                    >
                                      {saving ? 'Saving...' : '💾 Save'}
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      disabled={saving}
                                      className="px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  {data.problems && data.problems.length > 0 ? (
                                    <div className="space-y-1">
                                      {data.problems.map((problem, pidx) => (
                                        <div key={pidx} className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                                          {problem}
                                        </div>
                                      ))}
                                      {data.edited_by && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                          Edited by {data.edited_by}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500 text-xs">None detected</span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-sm">
                              {!isEditing && (
                                <button
                                  onClick={() => startEditing(record.id, modelName, data.problems)}
                                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 flex items-center gap-1"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {record.selected_question 
                    ? 'Click "Generate Responses" to get model outputs'
                    : 'No question selected yet. Complete Stage 3 first.'}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total} records
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(1)}
              disabled={page === 1}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => goToPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BRModelResponses
