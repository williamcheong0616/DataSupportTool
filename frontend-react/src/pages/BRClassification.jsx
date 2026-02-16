import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getBRClassificationRecords, updateBRClassification, deleteBRClassificationRecord, getBRPipelineStatus, runBRStage1, getBRStageProgress } from '../api'

const LANGUAGES = [
  'Malay',
  'English',
  'Mandarin',
  'Tamil',
  'Hokkien',
  'Cantonese',
  'Malay + English',
  'Malay + Mandarin',
  'English + Mandarin',
  'Mixed (Multiple)',
  'Unknown'
]

const FILTER_OPTIONS = [
  { value: '', label: 'All Records' },
  { value: 'true', label: 'Bahasa Rojak Only' },
  { value: 'false', label: 'Not Bahasa Rojak' },
  { value: 'unclassified', label: 'Unclassified' },
]

function BRClassification() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [pipelineInfo, setPipelineInfo] = useState(null)
  const [rerunning, setRerunning] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState(null)
  const [deleting, setDeleting] = useState({})
  
  // Filter
  const [filter, setFilter] = useState('')
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [classifiedCount, setClassifiedCount] = useState(0)
  const perPage = 15

  useEffect(() => {
    fetchPipelineInfo()
  }, [pipelineId])

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page, filter])

  // Poll progress when pipeline is running
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(async () => {
      try {
        const res = await getBRStageProgress(pipelineId)
        setProgress(res.data)
        if (res.data.status !== 'running') {
          setPolling(false)
          fetchRecords()
          fetchPipelineInfo()
        }
      } catch (err) {
        console.error('Poll failed:', err)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [polling, pipelineId])

  const fetchPipelineInfo = async () => {
    try {
      const res = await getBRPipelineStatus(pipelineId)
      setPipelineInfo(res.data)
    } catch (err) {
      console.error('Failed to fetch pipeline info:', err)
    }
  }

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const filterParam = filter || null
      const res = await getBRClassificationRecords(pipelineId, page, perPage, filterParam)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setTotalPages(res.data.total_pages)
      setClassifiedCount(res.data.classified_count)
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load classification records')
    } finally {
      setLoading(false)
    }
  }

  const handleBRChange = async (recordId, value) => {
    setSaving(prev => ({ ...prev, [recordId]: true }))
    try {
      await updateBRClassification(recordId, { is_bahasa_rojak: value })
      // Update local state
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, is_bahasa_rojak: value } : r
      ))
      // Update classified count if it was previously null
      const record = records.find(r => r.id === recordId)
      if (record && record.is_bahasa_rojak === null) {
        setClassifiedCount(prev => prev + 1)
      }
    } catch (err) {
      console.error('Failed to update BR classification:', err)
      alert('Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const handleLanguageChange = async (recordId, value) => {
    setSaving(prev => ({ ...prev, [`lang_${recordId}`]: true }))
    try {
      await updateBRClassification(recordId, { detected_language: value })
      // Update local state
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, detected_language: value } : r
      ))
    } catch (err) {
      console.error('Failed to update language:', err)
      alert('Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [`lang_${recordId}`]: false }))
    }
  }

  const handleDelete = async (recordId) => {
    if (!confirm('Delete this record? This will also remove the underlying text record. This action cannot be undone.')) return
    
    setDeleting(prev => ({ ...prev, [recordId]: true }))
    try {
      await deleteBRClassificationRecord(recordId)
      // Remove from local state
      setRecords(prev => prev.filter(r => r.id !== recordId))
      setTotal(prev => prev - 1)
      // If the deleted record was classified, decrement classified count
      const record = records.find(r => r.id === recordId)
      if (record && record.is_bahasa_rojak !== null) {
        setClassifiedCount(prev => prev - 1)
      }
    } catch (err) {
      console.error('Failed to delete record:', err)
      alert('Failed to delete: ' + (err.response?.data?.detail || err.message))
    } finally {
      setDeleting(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const handleFilterChange = (value) => {
    setFilter(value)
    setPage(1) // Reset to page 1 when filter changes
  }

  const goToPage = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage)
    }
  }

  const handleRerunStage = async () => {
    if (!confirm('Rerun Stage 1 (BR Detection + Language Detection) for all records?\n\nThis will process in the background. You can continue working while it runs.')) return
    
    setRerunning(true)
    try {
      const res = await runBRStage1(pipelineId, null, true)
      alert(`Stage 1 started in background!\n\n${res.data.message}\n\nThe page will auto-refresh as processing completes.`)
      setPolling(true)
    } catch (err) {
      console.error('Failed to rerun stage:', err)
      alert('Failed to start Stage 1: ' + (err.response?.data?.detail || err.message))
    } finally {
      setRerunning(false)
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading classification records...</div>
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
              Stage 1: BR Classification
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Review detected language and Bahasa Rojak classification
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRerunStage}
              disabled={rerunning}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {rerunning ? '⏳ Starting...' : '🔄 Rerun Stage 1'}
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
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">
              1. Classification
            </span>
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
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              4. Model Responses
            </Link>
          </div>
        </div>

        {/* Progress Banner (shown when running) */}
        {polling && progress && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-blue-600 dark:text-blue-400">&#9203;</div>
              <div>
                <div className="font-medium text-blue-900 dark:text-blue-200">
                  Stage 1 running in background...
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  {progress.stage1_classified} / {progress.total_records} classified | {progress.stage1_language_detected} with language detected
                  {progress.error_message && (
                    <span className="text-red-600 ml-2">Error: {progress.error_message}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {total}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {filter ? 'Filtered' : 'Total'} Records
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {classifiedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Classified</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {total - classifiedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Filter Dropdown */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500 dark:text-gray-400">Filter:</label>
                <select
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  {FILTER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {Math.round((classifiedCount / total) * 100) || 0}% Complete
                </span>
                <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(classifiedCount / total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Records Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-16">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Text
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-48">
                    Detected Language
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-40">
                    Bahasa Rojak?
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((record, idx) => (
                  <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {(page - 1) * perPage + idx + 1}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      <div className="max-w-xl line-clamp-3" title={record.original_text}>
                        {record.original_text}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={record.detected_language || ''}
                        onChange={(e) => handleLanguageChange(record.id, e.target.value)}
                        disabled={saving[`lang_${record.id}`]}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                      >
                        <option value="">-- Select --</option>
                        {record.detected_language && !LANGUAGES.includes(record.detected_language) && (
                          <option value={record.detected_language}>{record.detected_language} (detected)</option>
                        )}
                        {LANGUAGES.map(lang => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleBRChange(record.id, true)}
                          disabled={saving[record.id]}
                          className={`px-3 py-1 text-sm rounded transition ${
                            record.is_bahasa_rojak === true
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/40'
                          } disabled:opacity-50`}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => handleBRChange(record.id, false)}
                          disabled={saving[record.id]}
                          className={`px-3 py-1 text-sm rounded transition ${
                            record.is_bahasa_rojak === false
                              ? 'bg-red-600 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900/40'
                          } disabled:opacity-50`}
                        >
                          No
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(record.id)}
                        disabled={deleting[record.id]}
                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                        title="Delete record"
                      >
                        {deleting[record.id] ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <div className="flex items-center gap-1">
              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (page <= 3) {
                  pageNum = i + 1
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = page - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`px-3 py-1 text-sm rounded ${
                      page === pageNum
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>
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

export default BRClassification
