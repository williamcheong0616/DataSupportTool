import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:8000'

function BRPipelineResults() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterBR, setFilterBR] = useState('all') // all, yes, no

  useEffect(() => {
    fetchResults()
  }, [pipelineId])

  const fetchResults = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE_URL}/api/br-pipeline/results/${pipelineId}`)
      setResults(res.data)
    } catch (err) {
      console.error('Failed to fetch results:', err)
      alert('Failed to load results')
    } finally {
      setLoading(false)
    }
  }

  const exportToCSV = () => {
    if (!results || !results.results) return

    const headers = ['Record ID', 'Bahasa Rojak', 'Restructured Text', 'Question', 'Model', 'Model ID', 'Response', 'Problems']
    const rows = []

    results.results.forEach(r => {
      r.model_responses.forEach(mr => {
        rows.push([
          r.record_id,
          r.is_bahasa_rojak ? 'Yes' : 'No',
          `"${r.restructured_text?.replace(/"/g, '""') || ''}"`,
          `"${r.selected_question?.replace(/"/g, '""') || ''}"`,
          mr.model,
          mr.model_id,
          `"${mr.response?.replace(/"/g, '""') || ''}"`,
          `"${mr.problems?.join('; ') || ''}"`,
        ])
      })
    })

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().split('T')[0]
    // Get dataset name from results if available
    const datasetName = results.dataset_name || 'br_pipeline'
    const sanitizedName = datasetName.replace(/[^a-zA-Z0-9]/g, '_')
    a.download = `${sanitizedName}_${date}_export_full_results.csv`
    a.click()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading results...</div>
      </div>
    )
  }

  if (!results) return null

  const filteredResults = results.results.filter(r => {
    if (filterBR === 'all') return true
    if (filterBR === 'yes') return r.is_bahasa_rojak === true
    if (filterBR === 'no') return r.is_bahasa_rojak === false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              BR Pipeline Results
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Pipeline #{pipelineId} - {results.total_results} records completed
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
              onClick={() => navigate('/text/datasets')}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by Bahasa Rojak:
            </span>
            <div className="flex gap-2">
              {['all', 'yes', 'no'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setFilterBR(filter)}
                  className={`px-3 py-1 rounded text-sm ${
                    filterBR === filter
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
              Showing {filteredResults.length} of {results.total_results} results
            </span>
          </div>
        </div>

        {/* Results Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Record
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    BR
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Question
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Response
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Problems
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredResults.map((result, idx) => (
                  <React.Fragment key={idx}>
                    {result.model_responses.map((modelResp, midx) => (
                      <tr key={`${idx}-${midx}`} className={midx > 0 ? 'border-t-0' : ''}>
                        {midx === 0 ? (
                          <>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white" rowSpan={result.model_responses.length}>
                              #{result.record_id}
                            </td>
                            <td className="px-4 py-3 text-sm" rowSpan={result.model_responses.length}>
                              <span className={`px-2 py-1 rounded text-xs ${
                                result.is_bahasa_rojak
                                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}>
                                {result.is_bahasa_rojak ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-md" rowSpan={result.model_responses.length}>
                              <div className="line-clamp-2" title={result.selected_question}>
                                {result.selected_question}
                              </div>
                            </td>
                          </>
                        ) : null}
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {modelResp.model}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {modelResp.model_id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-md">
                          <div className="line-clamp-3" title={modelResp.response}>
                            {modelResp.response}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {modelResp.problems?.length > 0 ? (
                            <div className="space-y-1">
                              {modelResp.problems.map((problem, pidx) => (
                                <div key={pidx} className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                                  {problem}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500 text-xs">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {filteredResults.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center mt-6">
            <p className="text-gray-500 dark:text-gray-400">
              No results match the current filter
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default BRPipelineResults
