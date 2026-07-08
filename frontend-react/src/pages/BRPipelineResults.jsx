import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBRPipelineResults } from '../api'

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
      const res = await getBRPipelineResults(pipelineId)
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
      <div className="flex items-center justify-center h-72">
        <div style={{ color: 'var(--text-dim)' }}>Loading results…</div>
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            BR Pipeline Results
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
            Pipeline #{pipelineId} — {results.total_results} records completed
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="dst-btn-success">
            Export CSV
          </button>
          <button
            onClick={() => navigate('/text/datasets')}
            className="text-sm transition-colors px-2"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="surface p-4 flex items-center gap-4">
        <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>Filter by Bahasa Rojak:</span>
        <div className="flex gap-1.5">
          {['all', 'yes', 'no'].map(filter => (
            <button
              key={filter}
              onClick={() => setFilterBR(filter)}
              className="dst-chip"
              style={filterBR === filter ? { background: 'var(--accent-dim)', borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-sm ml-auto" style={{ color: 'var(--text-dim)' }}>
          Showing {filteredResults.length} of {results.total_results} results
        </span>
      </div>

      {/* Results Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dst-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>BR</th>
                <th>Question</th>
                <th>Model</th>
                <th>Response</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((result, idx) => (
                <React.Fragment key={idx}>
                  {result.model_responses.map((modelResp, midx) => (
                    <tr key={`${idx}-${midx}`}>
                      {midx === 0 ? (
                        <>
                          <td rowSpan={result.model_responses.length}>#{result.record_id}</td>
                          <td rowSpan={result.model_responses.length}>
                            <span
                              className="dst-badge"
                              style={result.is_bahasa_rojak
                                ? { background: 'var(--green-dim)', color: 'var(--green)' }
                                : { background: 'var(--bg-input)', color: 'var(--text-dim)' }}
                            >
                              {result.is_bahasa_rojak ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td className="max-w-md" rowSpan={result.model_responses.length}>
                            <div className="line-clamp-2" title={result.selected_question}>
                              {result.selected_question}
                            </div>
                          </td>
                        </>
                      ) : null}
                      <td>
                        <div className="font-medium" style={{ color: 'var(--text-hi)' }}>{modelResp.model}</div>
                        <div className="text-xs" style={{ color: 'var(--text-dim)' }}>{modelResp.model_id}</div>
                      </td>
                      <td className="max-w-md">
                        <div className="line-clamp-3" title={modelResp.response}>{modelResp.response}</div>
                      </td>
                      <td>
                        {modelResp.problems?.length > 0 ? (
                          <div className="space-y-1">
                            {modelResp.problems.map((problem, pidx) => (
                              <div
                                key={pidx}
                                className="text-xs px-2 py-1 rounded"
                                style={{ color: 'var(--red)', background: 'var(--red-dim)' }}
                              >
                                {problem}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>None</span>
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
        <div className="surface p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No results match the current filter</p>
        </div>
      )}
    </div>
  )
}

export default BRPipelineResults
