import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:8000'

function BRRestructure() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [pipelineInfo, setPipelineInfo] = useState(null)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [restructuredCount, setRestructuredCount] = useState(0)
  const perPage = 10

  useEffect(() => {
    fetchPipelineInfo()
  }, [pipelineId])

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page])

  const fetchPipelineInfo = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/br-pipeline/status/${pipelineId}`)
      setPipelineInfo(res.data)
    } catch (err) {
      console.error('Failed to fetch pipeline info:', err)
    }
  }

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/br-pipeline/restructure/${pipelineId}?page=${page}&per_page=${perPage}`
      )
      setRecords(res.data.records)
      setTotal(res.data.total)
      setTotalPages(res.data.total_pages)
      setRestructuredCount(res.data.restructured_count)
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load restructure records')
    } finally {
      setLoading(false)
    }
  }

  const handleRestructuredTextChange = (recordId, value) => {
    setRecords(prev => prev.map(r => 
      r.id === recordId ? { ...r, restructured_text: value } : r
    ))
  }

  const handleSave = async (recordId) => {
    const record = records.find(r => r.id === recordId)
    if (!record) return

    setSaving(prev => ({ ...prev, [recordId]: true }))
    try {
      await axios.patch(
        `${API_BASE_URL}/api/br-pipeline/restructure/${recordId}`,
        { restructured_text: record.restructured_text }
      )
      // Update restructured count if it was previously null
      if (!record.was_restructured) {
        setRestructuredCount(prev => prev + 1)
        setRecords(prev => prev.map(r => 
          r.id === recordId ? { ...r, was_restructured: true } : r
        ))
      }
    } catch (err) {
      console.error('Failed to save restructured text:', err)
      alert('Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const handleAutoRestructure = async (recordId) => {
    setSaving(prev => ({ ...prev, [`auto_${recordId}`]: true }))
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/br-pipeline/restructure/${recordId}/auto`
      )
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, restructured_text: res.data.restructured_text, was_restructured: true } : r
      ))
    } catch (err) {
      console.error('Failed to auto-restructure:', err)
      alert('Failed to auto-restructure')
    } finally {
      setSaving(prev => ({ ...prev, [`auto_${recordId}`]: false }))
    }
  }

  const goToPage = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage)
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading restructure records...</div>
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
              Stage 2: Text Restructure
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Consolidate MCQ text into coherent paragraphs
            </p>
          </div>
          <button
            onClick={() => navigate('/text')}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ← Back to Datasets
          </button>
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
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">
              2. Restructure
            </span>
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/questions/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              3. Question Validation
            </Link>
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              4. Model Responses
            </Link>
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
                <div className="text-sm text-gray-500 dark:text-gray-400">Total Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {restructuredCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Restructured</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {total - restructuredCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {Math.round((restructuredCount / total) * 100) || 0}% Complete
              </span>
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(restructuredCount / total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Records */}
        <div className="space-y-4 mb-6">
          {records.map((record, idx) => (
            <div key={record.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 w-8">
                  #{(page - 1) * perPage + idx + 1}
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  {/* Original Text */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Original Text
                    </label>
                    <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white min-h-[120px] whitespace-pre-wrap">
                      {record.original_text}
                    </div>
                  </div>
                  
                  {/* Restructured Text */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Restructured Text
                    </label>
                    <textarea
                      value={record.restructured_text || ''}
                      onChange={(e) => handleRestructuredTextChange(record.id, e.target.value)}
                      placeholder="Enter restructured text or click Auto-Restructure..."
                      className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[120px] text-sm resize-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => handleAutoRestructure(record.id)}
                  disabled={saving[`auto_${record.id}`]}
                  className="px-3 py-1 text-sm bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60 disabled:opacity-50"
                >
                  {saving[`auto_${record.id}`] ? 'Processing...' : '🤖 Auto-Restructure'}
                </button>
                <button
                  onClick={() => handleSave(record.id)}
                  disabled={saving[record.id] || !record.restructured_text}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {saving[record.id] ? 'Saving...' : '💾 Save'}
                </button>
              </div>
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

export default BRRestructure
