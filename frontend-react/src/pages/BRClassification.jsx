import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getBRClassificationRecords, updateBRClassification, deleteBRClassificationRecord, getBRPipelineStatus, runBRStage1, getBRStageProgress } from '../api'

const LANGUAGES = [
  'Malay', 'English', 'Mandarin', 'Tamil', 'Hokkien', 'Cantonese',
  'Malay + English', 'Malay + Mandarin', 'English + Mandarin',
  'Mixed (Multiple)', 'Unknown'
]

const FILTERS = [
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
  const [deleting, setDeleting] = useState({})
  const [pipeline, setPipeline] = useState(null)
  const [rerunning, setRerunning] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState(null)
  const [filter, setFilter] = useState('')

  // pagination
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [classified, setClassified] = useState(0)
  const perPage = 15

  useEffect(() => {
    getBRPipelineStatus(pipelineId)
      .then(res => setPipeline(res.data))
      .catch(err => console.error('Pipeline info failed:', err))
  }, [pipelineId])

  useEffect(() => { fetchRecords() }, [pipelineId, page, filter])

  // poll while stage is running
  useEffect(() => {
    if (!polling) return
    const id = setInterval(async () => {
      try {
        const res = await getBRStageProgress(pipelineId)
        setProgress(res.data)
        if (res.data.status !== 'running') {
          setPolling(false)
          fetchRecords()
          getBRPipelineStatus(pipelineId).then(r => setPipeline(r.data))
        }
      } catch (e) { console.error('Poll error:', e) }
    }, 3000)
    return () => clearInterval(id)
  }, [polling, pipelineId])

  async function fetchRecords() {
    setLoading(true)
    try {
      const res = await getBRClassificationRecords(pipelineId, page, perPage, filter || null)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setPages(res.data.total_pages)
      setClassified(res.data.classified_count)
    } catch (err) {
      console.error('Fetch failed:', err)
      alert('Failed to load records')
    }
    setLoading(false)
  }

  async function setBR(id, val) {
    setSaving(s => ({ ...s, [id]: true }))
    try {
      await updateBRClassification(id, { is_bahasa_rojak: val })
      setRecords(prev => prev.map(r => r.id === id ? { ...r, is_bahasa_rojak: val } : r))
      const rec = records.find(r => r.id === id)
      if (rec && rec.is_bahasa_rojak === null) setClassified(c => c + 1)
    } catch (err) {
      alert('Failed to save')
    }
    setSaving(s => ({ ...s, [id]: false }))
  }

  async function setLang(id, val) {
    setSaving(s => ({ ...s, [`l${id}`]: true }))
    try {
      await updateBRClassification(id, { detected_language: val })
      setRecords(prev => prev.map(r => r.id === id ? { ...r, detected_language: val } : r))
    } catch (err) {
      alert('Failed to save')
    }
    setSaving(s => ({ ...s, [`l${id}`]: false }))
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this record? This also removes the underlying text record and cannot be undone.')) return
    setDeleting(d => ({ ...d, [id]: true }))
    try {
      await deleteBRClassificationRecord(id)
      const rec = records.find(r => r.id === id)
      setRecords(prev => prev.filter(r => r.id !== id))
      setTotal(t => t - 1)
      if (rec && rec.is_bahasa_rojak !== null) setClassified(c => c - 1)
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
    setDeleting(d => ({ ...d, [id]: false }))
  }

  async function rerunStage() {
    if (!confirm('Rerun Stage 1 (BR + Language Detection) for all records?\nThis runs in the background.')) return
    setRerunning(true)
    try {
      const res = await runBRStage1(pipelineId, null, true)
      alert(`Stage 1 started!\n${res.data.message}`)
      setPolling(true)
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.detail || err.message))
    }
    setRerunning(false)
  }

  function changeFilter(val) {
    setFilter(val)
    setPage(1)
  }

  function goPage(p) {
    if (p >= 1 && p <= pages) setPage(p)
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading classification records...</div>
      </div>
    )
  }

  const pct = total > 0 ? Math.round((classified / total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">

        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stage 1: BR Classification</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Review detected language and Bahasa Rojak classification</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={rerunStage} disabled={rerunning}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
              {rerunning ? '⏳ Starting...' : '🔄 Rerun Stage 1'}
            </button>
            <button onClick={() => navigate('/text')} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
              ← Back to Datasets
            </button>
          </div>
        </div>

        {/* stage nav */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">1. Classification</span>
            <span className="text-gray-400">→</span>
            <Link to={`/br-pipeline/restructure/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600">2. Restructure</Link>
            <span className="text-gray-400">→</span>
            <Link to={`/br-pipeline/questions/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600">3. Question Validation</Link>
            <span className="text-gray-400">→</span>
            <Link to={`/br-pipeline/responses/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600">4. Model Responses</Link>
          </div>
        </div>

        {/* progress banner */}
        {polling && progress && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-blue-600">⏳</div>
              <div>
                <div className="font-medium text-blue-900 dark:text-blue-200">Stage 1 running...</div>
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  {progress.stage1_classified} / {progress.total_records} classified
                  {progress.error_message && <span className="text-red-600 ml-2">Error: {progress.error_message}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* stats + filter */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{total}</div>
                <div className="text-sm text-gray-500">{filter ? 'Filtered' : 'Total'} Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{classified}</div>
                <div className="text-sm text-gray-500">Classified</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{total - classified}</div>
                <div className="text-sm text-gray-500">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Filter:</label>
                <select value={filter} onChange={e => changeFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500">
                  {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{pct}% Complete</span>
                <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Text</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">Detected Language</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-40">Bahasa Rojak?</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((r, i) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-500">{(page - 1) * perPage + i + 1}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      <div className="max-w-xl line-clamp-3" title={r.original_text}>{r.original_text}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={r.detected_language || ''} onChange={e => setLang(r.id, e.target.value)} disabled={saving[`l${r.id}`]}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50">
                        <option value="">-- Select --</option>
                        {r.detected_language && !LANGUAGES.includes(r.detected_language) && (
                          <option value={r.detected_language}>{r.detected_language} (detected)</option>
                        )}
                        {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setBR(r.id, true)} disabled={saving[r.id]}
                          className={`px-3 py-1 text-sm rounded transition ${r.is_bahasa_rojak === true ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-green-100'} disabled:opacity-50`}>
                          Yes
                        </button>
                        <button onClick={() => setBR(r.id, false)} disabled={saving[r.id]}
                          className={`px-3 py-1 text-sm rounded transition ${r.is_bahasa_rojak === false ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-100'} disabled:opacity-50`}>
                          No
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => deleteRecord(r.id)} disabled={deleting[r.id]}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50" title="Delete">
                        {deleting[r.id]
                          ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        }
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => goPage(1)} disabled={page === 1} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">First</button>
            <button onClick={() => goPage(page - 1)} disabled={page === 1} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Prev</button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => {
              let p = pages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= pages - 2 ? pages - 4 + i : page - 2 + i
              return (
                <button key={p} onClick={() => goPage(p)}
                  className={`px-3 py-1 text-sm rounded ${page === p ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300'}`}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => goPage(page + 1)} disabled={page === pages} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Next</button>
            <button onClick={() => goPage(pages)} disabled={page === pages} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Last</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BRClassification
