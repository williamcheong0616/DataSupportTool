import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getBRClassificationRecords, updateBRClassification, getBRPipelineStatus } from '../api'

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

function BRClassification() {
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
  const [classifiedCount, setClassifiedCount] = useState(0)
  const perPage = 15

  useEffect(() => {
    fetchPipelineInfo()
  }, [pipelineId])

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page])

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
      const res = await getBRClassificationRecords(pipelineId, page, perPage)
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

  const goToPage = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage)
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
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((record, idx) => (
                  <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
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
